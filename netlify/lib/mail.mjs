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

export function page(title, inner, status = 200, headers = {}) {
  return new Response(`<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · PIC-ASS-O</title><meta name="robots" content="noindex">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#16302A;color:#F4F1E6;font-family:system-ui,sans-serif;padding:20px}
.c{max-width:440px;background:#20452F;border:3px dashed rgba(244,241,230,.25);border-radius:18px;padding:28px;text-align:center}
h1{color:#FFD166;font-size:1.5rem;margin:0 0 12px}p{line-height:1.5;color:#BFD3C4}
button,a.b{display:inline-block;font:800 1rem system-ui;border:0;border-radius:12px;padding:12px 22px;background:#7BD389;color:#16302A;cursor:pointer;text-decoration:none;margin-top:8px}
button.r{background:#FF6B5B}</style></head><body><div class="c"><h1>${esc(title)}</h1>${inner}</div></body></html>`,
    { status, headers: Object.assign({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' }, headers) });
}

export const mailConfigured = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

let transport = null;
export async function sendMail(to, subject, html, unsubUrl) {
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
