// PIC-ASS-O — admin szerveroldal (v4.19)
// Az admin oldalnak így nem kell GitHub vagy Netlify tokent kérnie: a tokenek
// a Netlify környezeti változóiban vannak, és csak ez a függvény használja őket.
//
//   POST { action:"login", password }      -> { session }   (jelszó a szerveren ellenőrizve)
//   POST { action:"gh", method, path, body } + x-admin-session -> GitHub API, csak:
//        /gists/<a játék Gistje>  és  /repos/<a zenés tároló>/...
//   POST { action:"nf", method, path }       + x-admin-session -> Netlify API, csak
//        a játék saját oldalának űrlapjai és beküldései
//
// Környezeti változók (Netlify → Project configuration → Environment variables):
//   GITHUB_TOKEN      — klasszikus GitHub token (gist + public_repo jogosultság)
//   NETLIFY_API_TOKEN — Netlify személyes token (a visszajelzések olvasásához)
//   (SITE_ID-t a Netlify magától adja; a munkamenet-titok magától jön létre)
import { getStore } from '@netlify/blobs';
import { pbkdf2Sync, createHash, timingSafeEqual } from 'node:crypto';
import { makeSession, verifySession } from '../lib/adminauth.mjs';

const GIST_ID = process.env.WORDS_GIST_ID || 'fe34dbe63eefd11f324555359ec4cf53';
// a beépített jelszó lenyomata (ugyanaz, mint a játékban) — amíg nincs admin.json
const BUILTIN_PW_SHA256 = '1d317673149102cdf94521be83a4cc1a4687e1b65382bd9de0f9499abb0f1dab';
const MAX_BODY = 6 * 1024 * 1024;

const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  if (hits.size > 3000) for (const k of hits.keys()) { if (!(hits.get(k) || []).some(t => now - t < windowMs)) hits.delete(k); }
  return arr.length > max;
}
const ipOf = req => req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || 'x';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const ghHeaders = () => Object.assign({ accept: 'application/vnd.github+json', 'user-agent': 'pic-ass-o-netlify' },
  process.env.GITHUB_TOKEN ? { authorization: 'token ' + process.env.GITHUB_TOKEN } : {});

async function readGistFile(name) {
  const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers: ghHeaders() });
  if (!r.ok) return null;
  const d = await r.json();
  const f = d && d.files && d.files[name];
  if (!f) return null;
  let text = f.content;
  if (f.truncated && f.raw_url) { const rr = await fetch(f.raw_url); if (rr.ok) text = await rr.text(); }
  try { return JSON.parse(text); } catch (e) { return null; }
}

function eqHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try { return timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (e) { return false; }
}
async function checkPassword(pw) {
  const rec = await readGistFile('admin.json');
  if (rec && rec.v === 1 && /^[0-9a-f]{32,}$/.test(rec.salt || '') && /^[0-9a-f]{64}$/.test(rec.hash || '')
      && Number.isInteger(rec.iter) && rec.iter >= 100000 && rec.iter <= 2000000) {
    const h = pbkdf2Sync(String(pw), Buffer.from(rec.salt, 'hex'), rec.iter, 32, 'sha256').toString('hex');
    return eqHex(h, rec.hash);
  }
  return eqHex(createHash('sha256').update(String(pw)).digest('hex'), BUILTIN_PW_SHA256);
}

// a zenés tároló: környezeti változóból, vagy a Gist zene.json-jából
let musicRepoCache = null, musicRepoAt = 0;
async function musicRepo() {
  if (process.env.MUSIC_REPO) return process.env.MUSIC_REPO.toLowerCase();
  if (musicRepoCache !== null && Date.now() - musicRepoAt < 60000) return musicRepoCache;
  const z = await readGistFile('zene.json');
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
  const repo = m[1].toLowerCase();
  if (want && repo !== want) return false;   // csak a beállított zenés tároló
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
    const store = getStore({ name: 'picasso-admin', consistency: 'strong' });
    const hour = new Date().toISOString().slice(0, 13);
    const fails = await store.get('fails', { type: 'json' }).catch(() => null) || {};
    if (fails.h === hour && fails.n >= 40) return json({ error: 'Túl sok hibás próbálkozás — próbáld újra egy óra múlva.' }, 429);
    const ok = await checkPassword(body.password).catch(() => false);
    if (!ok) {
      await store.setJSON('fails', { h: hour, n: (fails.h === hour ? fails.n : 0) + 1 }).catch(() => {});
      return json({ error: 'Hibás jelszó.' }, 401);
    }
    return json({ session: await makeSession(), gh: !!process.env.GITHUB_TOKEN, nf: !!process.env.NETLIFY_API_TOKEN });
  }

  if (!(await verifySession(req.headers.get('x-admin-session')))) return json({ error: 'A belépés lejárt — lépj be újra.' }, 401);
  if (limited('a|' + ip, 300, 60000)) return json({ error: 'slow down' }, 429);
  const method = String(body.method || 'GET').toUpperCase();
  const path = String(body.path || '');
  if (!/^\/[A-Za-z0-9_./?=&%:-]*$/.test(path) || path.includes('..')) return json({ error: 'bad path' }, 400);

  if (body.action === 'gh') {
    if (!process.env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN nincs beállítva a Netlify-on' }, 503);
    if (!['GET', 'PATCH', 'POST', 'PUT', 'DELETE'].includes(method) || !(await ghAllowed(method, path))) return json({ error: 'Ez a GitHub-művelet nem engedélyezett.' }, 403);
    const opts = { method, headers: ghHeaders() };
    if (body.body !== undefined && method !== 'GET') { opts.body = typeof body.body === 'string' ? body.body : JSON.stringify(body.body); opts.headers['content-type'] = 'application/json'; }
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
