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
  if (!s || s.length < 32) {
    // v4.30: ha két példány egyszerre hozná létre, csak az első írás nyer, a másik azt olvassa vissza
    const fresh = randomBytes(32).toString('hex');
    const w = await store.set('session-secret', fresh, s ? undefined : { onlyIfNew: true }).catch(() => null);
    s = (w && w.modified === false) ? await store.get('session-secret').catch(() => null) : fresh;
    if (!s || s.length < 32) s = fresh;
  }
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

/** Admin-e a kérés: érvényes munkamenet (v4.30: a régi Netlify-tokenes út megszűnt, a játék már nem használta). */
export async function isAdminRequest(req) {
  return verifySession(req.headers.get('x-admin-session'));
}
