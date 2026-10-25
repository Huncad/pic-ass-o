// PIC-ASS-O — admin munkamenet (v4.19)
// Belépéskor a jelszót a SZERVER ellenőrzi (netlify/functions/admin.mjs), és
// egy aláírt, néhány óráig érvényes munkamenet-kulcsot ad. A többi admin
// végpont ezt fogadja el az x-admin-session fejlécben — így a böngészőnek
// soha nem kell GitHub vagy Netlify tokent ismernie.
// Az aláíró titok magától jön létre az első használatkor (Netlify Blobs).
import { getStore } from '@netlify/blobs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_MS = 4 * 3600 * 1000;
let secretCache = null;

async function secret() {
  if (secretCache) return secretCache;
  if (process.env.ADMIN_SESSION_SECRET && process.env.ADMIN_SESSION_SECRET.length >= 32) return (secretCache = process.env.ADMIN_SESSION_SECRET);
  const store = getStore({ name: 'picasso-admin', consistency: 'strong' });
  let s = await store.get('session-secret').catch(() => null);
  if (!s || s.length < 32) { s = randomBytes(32).toString('hex'); await store.set('session-secret', s); }
  return (secretCache = s);
}

const b64 = s => Buffer.from(s).toString('base64url');
export async function makeSession() {
  const body = b64(JSON.stringify({ exp: Date.now() + SESSION_MS, n: randomBytes(6).toString('hex') }));
  const sig = createHmac('sha256', await secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export async function verifySession(token) {
  const t = String(token || '');
  const i = t.indexOf('.');
  if (i < 10 || t.length > 400) return false;
  const body = t.slice(0, i), sig = t.slice(i + 1);
  const want = createHmac('sha256', await secret()).update(body).digest('base64url');
  if (sig.length !== want.length) return false;
  try { if (!timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false; } catch (e) { return false; }
  try { const d = JSON.parse(Buffer.from(body, 'base64url').toString()); return Number(d.exp) > Date.now(); } catch (e) { return false; }
}

/** Admin-e a kérés: érvényes munkamenet, VAGY (régi út) egy Netlify token, ami hozzáfér a projekthez. */
export async function isAdminRequest(req) {
  if (await verifySession(req.headers.get('x-admin-session'))) return true;
  const token = req.headers.get('x-netlify-token') || '';
  const site = process.env.SITE_ID;
  if (!token || !site) return false;
  try {
    const r = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(site)}`, { headers: { authorization: 'Bearer ' + token } });
    return r.ok;
  } catch (e) { return false; }
}
