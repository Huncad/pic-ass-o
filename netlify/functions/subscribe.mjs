// PIC-ASS-O — e-mail értesítés új szobáról (v4.10, v4.30)
// Kettős megerősítés (double opt-in): feliratkozáskor csak egy megerősítő
// levél megy ki, értesítést csak az kap, aki a levélben a gombra kattintott.
// Minden levél alján egyedi leiratkozó link van.
//
//   GET                         -> { count }  (megerősített feliratkozók száma)
//   POST { action:"subscribe", email }
//   POST { action:"notify", code }   (nyilvános szoba nyílt — a játékszerver
//        szobalistájából ellenőrizve, v4.11)
//   POST { action:"drain" } + x-picasso-internal -> a levélsor folytatása (v4.30)
//   GET  ?confirm=TOKEN / ?unsub=TOKEN  -> HTML oldal egy gombbal
//   POST ?confirm=TOKEN / ?unsub=TOKEN  -> elvégzi (a gomb, ill. a levelezők
//        "egykattintásos leiratkozás" funkciója) — a GET szándékosan nem
//        módosít, mert a levélszűrők előre megnyitják a linkeket.
//
// v4.30: az értesítő levelek egy tartós sorba (Netlify Blobs) kerülnek. Egy
// hívás legfeljebb ~7 mp-ig küld, a maradékot egy láncolt "drain" hívás viszi
// tovább — régen egyetlen hívás próbálta kiküldeni az összeset, és sok
// feliratkozónál kifutott a Netlify időkorlátjából (a levelek egy része
// csendben elmaradt). Napi plafon védi a Gmail küldési korlátját (~500/nap).
// Minden írás ütközésbiztos (két egyszerre érkező kérés nem írja felül egymást).
//
// Környezeti változók (Netlify → Site configuration → Environment variables):
//   GMAIL_USER          — a küldő Gmail cím
//   GMAIL_APP_PASSWORD  — a Google fiók 16 karakteres alkalmazásjelszava
//   MAIL_FROM_NAME (nem kötelező, alapból "PIC-ASS-O")
//   MAIL_DAILY_CAP (nem kötelező, alapból 450 levél / nap)
//   GAME_SERVER_URL (nem kötelező, alapból a saját játékszerver címe)
import { getStore } from '@netlify/blobs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { json, ipOf, makeLimiter, updateJSON } from '../lib/util.mjs';

const KEY = 'subs';
const QUEUE_KEY = 'mailq';
const GAME_SERVER_URL = String(process.env.GAME_SERVER_URL || 'https://picasso.taile8c93.ts.net').replace(/\/+$/, '');
const NOTIFY_COOLDOWN_MS = 15 * 60 * 1000;   // legfeljebb 1 értesítés / 15 perc
const PENDING_TTL_MS = 24 * 3600 * 1000;      // a megerősítő link 24 óráig él
const RESEND_MS = 10 * 60 * 1000;             // ugyanarra a címre 10 percenként 1 megerősítő levél
const MAX_SUBS = 5000;
const DAILY_CAP = Math.max(1, Number(process.env.MAIL_DAILY_CAP) || 450);
const BATCH = 8;                              // egyszerre ennyi levél megy
const SEND_BUDGET_MS = 7000;                  // egy hívás legfeljebb eddig küld
const QUEUE_TTL_MS = 6 * 3600 * 1000;         // ennél régebbi értesítés már nem megy ki

const limited = makeLimiter();
const hashOf = s => createHash('sha256').update(s).digest('hex').slice(0, 32);
const token = () => randomBytes(24).toString('base64url');
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanEmail = e => {
  const s = String(e || '').trim().toLowerCase();
  return s.length <= 120 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/.test(s) ? s : '';
};
const asObj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};

function page(title, inner, status = 200) {
  return new Response(`<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · PIC-ASS-O</title><meta name="robots" content="noindex">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#16302A;color:#F4F1E6;font-family:system-ui,sans-serif;padding:20px}
.c{max-width:440px;background:#20452F;border:3px dashed rgba(244,241,230,.25);border-radius:18px;padding:28px;text-align:center}
h1{color:#FFD166;font-size:1.5rem;margin:0 0 12px}p{line-height:1.5;color:#BFD3C4}
button,a.b{display:inline-block;font:800 1rem system-ui;border:0;border-radius:12px;padding:12px 22px;background:#7BD389;color:#16302A;cursor:pointer;text-decoration:none;margin-top:8px}
button.r{background:#FF6B5B}</style></head><body><div class="c"><h1>${esc(title)}</h1>${inner}</div></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}

let transport = null;
async function sendMail(to, subject, html, unsubUrl) {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('nincs beállítva a Gmail');
  if (!transport) transport = nodemailer.createTransport({ service: 'gmail', pool: true, maxConnections: 3, auth: { user, pass: pass.replace(/\s+/g, '') } });
  const msg = { from: { name: process.env.MAIL_FROM_NAME || 'PIC-ASS-O', address: user }, to, subject, html };
  if (unsubUrl) msg.list = { unsubscribe: { url: unsubUrl, comment: 'Leiratkozás' } };
  if (unsubUrl) msg.headers = { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  await transport.sendMail(msg);
}

const mailWrap = (inner, unsubUrl) => `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;background:#20452F;color:#F4F1E6;border-radius:16px;padding:24px">
<h2 style="color:#FFD166;margin:0 0 12px">PIC-ASS-O ✏️</h2>${inner}
${unsubUrl ? `<p style="font-size:12px;color:#BFD3C4;margin-top:24px">Azért kaptad, mert feliratkoztál az új szobák értesítőjére. <a href="${unsubUrl}" style="color:#5FB6DE">Leiratkozás</a></p>` : ''}</div>`;
const btn = (url, text) => `<p><a href="${url}" style="display:inline-block;background:#7BD389;color:#16302A;font-weight:800;padding:12px 22px;border-radius:12px;text-decoration:none">${text}</a></p>`;

// a láncolt "drain" hívás belső kulcsa (magától jön létre, csak a szerver látja)
let internalCache = null;
async function internalSecret(store) {
  if (internalCache) return internalCache;
  let v = await store.get('internal-secret').catch(() => null);
  if (!v || v.length < 32) {
    await store.set('internal-secret', randomBytes(32).toString('hex'), { onlyIfNew: true }).catch(() => null);
    v = await store.get('internal-secret').catch(() => null);
  }
  if (v && v.length >= 32) internalCache = v;
  return internalCache;
}
function sameSecret(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length >= 32 && timingSafeEqual(x, y);
}

/** A levélsor feldolgozása időkerettel. Visszaadja, maradt-e még levél. */
async function drainQueue(store, self, budgetMs) {
  const until = Date.now() + budgetMs;
  const today = new Date().toISOString().slice(0, 10);
  let sent = 0;
  while (Date.now() < until) {
    // egy adag kivétele a sorból (ütközésbiztosan, így két hívás nem küldi ki kétszer)
    const take = await updateJSON(store, QUEUE_KEY, raw => {
      const q = asObj(raw);
      q.items = Array.isArray(q.items) ? q.items.filter(x => x && Date.now() - (x.at || 0) < QUEUE_TTL_MS) : [];
      if (q.day !== today) { q.day = today; q.sentToday = 0; }
      const room = Math.max(0, DAILY_CAP - (q.sentToday || 0));
      if (!q.items.length || !room) return { value: q, result: { batch: [], left: q.items.length, capped: !room && q.items.length > 0 } };
      const batch = q.items.splice(0, Math.min(BATCH, room));
      q.sentToday = (q.sentToday || 0) + batch.length;
      return { value: q, result: { batch, left: q.items.length } };
    });
    if (take.capped) { console.warn('levélsor: a napi plafon betelt, a maradék holnapig vár'); return false; }
    if (!take.batch.length) return false;
    const res = await Promise.allSettled(take.batch.map(it => {
      const unsub = `${self}?unsub=${it.ut}`;
      return sendMail(it.to, `🎨 Új szoba nyílt: ${it.name}`,
        mailWrap(`<p><b>${esc(it.host)}</b> most nyitotta meg a(z) <b>„${esc(it.name)}”</b> szobát. Gyere rajzolni!</p>${btn(it.joinUrl, '🚀 Csatlakozás')}`, unsub), unsub);
    }));
    sent += res.filter(r => r.status === 'fulfilled').length;
    res.forEach(r => { if (r.status === 'rejected') console.error('levélküldési hiba', r.reason && r.reason.message); });
    if (!take.left) return false;
  }
  console.log(`levélsor: ${sent} levél elküldve ebben a hívásban, folytatás következik`);
  return true;
}

/** A sor folytatása egy új függvényhívásban (a válaszát nem várjuk meg). */
async function kickDrain(store, self) {
  const sec = await internalSecret(store);
  if (!sec) return;
  try {
    await fetch(self, { method: 'POST', headers: { 'content-type': 'application/json', 'x-picasso-internal': sec },
      body: JSON.stringify({ action: 'drain' }), signal: AbortSignal.timeout(1500) });
  } catch (e) { /* időtúllépés várható: a másik hívás közben fut */ }
}

export default async (req) => {
  const url = new URL(req.url);
  const self = url.origin + url.pathname;
  const site = url.origin;
  const store = getStore({ name: 'picasso-subscribers', consistency: 'strong' });
  /** a nyers tartalom rendbetétele: lejárt, meg nem erősített címek törlése */
  const tidy = raw => {
    const d = asObj(raw);
    d.subs = asObj(d.subs);
    const now = Date.now();
    for (const [h, s] of Object.entries(d.subs)) if (!s || (s.status !== 'ok' && now - (s.at || 0) > PENDING_TTL_MS)) delete d.subs[h];
    return d;
  };
  const read = async () => tidy(await store.get(KEY, { type: 'json' }).catch(() => null));
  const findBy = (d, field, t) => t && Object.entries(d.subs).find(([, s]) => s[field] === t);
  const count = d => Object.values(d.subs).filter(s => s.status === 'ok').length;

  const confirmT = url.searchParams.get('confirm');
  const unsubT = url.searchParams.get('unsub');

  // ---- megerősítés ----
  if (confirmT) {
    if (req.method === 'POST') {
      const hit = await updateJSON(store, KEY, raw => {
        const d = tidy(raw);
        const h = findBy(d, 'ct', confirmT);
        if (!h) return { write: false, result: null };
        h[1].status = 'ok'; h[1].ct = null; h[1].okAt = Date.now();
        return { value: d, result: { email: h[1].email, ut: h[1].ut } };
      });
      if (!hit) return page('A link lejárt', '<p>Ez a megerősítő link már nem érvényes (24 óráig él). Iratkozz fel újra a játék kezdőoldalán.</p>', 404);
      const unsubUrl = `${self}?unsub=${hit.ut}`;
      try {
        await sendMail(hit.email, 'Feliratkoztál — PIC-ASS-O',
          mailWrap(`<p>Kész! Mostantól szólunk, ha valaki új nyilvános szobát nyit a PIC-ASS-O-ban (legfeljebb 15 percenként egy levél).</p><p>Ezt a levelet érdemes megtartani: az alján lévő linkkel bármikor leiratkozhatsz.</p>`, unsubUrl), unsubUrl);
      } catch (e) { console.error(e); }
      return page('Kész! 🎉', `<p>Mostantól szólunk e-mailben, ha valaki új nyilvános szobát nyit. Küldtünk egy visszaigazoló levelet is, aminek az alján bármikor leiratkozhatsz.</p><a class="b" href="${esc(site)}">Irány a játék</a>
<p style="font-size:.85rem;margin-top:18px"><a href="${esc(unsubUrl)}" style="color:#BFD3C4">Mégsem kérem — leiratkozás</a></p>`);
    }
    return page('Feliratkozás megerősítése', `<p>Egy kattintás, és szólunk, ha valaki új szobát nyit a PIC-ASS-O-ban.</p>
<form method="post" action="${esc(self)}?confirm=${encodeURIComponent(confirmT)}"><button>✅ Igen, kérem az értesítéseket</button></form>
<p style="font-size:.85rem">Ha nem te iratkoztál fel, egyszerűen zárd be ezt az oldalt — nem fogsz levelet kapni.</p>`);
  }

  // ---- leiratkozás ----
  if (unsubT) {
    if (req.method === 'POST') {
      await updateJSON(store, KEY, raw => {
        const d = tidy(raw);
        const h = findBy(d, 'ut', unsubT);
        if (!h) return { write: false };
        delete d.subs[h[0]];
        return { value: d };
      });
      // a sorban várakozó levelei se menjenek ki
      await updateJSON(store, QUEUE_KEY, raw => {
        const q = asObj(raw);
        if (!Array.isArray(q.items) || !q.items.some(x => x && x.ut === unsubT)) return { write: false };
        q.items = q.items.filter(x => x && x.ut !== unsubT);
        return { value: q };
      }).catch(() => {});
      return page('Leiratkoztál', '<p>Töröltük az e-mail címedet, több értesítést nem kapsz. Ha meggondolnád magad, a játék kezdőoldalán újra feliratkozhatsz.</p>');
    }
    return page('Leiratkozás', `<p>Biztosan nem kérsz több értesítést az új szobákról?</p>
<form method="post" action="${esc(self)}?unsub=${encodeURIComponent(unsubT)}"><button class="r">Leiratkozom</button></form>`);
  }

  if (req.method === 'GET') {
    const d = await read();
    return json({ count: count(d) });
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  // ---- a levélsor folytatása (csak belső, láncolt hívás) ----
  if (req.headers.get('x-picasso-internal')) {
    const sec = await internalSecret(store);
    if (!sameSecret(req.headers.get('x-picasso-internal'), sec)) return json({ error: 'forbidden' }, 403);
    const more = await drainQueue(store, self, SEND_BUDGET_MS);
    if (more) await kickDrain(store, self);
    return json({ ok: true, more });
  }

  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'forbidden' }, 403);
  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const ip = ipOf(req);

  // ---- feliratkozás ----
  if (body.action === 'subscribe') {
    if (limited('s|' + ip, 5, 3600000)) return json({ error: 'Túl sok próbálkozás, próbáld újra később.' }, 429);
    if (body.consent !== true) return json({ error: 'A feliratkozáshoz hozzájárulás kell.' }, 400);
    const email = cleanEmail(body.email);
    if (!email) return json({ error: 'Ez nem tűnik érvényes e-mail címnek.' }, 400);
    const d = await read();
    const h = hashOf(email);
    const cur = d.subs[h];
    if (cur && cur.status === 'ok') {
      // már feliratkozott: újra elküldjük neki a leiratkozó linket (10 percenként egyszer)
      let mailed = false;
      if (Date.now() - (cur.sentAt || 0) >= RESEND_MS) {
        const unsubUrl = `${self}?unsub=${cur.ut}`;
        try {
          await sendMail(email, 'Az értesítőd — PIC-ASS-O',
            mailWrap(`<p>Ez a cím már fel van iratkozva az új szobák értesítőjére. Ha le szeretnél iratkozni, kattints az alábbi gombra.</p>${btn(unsubUrl, 'Leiratkozás')}`, unsubUrl), unsubUrl);
          mailed = true;
          await updateJSON(store, KEY, raw => {
            const d2 = tidy(raw);
            if (!d2.subs[h]) return { write: false };
            d2.subs[h].sentAt = Date.now();
            return { value: d2 };
          });
        } catch (e) { console.error(e); }
      }
      return json({ ok: true, already: true, mailed, count: count(d) });
    }
    if (cur && Date.now() - (cur.sentAt || 0) < RESEND_MS) return json({ ok: true, pending: true, throttled: true, count: count(d) });
    if (!cur && Object.keys(d.subs).length >= MAX_SUBS) return json({ error: 'Megtelt a lista.' }, 503);
    const s = Object.assign({}, cur || { email, status: 'pending', ut: token() });
    s.ct = token(); s.at = Date.now(); s.sentAt = Date.now();
    s.consent = 'v4.10: 16+ és hozzájárulás az új szobák e-mail értesítőjéhez';
    try {
      await sendMail(email, 'Erősítsd meg a feliratkozást — PIC-ASS-O',
        mailWrap(`<p>Valaki (remélhetőleg te) feliratkoztatta ezt a címet, hogy értesítést kapjon, ha új szoba nyílik a PIC-ASS-O rajzjátékban.</p>
${btn(`${self}?confirm=${s.ct}`, '✅ Feliratkozás megerősítése')}
<p style="font-size:13px;color:#BFD3C4">A link 24 óráig érvényes. Ha nem te voltál, hagyd figyelmen kívül ezt a levelet — megerősítés nélkül egyetlen további levelet sem kapsz.</p>`));
    } catch (e) {
      console.error(e);
      return json({ error: 'Nem sikerült elküldeni a megerősítő levelet.' }, 502);
    }
    // csak ezt az egy bejegyzést írjuk (közben más is feliratkozhatott)
    const total = await updateJSON(store, KEY, raw => {
      const d2 = tidy(raw);
      if (d2.subs[h] && d2.subs[h].status === 'ok') return { write: false, result: count(d2) };
      d2.subs[h] = s;
      return { value: d2, result: count(d2) };
    });
    return json({ ok: true, pending: true, count: total });
  }

  // ---- értesítés új szobáról ----
  // v4.11: a kérés csak jelzés ("nézd meg, nyílt-e szoba"). Hogy tényleg nyílt-e,
  // azt a játékszerver nyilvános szobalistájából ellenőrizzük, és a levélbe a
  // szoba nevét / a szobanyitót is ONNAN vesszük, nem a kérésből — így kitalált
  // szobáról vagy kitalált szöveggel senki nem tud levelet küldetni.
  if (body.action === 'notify') {
    if (limited('n|' + ip, 6, 3600000)) return json({ ok: true, skipped: 'ip' });
    const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!code) return json({ ok: true, skipped: 'nocode' });
    let room = null;
    try {
      const r = await fetch(GAME_SERVER_URL + '/api/szobak', { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
      if (r.ok) {
        const d = await r.json();
        room = (d && Array.isArray(d.rooms) ? d.rooms : []).find(x => x && String(x.code).toUpperCase() === code) || null;
      }
    } catch (e) { room = null; }
    // csak frissen (3 percen belül) megnyílt, a szerveren tényleg látható nyilvános szoba
    if (!room || Date.now() - Number(room.firstAt || 0) > 3 * 60 * 1000) return json({ ok: true, skipped: 'unverified' });
    const name = String(room.name || '').slice(0, 60).trim() || 'Új szoba';
    const host = String(room.hostName || '').slice(0, 24).trim() || 'Valaki';
    const res = await updateJSON(store, KEY, raw => {
      const d = tidy(raw);
      if (Date.now() - (d.lastNotifyAt || 0) < NOTIFY_COOLDOWN_MS) return { write: false, result: { skipped: 'cooldown' } };
      d.notified = asObj(d.notified);
      for (const k of Object.keys(d.notified)) if (Date.now() - d.notified[k] > 86400000) delete d.notified[k];
      if (d.notified[code]) return { write: false, result: { skipped: 'already' } };
      d.notified[code] = Date.now();
      d.lastNotifyAt = Date.now();
      return { value: d, result: { list: Object.values(d.subs).filter(s => s.status === 'ok').map(s => ({ to: s.email, ut: s.ut })) } };
    });
    if (res.skipped) return json({ ok: true, skipped: res.skipped });
    if (!res.list.length) return json({ ok: true, queued: 0 });
    const joinUrl = `${site}/?join=${encodeURIComponent(code)}`;
    const at = Date.now();
    await updateJSON(store, QUEUE_KEY, raw => {
      const q = asObj(raw);
      q.items = (Array.isArray(q.items) ? q.items : []).concat(res.list.map(x => ({ ...x, name, host, joinUrl, at })));
      if (q.items.length > MAX_SUBS * 2) q.items = q.items.slice(-MAX_SUBS * 2);
      return { value: q };
    });
    const more = await drainQueue(store, self, SEND_BUDGET_MS);
    if (more) await kickDrain(store, self);
    return json({ ok: true, queued: res.list.length, more });
  }

  return json({ error: 'unknown action' }, 400);
};
