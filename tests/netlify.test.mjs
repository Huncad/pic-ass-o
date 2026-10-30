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
const net = { gist: null, patches: [], rooms: [], selfCalls: [] };
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

test('subscribe: feliratkozás, megerősítés, értesítés sorból, leiratkozás', async () => {
  process.env.GMAIL_USER = 'jatek@gmail.com';
  process.env.GMAIL_APP_PASSWORD = 'xxxx xxxx xxxx xxxx';
  const { default: sub } = await import('../netlify/functions/subscribe.mjs');
  const url = '/.netlify/functions/subscribe';
  const emails = Array.from({ length: 30 }, (_, i) => `jatekos${i}@pelda.hu`);
  // párhuzamos feliratkozások (külön IP-ről, a sebességkorlát miatt)
  await Promise.all(emails.map((e, i) => sub(post(url, { action: 'subscribe', email: e, consent: true }, { 'x-nf-client-connection-ip': '10.0.0.' + i }))));
  const confirms = sentMails.filter(m => /Erősítsd meg/.test(m.subject));
  assert.equal(confirms.length, 30);
  const d0 = await fakeStore('picasso-subscribers').get('subs', { type: 'json' });
  assert.equal(Object.keys(d0.subs).length, 30, 'egyik feliratkozás sem veszett el');
  // mindenki megerősít
  for (const m of confirms) {
    const link = /href="([^"]+\?confirm=[^"]+)"/.exec(m.html)[1];
    const r = await sub(new Request(link, { method: 'POST' }));
    assert.equal(r.status, 200);
  }
  const count = await (await sub(new Request('https://example.test' + url))).json();
  assert.equal(count.count, 30);

  // értesítés: kitalált szobáról nem megy levél
  sentMails.length = 0;
  let r = await sub(post(url, { action: 'notify', code: 'ZZZZZ' }));
  assert.equal((await r.json()).skipped, 'unverified');
  // valódi szoba: mind a 30 levél kimegy (az egyik hibás címre a hiba nem állítja meg a többit)
  mailFailFor = 'jatekos3@pelda.hu';
  net.rooms = [{ code: 'ABCDE', name: 'Péntek esti buli', hostName: 'Anna', firstAt: Date.now() }];
  r = await sub(post(url, { action: 'notify', code: 'ABCDE' }, { 'x-nf-client-connection-ip': '7.7.7.7' }));
  const nj = await r.json();
  assert.equal(nj.queued, 30);
  assert.equal(sentMails.length, 29);
  assert.ok(sentMails.every(m => m.list && m.list.unsubscribe && /Péntek esti buli/.test(m.subject)));
  const q = await fakeStore('picasso-subscribers').get('mailq', { type: 'json' });
  assert.equal(q.items.length, 0);
  // második értesítés a hűtési időn belül: nem megy
  r = await sub(post(url, { action: 'notify', code: 'ABCDE' }, { 'x-nf-client-connection-ip': '7.7.7.8' }));
  assert.equal((await r.json()).skipped, 'cooldown');
  // leiratkozás
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
