// PIC-ASS-O — telefonos (ntfy) értesítés az üzemeltetőnek, ha szoba nyílik (v4.15)
// Korábban a böngésző küldte közvetlenül az ntfy.sh-ra, és ehhez a csatornanév
// a nyilvános Gistben (ertesites.json) volt — így bárki kiolvashatta, és
// feliratkozhatott rá, vagy szemetet küldhetett rá. Mostantól a csatornanév
// CSAK itt, a szerveren (Netlify Blobs) van, a böngésző soha nem kapja meg.
//
//   POST { action:"notify", name, host, public, code }  -> bárki (a szobát nyitó
//        eszköz); sebességkorláttal és napi plafonnal
//   POST { action:"get" }                + x-netlify-token -> admin: { on, topic }
//   POST { action:"save", on, topic }    + x-netlify-token -> admin: beállítás
//   POST { action:"test" }               + x-netlify-token -> admin: próbaértesítés
//
// A Netlify token ugyanaz, amit az admin oldal a Visszajelzéseknél kér; azt
// ellenőrizzük, hogy hozzáfér-e ehhez a Netlify-projekthez.
import { getStore } from '@netlify/blobs';

const KEY = 'cfg';
const GAME_SERVER_URL = String(process.env.GAME_SERVER_URL || 'https://picasso.taile8c93.ts.net').replace(/\/+$/, '');
const DAILY_CAP = 80;          // legfeljebb ennyi értesítés naponta, összesen
const MIN_GAP_MS = 20 * 1000;  // két értesítés között legalább 20 mp

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
export const cleanTopic = t => { const s = String(t || '').trim(); return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : ''; };
// vezérlőkarakterek ki, hossz korlátozva — az ntfy sima szövegként jeleníti meg
export const cleanText = (t, n) => String(t || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const cleanCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

async function isAdmin(req) {
  const token = req.headers.get('x-netlify-token') || '';
  const site = process.env.SITE_ID;
  if (!token || !site) return false;
  try {
    const r = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(site)}`, { headers: { authorization: 'Bearer ' + token } });
    return r.ok;
  } catch (e) { return false; }
}

async function sendPush(topic, title, message, click) {
  const q = new URLSearchParams({ title, tags: 'art,bell' });
  if (click) q.set('click', click);
  try {
    const r = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}?${q.toString()}`, {
      method: 'POST', body: message, headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
    if (r.ok) return { ok: true };
    return { ok: false, detail: r.status === 429 ? 'az ntfy.sh napi korlátja betelt' : `az ntfy.sh visszautasította (HTTP ${r.status})` };
  } catch (e) { return { ok: false, detail: 'az ntfy.sh nem érhető el' }; }
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'forbidden' }, 403);
  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const store = getStore({ name: 'picasso-notify', consistency: 'strong' });
  const read = async () => {
    const v = await store.get(KEY, { type: 'json' }).catch(() => null);
    const d = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    return { on: d.on === true, topic: cleanTopic(d.topic), day: String(d.day || ''), n: Number(d.n) || 0, last: Number(d.last) || 0 };
  };
  const url = new URL(req.url);
  const site = url.origin + '/';

  if (body.action === 'get' || body.action === 'save' || body.action === 'test') {
    if (limited('a|' + ipOf(req), 30, 600000)) return json({ error: 'slow down' }, 429);
    if (!(await isAdmin(req))) return json({ error: 'unauthorized' }, 401);
    const cfg = await read();
    if (body.action === 'get') return json({ on: cfg.on, topic: cfg.topic });
    if (body.action === 'save') {
      const topic = cleanTopic(body.topic);
      const on = body.on === true;
      if (on && !topic) return json({ error: 'bad topic' }, 400);
      await store.setJSON(KEY, Object.assign({}, cfg, { on, topic }));
      return json({ ok: true, on, topic });
    }
    if (!cfg.topic) return json({ ok: false, detail: 'nincs elmentett csatornanév' });
    const r = await sendPush(cfg.topic, '🔔 PIC-ASS-O próbaértesítés', 'Ha ezt látod, működik az értesítés! 🎨', site);
    return json(r);
  }

  if (body.action === 'notify') {
    if (limited('n|' + ipOf(req), 6, 3600000)) return json({ ok: true, skipped: 'ip' });
    const cfg = await read();
    if (!cfg.on || !cfg.topic) return json({ ok: true, skipped: 'off' });
    const today = new Date().toISOString().slice(0, 10);
    if (cfg.day !== today) { cfg.day = today; cfg.n = 0; }
    if (cfg.n >= DAILY_CAP) return json({ ok: true, skipped: 'daily cap' });
    if (Date.now() - cfg.last < MIN_GAP_MS) return json({ ok: true, skipped: 'too soon' });

    const code = cleanCode(body.code);
    const isPublic = body.public === true;
    let name = cleanText(body.name, 60), host = cleanText(body.host, 20);
    // nyilvános szobánál, ha a játékszerver listáján van, onnan vesszük a nevet
    if (isPublic && code) {
      try {
        const ctl = AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined;
        const r = await fetch(GAME_SERVER_URL + '/api/szobak', { signal: ctl, headers: { accept: 'application/json' } });
        if (r.ok) {
          const d = await r.json();
          const room = (d && Array.isArray(d.rooms) ? d.rooms : []).find(x => x && String(x.code).toUpperCase() === code);
          if (room) { name = cleanText(room.name, 60) || name; host = cleanText(room.host || room.hostName, 20) || host; }
        }
      } catch (e) { /* marad a kérésben kapott név */ }
    }
    if (!name) name = 'névtelen szoba';
    if (!host) host = 'Valaki';
    const title = `🎨 Új szoba: ${name}`;
    const msg = isPublic ? `${host} nyitott egy nyilvános szobát. Koppints ide a csatlakozáshoz!` : `${host} nyitott egy zárt szobát.`;
    const click = isPublic && code ? `${site}?join=${encodeURIComponent(code)}` : site;
    cfg.n += 1; cfg.last = Date.now();
    await store.setJSON(KEY, cfg);
    const r = await sendPush(cfg.topic, title, msg, click);
    return json({ ok: r.ok });
  }

  return json({ error: 'unknown action' }, 400);
};
