// PIC-ASS-O — admin szerveroldal (v4.19, v4.30)
// Az admin oldalnak így nem kell GitHub vagy Netlify tokent kérnie: a tokenek
// a Netlify környezeti változóiban vannak, és csak ez a függvény használja őket.
//
//   POST { action:"login", password }      -> { session }   (jelszó a szerveren ellenőrizve)
//   POST { action:"setpw", password }      + x-admin-session -> új admin jelszó (v4.30)
//   POST { action:"gh", method, path, body } + x-admin-session -> GitHub API, csak:
//        /gists/<a játék Gistje>  és  /repos/<a zenés tároló>/...
//   POST { action:"nf", method, path }       + x-admin-session -> Netlify API, csak
//        a játék saját oldalának űrlapjai és beküldései
//
// v4.30: a jelszó lenyomata (salt + PBKDF2 hash) NEM a nyilvános Gistben van,
// hanem a Netlify Blobs tárolóban (picasso-admin / pw-record), amit csak a
// szerver lát. Régről maradt admin.json a Gistben: az első sikeres belépéskor
// átkerül a Blobs-ba, és a Gistből törlődik. (A Gist korábbi változatai
// nyilvánosak maradnak — ezért az átállás után érdemes új jelszót beállítani.)
// Kívülről is megadható: ADMIN_PASSWORD_RECORD = {"v":1,"salt":"…","iter":310000,"hash":"…"}
//
// Környezeti változók (Netlify → Project configuration → Environment variables):
//   GITHUB_TOKEN      — klasszikus GitHub token (gist + public_repo jogosultság)
//   NETLIFY_API_TOKEN — Netlify személyes token (a visszajelzések olvasásához)
//   MUSIC_REPO        — (nem kötelező) a zenés tároló, pl. "felhasznalo/picasso-zene"
//   (SITE_ID-t a Netlify magától adja; a munkamenet-titok magától jön létre)
import { getStore } from '@netlify/blobs';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { makeSession, verifySession } from '../lib/adminauth.mjs';
import { json, ipOf, makeLimiter, updateJSON } from '../lib/util.mjs';

const GIST_ID = process.env.WORDS_GIST_ID || 'fe34dbe63eefd11f324555359ec4cf53';
const MAX_BODY = 6 * 1024 * 1024;
const PW_ITER = 310000;

const limited = makeLimiter();
const adminStore = () => getStore({ name: 'picasso-admin', consistency: 'strong' });
const ghHeaders = () => Object.assign({ accept: 'application/vnd.github+json', 'user-agent': 'pic-ass-o-netlify' },
  process.env.GITHUB_TOKEN ? { authorization: 'token ' + process.env.GITHUB_TOKEN } : {});

async function readGist() {
  const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers: ghHeaders() });
  if (!r.ok) return null;
  return r.json();
}
async function gistFileJSON(d, name) {
  const f = d && d.files && d.files[name];
  if (!f) return null;
  let text = f.content;
  if (f.truncated && f.raw_url) { const rr = await fetch(f.raw_url); if (rr.ok) text = await rr.text(); }
  try { return JSON.parse(text); } catch (e) { return null; }
}

function validRecord(rec) {
  return !!rec && rec.v === 1 && /^[0-9a-f]{32,}$/.test(rec.salt || '') && /^[0-9a-f]{64}$/.test(rec.hash || '')
    && Number.isInteger(rec.iter) && rec.iter >= 100000 && rec.iter <= 2000000;
}
function eqHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try { return timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (e) { return false; }
}
const hashPw = (pw, rec) => pbkdf2Sync(String(pw), Buffer.from(rec.salt, 'hex'), rec.iter, 32, 'sha256').toString('hex');

/** A jelszó-rekord: 1. Blobs, 2. környezeti változó, 3. (átállás) a Gist régi admin.json-ja. */
async function passwordRecord() {
  const stored = await adminStore().get('pw-record', { type: 'json' }).catch(() => null);
  if (validRecord(stored)) return { rec: stored, from: 'blobs' };
  try { const env = JSON.parse(process.env.ADMIN_PASSWORD_RECORD || 'null'); if (validRecord(env)) return { rec: env, from: 'env' }; } catch (e) {}
  const gist = await readGist().catch(() => null);
  const legacy = await gistFileJSON(gist, 'admin.json').catch(() => null);
  if (validRecord(legacy)) return { rec: legacy, from: 'gist' };
  return { rec: null, from: '' };
}

/** A régi, nyilvános admin.json áthelyezése a Blobs-ba, és törlése a Gistből. */
async function migrateLegacyRecord(rec) {
  await adminStore().setJSON('pw-record', rec);
  if (!process.env.GITHUB_TOKEN) return false;
  try {
    const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH', headers: Object.assign(ghHeaders(), { 'content-type': 'application/json' }),
      body: JSON.stringify({ files: { 'admin.json': null } })
    });
    return r.ok;
  } catch (e) { return false; }
}

// a zenés tároló: környezeti változóból, vagy a Gist zene.json-jából
let musicRepoCache = null, musicRepoAt = 0;
async function musicRepo() {
  if (process.env.MUSIC_REPO) return process.env.MUSIC_REPO.toLowerCase();
  if (musicRepoCache !== null && Date.now() - musicRepoAt < 60000) return musicRepoCache;
  const z = await gistFileJSON(await readGist().catch(() => null), 'zene.json').catch(() => null);
  musicRepoCache = (z && typeof z.repo === 'string') ? z.repo.toLowerCase() : '';
  musicRepoAt = Date.now();
  return musicRepoCache;
}

async function ghAllowed(method, path) {
  const p = path.split('?')[0];
  if (p === `/gists/${GIST_ID}`) return method === 'GET' || method === 'PATCH';
  const m = /^\/repos\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(\/.*)?$/.exec(p);
  if (!m) return false;
  const want = await musicRepo();
  // v4.30: zenés tároló nélkül egyetlen tárolóhoz sem enged hozzá (régen bármelyikhez)
  if (!want || m[1].toLowerCase() !== want) return false;
  const rest = m[2] || '';
  return rest === '' || /^\/(branches|git\/ref|git\/refs|contents)(\/|$)/.test(rest);
}

async function nf(method, path) {
  const tok = process.env.NETLIFY_API_TOKEN;
  if (!tok) return { status: 503, body: { error: 'NETLIFY_API_TOKEN nincs beállítva a Netlify-on' } };
  const r = await fetch('https://api.netlify.com/api/v1' + path, { method, headers: { authorization: 'Bearer ' + tok, accept: 'application/json' } });
  const text = await r.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
  return { status: r.status, body };
}
async function siteFormIds(site) {
  const r = await nf('GET', `/sites/${encodeURIComponent(site)}/forms`);
  return new Set((Array.isArray(r.body) ? r.body : []).map(f => f && f.id).filter(Boolean));
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'forbidden' }, 403);
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) return json({ error: 'Túl nagy fájl (a Netlify legfeljebb kb. 4,5 MB-os zenét enged át).' }, 413);
  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const ip = ipOf(req);

  if (body.action === 'login') {
    if (limited('l|' + ip, 5, 10 * 60000)) return json({ error: 'Túl sok próbálkozás — várj 10 percet.' }, 429);
    // országos (példányon átívelő) fék: óránként legfeljebb 40 hibás próba összesen
    const store = adminStore();
    const hour = new Date().toISOString().slice(0, 13);
    const fails = await store.get('fails', { type: 'json' }).catch(() => null) || {};
    if (fails.h === hour && fails.n >= 40) return json({ error: 'Túl sok hibás próbálkozás — próbáld újra egy óra múlva.' }, 429);
    const { rec, from } = await passwordRecord().catch(() => ({ rec: null, from: '' }));
    // nincs beépített tartalék jelszó: ha nincs rekord, a belépés elutasítva
    const ok = !!rec && eqHex(hashPw(body.password, rec), rec.hash);
    if (!ok) {
      await updateJSON(store, 'fails', f => {
        const cur = (f && typeof f === 'object') ? f : {};
        return { value: { h: hour, n: (cur.h === hour ? Number(cur.n) || 0 : 0) + 1 } };
      }).catch(() => {});
      return json({ error: 'Hibás jelszó.' }, 401);
    }
    let migrated;
    if (from === 'gist') migrated = await migrateLegacyRecord(rec).catch(() => false);
    return json({ session: await makeSession(), gh: !!process.env.GITHUB_TOKEN, nf: !!process.env.NETLIFY_API_TOKEN,
      pwFrom: from === 'gist' ? 'blobs' : from, migrated: migrated === undefined ? undefined : !!migrated });
  }

  if (!(await verifySession(req.headers.get('x-admin-session')))) return json({ error: 'A belépés lejárt — lépj be újra.' }, 401);
  if (limited('a|' + ip, 300, 60000)) return json({ error: 'slow down' }, 429);

  if (body.action === 'setpw') {
    const pw = String(body.password || '');
    if (pw.length < 10 || pw.length > 200) return json({ error: 'A jelszó 10–200 karakter legyen.' }, 400);
    const salt = randomBytes(16).toString('hex');
    const rec = { v: 1, salt, iter: PW_ITER };
    rec.hash = hashPw(pw, rec);
    await adminStore().setJSON('pw-record', rec);
    return json({ ok: true });
  }

  const method = String(body.method || 'GET').toUpperCase();
  const path = String(body.path || '');
  if (!/^\/[A-Za-z0-9_./?=&%:-]*$/.test(path) || path.includes('..')) return json({ error: 'bad path' }, 400);

  if (body.action === 'gh') {
    if (!process.env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN nincs beállítva a Netlify-on' }, 503);
    if (!['GET', 'PATCH', 'POST', 'PUT', 'DELETE'].includes(method) || !(await ghAllowed(method, path))) return json({ error: 'Ez a GitHub-művelet nem engedélyezett.' }, 403);
    const opts = { method, headers: ghHeaders() };
    if (body.body !== undefined && method !== 'GET') { opts.body = typeof body.body === 'string' ? body.body : JSON.stringify(body.body); opts.headers['content-type'] = 'application/json'; }
    // v4.30: a jelszó-lenyomat soha nem kerülhet vissza a nyilvános Gistbe
    if (method === 'PATCH' && opts.body && /"admin\.json"\s*:\s*\{/.test(opts.body)) return json({ error: 'A jelszó már nem a Gistben tárolódik.' }, 403);
    const r = await fetch('https://api.github.com' + path, opts);
    if (path.startsWith(`/gists/`) || path.includes('/repos/')) musicRepoAt = 0;   // a zene.json változhatott
    return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }

  if (body.action === 'nf') {
    const site = process.env.SITE_ID;
    if (!site) return json({ error: 'no site' }, 503);
    // a játék saját oldala — a kliens régi "melyik oldalon vagyok" keresése ezt kapja
    if (method === 'GET' && path.startsWith('/sites?')) {
      const r = await nf('GET', `/sites/${encodeURIComponent(site)}`);
      return json(r.status === 200 && r.body ? [r.body] : [], r.status === 200 ? 200 : r.status);
    }
    if (method === 'GET' && path === `/sites/${site}/forms`) { const r = await nf('GET', path); return json(r.body, r.status); }
    let m = /^\/forms\/([A-Za-z0-9]+)\/submissions(\?.*)?$/.exec(path);
    if (method === 'GET' && m) {
      if (!(await siteFormIds(site)).has(m[1])) return json({ error: 'forbidden' }, 403);
      const r = await nf('GET', path); return json(r.body, r.status);
    }
    m = /^\/submissions\/([A-Za-z0-9]+)$/.exec(path);
    if (method === 'DELETE' && m) {
      const s = await nf('GET', path);
      const ids = await siteFormIds(site);
      if (!s.body || !(s.body.site_id === site || ids.has(s.body.form_id))) return json({ error: 'forbidden' }, 403);
      const r = await nf('DELETE', path); return json(r.body, r.status);
    }
    return json({ error: 'Ez a Netlify-művelet nem engedélyezett.' }, 403);
  }

  if (body.action === 'ping') return json({ ok: true, gh: !!process.env.GITHUB_TOKEN, nf: !!process.env.NETLIFY_API_TOKEN });
  return json({ error: 'unknown action' }, 400);
};
