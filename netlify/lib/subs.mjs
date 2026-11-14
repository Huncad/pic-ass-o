// PIC-ASS-O — az e-mail értesítő feliratkozóinak közös kezelése (v4.40)
// A v4.40-től értesítést csak regisztrált játékos kérhet: minden feliratkozás
// egy fiókhoz (uid) tartozik. A korábbi, fiók nélküli feliratkozók kapnak egy
// tájékoztató levelet, és 30 nap türelmi idő után törlődnek, hacsak közben
// ugyanazzal a címmel nem regisztrálnak (akkor a feliratkozásuk megmarad).
import { getStore } from '@netlify/blobs';
import { createHash, randomBytes } from 'node:crypto';
import { updateJSON } from './util.mjs';

export const SUBS_KEY = 'subs';
export const MAX_SUBS = 5000;
export const LEGACY_GRACE_MS = 30 * 86400_000;
export const subsStore = () => getStore({ name: 'picasso-subscribers', consistency: 'strong' });
export const subHash = email => createHash('sha256').update(String(email)).digest('hex').slice(0, 32);
const asObj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const PENDING_TTL_MS = 24 * 3600 * 1000;

/** A nyers tartalom rendbetétele: lejárt függő címek és a türelmi idő után a fiók nélküliek törlése. */
export function tidySubs(raw) {
  const d = asObj(raw);
  d.subs = asObj(d.subs);
  const now = Date.now();
  const legacyOver = Number(d.legacyUntil) > 0 && now > Number(d.legacyUntil);
  for (const [h, s] of Object.entries(d.subs)) {
    if (!s || (s.status !== 'ok' && now - (s.at || 0) > PENDING_TTL_MS)) delete d.subs[h];
    else if (!s.uid && legacyOver) delete d.subs[h];
  }
  return d;
}
export const countSubs = d => Object.values(d.subs).filter(s => s.status === 'ok').length;

/** A fiók e-mail értesítőjének be- / kikapcsolása. A cím a fiók megerősített címe, ezért nem kell külön megerősítés. */
export async function setAccountSub(user, on, store = subsStore()) {
  const h = subHash(user.email);
  return updateJSON(store, SUBS_KEY, raw => {
    const d = tidySubs(raw);
    const cur = d.subs[h];
    if (!on) {
      if (!cur) return { write: false, result: { ok: true, on: false } };
      delete d.subs[h];
      return { value: d, result: { ok: true, on: false } };
    }
    if (cur && cur.status === 'ok' && cur.uid === user.uid) return { write: false, result: { ok: true, on: true } };
    if (!cur && Object.keys(d.subs).length >= MAX_SUBS) return { write: false, result: { error: 'full' } };
    const pal = (user.settings && user.settings['mail-colors']) || (user.regPal ? JSON.stringify(user.regPal) : undefined);
    d.subs[h] = { email: user.email, status: 'ok', pal: typeof pal === 'string' ? pal.slice(0, 400) : undefined, ut: (cur && cur.ut) || randomBytes(24).toString('base64url'), uid: user.uid,
      at: (cur && cur.at) || Date.now(), okAt: Date.now(), consent: 'v4.40: fiókhoz kötött értesítés új szobákról (16+, a fiókban bekapcsolva)' };
    return { value: d, result: { ok: true, on: true } };
  });
}
export async function accountSubOn(user, store = subsStore()) {
  const d = tidySubs(await store.get(SUBS_KEY, { type: 'json' }).catch(() => null));
  const s = d.subs[subHash(user.email)];
  return !!(s && s.status === 'ok' && s.uid === user.uid);
}
/** Regisztrációkor: ha ezzel a címmel volt korábbi (fiók nélküli) feliratkozás, a fiókhoz kötjük, így megmarad. */
export async function claimLegacySub(user, store = subsStore()) {
  const h = subHash(user.email);
  return updateJSON(store, SUBS_KEY, raw => {
    const d = tidySubs(raw);
    const cur = d.subs[h];
    if (!cur || cur.status !== 'ok' || cur.uid) return { write: false, result: false };
    cur.uid = user.uid;
    return { value: d, result: true };
  }).catch(() => false);
}
/** Fiók törlésekor a hozzá tartozó feliratkozás is megy. */
export async function removeSubsOf(uid, store = subsStore()) {
  return updateJSON(store, SUBS_KEY, raw => {
    const d = tidySubs(raw);
    const hit = Object.entries(d.subs).filter(([, s]) => s && s.uid === uid);
    if (!hit.length) return { write: false };
    hit.forEach(([h]) => delete d.subs[h]);
    return { value: d };
  }).catch(() => {});
}

/** v4.43: a játékos színvilága a feliratkozásnál is (az értesítő levél ezekkel a színekkel megy). */
export async function setSubPalette(user, pal, store = subsStore()) {
  const h = subHash(user.email);
  return updateJSON(store, SUBS_KEY, raw => {
    const d = tidySubs(raw);
    const cur = d.subs[h];
    if (!cur || cur.uid !== user.uid) return { write: false };
    cur.pal = pal ? JSON.stringify(pal) : undefined;
    return { value: d };
  });
}
