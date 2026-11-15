// PIC-ASS-O — a játékszerver terheléses tesztje (v4.52)
// Sok szoba, sok játékos egyszerre, valósághű forgalommal: a rajzoló folyamatosan küldi a vonalakat,
// a többiek tippelnek (csak a rajzolónak), chatelnek, reagálnak; a szobanyitók hirdetik a szobát a
// szobalistán; a játékosok egy része menet közben megszakad és visszacsatlakozik (lezárt telefon).
// Mér: a szerver memóriáját (RSS) és processzoridejét, az üzenetek késleltetését (p50 / p95 / p99),
// az elveszett üzeneteket, és a szobalista-forgalmat.
//
// Futtatás: node tests/load/load.mjs [szobák] [játékos/szoba] [másodperc]
//   pl. node tests/load/load.mjs 100 8 60
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOMS = Number(process.argv[2] || 50), PER = Number(process.argv[3] || 8), SECS = Number(process.argv[4] || 45);
const PORT = 30000 + Math.floor(Math.random() * 20000);
const ORIGIN = 'http://localhost';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = n => Math.floor(Math.random() * n);

// ---- szerver ----
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'picasso-load-'));
const srv = spawn(process.execPath, [process.env.PICASSO_SERVER_JS || path.join(ROOT, 'server', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, MAX_CONN_PER_IP: '100000', ACCOUNT_API_BASE: 'http://127.0.0.1:1' }, stdio: ['ignore', 'ignore', 'pipe']
});
let srvErr = '';
srv.stderr.on('data', d => { srvErr += d; });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch (e) {} await sleep(100); }

function procStats(pid) {
  try {
    const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    const rss = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) / 1024;
    return { cpu: (Number(st[11]) + Number(st[12])) / 100, rss };   // utime + stime, 100 tick / mp
  } catch (e) { return { cpu: 0, rss: 0 }; }
}

// ---- kliens (ugyanaz a protokoll, mint a böngésző SRV-modulja: sorszámozás, nyugta, újraküldés) ----
const lat = []; let sentMsgs = 0, recvMsgs = 0, dupMsgs = 0, dirMsgs = 0, errors = 0, reconnects = 0, closedByServer = 0;
function client(id) {
  const c = { id, ip: `10.${rnd(250)}.${rnd(250)}.${1 + rnd(250)}`, token: crypto.randomBytes(16).toString('hex'), recvQ: 0, outSeq: 0, unacked: [], ws: null, room: null, seen: new Set(), open: false, peers: 0 };
  c.connect = () => new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { origin: ORIGIN, perMessageDeflate: true, headers: { 'x-forwarded-for': c.ip } });   // mindenki a saját IP-jéről (mint a valóságban)
    c.ws = ws;
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 2, r: c.recvQ, id, token: c.token, dir: true, room: c.room })));
    ws.on('message', buf => {
      let m; try { m = JSON.parse(buf.toString()); } catch (e) { return; }
      if (typeof m.q === 'number') { if (m.q <= c.recvQ) { dupMsgs++; return; } c.recvQ = m.q; }
      if (m.t === 'welcome') {
        c.open = true;
        if (typeof m.s === 'number') c.unacked = c.unacked.filter(x => x.s > m.s);
        if (c.room && !m.resumed) ws.send(JSON.stringify({ t: 'join', room: c.room }));
        c.unacked.forEach(x => ws.send(JSON.stringify(x)));
        resolve();
      }
      if (m.t === 'pong') c.unacked = c.unacked.filter(x => x.s > m.s);
      if (m.t === 'dir') dirMsgs++;
      if (m.t === 'error') errors++;
      if (m.t === 'msg') {
        recvMsgs++;
        const d = m.d || {};
        if (d.mid) { if (c.seen.has(d.mid)) dupMsgs++; c.seen.add(d.mid); if (c.seen.size > 5000) c.seen.clear(); }
        if (d.ts) lat.push(Date.now() - d.ts);
      }
    });
    ws.on('close', code => { c.open = false; if (code >= 4000 && code !== 4002) closedByServer++; });
    ws.on('error', () => {});
  });
  c.join = room => { c.room = room; c.ws.send(JSON.stringify({ t: 'join', room })); };
  c.send = (a, d, to) => {
    const x = { t: 'send', a, d, s: ++c.outSeq };
    if (to) x.to = to;
    c.unacked.push(x);
    if (c.unacked.length > 2000) c.unacked.shift();
    if (c.ws && c.ws.readyState === 1) c.ws.send(JSON.stringify(x));
    sentMsgs++;
  };
  // lezárt telefon: a kapcsolat megszakad, pár mp múlva ugyanazzal az azonosítóval vissza
  c.drop = async () => { reconnects++; try { c.ws.terminate(); } catch (e) {} await sleep(1500 + rnd(3000)); await c.connect(); };
  return c;
}

// ---- forgatókönyv ----
console.log(`Terhelés: ${ROOMS} szoba × ${PER} játékos + ${Math.round(ROOMS * PER * 0.2)} nézelődő a szobalistán = ${Math.round(ROOMS * PER * 1.2)} egyidejű kapcsolat, ${SECS} mp`);
const rooms = [];
const t0 = Date.now();
for (let r = 0; r < ROOMS; r++) {
  const members = [];
  for (let p = 0; p < PER; p++) members.push(client(`r${r}p${p}x${crypto.randomBytes(4).toString('hex')}`));
  rooms.push({ id: `v2:terheles-${r}-${crypto.randomBytes(6).toString('hex')}`, code: 'T' + String(r).padStart(4, '0').slice(-4), members });
}
// kapcsolódás hullámokban (ahogy egy esti csúcsban érkeznek)
for (let i = 0; i < rooms.length; i += 20) {
  await Promise.all(rooms.slice(i, i + 20).flatMap(rm => rm.members.map(c => c.connect())));
  for (const rm of rooms.slice(i, i + 20)) rm.members.forEach(c => c.join(rm.id));
  await sleep(50);
}
// nézelődők: a kezdőképernyőn böngészik a szobalistát (a játékosok ~20%-a)
const lurkers = [];
for (let i = 0; i < Math.round(ROOMS * PER * 0.2); i++) lurkers.push(client('lurk' + i + 'x' + crypto.randomBytes(4).toString('hex')));
for (let i = 0; i < lurkers.length; i += 50) await Promise.all(lurkers.slice(i, i + 50).map(c => c.connect()));
const tConnected = Date.now() - t0;
await sleep(500);
const base = procStats(srv.pid);
console.log(`  ✔ mind kapcsolódott ${tConnected} ms alatt · szerver RSS ${base.rss.toFixed(0)} MB`);

// forgalom
let mid = 0, stop = false;
const timers = [];
for (const rm of rooms) {
  let drawer = 0;
  const host = rm.members[0];
  // szobahirdetés 5 mp-enként (mint a böngésző), a zárt szobák ujjlenyomattal
  timers.push(setInterval(() => { if (host.open) host.ws.send(JSON.stringify({ t: 'dir', d: { id: 'h:' + crypto.createHash('sha256').update(rm.id).digest('hex').slice(0, 32), name: 'Szoba ' + rm.code, hostName: 'Host', players: PER, max: 12, inGame: true } })); }, 5000 + rnd(500)));
  // rajzolás: 10 vonaldarab / mp, ~300 bájt
  timers.push(setInterval(() => {
    const d = rm.members[drawer];
    if (d.open) d.send('stroke', { k: 'd', b: 0, s: [{ c: '#222', w: 4, p: Array.from({ length: 24 }, () => rnd(900)) }], mid: ++mid, ts: Date.now() });
  }, 100));
  // tippek a rajzolónak (fejenként ~4 mp-enként), a rajzoló visszaküldi mindenkinek a „feed”-be
  timers.push(setInterval(() => {
    const g = rm.members[1 + rnd(PER - 1)];
    const d = rm.members[drawer];
    if (g.open && d.open) { g.send('guess', { name: 'x', text: 'tipp' + rnd(1000), mid: ++mid, ts: Date.now() }, [d.id]); d.send('feed', { pid: g.id, text: 'tipp', mid: ++mid, ts: Date.now() }); }
  }, Math.max(300, 4000 / (PER - 1))));
  // chat és reakció
  timers.push(setInterval(() => { const c = rm.members[rnd(PER)]; if (c.open) c.send('chat', { type: 'text', text: 'szia', mid: ++mid, ts: Date.now() }); }, 3000 + rnd(2000)));
  timers.push(setInterval(() => { const c = rm.members[rnd(PER)]; if (c.open) c.send('reaction', { e: '😂', mid: ++mid, ts: Date.now() }); }, 4000 + rnd(2000)));
  // nyugta (ping) 5 mp-enként, mint a böngésző
  timers.push(setInterval(() => rm.members.forEach(c => { if (c.open) c.ws.send(JSON.stringify({ t: 'ping', r: c.recvQ })); }), 5000));
  // körváltás 20 mp-enként
  timers.push(setInterval(() => { drawer = (drawer + 1) % PER; }, 20000));
}
// a játékosok ~5%-a percenként megszakad és visszajön
timers.push(setInterval(() => { for (const rm of rooms) if (Math.random() < 0.05) rm.members[1 + rnd(PER - 1)].drop(); }, 6000));

const samples = [];
const sampler = setInterval(() => samples.push(procStats(srv.pid)), 1000);
await sleep(SECS * 1000);
stop = true;
timers.forEach(clearInterval);
await sleep(2500);
clearInterval(sampler);

// ---- eredmény ----
const end = procStats(srv.pid);
const health = await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json().catch(() => ({}));
lat.sort((a, b) => a - b);
const q = p => lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] : 0;
const cpuUse = samples.length > 1 ? (samples.at(-1).cpu - samples[0].cpu) / (samples.length - 1) * 100 : 0;
const maxRss = Math.max(...samples.map(s => s.rss));
const expectedApprox = Math.round(recvMsgs);   // tájékoztató
const res = {
  kapcsolatok: Math.round(ROOMS * PER * 1.2), szobak: ROOMS, masodperc: SECS,
  kapcsolodas_ms: tConnected,
  szerver_rss_MB: { indulas: base.rss.toFixed(0), csucs: maxRss.toFixed(0), vege: end.rss.toFixed(0) },
  szerver_cpu_szazalek_atlag: cpuUse.toFixed(0),
  kuldott: sentMsgs, kapott: recvMsgs, uzenet_per_mp: Math.round(recvMsgs / SECS), dupla: dupMsgs,
  szobalista_uzenet_per_mp: Math.round(dirMsgs / SECS),
  kesleltetes_ms: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: lat.at(-1) || 0 },
  ujracsatlakozas: reconnects, szerver_altal_bontott: closedByServer, hibauzenet: errors,
  health
};
console.log(JSON.stringify(res, null, 2));
if (srvErr.trim()) console.log('SZERVER HIBA:\n' + srvErr.slice(-2000));
for (const c of [...rooms.flatMap(r => r.members), ...lurkers]) { try { c.ws.terminate(); } catch (e) {} }
srv.kill('SIGTERM');
void expectedApprox;
process.exit(0);
