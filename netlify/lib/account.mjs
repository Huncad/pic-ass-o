// PIC-ASS-O — fiókok közös magja (v4.40; v4.45: jelszó nélkül)
// Munkamenet, névigazolás (aláírt jegy) és tartós sebességkorlát. Jelszó és
// kétfaktoros kód nincs: belépés jelkulccsal vagy e-mailes belépőlinkkel. A netlify/functions/account.mjs és az értesítő
// függvények (subscribe, push) közösen használják.
//
// Biztonsági alapelvek:
//  - a munkamenet-kulcs a böngészőben HttpOnly sütiben él (a JavaScript nem
//    látja), a tárolóban csak a SHA-256 lenyomata van meg
//  - a megerősítő és belépőlinkek kulcsából is csak lenyomat tárolódik
//  - a névigazoló jegy ECDSA P-256 aláírású, rövid életű és a játékos aktuális
//    kapcsolat-azonosítójához kötött: más nem tudja újra felhasználni
import { getStore } from '@netlify/blobs';
import { createHash, randomBytes, timingSafeEqual, generateKeyPairSync, createPrivateKey, sign } from 'node:crypto';
import { updateJSON, ipOf } from './util.mjs';

export const accountStore = () => getStore({ name: 'picasso-accounts', consistency: 'strong' });

export const SESSION_MS = 30 * 86400_000;
export const SESSION_RENEW_MS = 15 * 86400_000;
export const TICKET_MS = 15 * 60_000;          // rövid életű: a böngésző pár percenként újat kér
export const COOKIE = '__Host-picasso_s';
const MAX_SESSIONS = 10;

export const sha = s => createHash('sha256').update(String(s)).digest('hex');
export const newToken = (n = 32) => randomBytes(n).toString('base64url');
export const asObj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
export function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

// ---------- névigazoló jegy (ECDSA P-256) ----------
let keyCache = null;
async function signKey(store = accountStore()) {
  if (keyCache) return keyCache;
  let k = await store.get('signkey', { type: 'json' }).catch(() => null);
  if (!k || !k.priv || !k.pub) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const fresh = { priv: privateKey.export({ format: 'jwk' }), pub: publicKey.export({ format: 'jwk' }), at: Date.now() };
    const w = await store.setJSON('signkey', fresh, { onlyIfNew: true }).catch(() => null);
    k = (w && w.modified === false) ? await store.get('signkey', { type: 'json' }).catch(() => null) : fresh;
    if (!k || !k.priv) k = fresh;
  }
  return (keyCache = { priv: createPrivateKey({ key: k.priv, format: 'jwk' }), pub: { kty: k.pub.kty, crv: k.pub.crv, x: k.pub.x, y: k.pub.y } });
}
export async function publicKey(store) { return (await signKey(store)).pub; }
/** Tetszőleges adat aláírása: "törzs.aláírás" (mindkettő base64url). */
export async function signPayload(obj, store) {
  const k = await signKey(store);
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const sig = sign('sha256', Buffer.from(body), { key: k.priv, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${body}.${sig}`;
}
/**
 * Jegy: a név + a játékos kapcsolat-azonosítója (pid) + lejárat, aláírva.
 * `th`: a játékszerver-kapcsolat titkos kulcsának lenyomata — a szerver csak attól fogadja el a jegyet,
 * aki a kulcsot ismeri, így egy szobatárs által látott jegyet más nem tud a szervernél felhasználni.
 */
export async function makeTicket(user, pid, th, store) {
  const exp = Date.now() + TICKET_MS;
  return { ticket: await signPayload({ u: user.uid, n: user.name, p: String(pid), h: String(th || ''), e: exp }, store), exp };
}

// ---------- tartós sebességkorlát (a tárolóban, így példányok között is él) ----------
/** true, ha a kulcs túllépte a keretet. */
export async function overLimit(store, key, max, windowMs) {
  const k = 'rl/' + sha(key).slice(0, 40);
  try {
    return await updateJSON(store, k, raw => {
      const now = Date.now();
      const t = (Array.isArray(asObj(raw).t) ? raw.t : []).filter(x => now - x < windowMs);
      if (t.length >= max) return { write: false, result: true };
      t.push(now);
      return { value: { t, exp: now + windowMs }, result: false };
    });
  } catch (e) { return false; }
}
// ---------- munkamenet ----------
export function readCookie(req, name = COOKIE) {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}
export const sessionCookie = (token, maxAgeMs = SESSION_MS) =>
  `${COOKIE}=${token}; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}; HttpOnly; Secure; SameSite=Strict`;
export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

export const getUser = (store, uid) => store.get('u/' + uid, { type: 'json' }).catch(() => null);

/** Új munkamenet: visszaadja a sütibe kerülő kulcsot. A felhasználó rekordjában a lenyomat-lista is frissül. */
export async function createSession(store, uid, req) {
  const token = newToken(32), h = sha(token), now = Date.now();
  await store.setJSON('s/' + h, { uid, at: now, exp: now + SESSION_MS, ua: String(req.headers.get('user-agent') || '').slice(0, 120) });
  const dropped = await updateJSON(store, 'u/' + uid, raw => {
    if (!raw) return { write: false, result: [] };
    const list = (Array.isArray(raw.sess) ? raw.sess : []).concat(h);
    const out = list.splice(0, Math.max(0, list.length - MAX_SESSIONS));
    raw.sess = list;
    return { value: raw, result: out };
  });
  await Promise.all((dropped || []).map(x => store.delete('s/' + x).catch(() => {})));
  return token;
}
/** A kérés bejelentkezett felhasználója: { user, sh, sess } vagy null. */
export async function sessionUser(req, store = accountStore()) {
  const token = readCookie(req);
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const sh = sha(token);
  const sess = await store.get('s/' + sh, { type: 'json' }).catch(() => null);
  if (!sess || !sess.uid || Number(sess.exp) < Date.now()) { if (sess) await store.delete('s/' + sh).catch(() => {}); return null; }
  const user = await getUser(store, sess.uid);
  if (!user || !Array.isArray(user.sess) || !user.sess.includes(sh)) return null;
  if (await store.get('banned/' + user.uid).catch(() => null)) return null;   // v4.44: végleg kitiltott fiók
  return { user, sh, sess, token };
}
/** Minden munkamenet lezárása (a megadott kivételével). */
export async function revokeSessions(store, uid, keepSh = '') {
  const gone = await updateJSON(store, 'u/' + uid, raw => {
    if (!raw) return { write: false, result: [] };
    const all = Array.isArray(raw.sess) ? raw.sess : [];
    raw.sess = all.filter(x => x === keepSh);
    return { value: raw, result: all.filter(x => x !== keepSh) };
  });
  await Promise.all((gone || []).map(x => store.delete('s/' + x).catch(() => {})));
}

/** Saját oldalról jön-e a kérés (a SameSite süti mellett második védvonal a CSRF ellen). */
export function sameOrigin(req) {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return false;
  const o = req.headers.get('origin');
  if (o) { try { return new URL(o).host === new URL(req.url).host; } catch (e) { return false; } }
  return true;
}
export { ipOf };
