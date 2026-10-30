// PIC-ASS-O — a játékszerver (server/server.js) tesztjei valódi WebSocket-kapcsolatokkal
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 20000 + Math.floor(Math.random() * 20000);
const URL_WS = `ws://127.0.0.1:${PORT}/ws`;
const ORIGIN = 'http://localhost';
let proc, dataDir;

const sleep = ms => new Promise(r => setTimeout(r, ms));

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'picasso-test-'));
  proc = spawn(process.execPath, [process.env.PICASSO_SERVER_JS || path.join(ROOT, 'server', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', d => process.stderr.write(d));
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) return; } catch (e) {}
    await sleep(100);
  }
  throw new Error('a szerver nem indult el');
});
after(() => { try { proc.kill('SIGKILL'); } catch (e) {} });

/** Kis kliens, ami úgy viselkedik, mint a böngésző SRV-modulja (sorszámozás, újraküldés). */
function client(id, token = 'tok-' + id) {
  const c = { id, token, msgs: [], recvQ: 0, outSeq: 0, unacked: [], closes: [], ws: null, room: null };
  c.connect = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(URL_WS, { origin: ORIGIN });
    c.ws = ws;
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 2, r: c.recvQ, id, token, room: c.room })));
    ws.on('message', buf => {
      const m = JSON.parse(buf.toString());
      if (typeof m.q === 'number') { if (m.q <= c.recvQ) return; c.recvQ = m.q; }
      if (m.t === 'welcome') {
        c.welcome = m;
        if (typeof m.s === 'number') c.unacked = c.unacked.filter(x => x.s > m.s);
        if (c.room && !m.resumed) ws.send(JSON.stringify({ t: 'join', room: c.room }));
        c.unacked.forEach(x => ws.send(JSON.stringify(x)));
        resolve(m);
      }
      if (m.t === 'pong') c.unacked = c.unacked.filter(x => x.s > m.s);
      if (m.t === 'msg') c.msgs.push(m);
      if (m.t === 'joined') c.joined = m;
    });
    ws.on('close', code => { c.closes.push(code); });
    ws.on('error', reject);
  });
  c.join = async room => { c.room = room; c.ws.send(JSON.stringify({ t: 'join', room })); await sleep(80); };
  c.send = (a, d, to) => {
    const x = { t: 'send', a, d, s: ++c.outSeq };
    if (to) x.to = to;
    c.unacked.push(x);
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(x));
  };
  c.close = () => new Promise(r => { if (c.ws.readyState === 3) return r(); c.ws.once('close', r); c.ws.terminate(); });
  return c;
}

test('idegen oldalról nem lehet csatlakozni', async () => {
  const code = await new Promise(res => {
    const ws = new WebSocket(URL_WS, { origin: 'https://gonosz.example' });
    ws.on('close', c => res(c));
    ws.on('error', () => {});
  });
  assert.equal(code, 4003);
});

test('üzenettovábbítás a szobán belül, célzott üzenet csak a címzettnek', async () => {
  const a = client('aaaa1'), b = client('bbbb1'), c = client('cccc1');
  await Promise.all([a.connect(), b.connect(), c.connect()]);
  for (const x of [a, b, c]) await x.join('v2:szoba-1');
  a.send('stroke', { n: 1 });
  a.send('guess', { text: 'titok' }, ['bbbb1']);
  await sleep(150);
  assert.deepEqual(b.msgs.map(m => m.a), ['stroke', 'guess']);
  assert.deepEqual(c.msgs.map(m => m.a), ['stroke'], 'a célzott üzenet nem jut el másokhoz');
  assert.equal(b.msgs[0].f, 'aaaa1');
  await Promise.all([a.close(), b.close(), c.close()]);
});

test('foglalt azonosító más kulccsal: elutasítva', async () => {
  const a = client('dddd1');
  await a.connect();
  const fake = client('dddd1', 'mas-kulcs');
  const code = await new Promise(res => { const ws = new WebSocket(URL_WS, { origin: ORIGIN }); ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 2, id: 'dddd1', token: 'mas-kulcs' }))); ws.on('close', c => res(c)); });
  assert.equal(code, 4001);
  await a.close();
});

test('visszacsatlakozás: a kiesés alatt küldött üzenetek is megérkeznek', async () => {
  const a = client('eeee1'), b = client('ffff1');
  await Promise.all([a.connect(), b.connect()]);
  await a.join('v2:szoba-2'); await b.join('v2:szoba-2');
  b.send('x', 1);
  await sleep(80);
  await a.close();                      // "lezárt telefon"
  b.send('x', 2); b.send('x', 3);
  await sleep(80);
  const w = await a.connect();
  assert.equal(w.resumed, true);
  await sleep(150);
  assert.deepEqual(a.msgs.map(m => m.d), [1, 2, 3]);
  await Promise.all([a.close(), b.close()]);
});

test('túlterhelés: nincs csendes üzenetvesztés — bontás, újracsatlakozás, újraküldés', async () => {
  const a = client('gggg1'), b = client('hhhh1');
  await Promise.all([a.connect(), b.connect()]);
  await a.join('v2:szoba-3'); await b.join('v2:szoba-3');
  const N = 800;                         // több, mint a 600-as löketkeret
  for (let i = 1; i <= N; i++) a.send('s', i);
  await sleep(300);
  assert.ok(a.closes.includes(4008), 'a szerver túlterhelés miatt bontott');
  await a.connect();                     // a böngésző azonnal visszajön és újraküldi a nyugtázatlanokat
  await sleep(1500);
  const got = b.msgs.map(m => m.d);
  assert.equal(new Set(got).size, N, `mind a ${N} üzenet megérkezett (kapott: ${new Set(got).size})`);
  assert.deepEqual(got, [...got].sort((x, y) => x - y), 'sorrendben');
  await Promise.all([a.close(), b.close()]);
});

test('ranglista: túl rövid játék nem kerül fel, a JSON-végpont működik', async () => {
  const a = client('iiii1'), b = client('jjjj1');
  await Promise.all([a.connect(), b.connect()]);
  await a.join('v2:szoba-4'); await b.join('v2:szoba-4');
  const ack = new Promise(res => a.ws.on('message', buf => { const m = JSON.parse(buf.toString()); if (m.t === 'resultack') res(m.r); }));
  a.ws.send(JSON.stringify({ t: 'result', rows: [{ name: 'Anna', score: 100 }, { name: 'Bence', score: 50 }] }));
  assert.equal(await ack, 'túl rövid');
  const lb = await (await fetch(`http://127.0.0.1:${PORT}/api/ranglista`)).json();
  assert.ok(Array.isArray(lb));
  const html = await (await fetch(`http://127.0.0.1:${PORT}/ranglista`)).text();
  assert.match(html, /PIC-ASS-O ranglista/);
  await Promise.all([a.close(), b.close()]);
});

test('leállításkor (SIGTERM) a ranglista elmentődik és a folyamat rendben kilép', async () => {
  const exited = new Promise(res => proc.once('exit', (code, sig) => res({ code, sig })));
  proc.kill('SIGTERM');
  const { code } = await exited;
  assert.equal(code, 0);
  assert.ok(fs.existsSync(path.join(dataDir, 'games.json')));
});
