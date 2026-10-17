// PIC-ASS-O — e-mail értesítés új szobáról (v4.10)
// Kettős megerősítés (double opt-in): feliratkozáskor csak egy megerősítő
// levél megy ki, értesítést csak az kap, aki a levélben a gombra kattintott.
// Minden levél alján egyedi leiratkozó link van.
//
//   GET                         -> { count }  (megerősített feliratkozók száma)
//   POST { action:"subscribe", email }
//   POST { action:"notify", name, host, code }   (nyilvános szoba nyílt)
//   GET  ?confirm=TOKEN / ?unsub=TOKEN  -> HTML oldal egy gombbal
//   POST ?confirm=TOKEN / ?unsub=TOKEN  -> elvégzi (a gomb, ill. a levelezők
//        "egykattintásos leiratkozás" funkciója) — a GET szándékosan nem
//        módosít, mert a levélszűrők előre megnyitják a linkeket.
//
// Környezeti változók (Netlify → Site configuration → Environment variables):
//   GMAIL_USER          — a küldő Gmail cím
//   GMAIL_APP_PASSWORD  — a Google fiók 16 karakteres alkalmazásjelszava
//   MAIL_FROM_NAME (nem kötelező, alapból "PIC-ASS-O")
import { getStore } from '@netlify/blobs';
import { createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';

const KEY = 'subs';
const NOTIFY_COOLDOWN_MS = 15 * 60 * 1000;   // legfeljebb 1 értesítés / 15 perc
const PENDING_TTL_MS = 24 * 3600 * 1000;      // a megerősítő link 24 óráig él
const RESEND_MS = 10 * 60 * 1000;             // ugyanarra a címre 10 percenként 1 megerősítő levél
const MAX_SUBS = 5000;

const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  if (hits.size > 3000) for (const k of hits.keys()) { if (!(hits.get(k) || []).some(t => now - t < windowMs)) hits.delete(k); }
  return arr.length > max;
}
const ipOf = req => req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || 'x';
const hashOf = s => createHash('sha256').update(s).digest('hex').slice(0, 32);
const token = () => randomBytes(24).toString('base64url');
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanEmail = e => {
  const s = String(e || '').trim().toLowerCase();
  return s.length <= 120 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/.test(s) ? s : '';
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
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
  if (!transport) transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass: pass.replace(/\s+/g, '') } });
  const msg = { from: { name: process.env.MAIL_FROM_NAME || 'PIC-ASS-O', address: user }, to, subject, html };
  if (unsubUrl) msg.list = { unsubscribe: { url: unsubUrl, comment: 'Leiratkozás' } };
  if (unsubUrl) msg.headers = { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  await transport.sendMail(msg);
}

const mailWrap = (inner, unsubUrl) => `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;background:#20452F;color:#F4F1E6;border-radius:16px;padding:24px">
<h2 style="color:#FFD166;margin:0 0 12px">PIC-ASS-O ✏️</h2>${inner}
${unsubUrl ? `<p style="font-size:12px;color:#BFD3C4;margin-top:24px">Azért kaptad, mert feliratkoztál az új szobák értesítőjére. <a href="${unsubUrl}" style="color:#5FB6DE">Leiratkozás</a></p>` : ''}</div>`;
const btn = (url, text) => `<p><a href="${url}" style="display:inline-block;background:#7BD389;color:#16302A;font-weight:800;padding:12px 22px;border-radius:12px;text-decoration:none">${text}</a></p>`;

export default async (req) => {
  const url = new URL(req.url);
  const self = url.origin + url.pathname;
  const site = url.origin;
  const store = getStore({ name: 'picasso-subscribers', consistency: 'strong' });
  const read = async () => {
    const v = await store.get(KEY, { type: 'json' }).catch(() => null);
    const d = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    d.subs = d.subs && typeof d.subs === 'object' ? d.subs : {};
    // lejárt, meg nem erősített címek törlése
    const now = Date.now();
    for (const [h, s] of Object.entries(d.subs)) if (s.status !== 'ok' && now - (s.at || 0) > PENDING_TTL_MS) delete d.subs[h];
    return d;
  };
  const findBy = (d, field, t) => t && Object.entries(d.subs).find(([, s]) => s[field] === t);
  const count = d => Object.values(d.subs).filter(s => s.status === 'ok').length;

  const confirmT = url.searchParams.get('confirm');
  const unsubT = url.searchParams.get('unsub');

  // ---- megerősítés ----
  if (confirmT) {
    if (req.method === 'POST') {
      const d = await read();
      const hit = findBy(d, 'ct', confirmT);
      if (!hit) return page('A link lejárt', '<p>Ez a megerősítő link már nem érvényes (24 óráig él). Iratkozz fel újra a játék kezdőoldalán.</p>', 404);
      hit[1].status = 'ok'; hit[1].ct = null; hit[1].okAt = Date.now();
      await store.setJSON(KEY, d);
      const unsubUrl = `${self}?unsub=${hit[1].ut}`;
      try {
        await sendMail(hit[1].email, 'Feliratkoztál — PIC-ASS-O',
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
      const d = await read();
      const hit = findBy(d, 'ut', unsubT);
      if (hit) { delete d.subs[hit[0]]; await store.setJSON(KEY, d); }
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
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'forbidden' }, 403);
  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const ip = ipOf(req);

  // ---- feliratkozás ----
  if (body.action === 'subscribe') {
    if (limited('s|' + ip, 5, 3600000)) return json({ error: 'Túl sok próbálkozás, próbáld újra később.' }, 429);
    const email = cleanEmail(body.email);
    if (!email) return json({ error: 'Ez nem tűnik érvényes e-mail címnek.' }, 400);
    const d = await read();
    const h = hashOf(email);
    const cur = d.subs[h];
    if (cur && cur.status === 'ok') {
      // már feliratkozott: újra elküldjük neki a leiratkozó linket (10 percenként egyszer)
      let mailed = false;
      if (Date.now() - (cur.sentAt || 0) >= RESEND_MS) {
        cur.sentAt = Date.now();
        const unsubUrl = `${self}?unsub=${cur.ut}`;
        try {
          await sendMail(email, 'Az értesítőd — PIC-ASS-O',
            mailWrap(`<p>Ez a cím már fel van iratkozva az új szobák értesítőjére. Ha le szeretnél iratkozni, kattints az alábbi gombra.</p>${btn(unsubUrl, 'Leiratkozás')}`, unsubUrl), unsubUrl);
          await store.setJSON(KEY, d);
          mailed = true;
        } catch (e) { console.error(e); }
      }
      return json({ ok: true, already: true, mailed, count: count(d) });
    }
    if (cur && Date.now() - (cur.sentAt || 0) < RESEND_MS) return json({ ok: true, pending: true, throttled: true, count: count(d) });
    if (!cur && Object.keys(d.subs).length >= MAX_SUBS) return json({ error: 'Megtelt a lista.' }, 503);
    const s = cur || { email, status: 'pending', ut: token() };
    s.ct = token(); s.at = Date.now(); s.sentAt = Date.now();
    d.subs[h] = s;
    try {
      await sendMail(email, 'Erősítsd meg a feliratkozást — PIC-ASS-O',
        mailWrap(`<p>Valaki (remélhetőleg te) feliratkoztatta ezt a címet, hogy értesítést kapjon, ha új szoba nyílik a PIC-ASS-O rajzjátékban.</p>
${btn(`${self}?confirm=${s.ct}`, '✅ Feliratkozás megerősítése')}
<p style="font-size:13px;color:#BFD3C4">A link 24 óráig érvényes. Ha nem te voltál, hagyd figyelmen kívül ezt a levelet — megerősítés nélkül egyetlen további levelet sem kapsz.</p>`));
    } catch (e) {
      console.error(e);
      return json({ error: 'Nem sikerült elküldeni a megerősítő levelet.' }, 502);
    }
    await store.setJSON(KEY, d);
    return json({ ok: true, pending: true, count: count(d) });
  }

  // ---- értesítés új szobáról ----
  if (body.action === 'notify') {
    if (limited('n|' + ip, 6, 3600000)) return json({ ok: true, skipped: 'ip' });
    const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const name = String(body.name || '').slice(0, 60).trim() || 'Új szoba';
    const host = String(body.host || '').slice(0, 24).trim() || 'Valaki';
    const d = await read();
    if (Date.now() - (d.lastNotifyAt || 0) < NOTIFY_COOLDOWN_MS) return json({ ok: true, skipped: 'cooldown' });
    const list = Object.values(d.subs).filter(s => s.status === 'ok');
    d.lastNotifyAt = Date.now();
    await store.setJSON(KEY, d);
    if (!list.length) return json({ ok: true, sent: 0 });
    const joinUrl = code ? `${site}/?join=${encodeURIComponent(code)}` : site;
    let sent = 0;
    for (let i = 0; i < list.length; i += 8) {
      const res = await Promise.allSettled(list.slice(i, i + 8).map(s => {
        const unsub = `${self}?unsub=${s.ut}`;
        return sendMail(s.email, `🎨 Új szoba nyílt: ${name}`,
          mailWrap(`<p><b>${esc(host)}</b> most nyitotta meg a(z) <b>„${esc(name)}”</b> szobát. Gyere rajzolni!</p>${btn(joinUrl, '🚀 Csatlakozás')}`, unsub), unsub);
      }));
      sent += res.filter(r => r.status === 'fulfilled').length;
    }
    return json({ ok: true, sent });
  }

  return json({ error: 'unknown action' }, 400);
};
