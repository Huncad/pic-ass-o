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
  if (u.endsWith('/api/ban')) { (net.bans = net.bans || []).push(JSON.parse(opts.body)); return res(200, { ok: true }); }
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

test('kirúgási napló és végleges kitiltás (admin)', async () => {
  const { default: ban } = await import('../netlify/functions/ban.mjs');
  const { makeSession } = await import('../netlify/lib/adminauth.mjs');
  const call = async (b, ip = '1.2.3.4', h = {}) => { const r = await ban(post('/.netlify/functions/ban', b, Object.assign({ 'x-nf-client-connection-ip': ip }, h))); return { status: r.status, j: await r.json() }; };
  const o = (await call({ action: 'open', room: 'LOGGA', dev: 'hostdevicelog01' }, '30.0.0.1')).j;
  await call({ action: 'enter', room: 'LOGGA', dev: 'trolldevice0001' }, '31.0.0.1');
  await call({ action: 'kick', room: 'LOGGA', hostKey: o.hostKey, targetDev: 'trolldevice0001', how: 'host', targetName: 'Troll<b>', hostName: 'Anna', roomName: 'Buli', reports: 2 }, '30.0.0.1');
  // admin nélkül semmi
  assert.equal((await call({ action: 'kicklog' })).status, 401);
  assert.equal((await call({ action: 'permban', dev: 'trolldevice0001' })).status, 401);
  const admin = { 'x-admin-session': await makeSession() };
  const log = (await call({ action: 'kicklog' }, '1.2.3.4', admin)).j;
  assert.equal(log.items[0].name, 'Trollb', 'a név tisztítva');
  assert.equal(log.items[0].reports, 2);
  const td = log.devs.find(d => d.dev === 'trolldevice0001');
  assert.ok(td && td.hosts === 1 && td.n === 1);
  assert.equal(log.devs.find(d => d.dev === 'guestdevice0001').hosts, 2, 'a több szobanyitó által kirúgott elöl');
  assert.equal(log.devs[0].dev, 'guestdevice0001');
  // még nincs végleg kitiltva
  assert.deepEqual((await call({ action: 'check', dev: 'trolldevice0001' }, '31.0.0.1')).j, { ok: true });
  net.bans = [];
  assert.equal((await call({ action: 'permban', dev: 'trolldevice0001' }, '1.2.3.4', admin)).j.ok, true);
  assert.equal(net.bans.length, 1, 'a játékszerver is megkapta');
  // az eszköz és a hozzá látott IP — más eszközről, ugyanarról a hálózatról sem
  assert.equal((await call({ action: 'check', dev: 'trolldevice0001' }, '99.0.0.1')).j.banned, 'perm');
  assert.equal((await call({ action: 'check', dev: 'ujeszkoz0000001' }, '31.0.0.1')).j.banned, 'perm');
  assert.equal((await call({ action: 'enter', room: 'LOGGB', dev: 'ujeszkoz0000001' }, '31.0.0.1')).j.scope, 'global');
  assert.deepEqual((await call({ action: 'check', dev: 'artatlan0000001' }, '32.0.0.1')).j, { ok: true });
  assert.equal((await call({ action: 'kicklog' }, '1.2.3.4', admin)).j.perms.length, 1);
  // feloldás
  assert.equal((await call({ action: 'unban', dev: 'trolldevice0001' }, '1.2.3.4', admin)).j.ok, true);
  assert.deepEqual((await call({ action: 'check', dev: 'trolldevice0001' }, '31.0.0.1')).j, { ok: true });
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
process.env.ACCOUNT_EXTRA_EMAIL_DOMAINS = 'pelda.hu, b.hu';   // a tesztek példa-domainjei
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
/** regisztráció + megerősítés (ami egyben belépés is); visszaadja a munkamenet-sütit */
async function makeAccount(name, email) {
  const { default: acc } = await import('../netlify/functions/account.mjs');
  const before = sentMails.length;
  const r = await accPost({ action: 'register', name, email, consent: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const mail = sentMails.slice(before).find(m => m.to === email && /Erősítsd meg a regisztrációt/.test(m.subject));
  assert.ok(mail, 'megerősítő levél ment');
  const link = /href="([^"]+\?confirm=[^"]+)"/.exec(mail.html)[1];
  const g = await acc(new Request(link));
  assert.equal(g.status, 200, 'a GET csak egy gombot mutat');
  assert.equal(g.headers.get('set-cookie'), null, 'a GET nem léptet be (a levélszűrők előre megnyitják)');
  assert.equal((await accGet('?name=' + encodeURIComponent(name))).taken, true, 'a név a megerősítésig is foglalt');
  const c = await acc(new Request(link, { method: 'POST' }));
  assert.equal(c.status, 200);
  const cookie = (c.headers.get('set-cookie') || '').split(';')[0];
  assert.match(cookie, /^__Host-picasso_s=[A-Za-z0-9_-]{40,}$/);
  return cookie;
}
/** belépőlink kérése és megnyitása; visszaadja az új munkamenet sütijét */
async function magicLogin(email) {
  const { default: acc } = await import('../netlify/functions/account.mjs');
  const before = sentMails.length;
  assert.deepEqual((await accPost({ action: 'magic', email })).body, { ok: true });
  const mail = sentMails.slice(before).find(m => m.to === email && /Belépés/.test(m.subject));
  if (!mail) return '';
  const link = /href="([^"]+\?login=[^"]+)"/.exec(mail.html)[1];
  const g = await acc(new Request(link));
  assert.equal(g.headers.get('set-cookie'), null, 'a GET nem léptet be');
  const r = await acc(new Request(link, { method: 'POST' }));
  return (r.headers.get('set-cookie') || '').split(';')[0];
}

test('fiók: jelszó nélküli regisztráció, megerősítés = belépés, névvédelem', async () => {
  process.env.GMAIL_USER = 'jatek@gmail.com';
  process.env.GMAIL_APP_PASSWORD = 'xxxx xxxx xxxx xxxx';
  // hibás adatok
  assert.equal((await accPost({ action: 'register', name: 'Ab', email: 'a@b.hu', consent: true })).status, 400);
  assert.equal((await accPost({ action: 'register', name: 'Admin', email: 'a@b.hu', consent: true })).status, 400);
  assert.equal((await accPost({ action: 'register', name: 'Péter', email: 'a@b.hu' })).status, 400, 'hozzájárulás nélkül nem megy');
  // a régi jelszavas végpontok nincsenek többé
  for (const action of ['login', 'forgot', 'reset', 'password', 'totp-begin']) assert.equal((await accPost({ action, email: 'a@b.hu', password: 'x' })).status >= 400, true, action);
  // a lefoglalt nevet más nem viheti el, ékezet és kis-nagybetű nélkül sem
  await accPost({ action: 'register', name: 'Kata', email: 'kata@pelda.hu', consent: true });
  assert.equal((await accPost({ action: 'register', name: 'KATA', email: 'mas@pelda.hu', consent: true })).status, 409);
  const cookie = await makeAccount('Péter', 'peter@pelda.hu');
  assert.equal((await accGet('?name=peter')).taken, true);
  assert.equal((await accGet('?name=PÉTER ')).taken, true);
  assert.equal((await accGet('?name=Szabad')).taken, false);
  // ugyanazzal a címmel újra: a válasz ugyanaz, de fiók nem jön létre — a tulajdonos kap levelet
  const n0 = sentMails.length;
  const dup = await accPost({ action: 'register', name: 'Masik', email: 'peter@pelda.hu', consent: true });
  assert.deepEqual(dup.body, { ok: true, pending: true });
  assert.ok(/Már van fiókod/.test(sentMails[n0].subject));
  // a saját adatok csak sütivel látszanak
  assert.equal((await accGet('')).user, null);
  const me = await accGet('', cookie);
  assert.equal(me.user.name, 'Péter');
  assert.ok(!('twofa' in me.user));
  // a tárolóban nincs jelszó-lenyomat és nincs nyers munkamenet-kulcs
  const dump = JSON.stringify([...stores.get('picasso-accounts').entries()]);
  assert.ok(!/"pw":|scrypt/.test(dump), 'nincs jelszó-lenyomat');
  assert.ok(!dump.includes(cookie.split('=')[1]));
  // idegen oldalról jövő kérés tiltva
  assert.equal((await accPost({ action: 'ticket', pid: 'abcdefgh12345678' }, cookie, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await accPost({ action: 'ticket', pid: 'abcdefgh12345678' }, cookie, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await accPost({ action: 'ticket', pid: 'abcdefgh12345678' })).status, 401);
  // névigazoló jegy
  const t = await accPost({ action: 'ticket', pid: 'abcdefgh12345678', th: 'ab'.repeat(32) }, cookie);
  const { key } = await accGet('?pubkey=1');
  const { createPublicKey, verify } = await import('node:crypto');
  const [bodyB64, sig] = t.body.ticket.split('.');
  assert.ok(verify('sha256', Buffer.from(bodyB64), { key: createPublicKey({ key, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
  const claims = JSON.parse(Buffer.from(bodyB64, 'base64url').toString());
  assert.equal(claims.n, 'Péter'); assert.equal(claims.p, 'abcdefgh12345678'); assert.equal(claims.h, 'ab'.repeat(32));
  assert.ok(claims.e > Date.now() && claims.e < Date.now() + 20 * 60000, 'a jegy rövid életű');
  // kilépés után a süti már nem ér semmit
  await accPost({ action: 'logout' }, cookie);
  assert.equal((await accGet('', cookie)).user, null);
});

test('fiók: belépőlink e-mailben — egyszer használható, nem árulja el a címet, kiléptetés minden eszközről', async () => {
  await makeAccount('Linkes', 'linkes@pelda.hu');
  const n0 = sentMails.length;
  assert.deepEqual((await accPost({ action: 'magic', email: 'senki@pelda.hu' })).body, { ok: true }, 'nem létező címre ugyanaz a válasz');
  assert.equal(sentMails.length, n0, '…de levél nem megy');
  const a = await magicLogin('linkes@pelda.hu');
  assert.match(a, /^__Host-picasso_s=/);
  assert.equal((await accGet('', a)).user.name, 'Linkes');
  // a link csak egyszer jó
  const { default: acc } = await import('../netlify/functions/account.mjs');
  const link = /href="([^"]+\?login=[^"]+)"/.exec(sentMails.filter(m => m.to === 'linkes@pelda.hu' && /Belépés/.test(m.subject)).at(-1).html)[1];
  const again = await acc(new Request(link, { method: 'POST' }));
  assert.equal(again.status, 404); assert.equal(again.headers.get('set-cookie'), null);
  // második eszköz, majd kiléptetés a többiből
  const b = await magicLogin('linkes@pelda.hu');
  assert.equal((await accPost({ action: 'logout-all' }, a)).status, 200);
  assert.equal((await accGet('', a)).user.name, 'Linkes');
  assert.equal((await accGet('', b)).user, null);
});

test('fiók: a régi jelszó-lenyomatok és 2FA-kulcsok az első induláskor törlődnek', async () => {
  const S = stores.get('picasso-accounts');
  // a migráció jelzője vissza, és egy régi (v4.40-es) fiók
  S.delete('mig/nopw');
  S.set('u/regifiok01', { text: JSON.stringify({ uid: 'regifiok01', name: 'Régi', email: 'regi@pelda.hu', pw: 'scrypt$15$8$1$abc$def', totp: { secret: 'X', on: true }, backup: ['h1'], sess: [] }), etag: 'x1' });
  S.set('r/abc', { text: '{"uid":"regifiok01"}', etag: 'x2' });
  const mod = await import('../netlify/functions/account.mjs?mig=1');
  await mod.default(new Request('https://example.test' + ACC + '?pubkey=1'));
  const u = JSON.parse(S.get('u/regifiok01').text);
  assert.ok(!('pw' in u) && !('totp' in u) && !('backup' in u), JSON.stringify(u));
  assert.ok(!S.has('r/abc'));
  assert.ok(S.has('mig/nopw'));
});

test('v4.51: tiltott nevek és csak magánszemélyes e-mail cím', async () => {
  for (const name of ['Admin', '4dm1n', 'R00T', 'Moderátor', 'Hivatalos Anna', 'PicassoTeam', 'Kurva', 'F4sz', 'Hitler', 'Szar'])
    assert.equal((await accPost({ action: 'register', name, email: 'tilt' + (++ipSeq) + '@gmail.com', consent: true })).status, 400, name);
  // a hétköznapi nevek átmennek (nem akadnak fenn tévesen)
  for (const name of ['Navigátor', 'Szarvas Bence', 'Dickens', 'Pinokkió', 'Botond'])
    assert.equal((await accPost({ action: 'register', name, email: 'ok' + (++ipSeq) + '@gmail.com', consent: true })).status, 200, name);
  // céges cím: nem
  const r = await accPost({ action: 'register', name: 'Cégesember', email: 'valaki@purina.nestle.com', consent: true });
  assert.equal(r.status, 400); assert.match(r.body.error, /magánszemélyes/);
  assert.equal((await accPost({ action: 'register', name: 'Freemailes', email: 'valaki@freemail.hu', consent: true })).status, 200);
  const c = await makeAccount('Cserélő', 'cserelo@pelda.hu');
  assert.equal((await accPost({ action: 'email-begin', email: 'cserelo@ceg.hu' }, c)).status, 400, 'e-mail csere céges címre sem');
  assert.equal((await accPost({ action: 'rename', name: 'Adminka' }, c)).status, 400, 'névváltoztatásnál is szűr');
});

test('v4.51: trófea-ranglista és a statisztika hihetősége', async () => {
  const a = await makeAccount('Trófeás', 'trofeas@pelda.hu');
  const b = await makeAccount('Másik', 'masik@pelda.hu');
  // első szinkron: nagy ugrás is mehet (az eszközön addig gyűjtött adat)
  assert.equal((await accPost({ action: 'stats-put', stats: { games: 60, wins: 30, points: 20000, guessRounds: 100, guessHit: 90 }, rev: 0 }, a)).status, 200);
  // utána csak kis lépés
  assert.equal((await accPost({ action: 'stats-put', stats: { games: 500, wins: 30, points: 20000, guessRounds: 100, guessHit: 90 }, rev: 1 }, a)).status, 400);
  assert.equal((await accPost({ action: 'stats-put', stats: { games: 61, wins: 31, points: 21000, guessRounds: 105, guessHit: 94 }, rev: 1 }, a)).status, 200);
  // egy másik eszköz első szinkronja: mehet nagyobb ugrás, de naponta csak párszor
  assert.equal((await accPost({ action: 'stats-put', first: true, stats: { games: 80, wins: 40, points: 30000, guessRounds: 150, guessHit: 130 }, rev: 2 }, a)).status, 200);
  const revNow = async () => (await accPost({ action: 'stats-get' }, a)).body.rev;
  for (let i = 0; i < 2; i++) await accPost({ action: 'stats-put', first: true, stats: { games: 80 + i, wins: 40, points: 30000, guessRounds: 150, guessHit: 130 }, rev: await revNow() }, a);
  assert.equal((await accPost({ action: 'stats-put', first: true, stats: { games: 400, wins: 40, points: 30000, guessRounds: 150, guessHit: 130 }, rev: await revNow() }, a)).status, 400, 'a 4. „első szinkron” aznap már nem');
  // ellentmondás: soha
  assert.equal((await accPost({ action: 'stats-put', stats: { games: 1, wins: 5 }, rev: 0 }, b)).status, 400);
  await accPost({ action: 'stats-put', stats: { games: 1 }, rev: 0 }, b);
  const top = await accGet('?achtop=1', a);
  assert.equal(top.rows[0].name, 'Trófeás');
  assert.ok(top.rows[0].count >= 8 && top.rows[0].points > 100, JSON.stringify(top.rows[0]));
  assert.equal(top.mine.rank, 1);
  assert.equal(top.rows[1].name, 'Másik');
  // nem nyilvános profil: lekerül a ranglistáról
  await accPost({ action: 'prefs-put', profilePublic: false }, a);
  assert.ok(!(await accGet('?achtop=1')).rows.some(r => r.name === 'Trófeás'));
});

test('v4.49: e-mail csere, névváltoztatás, eszközök, adatletöltés', async () => {
  const { default: acc } = await import('../netlify/functions/account.mjs');
  const c = await makeAccount('Váltó', 'valto@pelda.hu');
  // e-mail csere: megerősítés az új címről; addig nem változik
  const n0 = sentMails.length;
  assert.equal((await accPost({ action: 'email-begin', email: 'uj-valto@pelda.hu' }, c)).status, 200);
  const conf = sentMails.slice(n0).find(m => m.to === 'uj-valto@pelda.hu');
  assert.ok(conf && sentMails.slice(n0).some(m => m.to === 'valto@pelda.hu'), 'a régi címre is szól');
  assert.equal((await accGet('', c)).user.email, 'valto@pelda.hu');
  const link = /href="([^"]+\?emailchg=[^"]+)"/.exec(conf.html)[1];
  assert.equal((await acc(new Request(link))).status, 200);
  assert.equal((await acc(new Request(link, { method: 'POST' }))).status, 200);
  assert.equal((await accGet('', c)).user.email, 'uj-valto@pelda.hu');
  assert.equal((await acc(new Request(link, { method: 'POST' }))).status, 404, 'egyszer használható');
  assert.equal(await magicLogin('valto@pelda.hu'), '', 'a régi címre már nem megy belépőlink');
  assert.match(await magicLogin('uj-valto@pelda.hu'), /^__Host-picasso_s=/);
  // névváltoztatás: a régi név 30 napig foglalt marad, és 30 napig nem lehet újra
  const r1 = await accPost({ action: 'rename', name: 'Újnév' }, c);
  assert.equal(r1.body.user.name, 'Újnév');
  assert.equal((await accGet('?name=Váltó')).taken, true, 'a régi név foglalt marad');
  assert.equal((await accPost({ action: 'register', name: 'Valto', email: 'mas2@pelda.hu', consent: true })).status, 409);
  assert.equal((await accPost({ action: 'rename', name: 'Harmadik' }, c)).status, 429);
  const t = await accPost({ action: 'ticket', pid: 'abcdefgh12345678' }, c);
  assert.equal(t.body.name, 'Újnév', 'a névigazoló jegy már az új nevet mondja');
  // eszközök: kiléptetés egyenként
  const other = await magicLogin('uj-valto@pelda.hu');
  const ss = (await accPost({ action: 'sessions' }, c)).body.sessions;
  assert.ok(ss.length >= 3 && ss.filter(x => x.current).length === 1);
  const victim = ss.find(x => !x.current);
  assert.equal((await accPost({ action: 'session-revoke', id: victim.id }, c)).status, 200);
  assert.equal((await accPost({ action: 'sessions' }, c)).body.sessions.length, ss.length - 1);
  assert.equal((await accPost({ action: 'session-revoke', id: ss.find(x => x.current).id }, c)).status, 400);
  void other;
  // adatletöltés: minden benne, titok nincs
  const ex = (await accPost({ action: 'export' }, c)).body;
  assert.equal(ex.account.name, 'Újnév'); assert.equal(ex.account.email, 'uj-valto@pelda.hu');
  assert.deepEqual(ex.account.previousNames, ['Váltó']);
  assert.ok(!JSON.stringify(ex).match(/"pub"|"sess"|"pw"|scrypt/), 'nincs benne kulcs vagy munkamenet-azonosító');
  // a levelekben sehol nem esik szó jelszóról
  assert.ok(!sentMails.some(m => /jelsz/i.test(m.html)), 'egyetlen levél sem említ jelszót');
});

test('v4.49: profil, követés, szólisták, galéria, állandó szobakód', async () => {
  const { default: acc } = await import('../netlify/functions/account.mjs');
  const a = await makeAccount('Profilos', 'profilos@pelda.hu');
  const b = await makeAccount('Követő', 'koveto@pelda.hu');
  await accPost({ action: 'stats-put', stats: { games: 12, wins: 4, points: 1500, badges: { fast: 2, '<x>': 1 } }, rev: 0 }, a);
  // nyilvános profil: csak összesítők, e-mail cím nincs benne
  const p = await accGet('?profile=profilos');
  assert.equal(p.found, true); assert.equal(p.stats.games, 12); assert.deepEqual(p.stats.badges, { fast: 2 });
  assert.ok(!JSON.stringify(p).includes('profilos@pelda.hu'));
  assert.equal((await accGet('?profile=Vendég Ember')).found, false);
  // követés
  assert.equal((await accPost({ action: 'follow', name: 'PROFILOS' }, b)).body.user.friends[0].name, 'Profilos');
  assert.equal((await accPost({ action: 'follow', name: 'Követő' }, b)).status, 400, 'magát nem');
  assert.equal((await accGet('?profile=Profilos', b)).following, true);
  assert.equal((await accGet('?profile=Profilos')).followers, 1);
  // nem nyilvános profil
  await accPost({ action: 'prefs-put', profilePublic: false }, a);
  const priv = await accGet('?profile=Profilos');
  assert.equal(priv.private, true); assert.equal(priv.stats, undefined);
  assert.ok((await accGet('?profile=Profilos', a)).stats, 'a gazdája látja');
  await accPost({ action: 'prefs-put', profilePublic: true }, a);
  // szólisták
  const wl = await accPost({ action: 'wordlists-put', lists: [{ name: 'Családi<b>', words: ['alma', 'Alma', ' körte ', '<script>'] }] }, a);
  assert.deepEqual(wl.body.wordlists, [{ name: 'Családib', words: ['alma', 'körte', 'script'] }]);
  // galéria
  const img = 'data:image/webp;base64,' + Buffer.from('kep').toString('base64');
  assert.equal((await accPost({ action: 'gallery-add', img: 'data:text/html;base64,PHNjcmlwdD4=', word: 'x' }, a)).status, 400);
  const g = await accPost({ action: 'gallery-add', img, word: 'macska' }, a);
  assert.equal(g.status, 200);
  const pid = (await accGet('?profile=Profilos')).pid;
  const ir = await acc(new Request('https://example.test' + ACC + '?img=' + pid + '.' + g.body.id));
  assert.equal(ir.status, 200); assert.equal(ir.headers.get('content-type'), 'image/webp');
  assert.equal((await accGet('?profile=Profilos')).gallery[0].word, 'macska');
  // állandó szobakód: egyedi
  assert.equal((await accPost({ action: 'roomcode-set', code: 'ab0de' }, a)).status, 400, 'tiltott karakter (0)');
  assert.equal((await accPost({ action: 'roomcode-set', code: 'adam5' }, a)).body.user.roomCode, 'ADAM5');
  assert.equal((await accPost({ action: 'roomcode-set', code: 'ADAM5' }, b)).status, 409);
  // a szobanyitás: a lefoglalt kódot más nem nyithatja meg, a gazdája igen
  const { default: ban } = await import('../netlify/functions/ban.mjs');
  const open = async (cookie) => (await ban(post('/.netlify/functions/ban', { action: 'open', room: 'ADAM5', dev: 'devicecode000001' }, Object.assign({ 'x-nf-client-connection-ip': '44.0.0.' + (++ipSeq % 200) }, cookie ? { cookie } : {})))).json();
  assert.equal((await open('')).error, 'reserved');
  assert.equal((await open(b)).error, 'reserved');
  assert.ok((await open(a)).hostKey);
  assert.ok((await open(a)).hostKey, 'újra is megnyithatja a saját kódját');
  // fióktörlés: a galéria, a követések és a kód is megy
  assert.equal((await accPost({ action: 'delete', confirmName: 'Profilos' }, a)).status, 200);
  assert.equal((await accGet('', b)).user.friends.length, 1, 'a követő listája lusta: a név megmarad, de a profil eltűnt');
  assert.equal((await accGet('?profile=Profilos')).found, false);
  assert.ok(![...stores.get('picasso-accounts').keys()].some(k => k.startsWith('gi/' + pid) || k === 'rc/ADAM5'));
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
  const st = await accPost({ action: 'settings-put', settings: { 'avatar-color': '#ff0000', theme: 'tabla', gonosz: '<script>', 'chat-pos': '{"x":0.5}', 'sfx-vol': 'x'.repeat(5000) } }, c);
  assert.deepEqual(st.body.settings, { 'avatar-color': '#ff0000', theme: 'tabla', 'chat-pos': '{"x":0.5}' }, 'ismeretlen kulcs és túl hosszú érték nem megy át');
  assert.deepEqual((await accGet('', c)).user.settings, { 'avatar-color': '#ff0000', theme: 'tabla', 'chat-pos': '{"x":0.5}' });
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
  // fióktörlés: a név begépelése kell hozzá; utána a név szabad, a feliratkozás és a statisztika eltűnik
  const l = { cookie: await magicLogin('jatekos0@pelda.hu') };
  await accPost({ action: 'stats-put', stats: { games: 1 }, rev: 0 }, l.cookie);
  assert.equal((await accPost({ action: 'delete', confirmName: 'rossz' }, l.cookie)).status, 400);
  assert.equal((await accPost({ action: 'delete', confirmName: 'Régimotoros' }, l.cookie)).status, 200);
  assert.equal((await accGet('?name=Régimotoros')).taken, false);
  assert.equal((await accGet('', l.cookie)).user, null);
  assert.equal((await (await sub(new Request('https://example.test/.netlify/functions/subscribe'))).json()).count, 0);
  assert.equal(await magicLogin('jatekos0@pelda.hu'), '', 'törölt fiókba belépőlink sem megy');
  assert.ok(![...stores.get('picasso-accounts').values()].some(v => v.text.includes('jatekos0@pelda.hu')), 'a címnek nyoma sem maradt');
  assert.ok(net.forget.length >= 1, 'a játékszerver is megkapta az aláírt törlési kérést');
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
