// PIC-ASS-O — közös levélküldő és HTML-sablonok (v4.40)
// A subscribe függvényből kiemelve, hogy a fiókkezelő (account) is használhassa.
//
// Környezeti változók (Netlify → Site configuration → Environment variables):
//   GMAIL_USER          — a küldő Gmail cím
//   GMAIL_APP_PASSWORD  — a Google fiók 16 karakteres alkalmazásjelszava
//   MAIL_FROM_NAME (nem kötelező, alapból "PIC-ASS-O")
import nodemailer from 'nodemailer';

export const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const cleanEmail = e => {
  const s = String(e || '').trim().toLowerCase();
  return s.length <= 120 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/.test(s) ? s : '';
};

// ---- v4.43: a levelek és oldalak a játékos saját színvilágában ----
// A böngésző a ténylegesen látott színeket küldi (téma + sötét mód), mi csak ellenőrizzük és behelyettesítjük.
const DEFAULT_PAL = { bg: '#16302A', panel: '#20452F', text: '#F4F1E6', dim: '#BFD3C4', accent: '#FFD166', link: '#5FB6DE', btn: '#7BD389', btnText: '#16302A' };
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/** Ellenőrzött paletta (bármi hibás → az alap zöld); bemenet: objektum vagy JSON-szöveg. */
export function cleanPalette(v) {
  let o = v;
  if (typeof v === 'string') { try { o = JSON.parse(v); } catch (e) { o = null; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  for (const k of Object.keys(DEFAULT_PAL)) { if (!COLOR_RE.test(String(o[k] || ''))) return null; out[k] = String(o[k]); }
  return out;
}
/** Az alapszínek cseréje a játékos palettájára (egyszerre, hogy a cserék ne írják felül egymást). */
export function themed(html, pal) {
  const p = cleanPalette(pal);
  if (!p) return html;
  const map = { '#16302a': null, '#20452f': p.panel, '#f4f1e6': p.text, '#bfd3c4': p.dim, '#ffd166': p.accent, '#5fb6de': p.link, '#7bd389': p.btn };
  return html.replace(/(background:)?#(16302A|20452F|F4F1E6|BFD3C4|FFD166|5FB6DE|7BD389)\b/gi, (m, bgPrefix, hex) => {
    const k = '#' + hex.toLowerCase();
    if (k === '#16302a') return (bgPrefix || '') + (bgPrefix ? p.bg : p.btnText);   // háttérként a lap, szövegként a gomb felirata
    return (bgPrefix || '') + map[k];
  });
}

export function page(title, inner, status = 200, headers = {}, pal = null) {
  return new Response(themed(`<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · PIC-ASS-O</title><meta name="robots" content="noindex">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#16302A;color:#F4F1E6;font-family:system-ui,sans-serif;padding:20px}
.c{max-width:440px;background:#20452F;border:3px dashed rgba(244,241,230,.25);border-radius:18px;padding:28px;text-align:center}
h1{color:#FFD166;font-size:1.5rem;margin:0 0 12px}p{line-height:1.5;color:#BFD3C4}
button,a.b{display:inline-block;font:800 1rem system-ui;border:0;border-radius:12px;padding:12px 22px;background:#7BD389;color:#16302A;cursor:pointer;text-decoration:none;margin-top:8px}
button.r{background:#FF6B5B}</style></head><body><div class="c"><h1>${esc(title)}</h1>${inner}</div></body></html>`, pal),
    { status, headers: Object.assign({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' }, headers) });
}

export const mailConfigured = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

let transport = null;
export async function sendMail(to, subject, html, unsubUrl, pal = null) {
  html = themed(html, pal);
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('nincs beállítva a Gmail');
  if (!transport) transport = nodemailer.createTransport({ service: 'gmail', pool: true, maxConnections: 3, auth: { user, pass: pass.replace(/\s+/g, '') } });
  const msg = { from: { name: process.env.MAIL_FROM_NAME || 'PIC-ASS-O', address: user }, to, subject, html };
  if (unsubUrl) msg.list = { unsubscribe: { url: unsubUrl, comment: 'Leiratkozás' } };
  if (unsubUrl) msg.headers = { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  await transport.sendMail(msg);
}

export const mailWrap = (inner, unsubUrl) => `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;background:#20452F;color:#F4F1E6;border-radius:16px;padding:24px">
<h2 style="color:#FFD166;margin:0 0 12px">PIC-ASS-O ✏️</h2>${inner}
${unsubUrl ? `<p style="font-size:12px;color:#BFD3C4;margin-top:24px">Azért kaptad, mert feliratkoztál az új szobák értesítőjére. <a href="${unsubUrl}" style="color:#5FB6DE">Leiratkozás</a></p>` : ''}</div>`;
export const btn = (url, text) => `<p><a href="${url}" style="display:inline-block;background:#7BD389;color:#16302A;font-weight:800;padding:12px 22px;border-radius:12px;text-decoration:none">${text}</a></p>`;

// ---- v4.51: csak magánszemélyes e-mail cím ----
// Céges címet általánosan nem lehet felismerni, ezért fordítva: csak az ismert, bárki által ingyen
// (vagy magánszemélyként) használható levelezőszolgáltatók címeit fogadjuk el.
const PERSONAL = new Set([
  'gmail.com','googlemail.com',
  'outlook.com','outlook.hu','hotmail.com','hotmail.hu','hotmail.co.uk','hotmail.de','hotmail.fr','hotmail.it','live.com','live.hu','live.co.uk','live.de','msn.com',
  'yahoo.com','yahoo.co.uk','yahoo.de','yahoo.fr','yahoo.it','yahoo.es','ymail.com','rocketmail.com',
  'icloud.com','me.com','mac.com',
  'proton.me','protonmail.com','protonmail.ch','pm.me','tutanota.com','tutanota.de','tuta.io','tuta.com',
  'gmx.com','gmx.net','gmx.de','gmx.at','gmx.ch','gmx.hu','web.de','mail.com','email.com','aol.com','zoho.com','yandex.com','yandex.ru','mail.ru','inbox.lv','seznam.cz','centrum.cz','wp.pl','o2.pl','interia.pl','onet.pl','libero.it','free.fr','orange.fr','laposte.net','t-online.de','bluewin.ch','abv.bg','fastmail.com','hey.com',
  // magyar ingyenes / internetszolgáltatói (magánszemélyes) levelezők
  'freemail.hu','citromail.hu','indamail.hu','vipmail.hu','t-online.hu','upcmail.hu','chello.hu','invitel.hu','digikabel.hu','externet.hu','vodafone.hu','telenor.hu','tvnetwork.hu','mailbox.hu','postafiok.hu','hu.inter.net','axelero.hu','fibermail.hu','yettel.hu','one.hu'
]);
/** true, ha a cím ismert magánszemélyes szolgáltatónál van */
export function isPersonalEmail(email) {
  const d = String(email || '').toLowerCase().split('@')[1] || '';
  // ACCOUNT_EXTRA_EMAIL_DOMAINS (nem kötelező): további elfogadott szolgáltatók, vesszővel elválasztva
  const extra = String(process.env.ACCOUNT_EXTRA_EMAIL_DOMAINS || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  return PERSONAL.has(d) || extra.includes(d);
}
export const PERSONAL_EMAIL_TEXT = 'Csak magánszemélyes e-mail címmel lehet regisztrálni (például Gmail, Freemail, Citromail, Outlook/Hotmail, iCloud, Yahoo, Proton) — céges vagy iskolai címmel nem. Ha a szolgáltatód nincs a listán, írj nekünk: picasso.ertesito@gmail.com';
