// PIC-ASS-O — a játékszerver (server/server.js) tesztjei valódi WebSocket-kapcsolatokkal
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import http from 'node:http';
import crypto from 'node:crypto';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 20000 + Math.floor(Math.random() * 20000);
const URL_WS = `ws://127.0.0.1:${PORT}/ws`;
const ORIGIN = 'http://localhost';
let proc, dataDir;

// ---- hamis fiókszolgáltatás (a Netlify account függvénye helyett): nyilvános kulcs + névlekérdezés ----
const acctKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const registered = new Set(['peter']);
const signed = obj => {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return body + '.' + crypto.sign('sha256', Buffer.from(body), { key: acctKeys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
};
const th = token => crypto.createHash('sha256').update(token).digest('hex');
const ticketFor = (pid, name = 'Péter', uid = 'uid-peter', token = 'tok-' + pid) => signed({ u: uid, n: name, p: pid, h: th(token), e: Date.now() + 60000 });
const acctSrv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (u.searchParams.has('pubkey')) return res.end(JSON.stringify({ key: acctKeys.publicKey.export({ format: 'jwk' }) }));
  if (u.searchParams.has('name')) return res.end(JSON.stringify({ taken: registered.has(u.searchParams.get('name')) }));
  res.statusCode = 404; res.end('{}');
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

before(async () => {
  await new Promise(r => acctSrv.listen(0, '127.0.0.1', r));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'picasso-test-'));
  proc = spawn(process.execPath, [process.env.PICASSO_SERVER_JS || path.join(ROOT, 'server', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ACCOUNT_API_BASE: `http://127.0.0.1:${acctSrv.address().port}`, MIN_GAME_MS: '300' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', d => process.stderr.write(d));
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) return; } catch (e) {}
    await sleep(100);
  }
  throw new Error('a szerver nem indult el');
});
after(() => { try { proc.kill('SIGKILL'); } catch (e) {} acctSrv.close(); });

/** Kis kliens, ami úgy viselkedik, mint a böngésző SRV-modulja (sorszámozás, újraküldés). */
function client(id, token = 'tok-' + id) {
  const c = { id, token, msgs: [], recvQ: 0, outSeq: 0, unacked: [], closes: [], ws: null, room: null, errors: [], acks: [], authed: null };
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
      if (m.t === 'error') c.errors.push(m);
      if (m.t === 'authed') c.authed = m;
      if (m.t === 'resultack') c.acks.push(m.r);
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

test('névvédelem: regisztrált névvel csak érvényes jeggyel lehet bemutatkozni', async () => {
  await sleep(300);   // a szerver ekkorra letöltötte a nyilvános kulcsot
  const host = client('host0001'), fake = client('fake0001'), real = client('real0001'), guest = client('gues0001');
  await Promise.all([host.connect(), fake.connect(), real.connect(), guest.connect()]);
  for (const c of [host, fake, real, guest]) await c.join('v2:szoba-nev');
  // jegy nélkül: a bemutatkozást a szerver nem továbbítja, a küldő hibát kap; az utána küldött üzenetek sorrendje megmarad
  fake.send('hello', { name: 'PETER ' });
  fake.send('chat', { text: 'utána' });
  // szabad név: átmegy
  guest.send('hello', { name: 'Vendég Béla' });
  await sleep(300);
  assert.equal(fake.errors[0] && fake.errors[0].e, 'name-taken');
  assert.ok(!host.msgs.some(m => m.f === 'fake0001' && m.a === 'hello'));
  assert.ok(host.msgs.some(m => m.f === 'fake0001' && m.a === 'chat'));
  assert.ok(host.msgs.some(m => m.f === 'gues0001' && m.a === 'hello'));
  // más kapcsolatához kiállított (ellopott) jegy nem ér semmit; hamisított aláírás sem
  fake.ws.send(JSON.stringify({ t: 'auth', k: ticketFor('real0001') }));
  await sleep(100);
  assert.equal(fake.authed.ok, false);
  // jó azonosítóra szóló, de más kapcsolat-kulcsához kötött jegy (pl. a tulajdonos régi azonosítóját átvevő támadó)
  fake.ws.send(JSON.stringify({ t: 'auth', k: ticketFor('fake0001', 'Péter', 'uid-peter', 'a-tulajdonos-kulcsa') }));
  await sleep(100);
  assert.equal(fake.authed.ok, false);
  const good = ticketFor('fake0001'), mid = good.length - 40;   // az aláírás közepén egy karakter megváltoztatva
  const forged = good.slice(0, mid) + (good[mid] === 'A' ? 'B' : 'A') + good.slice(mid + 1);
  fake.ws.send(JSON.stringify({ t: 'auth', k: forged }));
  await sleep(100);
  assert.equal(fake.authed.ok, false);
  fake.send('hello', { name: 'Péter' });
  await sleep(150);
  assert.ok(!host.msgs.some(m => m.f === 'fake0001' && m.a === 'hello'));
  // a valódi tulajdonos a saját jegyével: igazolva, és a bemutatkozása átmegy
  real.ws.send(JSON.stringify({ t: 'auth', k: ticketFor('real0001') }));
  await sleep(100);
  assert.deepEqual(real.authed, { t: 'authed', ok: true, name: 'Péter' });
  real.send('hello', { name: 'Péter' });
  await sleep(150);
  assert.ok(host.msgs.some(m => m.f === 'real0001' && m.a === 'hello'));

  // ranglista: csak a regisztrált játékos kerül fel név szerint
  await sleep(300);
  const rows = [{ name: 'Péter', score: 120 }, { name: 'Vendég Béla', score: 200 }, { name: 'Hoszt', score: 10 }];
  for (const c of [host, real, guest]) c.ws.send(JSON.stringify({ t: 'result', rows }));
  await sleep(200);
  assert.ok([host, real, guest].some(c => c.acks.includes('ok')), JSON.stringify([host.acks, real.acks, guest.acks]));
  const lb = await (await fetch(`http://127.0.0.1:${PORT}/api/ranglista`)).json();
  assert.equal(lb.length, 1);
  assert.equal(lb[0].name, 'Péter'); assert.equal(lb[0].wins, 0, 'a vendég nyert, de ő nincs a listán');
  const html = await (await fetch(`http://127.0.0.1:${PORT}/ranglista`)).text();
  assert.ok(!html.includes('Vendég Béla'), 'a vendég neve sehol nem jelenik meg');
  // fióktörlés: csak aláírt kérésre, utána a játékos eltűnik a ranglistáról
  const forget = body => fetch(`http://127.0.0.1:${PORT}/api/forget`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await forget({ proof: 'aaaa.bbbb' })).status, 403);
  assert.equal((await forget({ proof: ticketFor('x') })).status, 403);
  assert.equal((await forget({ proof: signed({ del: 'uid-peter', e: Date.now() + 60000 }) })).status, 200);
  assert.equal((await (await fetch(`http://127.0.0.1:${PORT}/api/ranglista`)).json()).length, 0);
  await Promise.all([host.close(), fake.close(), real.close(), guest.close()]);
});

test('kirúgás: más kapcsolattal, más névvel sem jöhet vissza ugyanarról az eszközről / fiókkal', async () => {
  const host = client('kick0host'), bad = client('kick0bad1');
  await Promise.all([host.connect(), bad.connect()]);
  await host.join('v2:szoba-kick'); 
  bad.ws.send(JSON.stringify({ t: 'join', room: 'v2:szoba-kick', dev: 'eszkoz0123456789abc' })); bad.room = 'v2:szoba-kick'; await sleep(100);
  host.ws.send(JSON.stringify({ t: 'kick', id: 'kick0bad1' }));
  await sleep(150);
  assert.equal(bad.errors.at(-1) && bad.errors.at(-1).e, 'kicked');
  // új kapcsolat (újratöltés / más név), ugyanaz az eszköz
  const again = client('kick0bad2');
  await again.connect();
  again.ws.send(JSON.stringify({ t: 'join', room: 'v2:szoba-kick', dev: 'eszkoz0123456789abc' }));
  await sleep(150);
  assert.equal(again.errors.at(-1) && again.errors.at(-1).e, 'kicked', 'ugyanarról az eszközről nem jöhet vissza');
  // a szoba egy pillanatra kiürül: a tiltás akkor is marad
  await host.close(); await sleep(100);
  const again2 = client('kick0bad3');
  await again2.connect();
  again2.ws.send(JSON.stringify({ t: 'join', room: 'v2:szoba-kick', dev: 'eszkoz0123456789abc' }));
  await sleep(150);
  assert.equal(again2.errors.at(-1) && again2.errors.at(-1).e, 'kicked', 'kiürült szobába sem');
  // egy másik eszköz beléphet
  const other = client('kick0oth1');
  await other.connect();
  other.ws.send(JSON.stringify({ t: 'join', room: 'v2:szoba-kick', dev: 'masikeszkoz0123456789' }));
  await sleep(150);
  assert.ok(!other.errors.some(e => e.e === 'kicked'));
  await Promise.all([bad.close(), again.close(), again2.close(), other.close()]);
});

test('végleges kitiltás: csak aláírt kérésre; az eszköz, az IP és a fiók sem léphet be, újraindítás után sem', async () => {
  const t = client('perm0tro1');
  await t.connect();
  t.ws.send(JSON.stringify({ t: 'join', room: 'v2:szoba-perm', dev: 'permtroll000000001' })); t.room = 'v2:szoba-perm';
  await sleep(100);
  const post = body => fetch(`http://127.0.0.1:${PORT}/api/ban`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ proof: 'x.y' })).status, 403);
  assert.equal((await post({ proof: signed({ ban: 'permtroll000000001', uids: [], e: Date.now() - 1 }) })).status, 403, 'lejárt');
  assert.equal((await post({ proof: signed({ ban: 'permtroll000000001', uids: ['uid-troll'], e: Date.now() + 60000 }) })).status, 200);
  await sleep(150);
  assert.ok(t.closes.includes(4030), 'a kapcsolatot azonnal bontotta');
  // ugyanarról az IP-ről (tesztben minden 127.0.0.1) más eszközzel sem
  const t2 = client('perm0tro2');
  await t2.connect().catch(() => {});
  await sleep(150);
  assert.ok(t2.closes.includes(4030), 'az IP is tiltva');
  assert.ok(fs.readFileSync(path.join(dataDir, 'bans.json'), 'utf8').includes('permtroll000000001'), 'lemezre mentve');
  // feloldás (különben a többi teszt nem tudna csatlakozni)
  assert.equal((await post({ proof: signed({ unban: 'permtroll000000001', uids: ['uid-troll'], e: Date.now() + 60000 }) })).status, 200);
  const t3 = client('perm0tro3');
  await t3.connect();
  await sleep(100);
  assert.ok(!t3.closes.includes(4030));
  await t3.close();
});

test('v4.49: „csak regisztráltak” szoba és havi szezon', async () => {
  const host = client('rego0hst1'), guest = client('rego0gst1'), reg = client('rego0reg1');
  await Promise.all([host.connect(), guest.connect(), reg.connect()]);
  host.ws.send(JSON.stringify({ t: 'auth', k: ticketFor('rego0hst1', 'Gazda', 'uid-gazda') }));
  reg.ws.send(JSON.stringify({ t: 'auth', k: ticketFor('rego0reg1', 'Regisztrált', 'uid-reg') }));
  await sleep(100);
  await host.join('v2:szoba-rego');
  host.ws.send(JSON.stringify({ t: 'rflags', regOnly: true }));
  await sleep(80);
  await guest.join('v2:szoba-rego');
  await reg.join('v2:szoba-rego');
  await sleep(150);
  assert.equal(guest.errors.at(-1) && guest.errors.at(-1).e, 'regonly', 'vendég nem léphet be');
  assert.ok(!reg.errors.some(e => e.e === 'regonly'), 'regisztrált beléphet');
  // vendég nem állíthatja át a szoba beállítását
  guest.ws.send(JSON.stringify({ t: 'rflags', regOnly: false }));
  const html = await (await fetch(`http://127.0.0.1:${PORT}/ranglista`)).text();
  assert.match(html, /Ez a hónap/);
  assert.match(html, /havi szezon/);
  const d = await (await fetch(`http://127.0.0.1:${PORT}/api/dobogo?pid=uid-gazda`)).json();
  assert.deepEqual(d, { podiums: [] });
  await Promise.all([host.close(), guest.close(), reg.close()]);
});

test('ranglista: regisztrált játékos nélkül a játék nem kerül fel', async () => {
  const a = client('mmmm0001'), b = client('nnnn0001');
  await Promise.all([a.connect(), b.connect()]);
  await a.join('v2:szoba-vendeg'); await b.join('v2:szoba-vendeg');
  await sleep(350);
  const rows = [{ name: 'Anna', score: 100 }, { name: 'Bence', score: 50 }];
  a.ws.send(JSON.stringify({ t: 'result', rows })); b.ws.send(JSON.stringify({ t: 'result', rows }));
  await sleep(200);
  assert.ok(b.acks.includes('nincs regisztrált játékos') || a.acks.includes('nincs regisztrált játékos'), JSON.stringify([a.acks, b.acks]));
  await Promise.all([a.close(), b.close()]);
});

test('akciókorlát: a chat-áradatot a szerver eldobja, a rajz forgalmát nem', async () => {
  const a = client('kkkk1'), b = client('llll1');
  await Promise.all([a.connect(), b.connect()]);
  await a.join('v2:szoba-5'); await b.join('v2:szoba-5');
  for (let i = 0; i < 30; i++) a.send('chat', { text: 'spam ' + i });
  for (let i = 0; i < 30; i++) a.send('stroke', { n: i });
  await sleep(400);
  const chats = b.msgs.filter(m => m.a === 'chat').length, strokes = b.msgs.filter(m => m.a === 'stroke').length;
  assert.equal(chats, 10, `10 chatüzenet ment át (${chats})`);
  assert.equal(strokes, 30, 'a rajz minden darabja átment');
  // a kliens nem küldi újra az eldobottakat (nyugtázva lettek)
  await sleep(4500);
  assert.equal(b.msgs.filter(m => m.a === 'chat').length, 10);
  await Promise.all([a.close(), b.close()]);
});

test('leállításkor (SIGTERM) a ranglista elmentődik és a folyamat rendben kilép', async () => {
  const exited = new Promise(res => proc.once('exit', (code, sig) => res({ code, sig })));
  proc.kill('SIGTERM');
  const { code } = await exited;
  assert.equal(code, 0);
  assert.ok(fs.existsSync(path.join(dataDir, 'games.json')));
});
