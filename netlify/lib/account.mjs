// PIC-ASS-O — fiókok közös magja (v4.40)
// Jelszó-lenyomat, munkamenet, kétfaktoros kód (TOTP), névigazolás (aláírt jegy)
// és tartós sebességkorlát. A netlify/functions/account.mjs és az értesítő
// függvények (subscribe, push) közösen használják.
//
// Biztonsági alapelvek:
//  - a jelszóból csak sózott scrypt-lenyomat tárolódik (visszafejthetetlen);
//    ha van ACCOUNT_PEPPER környezeti változó, az is belekeveredik
//  - a munkamenet-kulcs a böngészőben HttpOnly sütiben él (a JavaScript nem
//    látja), a tárolóban csak a SHA-256 lenyomata van meg
//  - a megerősítő / jelszó-visszaállító linkek kulcsából is csak lenyomat tárolódik
//  - a névigazoló jegy ECDSA P-256 aláírású, rövid életű és a játékos aktuális
//    kapcsolat-azonosítójához kötött: más nem tudja újra felhasználni
import { getStore } from '@netlify/blobs';
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual, generateKeyPairSync, createPrivateKey, sign } from 'node:crypto';
import { updateJSON, ipOf } from './util.mjs';

export const accountStore = () => getStore({ name: 'picasso-accounts', consistency: 'strong' });

export const SESSION_MS = 30 * 86400_000;
export const SESSION_RENEW_MS = 15 * 86400_000;
export const TICKET_MS = 12 * 3600_000;
export const COOKIE = '__Host-picasso_s';
const MAX_SESSIONS = 10;

export const sha = s => createHash('sha256').update(String(s)).digest('hex');
export const newToken = (n = 32) => randomBytes(n).toString('base64url');
export const asObj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
export function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

// ---------- jelszó ----------
const SCRYPT = { N: 1 << 15, r: 8, p: 1 };
const scryptAsync = (pw, salt, o) => new Promise((res, rej) =>
  scrypt(pw, salt, 32, { N: o.N, r: o.r, p: o.p, maxmem: 256 * o.N * o.r }, (e, k) => e ? rej(e) : res(k)));
const pepper = () => (process.env.ACCOUNT_PEPPER && process.env.ACCOUNT_PEPPER.length >= 16) ? process.env.ACCOUNT_PEPPER : '';
const peppered = (pw, pep) => pep ? createHmac('sha256', pep).update(String(pw)).digest() : Buffer.from(String(pw).normalize('NFKC'));

/** Lenyomat: scrypt[p]$logN$r$p$só$kulcs — a "p" jelzi, hogy a szerveroldali titok is benne van. */
export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const pep = pepper();
  const key = await scryptAsync(peppered(String(pw).normalize('NFKC'), pep), salt, SCRYPT);
  return `${pep ? 'scryptp' : 'scrypt'}$${Math.log2(SCRYPT.N)}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
const DUMMY = 'scrypt$15$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
/** Ellenőrzés; hiányzó lenyomatnál is elvégzi a munkát, hogy a válaszidő ne áruljon el semmit. */
export async function verifyPassword(pw, stored) {
  const parts = String(stored || DUMMY).split('$');
  const real = !!stored && parts.length === 6;
  const [kind, ln, r, p, salt, want] = real ? parts : DUMMY.split('$');
  const o = { N: 1 << Math.min(20, Math.max(10, Number(ln) || 15)), r: Number(r) || 8, p: Number(p) || 1 };
  let key;
  try { key = await scryptAsync(peppered(String(pw).normalize('NFKC'), kind === 'scryptp' ? pepper() : ''), Buffer.from(salt, 'base64url'), o); }
  catch (e) { return false; }
  const w = Buffer.from(want, 'base64url');
  return real && key.length === w.length && timingSafeEqual(key, w);
}
/** Kell-e újraszámolni (pl. időközben lett szerveroldali titok). */
export const needsRehash = stored => String(stored || '').startsWith('scrypt$') ? !!pepper() : false;

const COMMON = new Set(['password', 'password1', 'password12', 'password123', '1234567890', '12345678910', 'qwertyuiop', 'qwertzuiop', 'asdfghjkl1', 'jelszo1234', 'jelszo12345', 'jelszojelszo', 'picasso123', 'picasso1234', 'iloveyou12', 'abcdefghij', '0123456789', '9876543210', 'aaaaaaaaaa', '1111111111', '0000000000', 'letmein123', 'welcome123', 'admin12345', 'qwerty12345', 'asdasdasda', 'szeretlek1', 'szeretlek12', 'szeretlek123']);
/** A jelszó hibája szövegesen, vagy '' ha megfelel. */
export function passwordProblem(pw, { name = '', email = '' } = {}) {
  const s = String(pw || '');
  if (s.length < 10) return 'A jelszó legalább 10 karakter legyen.';
  if (s.length > 200) return 'A jelszó legfeljebb 200 karakter lehet.';
  const low = s.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(s)) return 'Ez a jelszó túl gyakori, válassz egy egyedibbet.';
  if (new Set(s).size < 5) return 'A jelszó túl egyszerű, használj többféle karaktert.';
  const n = String(name).toLowerCase(), e = String(email).toLowerCase();
  if ((n.length >= 3 && low === n) || (e && (low === e || low === e.split('@')[0]))) return 'A jelszó ne egyezzen a neveddel vagy az e-mail címeddel.';
  return '';
}

// ---------- kétfaktoros kód (TOTP, RFC 6238) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function unbase32(s) {
  let bits = 0, val = 0; const out = [];
  for (const ch of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    val = (val << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32(randomBytes(20));
export function totpAt(secret, counter) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
/**
 * A beírt kód ellenőrzése ±1 időablakkal. Visszaadja az időablak sorszámát, vagy 0-t.
 * `after`: az utoljára elfogadott sorszám — egy kód csak egyszer használható.
 */
export function totpCheck(secret, code, after = 0, now = Date.now()) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return 0;
  const t = Math.floor(now / 30000);
  let hit = 0;
  for (const d of [0, -1, 1]) { if (safeEqual(totpAt(secret, t + d), c) && t + d > after && !hit) hit = t + d; }
  return hit;
}
export const totpUri = (secret, email) =>
  `otpauth://totp/${encodeURIComponent('PIC-ASS-O:' + email)}?secret=${secret}&issuer=${encodeURIComponent('PIC-ASS-O')}&algorithm=SHA1&digits=6&period=30`;
/** Tartalék kódok: a felhasználó csak egyszer látja őket, a tárolóban a lenyomatuk van. */
export function newBackupCodes(n = 8) {
  const plain = Array.from({ length: n }, () => { const s = base32(randomBytes(7)).slice(0, 10).toLowerCase(); return s.slice(0, 5) + '-' + s.slice(5); });
  return { plain, hashed: plain.map(c => sha('bk|' + c.replace(/-/g, ''))) };
}
export const backupHash = code => sha('bk|' + String(code || '').toLowerCase().replace(/[^a-z2-7]/g, ''));

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
/** Jegy: a név + a játékos kapcsolat-azonosítója (pid) + lejárat, aláírva. */
export async function makeTicket(user, pid, store) {
  const exp = Date.now() + TICKET_MS;
  return { ticket: await signPayload({ u: user.uid, n: user.name, p: String(pid), e: exp }, store), exp };
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
/** Hibás belépések számlálója e-mail címenként (nem létező címre is ugyanúgy működik). */
export async function lockState(store, eh) {
  const d = asObj(await store.get('lock/' + eh, { type: 'json' }).catch(() => null));
  return { n: Number(d.n) || 0, until: Number(d.until) || 0, at: Number(d.at) || 0 };
}
export async function lockFail(store, eh) {
  return updateJSON(store, 'lock/' + eh, raw => {
    const d = asObj(raw), now = Date.now();
    let n = (now - (Number(d.at) || 0) > 3600_000) ? 0 : (Number(d.n) || 0);
    n++;
    const until = n >= 5 ? now + Math.min(15 * 60_000, 30_000 * 2 ** (n - 5)) : 0;
    return { value: { n, until, at: now }, result: { n, until } };
  }).catch(() => ({ n: 0, until: 0 }));
}
export const lockClear = (store, eh) => store.delete('lock/' + eh).catch(() => {});

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
