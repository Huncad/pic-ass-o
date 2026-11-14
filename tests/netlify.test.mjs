// PIC-ASS-O — a Netlify-függvények tesztjei memóriabeli tárolóval és hamis hálózattal
// Futtatás: npm test  (node --test --experimental-test-module-mocks)
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';

// ---- hamis Netlify Blobs (ETag-gel és feltételes írással, mint az igazi) ----
const stores = new Map();
let etagSeq = 0;
function fakeStore(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  const m = stores.get(name);
  const tick = () => new Promise(r => setImmediate(r));   // valódi aszinkronitás: a versenyhelyzetek előjöhetnek
  const write = async (key, text, opts = {}) => {
    await tick();
    const cur = m.get(key);
    if (opts.onlyIfNew && cur) return { modified: false };
    if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
    const etag = 'e' + (++etagSeq);
    m.set(key, { text, etag });
    return { modified: true, etag };
  };
  return {
    async get(key, o = {}) {
      await tick();
      const cur = m.get(key);
      if (!cur) return null;
      return o.type === 'json' ? JSON.parse(cur.text) : cur.text;
    },
    async getWithMetadata(key, o = {}) {
      await tick();
      const cur = m.get(key);
      if (!cur) return null;
      return { data: o.type === 'json' ? JSON.parse(cur.text) : cur.text, etag: cur.etag, metadata: {} };
    },
    set: (key, v, o) => write(key, String(v), o),
    setJSON: (key, v, o) => write(key, JSON.stringify(v), o),
    async delete(key) { m.delete(key); },
    async list({ prefix = '' } = {}) { return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
  };
}
mock.module('@netlify/blobs', { namedExports: { getStore: ({ name }) => fakeStore(name) } });

// ---- hamis levélküldő ----
const sentMails = [];
let mailFailFor = null;
mock.module('nodemailer', {
  defaultExport: {
    createTransport: () => ({
      async sendMail(msg) {
        await new Promise(r => setImmediate(r));
        if (mailFailFor && msg.to === mailFailFor) throw new Error('SMTP hiba');
        sentMails.push(msg);
        return { messageId: 'x' };
      }
    })
  }
});

// ---- hamis hálózat (GitHub, játékszerver, saját függvényhívás) ----
const GIST_ID = 'fe34dbe63eefd11f324555359ec4cf53';
const net = { gist: null, patches: [], rooms: [], selfCalls: [], forget: [] };
function gistBody() {
  return { id: GIST_ID, updated_at: 'x', files: Object.fromEntries(Object.entries(net.gist).map(([k, v]) => [k, { content: v, truncated: false }])) };
}
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const res = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u === `https://api.github.com/gists/${GIST_ID}`) {
    if ((opts.method || 'GET') === 'PATCH') { net.patches.push(JSON.parse(opts.body)); for (const [k, v] of Object.entries(JSON.parse(opts.body).files)) { if (v === null) delete net.gist[k]; else net.gist[k] = v.content; } return res(200, {}); }
    return res(200, gistBody());
  }
  if (u.endsWith('/api/szobak')) return res(200, { rooms: net.rooms });
  if (u.endsWith('/api/forget')) { net.forget.push(JSON.parse(opts.body)); return res(200, { ok: true }); }
  if (u.startsWith('https://example.test/.netlify/functions/subscribe')) {
    net.selfCalls.push(opts);
    const { default: sub } = await import('../netlify/functions/subscribe.mjs');
    return sub(new Request(u, opts));
  }
  return res(404, { error: 'nincs ilyen a tesztben' });
};

const post = (path, body, headers = {}) => new Request('https://example.test' + path, {
  method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-nf-client-connection-ip': '1.2.3.4' }, headers), body: JSON.stringify(body)
});
const pwRecord = (pw) => { const salt = 'ab'.repeat(16), iter = 100000; return { v: 1, salt, iter, hash: pbkdf2Sync(pw, Buffer.from(salt, 'hex'), iter, 32, 'sha256').toString('hex') }; };

const { updateJSON } = await import('../netlify/lib/util.mjs');

test('updateJSON: egyszerre érkező módosítások egyike sem vész el', async () => {
  const store = fakeStore('t-concurrency');
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    updateJSON(store, 'k', raw => { const d = raw || {}; d['w' + i] = i; return { value: d }; }, 50)));
  const d = await store.get('k', { type: 'json' });
  assert.equal(Object.keys(d).length, 20);
});

test('updateJSON: write:false esetén nem ír, és visszaadja az eredményt', async () => {
  const store = fakeStore('t-nowrite');
  const r = await updateJSON(store, 'k', () => ({ write: false, result: 42 }));
  assert.equal(r, 42);
  assert.equal(await store.get('k'), null);
});

test('admin: a régi Gist-beli jelszó átköltözik a Blobs-ba és törlődik a Gistből', async () => {
  process.env.GITHUB_TOKEN = 'teszt-token';
  net.gist = { 'szavak.json': '{"konnyu":["alma"]}', 'admin.json': JSON.stringify(pwRecord('regi-jelszo-123')) };
  const { default: admin } = await import('../netlify/functions/admin.mjs');
  let r = await admin(post('/.netlify/functions/admin', { action: 'login', password: 'rossz' }));
  assert.equal(r.status, 401);
  r = await admin(post('/.netlify/functions/admin', { action: 'login', password: 'regi-jelszo-123' }));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.ok(j.session);
  assert.equal(j.migrated, true);
  assert.equal(net.gist['admin.json'], undefined, 'az admin.json törlődött a Gistből');
  assert.ok(await fakeStore('picasso-admin').get('pw-record', { type: 'json' }));

  // új jelszó: csak a Blobs-ba kerül
  r = await admin(post('/.netlify/functions/admin', { action: 'setpw', password: 'uj-jelszo-456789' }, { 'x-admin-session': j.session }));
  assert.equal(r.status, 200);
  assert.equal(net.gist['admin.json'], undefined);
  r = await admin(post('/.netlify/functions/admin', { action: 'login', password: 'regi-jelszo-123' }));
  assert.equal(r.status, 401);
  r = await admin(post('/.netlify/functions/admin', { action: 'login', password: 'uj-jelszo-456789' }));
  assert.equal(r.status, 200);

  // a jelszó-lenyomat nem írható vissza a Gistbe a GitHub-proxyn át
  r = await admin(post('/.netlify/functions/admin', { action: 'gh', method: 'PATCH', path: `/gists/${GIST_ID}`, body: JSON.stringify({ files: { 'admin.json': { content: '{}' } } }) }, { 'x-admin-session': j.session }));
  assert.equal(r.status, 403);
  // zenés tároló beállítása nélkül tárolóhoz nem enged
  r = await admin(post('/.netlify/functions/admin', { action: 'gh', method: 'PUT', path: '/repos/valaki/barmi/contents/a.mp3', body: '{}' }, { 'x-admin-session': j.session }));
  assert.equal(r.status, 403);
  // munkamenet nélkül semmi
  r = await admin(post('/.netlify/functions/admin', { action: 'setpw', password: 'xxxxxxxxxxxxx' }));
  assert.equal(r.status, 401);
});

test('gist-proxy: az admin.json soha nem kerül a válaszba', async () => {
  net.gist = { 'szavak.json': '{"konnyu":["alma"]}', 'admin.json': '{"titok":1}', 'zene.json': '{}' };
  const { default: gist } = await import('../netlify/functions/gist.mjs');
  const r = await gist(new Request('https://example.test/.netlify/functions/gist'));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.id, GIST_ID);
  assert.ok(j.files['szavak.json']);
  assert.equal(j.files['admin.json'], undefined);
  assert.match(r.headers.get('netlify-cdn-cache-control'), /s-maxage/);
});

test('ban: szobanyitás, belépés, kirúgás és heti tiltás', async () => {
  const { default: ban } = await import('../netlify/functions/ban.mjs');
  const call = async (b, ip = '1.2.3.4') => (await ban(post('/.netlify/functions/ban', b, { 'x-nf-client-connection-ip': ip }))).json();
  // két egyszerre nyitó közül csak az egyik kapja meg a szobát
  const [o1, o2] = await Promise.all([call({ action: 'open', room: 'ABCDE', dev: 'hostdevice00001' }), call({ action: 'open', room: 'ABCDE', dev: 'hostdevice00002' })]);
  const winners = [o1, o2].filter(x => x.hostKey);
  assert.equal(winners.length, 1, 'pontosan egy nyitó nyer');
  const hostKey = winners[0].hostKey;
  const ent = await call({ action: 'enter', room: 'ABCDE', dev: 'guestdevice0001' }, '5.6.7.8');
  assert.ok(ent.token);
  assert.equal((await call({ action: 'verify', room: 'ABCDE', dev: 'guestdevice0001', token: ent.token })).ok, true);
  assert.equal((await call({ action: 'kick', room: 'ABCDE', hostKey: 'rossz', targetDev: 'guestdevice0001' })).error, 'unauthorized');
  assert.equal((await call({ action: 'kick', room: 'ABCDE', hostKey, targetDev: 'guestdevice0001' })).ok, true);
  assert.equal((await call({ action: 'enter', room: 'ABCDE', dev: 'guestdevice0001' }, '5.6.7.8')).scope, 'room');
  // második szobából is kirúgva -> heti tiltás az egész játékból
  const o3 = await call({ action: 'open', room: 'FGHIJ', dev: 'hostdevice00003' }, '9.9.9.9');
  await call({ action: 'enter', room: 'FGHIJ', dev: 'guestdevice0001' }, '5.6.7.8');
  const k2 = await call({ action: 'kick', room: 'FGHIJ', hostKey: o3.hostKey, targetDev: 'guestdevice0001' }, '9.9.9.9');
  assert.equal(k2.globalBan, true);
  const blocked = await call({ action: 'enter', room: 'KLMNO', dev: 'guestdevice0001' }, '5.6.7.8');
  assert.equal(blocked.scope, 'global');
});

test('wordused / wordblock: csak a játékszerver jelezhet, és párhuzamosan sem vész el jelzés', async () => {
  process.env.PICASSO_SERVER_SECRET = 's'.repeat(32);
  net.gist = { 'szavak.json': JSON.stringify({ konnyu: ['alma', 'körte', 'szilva', 'barack', 'meggy'], kozepes: [], nehez: [] }) };
  const { default: used } = await import('../netlify/functions/wordused.mjs');
  let r = await used(post('/.netlify/functions/wordused', { word: 'alma' }));
  assert.equal(r.status, 403);
  const sec = { 'x-picasso-secret': 's'.repeat(32) };
  await Promise.all(['alma', 'körte', 'szilva', 'barack', 'meggy'].map(w => used(post('/.netlify/functions/wordused', { word: w }, sec))));
  const all = await fakeStore('picasso-wordused').get('used', { type: 'json' });
  assert.deepEqual(Object.keys(all).sort(), ['alma', 'barack', 'korte', 'meggy', 'szilva']);
  r = await used(post('/.netlify/functions/wordused', { word: 'kitalált' }, sec));
  assert.equal((await r.json()).skipped, 'not an official word');

  const { default: block } = await import('../netlify/functions/wordblock.mjs');
  await Promise.all(['alma', 'körte'].map(w => block(post('/.netlify/functions/wordblock', { word: w, votes: 2 }, sec))));
  const held = await fakeStore('picasso-wordblock').get('held', { type: 'json' });
  assert.deepEqual(Object.keys(held).sort(), ['alma', 'korte']);
});

// ---- fiókok (v4.40) ----
const ACC = '/.netlify/functions/account';
let ipSeq = 0;
const accPost = async (body, cookie = '', headers = {}) => {
  const { default: acc } = await import('../netlify/functions/account.mjs');
  const r = await acc(post(ACC, body, Object.assign({ 'x-nf-client-connection-ip': '20.0.' + (++ipSeq >> 8) + '.' + (ipSeq & 255) }, cookie ? { cookie } : {}, headers)));
  return { status: r.status, body: await r.json(), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
};
const accGet = async (qs = '', cookie = '') => {
  const { default: acc } = await import('../netlify/functions/account.mjs');
  const r = await acc(new Request('https://example.test' + ACC + qs, { headers: cookie ? { cookie } : {} }));
  return r.json();
};
/** regisztráció + megerősítés + belépés; visszaadja a munkamenet-sütit */
async function makeAccount(name, email, password = 'Nagyon-Titkos-42') {
  const { default: acc } = await import('../netlify/functions/account.mjs');
  const before = sentMails.length;
  const r = await accPost({ action: 'register', name, email, password, consent: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const mail = sentMails.slice(before).find(m => m.to === email && /Erősítsd meg a regisztrációt/.test(m.subject));
  assert.ok(mail, 'megerősítő levél ment');
  const link = /href="([^"]+\?confirm=[^"]+)"/.exec(mail.html)[1];
  assert.equal((await acc(new Request(link))).status, 200, 'a GET csak egy gombot mutat');
  assert.equal((await accGet('?name=' + encodeURIComponent(name))).taken, true, 'a név a megerősítésig is foglalt');
  assert.equal((await acc(new Request(link, { method: 'POST' }))).status, 200);
  const l = await accPost({ action: 'login', email, password });
  assert.equal(l.status, 200, JSON.stringify(l.body));
  assert.match(l.cookie, /^__Host-picasso_s=[A-Za-z0-9_-]{40,}$/);
  return l.cookie;
}

test('fiók: regisztráció, megerősítés, belépés, névvédelem', async () => {
  process.env.GMAIL_USER = 'jatek@gmail.com';
  process.env.GMAIL_APP_PASSWORD = 'xxxx xxxx xxxx xxxx';
  const { default: acc } = await import('../netlify/functions/account.mjs');
  // hibás adatok
  assert.equal((await accPost({ action: 'register', name: 'Ab', email: 'a@b.hu', password: 'Nagyon-Titkos-42', consent: true })).status, 400);
  assert.equal((await accPost({ action: 'register', name: 'Admin', email: 'a@b.hu', password: 'Nagyon-Titkos-42', consent: true })).status, 400);
  assert.equal((await accPost({ action: 'register', name: 'Péter', email: 'a@b.hu', password: 'rovid', consent: true })).status, 400);
  assert.equal((await accPost({ action: 'register', name: 'Péter', email: 'a@b.hu', password: 'password123', consent: true })).status, 400);
  assert.equal((await accPost({ action: 'register', name: 'Péter', email: 'a@b.hu', password: 'Nagyon-Titkos-42' })).status, 400, 'hozzájárulás nélkül nem megy');
  // megerősítés nélkül nincs fiók és nem lehet belépni
  const before = sentMails.length;
  await accPost({ action: 'register', name: 'Kata', email: 'kata@pelda.hu', password: 'Nagyon-Titkos-42', consent: true });
  assert.equal((await accPost({ action: 'login', email: 'kata@pelda.hu', password: 'Nagyon-Titkos-42' })).status, 401);
  assert.equal(sentMails.length, before + 1);
  // a lefoglalt nevet más nem viheti el, ékezet és kis-nagybetű nélkül sem
  assert.equal((await accPost({ action: 'register', name: 'KATA', email: 'mas@pelda.hu', password: 'Nagyon-Titkos-42', consent: true })).status, 409);
  const cookie = await makeAccount('Péter', 'peter@pelda.hu');
  assert.equal((await accGet('?name=peter')).taken, true);
  assert.equal((await accGet('?name=PÉTER ')).taken, true);
  assert.equal((await accGet('?name=Szabad')).taken, false);
  assert.equal((await accPost({ action: 'register', name: 'peter', email: 'x@pelda.hu', password: 'Nagyon-Titkos-42', consent: true })).status, 409);
  // ugyanazzal a címmel újra: a válasz ugyanaz, de fiók nem jön létre — a tulajdonos kap levelet
  const n0 = sentMails.length;
  const dup = await accPost({ action: 'register', name: 'Masik', email: 'peter@pelda.hu', password: 'Nagyon-Titkos-42', consent: true });
  assert.deepEqual(dup.body, { ok: true, pending: true });
  assert.ok(/Már van fiókod/.test(sentMails[n0].subject));
  assert.equal((await accGet('?name=Masik')).taken, false);
  // a saját adatok csak sütivel látszanak
  assert.equal((await accGet('')).user, null);
  const me = await accGet('', cookie);
  assert.equal(me.user.name, 'Péter');
  assert.equal(me.user.twofa, false);
  // a tárolóban nincs nyers jelszó és nincs nyers munkamenet-kulcs
  const dump = JSON.stringify([...stores.get('picasso-accounts').entries()]);
  assert.ok(!dump.includes('Nagyon-Titkos-42'));
  assert.ok(!dump.includes(cookie.split('=')[1]));
  // hibás jelszó: általános hibaüzenet; idegen oldalról jövő kérés tiltva
  const bad = await accPost({ action: 'login', email: 'peter@pelda.hu', password: 'nem-ez-a-jelszo' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, (await accPost({ action: 'login', email: 'nincs@pelda.hu', password: 'nem-ez-a-jelszo' })).body.error);
  assert.equal((await accPost({ action: 'ticket', pid: 'abcdefgh12345678' }, cookie, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await accPost({ action: 'ticket', pid: 'abcdefgh12345678' }, cookie, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await accPost({ action: 'ticket', pid: 'abcdefgh12345678' })).status, 401);
  // névigazoló jegy: a nyilvános kulccsal ellenőrizhető, a kapcsolat-azonosítóhoz kötött
  const t = await accPost({ action: 'ticket', pid: 'abcdefgh12345678' }, cookie);
  const { key } = await accGet('?pubkey=1');
  const { createPublicKey, verify } = await import('node:crypto');
  const [bodyB64, sig] = t.body.ticket.split('.');
  assert.ok(verify('sha256', Buffer.from(bodyB64), { key: createPublicKey({ key, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
  const claims = JSON.parse(Buffer.from(bodyB64, 'base64url').toString());
  assert.equal(claims.n, 'Péter'); assert.equal(claims.p, 'abcdefgh12345678'); assert.ok(claims.e > Date.now());
  assert.ok(!JSON.stringify(await accGet('?pubkey=1')).includes('"d"'), 'a titkos kulcs nem szivárog');
  // kilépés után a süti már nem ér semmit
  await accPost({ action: 'logout' }, cookie);
  assert.equal((await accGet('', cookie)).user, null);
  void acc;
});

test('fiók: túl sok hibás belépés után zárolás', async () => {
  await makeAccount('Zárolt', 'zarolt@pelda.hu');
  let last;
  for (let i = 0; i < 6; i++) last = await accPost({ action: 'login', email: 'zarolt@pelda.hu', password: 'rossz-jelszo-' + i });
  assert.equal(last.status, 429);
  // a zárolás alatt a jó jelszó sem enged be
  assert.equal((await accPost({ action: 'login', email: 'zarolt@pelda.hu', password: 'Nagyon-Titkos-42' })).status, 429);
});

test('fiók: kétfaktoros belépés, tartalék kódok, kód újrahasználata tiltva', async () => {
  const { totpAt } = await import('../netlify/lib/account.mjs');
  const cookie = await makeAccount('Kétfaktor', 'ketfaktor@pelda.hu');
  assert.equal((await accPost({ action: 'totp-begin', password: 'rossz' }, cookie)).status, 401);
  const b = await accPost({ action: 'totp-begin', password: 'Nagyon-Titkos-42' }, cookie);
  assert.match(b.body.secret, /^[A-Z2-7]{32}$/);
  assert.match(b.body.uri, /^otpauth:\/\/totp\//);
  assert.equal((await accPost({ action: 'totp-enable', code: '000000' }, cookie)).status, 401);
  const step = Math.floor(Date.now() / 30000);
  const en = await accPost({ action: 'totp-enable', code: totpAt(b.body.secret, step) }, cookie);
  assert.equal(en.status, 200);
  assert.equal(en.body.backup.length, 8);
  // belépés: jelszó után kódot kér
  const l1 = await accPost({ action: 'login', email: 'ketfaktor@pelda.hu', password: 'Nagyon-Titkos-42' });
  assert.deepEqual(l1.body, { need2fa: true });
  assert.equal(l1.cookie, '');
  assert.equal((await accPost({ action: 'login', email: 'ketfaktor@pelda.hu', password: 'Nagyon-Titkos-42', code: '123456' })).status, 401);
  // a beállításkor használt kód még egyszer nem jó; a következő igen, de az is csak egyszer
  assert.equal((await accPost({ action: 'login', email: 'ketfaktor@pelda.hu', password: 'Nagyon-Titkos-42', code: totpAt(b.body.secret, step) })).status, 401);
  const next = totpAt(b.body.secret, step + 1);
  assert.equal((await accPost({ action: 'login', email: 'ketfaktor@pelda.hu', password: 'Nagyon-Titkos-42', code: next })).status, 200);
  assert.equal((await accPost({ action: 'login', email: 'ketfaktor@pelda.hu', password: 'Nagyon-Titkos-42', code: next })).status, 401);
  // tartalék kód: egyszer használható
  const viaBackup = await accPost({ action: 'login', email: 'ketfaktor@pelda.hu', password: 'Nagyon-Titkos-42', code: en.body.backup[0] });
  assert.equal(viaBackup.status, 200);
  assert.equal(viaBackup.body.user.backupLeft, 7);
  assert.equal((await accPost({ action: 'login', email: 'ketfaktor@pelda.hu', password: 'Nagyon-Titkos-42', code: en.body.backup[0] })).status, 401);
  // a tartalék kódok nem nyersen tárolódnak
  assert.ok(!JSON.stringify([...stores.get('picasso-accounts').entries()]).includes(en.body.backup[1].replace('-', '')));
  // kikapcsolás jelszóval és kóddal
  const off = await accPost({ action: 'totp-disable', password: 'Nagyon-Titkos-42', code: en.body.backup[1] }, viaBackup.cookie);
  assert.equal(off.status, 200);
  assert.equal((await accPost({ action: 'login', email: 'ketfaktor@pelda.hu', password: 'Nagyon-Titkos-42' })).status, 200);
});

test('fiók: elfelejtett jelszó, jelszócsere, minden eszköz kiléptetése', async () => {
  const c1 = await makeAccount('Feledékeny', 'feledekeny@pelda.hu');
  // nem létező címre ugyanaz a válasz, de levél nem megy
  const n0 = sentMails.length;
  assert.deepEqual((await accPost({ action: 'forgot', email: 'senki@pelda.hu' })).body, { ok: true });
  assert.equal(sentMails.length, n0);
  assert.deepEqual((await accPost({ action: 'forgot', email: 'feledekeny@pelda.hu' })).body, { ok: true });
  const token = /\?reset=([A-Za-z0-9_-]+)/.exec(sentMails[n0].html)[1];
  assert.equal((await accPost({ action: 'reset', token, password: 'rovid' })).status, 400);
  assert.equal((await accPost({ action: 'reset', token: 'x'.repeat(43), password: 'Uj-Jelszo-Hosszu-1' })).status, 400);
  assert.equal((await accPost({ action: 'reset', token, password: 'Uj-Jelszo-Hosszu-1' })).status, 200);
  assert.equal((await accPost({ action: 'reset', token, password: 'Megint-Mas-Jelszo-2' })).status, 400, 'a link csak egyszer használható');
  assert.equal((await accGet('', c1)).user, null, 'a régi munkamenet megszűnt');
  assert.equal((await accPost({ action: 'login', email: 'feledekeny@pelda.hu', password: 'Nagyon-Titkos-42' })).status, 401);
  const a = await accPost({ action: 'login', email: 'feledekeny@pelda.hu', password: 'Uj-Jelszo-Hosszu-1' });
  const b = await accPost({ action: 'login', email: 'feledekeny@pelda.hu', password: 'Uj-Jelszo-Hosszu-1' });
  // jelszócsere: a régi jelszó kell hozzá, és a többi eszközt kilépteti
  assert.equal((await accPost({ action: 'password', password: 'rossz', newPassword: 'Harmadik-Jelszo-3' }, a.cookie)).status, 401);
  assert.equal((await accPost({ action: 'password', password: 'Uj-Jelszo-Hosszu-1', newPassword: 'Harmadik-Jelszo-3' }, a.cookie)).status, 200);
  assert.equal((await accGet('', a.cookie)).user.name, 'Feledékeny');
  assert.equal((await accGet('', b.cookie)).user, null);
});

test('fiók: statisztika és beállítások szinkronja, ütközéskezelés', async () => {
  const c = await makeAccount('Statisztikus', 'stat@pelda.hu');
  assert.deepEqual((await accPost({ action: 'stats-get' }, c)).body, { ok: true, stats: null, rev: 0 });
  assert.equal((await accPost({ action: 'stats-put', stats: { games: 3, wins: 1 }, rev: 0 }, c)).body.rev, 1);
  // egy másik eszköz régi állapotból írna: ütközés, visszakapja a frisset
  const conflict = await accPost({ action: 'stats-put', stats: { games: 1 }, rev: 0 }, c);
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.body.stats, { games: 3, wins: 1 });
  assert.equal((await accPost({ action: 'stats-put', stats: { games: 4, wins: 1 }, rev: 1 }, c)).body.rev, 2);
  // hibás / túl nagy adat nem megy át
  assert.equal((await accPost({ action: 'stats-put', stats: [1, 2], rev: 2 }, c)).status, 400);
  assert.equal((await accPost({ action: 'stats-put', stats: { x: 'y'.repeat(70000) }, rev: 2 }, c)).status, 400);
  // beállítások: csak az ismert kulcsok maradnak meg
  const st = await accPost({ action: 'settings-put', settings: { avatar: '#ff0000', theme: 'tabla', gonosz: '<script>', dark: '<img>' } }, c);
  assert.deepEqual(st.body.settings, { avatar: '#ff0000', theme: 'tabla' });
  assert.deepEqual((await accGet('', c)).user.settings, { avatar: '#ff0000', theme: 'tabla' });
});

test('subscribe: csak fiókkal; régi feliratkozók tájékoztatása és türelmi ideje; értesítés sorból; leiratkozás', async () => {
  const { default: sub } = await import('../netlify/functions/subscribe.mjs');
  const url = '/.netlify/functions/subscribe';
  const S = fakeStore('picasso-subscribers');
  // 30 korábbi (fiók nélküli) feliratkozó
  const emails = Array.from({ length: 30 }, (_, i) => `jatekos${i}@pelda.hu`);
  await S.setJSON('subs', { subs: Object.fromEntries(emails.map((e, i) => ['h' + i, { email: e, status: 'ok', ut: 'ut-' + i, at: 1, okAt: 1 }])) });
  // fiók nélkül nem lehet feliratkozni
  let r = await sub(post(url, { action: 'subscribe', email: 'uj@pelda.hu', consent: true }));
  assert.equal(r.status, 401);
  // az első lekérdezés elindítja a türelmi időt, és mindenki kap egy tájékoztatót
  sentMails.length = 0;
  let g = await (await sub(new Request('https://example.test' + url))).json();
  assert.equal(g.count, 30); assert.equal(g.loggedIn, false);
  assert.equal(sentMails.filter(m => /fiókhoz kötött/.test(m.subject)).length, 30);
  await sub(new Request('https://example.test' + url));
  assert.equal(sentMails.length, 30, 'a tájékoztató csak egyszer megy ki');
  const d1 = await S.get('subs', { type: 'json' });
  assert.ok(d1.legacyUntil > Date.now() + 29 * 86400000);

  // fiókkal: egy kattintás, megerősítő levél nélkül
  const cookie = await makeAccount('Értesített', 'ertesitett@pelda.hu');
  r = await sub(post(url, { action: 'subscribe', consent: true }, { cookie }));
  assert.equal(r.status, 200);
  g = await (await sub(new Request('https://example.test' + url, { headers: { cookie } }))).json();
  assert.deepEqual([g.count, g.loggedIn, g.subscribed], [31, true, true]);
  assert.equal((await accGet('', cookie)).user.notifyEmail, true);
  r = await sub(post(url, { action: 'unsubscribe' }, { cookie }));
  assert.equal((await r.json()).subscribed, false);
  // aki a régi címével regisztrál, annak a feliratkozása megmarad (a fiókjához kötődik)
  const { subHash } = await import('../netlify/lib/subs.mjs');
  const dd = await S.get('subs', { type: 'json' });
  dd.subs[subHash('jatekos0@pelda.hu')] = dd.subs.h0; delete dd.subs.h0; await S.setJSON('subs', dd);
  const c0 = await makeAccount('Régimotoros', 'jatekos0@pelda.hu');
  assert.equal((await accGet('', c0)).user.notifyEmail, true);

  // értesítés: kitalált szobáról nem megy levél
  sentMails.length = 0;
  r = await sub(post(url, { action: 'notify', code: 'ZZZZZ' }));
  assert.equal((await r.json()).skipped, 'unverified');
  // valódi szoba: mind a 30 levél kimegy (az egyik hibás címre a hiba nem állítja meg a többit)
  mailFailFor = 'jatekos3@pelda.hu';
  net.rooms = [{ code: 'ABCDE', name: 'Péntek esti buli', hostName: 'Anna', firstAt: Date.now() }];
  r = await sub(post(url, { action: 'notify', code: 'ABCDE' }, { 'x-nf-client-connection-ip': '7.7.7.7' }));
  const nj = await r.json();
  assert.equal(nj.queued, 30);
  assert.equal(sentMails.length, 29);
  assert.ok(sentMails.every(m => m.list && m.list.unsubscribe && /Péntek esti buli/.test(m.subject)));
  const q = await S.get('mailq', { type: 'json' });
  assert.equal(q.items.length, 0);
  // második értesítés a hűtési időn belül: nem megy
  r = await sub(post(url, { action: 'notify', code: 'ABCDE' }, { 'x-nf-client-connection-ip': '7.7.7.8' }));
  assert.equal((await r.json()).skipped, 'cooldown');
  // leiratkozás a levél aljáról (fiók nélkül is működik)
  const unsubLink = sentMails[0].list.unsubscribe.url;
  r = await sub(new Request(unsubLink, { method: 'POST' }));
  assert.equal(r.status, 200);
  assert.equal((await (await sub(new Request('https://example.test' + url))).json()).count, 29);
  // belső drain-hívás kulcs nélkül tilos
  r = await sub(post(url, { action: 'drain' }, { 'x-picasso-internal': 'x'.repeat(64) }));
  assert.equal(r.status, 403);
  mailFailFor = null;
});

test('subscribe: napi plafon — a maradék a sorban vár', async () => {
  process.env.MAIL_DAILY_CAP = '5';
  // friss modulpéldány a módosított plafonnal
  const { default: sub } = await import('../netlify/functions/subscribe.mjs?cap=5');
  const s = fakeStore('picasso-subscribers');
  const d = await s.get('subs', { type: 'json' });
  d.lastNotifyAt = 0; await s.setJSON('subs', d);
  await s.setJSON('mailq', { items: [], day: new Date().toISOString().slice(0, 10), sentToday: 0 });
  sentMails.length = 0;
  net.rooms = [{ code: 'QWERT', name: 'Második', hostName: 'Bence', firstAt: Date.now() }];
  const r = await sub(post('/.netlify/functions/subscribe', { action: 'notify', code: 'QWERT' }, { 'x-nf-client-connection-ip': '7.7.7.9' }));
  const j = await r.json();
  assert.equal(j.queued, 29);
  assert.equal(sentMails.length, 5, 'csak a napi plafonig');
  const q = await s.get('mailq', { type: 'json' });
  assert.equal(q.items.length, 24);
  delete process.env.MAIL_DAILY_CAP;
});

test('subscribe: a türelmi idő után a fiók nélküliek törlődnek; fióktörlés mindent visz', async () => {
  const { default: sub } = await import('../netlify/functions/subscribe.mjs');
  const S = fakeStore('picasso-subscribers');
  const d = await S.get('subs', { type: 'json' });
  d.legacyUntil = Date.now() - 1000; await S.setJSON('subs', d);
  const g = await (await sub(new Request('https://example.test/.netlify/functions/subscribe'))).json();
  assert.equal(g.count, 1, 'csak a fiókhoz kötött feliratkozás maradt');
  // fióktörlés: jelszó kell hozzá; utána a név szabad, a feliratkozás és a statisztika eltűnik
  const l = await accPost({ action: 'login', email: 'jatekos0@pelda.hu', password: 'Nagyon-Titkos-42' });
  await accPost({ action: 'stats-put', stats: { games: 1 }, rev: 0 }, l.cookie);
  assert.equal((await accPost({ action: 'delete', password: 'rossz' }, l.cookie)).status, 401);
  assert.equal((await accPost({ action: 'delete', password: 'Nagyon-Titkos-42' }, l.cookie)).status, 200);
  assert.equal((await accGet('?name=Régimotoros')).taken, false);
  assert.equal((await accGet('', l.cookie)).user, null);
  assert.equal((await (await sub(new Request('https://example.test/.netlify/functions/subscribe'))).json()).count, 0);
  assert.equal((await accPost({ action: 'login', email: 'jatekos0@pelda.hu', password: 'Nagyon-Titkos-42' })).status, 401);
  assert.ok(![...stores.get('picasso-accounts').values()].some(v => v.text.includes('jatekos0@pelda.hu')), 'a címnek nyoma sem maradt');
  assert.ok(net.forget.length === 1, 'a játékszerver is megkapta az aláírt törlési kérést');
});

test('report: gyanús eset naplózása, összevonás, admin listázás és törlés', async () => {
  const { default: rep } = await import('../netlify/functions/report.mjs');
  const url = '/.netlify/functions/report';
  const base = { action: 'report', room: 'abcde', roomName: 'Teszt', subject: 'Csaló Csaba', subjectDev: 'dev123', kind: 'chat-flood', detail: 'x', v: '4.32' };
  let r = await rep(post(url, { ...base, reporter: 'Anna' }));
  assert.equal((await r.json()).ok, true);
  // ugyanaz 10 percen belül, másik jelzőtől: egy bejegyzés, kettes számlálóval
  await rep(post(url, { ...base, reporter: 'Bence' }, { 'x-nf-client-connection-ip': '9.8.7.6' }));
  await rep(post(url, { ...base, kind: 'forged', reporter: 'Anna' }));
  r = await rep(post(url, { ...base, kind: 'nincs-ilyen', reporter: 'Anna' }));
  assert.equal(r.status, 400);
  // admin nélkül nem olvasható
  r = await rep(post(url, { action: 'list' }));
  assert.equal(r.status, 401);
  const { makeSession } = await import('../netlify/lib/adminauth.mjs');
  const sess = { 'x-admin-session': await makeSession() };
  r = await rep(post(url, { action: 'list' }, sess));
  const items = (await r.json()).items;
  assert.equal(items.length, 2);
  const flood = items.find(x => x.kind === 'chat-flood');
  assert.equal(flood.count, 2);
  assert.deepEqual(flood.reporters.sort(), ['Anna', 'Bence']);
  assert.equal(flood.room, 'ABCDE');
  assert.ok(!JSON.stringify(items).includes('1.2.3.4'), 'IP-cím nem tárolódik');
  r = await rep(post(url, { action: 'delete', id: flood.id }, sess));
  assert.equal((await r.json()).left, 1);
  r = await rep(post(url, { action: 'clear' }, sess));
  assert.equal((await r.json()).left, 0);
});

test('admin belépés: a fék hálózatonként működik — egy támadó nem zárhatja ki az admint', async () => {
  const { default: admin } = await import('../netlify/functions/admin.mjs?brake=1');
  const url = '/.netlify/functions/admin';
  // a támadó hálózat (5.5.5.x): sok rossz jelszó, több IP-ről (az IP-nkénti 5-ös korlát kikerülésére)
  let last;
  for (let i = 0; i < 25; i++) last = await admin(post(url, { action: 'login', password: 'rossz' + i }, { 'x-nf-client-connection-ip': '5.5.5.' + (i % 5 + 1) }));
  assert.equal(last.status, 429, 'a támadó hálózat megáll');
  // a valódi admin másik hálózatról be tud lépni
  const r = await admin(post(url, { action: 'login', password: 'uj-jelszo-456789' }, { 'x-nf-client-connection-ip': '8.8.4.4' }));
  assert.equal(r.status, 200);
});

test('report: hálózatonként napi plafon (a példányokon átívelően)', async () => {
  // két külön függvénypéldány (mintha a Netlify két gépen futtatná): a példányonkénti
  // 40-es fék egyiken sem telik be, a tárolóban számolt 60-as napi plafon viszont igen
  const send = async (rep, i) => (await (await rep(post('/.netlify/functions/report', { action: 'report', room: 'QQQQQ', subject: 'S' + i, kind: 'chat-flood', reporter: 'X' }, { 'x-nf-client-connection-ip': '6.6.6.6' }))).json());
  const { default: rep1 } = await import('../netlify/functions/report.mjs?ipcap=1');
  const { default: rep2 } = await import('../netlify/functions/report.mjs?ipcap=2');
  const res = [];
  for (let i = 0; i < 35; i++) res.push(await send(rep1, i));
  for (let i = 35; i < 70; i++) res.push(await send(rep2, i));
  assert.equal(res.filter(j => j.ok).length, 60, 'pontosan 60 jelzés került be');
  assert.ok(res.slice(60).every(j => j.skipped === 'ip-cap'), 'a többit a napi plafon állította meg');
});

// ---- v4.36: push értesítés ----
test('push: csak ismert push-szolgáltató címe fogadható el', async () => {
  const { cleanSubscription } = await import('../netlify/lib/push.mjs');
  const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
  assert.ok(cleanSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys }));
  assert.ok(cleanSubscription({ endpoint: 'https://web.push.apple.com/abc', keys }));
  assert.ok(cleanSubscription({ endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/abc', keys }));
  assert.equal(cleanSubscription({ endpoint: 'https://evil.example/hook', keys }), null);
  assert.equal(cleanSubscription({ endpoint: 'http://fcm.googleapis.com/x', keys }), null);
  assert.equal(cleanSubscription({ endpoint: 'https://fcm.googleapis.com.evil.example/x', keys }), null);
  assert.equal(cleanSubscription({ endpoint: 'https://picasso.taile8c93.ts.net/x', keys }), null);
  assert.equal(cleanSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'x', auth: '' } }), null);
});

test('push: kulcs lekérése, feliratkozás, leiratkozás', async () => {
  const { default: push } = await import('../netlify/functions/push.mjs');
  const cookie = await makeAccount('Pusholó', 'push@pelda.hu');
  const call = (method, body, ip = '9.9.9.1', ck = cookie) => push(new Request('https://x.test/.netlify/functions/push', {
    method, headers: Object.assign({ 'content-type': 'application/json', 'x-nf-client-connection-ip': ip }, ck ? { cookie: ck } : {}), body: body ? JSON.stringify(body) : undefined }));
  const a = await (await call('GET')).json();
  const b = await (await call('GET')).json();
  assert.match(a.key, /^[A-Za-z0-9_-]{80,}$/);
  assert.equal(a.key, b.key, 'a küldőkulcs állandó');
  assert.equal(a.count, 0);
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/teszt-1', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } };
  assert.equal((await call('POST', { action: 'subscribe', sub }, '9.9.9.1', '')).status, 401, 'fiók nélkül nem lehet értesítést kérni');
  assert.equal((await call('POST', { action: 'subscribe', sub })).status, 200);
  assert.equal((await call('POST', { action: 'subscribe', sub })).status, 200);   // kétszer ugyanaz: egy marad
  assert.equal((await (await call('GET')).json()).count, 1);
  assert.equal((await call('POST', { action: 'subscribe', sub: { endpoint: 'https://evil.example/x', keys: sub.keys } })).status, 400);
  assert.equal((await call('POST', { action: 'unsubscribe', endpoint: sub.endpoint })).status, 200);
  assert.equal((await (await call('GET')).json()).count, 0);
  // a válaszban soha nincs benne a titkos kulcs
  assert.ok(!JSON.stringify(a).includes('privateKey'));
});
