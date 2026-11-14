// PIC-ASS-O — fiókok (v4.40)
// Regisztráció e-mail megerősítéssel, belépés jelszóval és választható
// kétfaktoros kóddal, névvédelem, eszközök közti statisztika és beállítások.
//
//   GET                    -> { user | null }   (a bejelentkezett fiók adatai)
//   GET  ?name=NÉV         -> { taken }         (regisztrált-e ez a név)
//   GET  ?pubkey=1         -> { key }           (a névigazoló jegyek nyilvános kulcsa)
//   GET  ?confirm=KULCS    -> HTML oldal egy gombbal (a levélszűrők előre megnyitják a linkeket,
//   POST ?confirm=KULCS    -> ezért csak a gomb hozza létre a fiókot)
//   POST { action, ... }   -> register | login | logout | logout-all | ticket | stats-get | stats-put |
//                             settings-put | notify | totp-begin | totp-enable | totp-disable |
//                             password | forgot | reset | delete
//
// Környezeti változók: a levélküldéshez ugyanaz kell, mint az értesítőhöz
// (GMAIL_USER, GMAIL_APP_PASSWORD). Nem kötelező: ACCOUNT_PEPPER (legalább 16
// karakteres titok, ami a jelszó-lenyomatokba keveredik — ha egyszer beállítod,
// ne változtasd meg, mert a vele készült lenyomatok érvénytelenné válnak).
import { json, updateJSON, makeLimiter } from '../lib/util.mjs';
import { esc, cleanEmail, page as basePage, sendMail as baseSendMail, mailWrap, btn, cleanPalette } from '../lib/mail.mjs';
import {
  accountStore, sha, newToken, asObj, safeEqual, hashPassword, verifyPassword, needsRehash, passwordProblem,
  newTotpSecret, totpCheck, totpUri, newBackupCodes, backupHash, publicKey, makeTicket, signPayload, overLimit,
  lockState, lockFail, lockClear, sessionCookie, clearCookie, getUser, createSession, sessionUser,
  revokeSessions, sameOrigin, ipOf, SESSION_RENEW_MS, SESSION_MS
} from '../lib/account.mjs';
import { setAccountSub, accountSubOn, claimLegacySub, removeSubsOf, setSubPalette } from '../lib/subs.mjs';
import { removePushOf } from '../lib/push.mjs';
import { cleanName, nameKey, isPlainObject } from '../../js/rules.js';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';

const PENDING_MS = 24 * 3600_000;
const RESET_MS = 3600_000;
const MAX_STATS_BYTES = 60_000;
const MAIL_DAY_CAP = Math.max(1, Number(process.env.ACCOUNT_MAIL_DAILY_CAP) || 200);
const RESERVED = new Set(['valaki', 'vendeg', 'admin', 'adminisztrator', 'moderator', 'picasso', 'pic-ass-o', 'pic ass o', 'rendszer', 'szerver', 'huncraft', 'teged', 'te', 'en']);
const SETTING_KEYS = ['mail-colors', 'avatar-color','dark-mode','theme','master-sound','sfx-vol','sfx-muted','music-vol','music-muted','replay-speed','create-prefs','chat-size','chat-pos','chat-fs','chat-dock','fab-pos','whatis-noimg','tutorial-seen','setup-advanced-open','sub-open','notify-skip-own','phone-hint','announce-dismissed'];
const GAME_SERVER_URL = String(process.env.GAME_SERVER_URL || 'https://picasso.taile8c93.ts.net').replace(/\/+$/, '');
const softLimit = makeLimiter();
/** v4.43: a fiók tulajdonosának színvilága (a játékban látott színek, a beállításokkal szinkronizálva) */
const palOf = u => cleanPalette(u && u.settings && u.settings['mail-colors']) || cleanPalette(u && u.regPal);

const nameBlob = key => 'n/' + Buffer.from(key).toString('hex');
const GENERIC_LOGIN = 'Hibás e-mail cím vagy jelszó.';
const err = (msg, status = 400, extra = {}) => json(Object.assign({ error: msg }, extra), status);

/** A regisztrálható név: pontosan úgy, ahogy a játék megjelenítené. */
function validName(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (s.length < 3 || s.length > 16 || cleanName(s) !== s) return { error: 'A név 3–16 karakter hosszú legyen.' };
  if (/[\u0000-\u001f\u007f<>"'`\\]/.test(s) || /[​-‏‪-‮⁠-⁯﻿]/.test(s)) return { error: 'A névben nem megengedett karakter van.' };
  const key = nameKey(s);
  if (key.replace(/[^a-z0-9]/g, '').length < 2) return { error: 'A névben legyen legalább két betű vagy szám.' };
  if (RESERVED.has(key) || /^vendeg\b/.test(key)) return { error: 'Ez a név nem választható.' };
  return { name: s, key };
}
async function nameTaken(store, key) {
  const n = await store.get(nameBlob(key), { type: 'json' }).catch(() => null);
  return !!(n && (n.uid || Number(n.until) > Date.now()));
}
const publicUser = async (u) => ({
  name: u.name, email: u.email, twofa: !!(u.totp && u.totp.on), backupLeft: Array.isArray(u.backup) ? u.backup.length : 0,
  createdAt: u.createdAt, notifyEmail: await accountSubOn(u).catch(() => false), settings: asObj(u.settings),
  passkeys: (Array.isArray(u.pk) ? u.pk : []).map(k => ({ id: k.id, name: k.name, at: k.at, used: k.used || 0 }))
});
const MAX_PASSKEYS = 10;
const PK_CHALLENGE_MS = 5 * 60_000;
const pkBlob = id => 'pk/' + sha('pk|' + id);
/** A jelkulcs eszközének emberi neve a böngészőből (csak tájékoztató). */
function deviceLabel(req) {
  const ua = String(req.headers.get('user-agent') || '');
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'eszköz';
  const br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return (os + (br ? ' · ' + br : '')).slice(0, 40);
}
async function mailAllowed(store) {
  return !(await overLimit(store, 'mailday|' + new Date().toISOString().slice(0, 10), MAIL_DAY_CAP, 86400_000));
}
function cleanStats(v) {
  if (!isPlainObject(v)) return null;
  let s; try { s = JSON.stringify(v); } catch (e) { return null; }
  if (s.length > MAX_STATS_BYTES || /"__proto__"|"constructor"|"prototype"/.test(s)) return null;
  return JSON.parse(s);
}
function cleanSettings(v) {
  const out = {};
  if (!isPlainObject(v)) return out;
  let total = 0;
  for (const k of SETTING_KEYS) {
    if (typeof v[k] !== 'string' || !v[k].length || v[k].length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v[k])) continue;
    total += v[k].length;
    if (total > 30000) break;
    out[k] = v[k];
  }
  return out;
}

export default async (req) => {
  const url = new URL(req.url);
  const self = url.origin + url.pathname;
  const site = url.origin;
  const store = accountStore();
  const ip = ipOf(req);
  let reqPal = null;   // v4.43: a levél / oldal színei
  const sendMail = (to, subject, html, unsub) => baseSendMail(to, subject, html, unsub, reqPal);
  const page = (title, inner, status, headers) => basePage(title, inner, status, headers, reqPal);

  // ---------- nyilvános lekérdezések ----------
  if (req.method === 'GET' && url.searchParams.has('pubkey')) {
    return json({ key: await publicKey(store) }, 200, { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' });
  }
  if (req.method === 'GET' && url.searchParams.has('name')) {
    if (softLimit('n|' + ip, 300, 600_000)) return err('Lassabban!', 429);
    const key = nameKey(String(url.searchParams.get('name') || '').slice(0, 40));
    return json({ taken: key ? await nameTaken(store, key) : false }, 200, { 'access-control-allow-origin': '*' });
  }

  // ---------- regisztráció megerősítése (a levélből) ----------
  const confirmT = url.searchParams.get('confirm');
  if (confirmT) {
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(confirmT)) return page('A link hibás', '<p>Ez a megerősítő link nem érvényes.</p>', 404);
    const pk = 'p/' + sha(confirmT);
    if (req.method !== 'POST') {
      return page('Regisztráció megerősítése', `<p>Egy kattintás, és kész a PIC-ASS-O fiókod.</p>
<form method="post" action="${esc(self)}?confirm=${encodeURIComponent(confirmT)}"><button>✅ Megerősítem az e-mail címem</button></form>
<p style="font-size:.85rem">Ha nem te regisztráltál, egyszerűen zárd be ezt az oldalt — fiók nem jön létre.</p>`);
    }
    const p = await store.get(pk, { type: 'json' }).catch(() => null);
    reqPal = cleanPalette(p && p.pal);
    if (!p || Date.now() - (p.at || 0) > PENDING_MS) {
      return page('A link lejárt', `<p>Ez a megerősítő link már nem érvényes (24 óráig él, és csak egyszer használható). Ha a fiókod már kész, lépj be; ha nem, regisztrálj újra.</p><a class="b" href="${esc(site)}/?fiok=1">Irány a játék</a>`, 404);
    }
    const uid = newToken(12);
    // az e-mail cím foglalása: csak az első megerősítés nyer
    const w = await store.setJSON('e/' + p.eh, { uid }, { onlyIfNew: true }).catch(() => null);
    if (!w || w.modified === false) {
      await store.delete(pk).catch(() => {});
      return page('Már van fiókod', `<p>Ezzel az e-mail címmel már létezik fiók. Lépj be a játék kezdőoldalán.</p><a class="b" href="${esc(site)}/?fiok=1">Belépés</a>`, 409);
    }
    const nb = await store.get(nameBlob(p.key), { type: 'json' }).catch(() => null);
    if (nb && nb.uid) {   // a névfoglalás közben lejárt, és más vitte el
      await store.delete('e/' + p.eh).catch(() => {});
      await store.delete(pk).catch(() => {});
      return page('A név közben elkelt', `<p>Sajnos ezt a nevet időközben más regisztrálta. Kérlek, regisztrálj újra egy másik névvel.</p><a class="b" href="${esc(site)}/?fiok=1">Vissza a játékhoz</a>`, 409);
    }
    const user = { uid, name: p.name, key: p.key, email: p.email, eh: p.eh, pw: p.pw, createdAt: Date.now(), sess: [], settings: {}, regPal: reqPal || undefined,
      consent: 'v4.40: elmúlt 16 éves, és elfogadta az adatkezelési tájékoztatót (' + new Date(p.at).toISOString() + ')' };
    await store.setJSON('u/' + uid, user);
    await store.setJSON(nameBlob(p.key), { uid });
    await store.delete(pk).catch(() => {});
    await claimLegacySub(user);
    return page('Kész a fiókod! 🎉', `<p>Szia, <b>${esc(user.name)}</b>! Az e-mail címed megerősítve. Mostantól ez a név csak a tiéd — lépj be a játékban az e-mail címeddel és a jelszavaddal.</p><a class="b" href="${esc(site)}/?fiok=1">Belépés</a>`);
  }

  // ---------- a bejelentkezett fiók ----------
  if (req.method === 'GET') {
    const s = await sessionUser(req, store);
    if (!s) return json({ user: null });
    const headers = {};
    if (Number(s.sess.exp) - Date.now() < SESSION_RENEW_MS) {   // a munkamenet meghosszabbítása használat közben
      await store.setJSON('s/' + s.sh, Object.assign({}, s.sess, { exp: Date.now() + SESSION_MS })).catch(() => {});
      headers['set-cookie'] = sessionCookie(s.token);
    }
    return json({ user: await publicUser(s.user) }, 200, headers);
  }
  if (req.method !== 'POST') return err('method', 405);
  if (!sameOrigin(req)) return err('forbidden', 403);
  if (!String(req.headers.get('content-type') || '').includes('application/json')) return err('bad content-type', 415);
  let body = {};
  try { body = await req.json(); } catch (e) { return err('bad json', 400); }
  if (!isPlainObject(body)) return err('bad json', 400);
  const action = String(body.action || '');
  reqPal = cleanPalette(body.pal);

  // ---------- regisztráció ----------
  if (action === 'register') {
    if (await overLimit(store, 'reg|' + ip, 6, 3600_000)) return err('Túl sok próbálkozás, próbáld újra egy óra múlva.', 429);
    if (body.consent !== true) return err('A regisztrációhoz el kell fogadnod a feltételeket (16 éves kor felett).');
    const vn = validName(body.name);
    if (vn.error) return err(vn.error, 400, { field: 'name' });
    const email = cleanEmail(body.email);
    if (!email) return err('Ez nem tűnik érvényes e-mail címnek.', 400, { field: 'email' });
    const pwErr = passwordProblem(body.password, { name: vn.name, email });
    if (pwErr) return err(pwErr, 400, { field: 'password' });
    const eh = sha('em|' + email);
    const nk = nameBlob(vn.key);
    const nb = await store.get(nk, { type: 'json' }).catch(() => null);
    if (nb && (nb.uid || (Number(nb.until) > Date.now() && nb.eh !== eh))) return err('Ez a név már foglalt, válassz másikat.', 409, { field: 'name' });
    const done = json({ ok: true, pending: true });   // ugyanaz a válasz, akár létezik már a cím, akár nem
    const existing = await store.get('e/' + eh, { type: 'json' }).catch(() => null);
    if (existing) {
      // a címmel már van fiók: a válaszból ez nem derül ki, a tulajdonos levelet kap róla
      if (!(await overLimit(store, 'regdup|' + eh, 1, 3600_000)) && await mailAllowed(store)) {
        await sendMail(email, 'Már van fiókod — PIC-ASS-O', mailWrap(`<p>Valaki (talán te) regisztrálni próbált ezzel az e-mail címmel, de ehhez a címhez már tartozik PIC-ASS-O fiók.</p>
<p>Ha elfelejtetted a jelszavad, a belépésnél kérhetsz újat. Ha nem te voltál, nincs teendőd.</p>${btn(site + '/?fiok=1', 'Belépés')}`)).catch(e => console.error(e));
      }
      return done;
    }
    if (await overLimit(store, 'regmail|' + eh, 3, 3600_000)) return done;
    if (!(await mailAllowed(store))) return err('Ma már túl sok levelet küldtünk ki, próbáld újra holnap.', 503);
    const token = newToken(32);
    const pw = await hashPassword(body.password);
    // a név lefoglalása a megerősítésig (24 óra) — ütközésbiztosan
    const reserved = await updateJSON(store, nk, raw => {
      const cur = asObj(raw);
      if (cur.uid || (Number(cur.until) > Date.now() && cur.eh !== eh)) return { write: false, result: false };
      return { value: { eh, until: Date.now() + PENDING_MS }, result: true };
    }).catch(() => false);
    if (!reserved) return err('Ez a név már foglalt, válassz másikat.', 409, { field: 'name' });
    await store.setJSON('p/' + sha(token), { name: vn.name, key: vn.key, email, eh, pw, at: Date.now(), pal: reqPal });
    try {
      await sendMail(email, 'Erősítsd meg a regisztrációt — PIC-ASS-O', mailWrap(`<p>Szia! Valaki (remélhetőleg te) fiókot kért a PIC-ASS-O rajzjátékban <b>${esc(vn.name)}</b> néven, ezzel az e-mail címmel.</p>
${btn(`${self}?confirm=${token}`, '✅ E-mail cím megerősítése')}
<p style="font-size:13px;color:#BFD3C4">A link 24 óráig érvényes. Ha nem te voltál, hagyd figyelmen kívül ezt a levelet — megerősítés nélkül nem jön létre fiók.</p>`));
    } catch (e) {
      console.error(e);
      return err('Nem sikerült elküldeni a megerősítő levelet. Próbáld újra később.', 502);
    }
    return done;
  }

  // ---------- belépés ----------
  if (action === 'login') {
    if (await overLimit(store, 'login|' + ip, 30, 900_000)) return err('Túl sok próbálkozás erről a hálózatról, próbáld újra negyed óra múlva.', 429);
    const email = cleanEmail(body.email);
    const password = String(body.password || '');
    if (!email || !password || password.length > 200) return err(GENERIC_LOGIN, 401);
    const eh = sha('em|' + email);
    const lock = await lockState(store, eh);
    if (lock.until > Date.now()) return err(`Túl sok hibás próbálkozás. Próbáld újra ${Math.ceil((lock.until - Date.now()) / 60000)} perc múlva.`, 429);
    const idx = await store.get('e/' + eh, { type: 'json' }).catch(() => null);
    const user = idx && idx.uid ? await getUser(store, idx.uid) : null;
    const okPw = await verifyPassword(password, user && user.pw);
    if (!user || !okPw) { await lockFail(store, eh); return err(GENERIC_LOGIN, 401); }
    if (user.totp && user.totp.on) {
      const code = String(body.code || '').trim();
      if (!code) return json({ need2fa: true });
      const step = totpCheck(user.totp.secret, code, Number(user.totp.last) || 0);
      const bh = backupHash(code);
      const viaBackup = !step && Array.isArray(user.backup) && user.backup.some(h => safeEqual(h, bh));
      if (!step && !viaBackup) { await lockFail(store, eh); return err('Hibás ellenőrző kód.', 401, { need2fa: true }); }
      // a kód (vagy tartalék kód) csak egyszer használható
      const fresh = await updateJSON(store, 'u/' + user.uid, raw => {
        if (!raw || !raw.totp) return { write: false, result: false };
        if (step) { if (Number(raw.totp.last) >= step) return { write: false, result: false }; raw.totp.last = step; }
        else { const before = (raw.backup || []).length; raw.backup = (raw.backup || []).filter(h => !safeEqual(h, bh)); if (raw.backup.length === before) return { write: false, result: false }; }
        return { value: raw, result: true };
      });
      if (!fresh) return err('Ezt a kódot már felhasználtad, várd meg a következőt.', 401, { need2fa: true });
    }
    if (await store.get('banned/' + user.uid).catch(() => null)) return err('Ez a fiók végleg ki van tiltva a játékból.', 403);
    await lockClear(store, eh);
    if (needsRehash(user.pw)) {
      const pw = await hashPassword(password);
      await updateJSON(store, 'u/' + user.uid, raw => raw ? { value: Object.assign(raw, { pw }) } : { write: false }).catch(() => {});
    }
    const token = await createSession(store, user.uid, req);
    const u2 = await getUser(store, user.uid);
    return json({ ok: true, user: await publicUser(u2) }, 200, { 'set-cookie': sessionCookie(token) });
  }

  // ---------- v4.43: belépés jelkulccsal (passkey, WebAuthn) ----------
  // A jelkulcs a telefonon / gépen él (ujjlenyomat, arc vagy a képernyőzár kódja védi); a szerver csak a
  // nyilvános felét ismeri. Egy jelkulcsos belépés a kétfaktoros kódot is kiváltja (eszköz + biometria).
  const rpID = url.hostname, origin = url.origin;
  if (action === 'pk-login-begin') {
    if (await overLimit(store, 'pklb|' + ip, 30, 600_000)) return err('Túl sok próbálkozás, próbáld újra később.', 429);
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred', timeout: 120_000 });
    await store.setJSON('pc/' + sha(options.challenge), { exp: Date.now() + PK_CHALLENGE_MS });
    return json({ ok: true, options });
  }
  if (action === 'pk-login-finish') {
    if (await overLimit(store, 'pklf|' + ip, 30, 600_000)) return err('Túl sok próbálkozás, próbáld újra később.', 429);
    const resp = asObj(body.response);
    const credId = String(resp.id || '');
    if (!/^[A-Za-z0-9_-]{16,1400}$/.test(credId)) return err('Hibás jelkulcs.', 400);
    let challenge = '';
    try { challenge = String(JSON.parse(Buffer.from(String(asObj(resp.response).clientDataJSON || ''), 'base64url').toString()).challenge || ''); } catch (e) {}
    const ck = 'pc/' + sha(challenge);
    const ch = challenge ? await store.get(ck, { type: 'json' }).catch(() => null) : null;
    await store.delete(ck).catch(() => {});          // egy kihívás csak egyszer használható
    if (!ch || Number(ch.exp) < Date.now()) return err('A belépés lejárt, próbáld újra.', 400);
    const idx = await store.get(pkBlob(credId), { type: 'json' }).catch(() => null);
    const owner = idx && idx.uid ? await getUser(store, idx.uid) : null;
    const cred = owner && (owner.pk || []).find(k => k.id === credId);
    if (!cred) return err('Ezt a jelkulcsot nem ismerjük — lehet, hogy törölted a fiókodból. Lépj be jelszóval.', 401);
    let v;
    try {
      v = await verifyAuthenticationResponse({ response: resp, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
        credential: { id: cred.id, publicKey: Buffer.from(cred.pub, 'base64url'), counter: Number(cred.counter) || 0, transports: cred.transports } });
    } catch (e) { return err('A jelkulcsot nem sikerült ellenőrizni.', 401); }
    if (!v.verified) return err('A jelkulcsot nem sikerült ellenőrizni.', 401);
    await updateJSON(store, 'u/' + owner.uid, raw => {
      if (!raw) return { write: false };
      raw.pk = (raw.pk || []).map(k => k.id === credId ? Object.assign(k, { counter: v.authenticationInfo.newCounter, used: Date.now() }) : k);
      return { value: raw };
    });
    if (await store.get('banned/' + owner.uid).catch(() => null)) return err('Ez a fiók végleg ki van tiltva a játékból.', 403);
    await lockClear(store, owner.eh);
    const token = await createSession(store, owner.uid, req);
    return json({ ok: true, user: await publicUser(await getUser(store, owner.uid)) }, 200, { 'set-cookie': sessionCookie(token) });
  }

  // ---------- elfelejtett jelszó ----------
  if (action === 'forgot') {
    if (await overLimit(store, 'forgot|' + ip, 6, 3600_000)) return err('Túl sok próbálkozás, próbáld újra később.', 429);
    const email = cleanEmail(body.email);
    if (!email) return err('Ez nem tűnik érvényes e-mail címnek.', 400, { field: 'email' });
    const eh = sha('em|' + email);
    const done = json({ ok: true });   // a válaszból nem derül ki, van-e ilyen fiók
    const idx = await store.get('e/' + eh, { type: 'json' }).catch(() => null);
    if (!idx || !idx.uid) return done;
    if (await overLimit(store, 'forgotmail|' + eh, 3, 3600_000) || !(await mailAllowed(store))) return done;
    { const owner = await getUser(store, idx.uid); if (palOf(owner)) reqPal = palOf(owner); }
    const token = newToken(32), rh = sha(token);
    const old = await updateJSON(store, 'u/' + idx.uid, raw => {
      if (!raw) return { write: false, result: null };
      const prev = raw.reset || ''; raw.reset = rh;
      return { value: raw, result: prev };
    }).catch(() => null);
    if (old) await store.delete('r/' + old).catch(() => {});
    await store.setJSON('r/' + rh, { uid: idx.uid, exp: Date.now() + RESET_MS });
    await sendMail(email, 'Új jelszó beállítása — PIC-ASS-O', mailWrap(`<p>Új jelszót kértél a PIC-ASS-O fiókodhoz.</p>${btn(`${site}/?reset=${token}`, '🔑 Új jelszó beállítása')}
<p style="font-size:13px;color:#BFD3C4">A link 1 óráig érvényes, és csak egyszer használható. Ha nem te kérted, hagyd figyelmen kívül — a jelszavad nem változik.</p>`)).catch(e => console.error(e));
    return done;
  }
  if (action === 'reset') {
    if (await overLimit(store, 'reset|' + ip, 10, 3600_000)) return err('Túl sok próbálkozás, próbáld újra később.', 429);
    const token = String(body.token || '');
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return err('Ez a link nem érvényes.', 400);
    const rh = sha(token);
    const r = await store.get('r/' + rh, { type: 'json' }).catch(() => null);
    const user = r && Number(r.exp) > Date.now() ? await getUser(store, r.uid) : null;
    if (!user || user.reset !== rh) return err('Ez a link lejárt vagy már felhasználták. Kérj újat a belépésnél.', 400);
    const pwErr = passwordProblem(body.password, { name: user.name, email: user.email });
    if (pwErr) return err(pwErr, 400, { field: 'password' });
    const pw = await hashPassword(body.password);
    await store.delete('r/' + rh).catch(() => {});
    await updateJSON(store, 'u/' + user.uid, raw => raw ? { value: Object.assign(raw, { pw, reset: '' }) } : { write: false });
    if (palOf(user)) reqPal = palOf(user);
    await revokeSessions(store, user.uid);          // minden eszközről kiléptetjük
    await lockClear(store, user.eh);
    if (await mailAllowed(store)) await sendMail(user.email, 'Megváltozott a jelszavad — PIC-ASS-O', mailWrap(`<p>A PIC-ASS-O fiókod jelszava most megváltozott, és minden eszközről kiléptettünk.</p><p>Ha nem te voltál, azonnal kérj új jelszót a belépésnél, és nézd meg az e-mail fiókod biztonságát.</p>`)).catch(e => console.error(e));
    return json({ ok: true });
  }

  // ---------- innen minden bejelentkezést kér ----------
  const s = await sessionUser(req, store);
  if (action === 'logout') {
    if (s) {
      await store.delete('s/' + s.sh).catch(() => {});
      await updateJSON(store, 'u/' + s.user.uid, raw => raw ? { value: Object.assign(raw, { sess: (raw.sess || []).filter(x => x !== s.sh) }) } : { write: false }).catch(() => {});
    }
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
  }
  if (!s) return err('Ehhez be kell lépned.', 401, { login: true });
  const user = s.user;
  if (palOf(user)) reqPal = palOf(user);
  const uk = 'u/' + user.uid;
  /** érzékeny műveletekhez újra kell a jelszó (és a hibás próbálkozás ugyanúgy számít, mint belépésnél) */
  const confirmPassword = async () => {
    const lock = await lockState(store, user.eh);
    if (lock.until > Date.now()) return 'Túl sok hibás próbálkozás, próbáld újra később.';
    if (await verifyPassword(String(body.password || ''), user.pw)) return '';
    await lockFail(store, user.eh);
    return 'Hibás jelszó.';
  };

  if (action === 'logout-all') {
    await revokeSessions(store, user.uid, s.sh);
    return json({ ok: true });
  }

  // névigazoló jegy az aktuális játék-kapcsolathoz
  if (action === 'ticket') {
    if (softLimit('t|' + user.uid, 120, 600_000)) return err('Lassabban!', 429);
    const pid = String(body.pid || '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(pid)) return err('bad pid');
    const th = /^[0-9a-f]{64}$/.test(String(body.th || '')) ? String(body.th) : '';
    return json(Object.assign({ ok: true, name: user.name }, await makeTicket(user, pid, th, store)));
  }

  // statisztika: verziózott, hogy két eszköz ne írja felül egymást
  if (action === 'stats-get') {
    const st = asObj(await store.get('st/' + user.uid, { type: 'json' }).catch(() => null));
    return json({ ok: true, stats: isPlainObject(st.stats) ? st.stats : null, rev: Number(st.rev) || 0 });
  }
  if (action === 'stats-put') {
    if (softLimit('sp|' + user.uid, 120, 600_000)) return err('Lassabban!', 429);
    const stats = cleanStats(body.stats);
    if (!stats) return err('hibás statisztika');
    const rev = Number(body.rev) || 0;
    const out = await updateJSON(store, 'st/' + user.uid, raw => {
      const cur = asObj(raw), curRev = Number(cur.rev) || 0;
      if (curRev !== rev) return { write: false, result: { conflict: true, stats: isPlainObject(cur.stats) ? cur.stats : null, rev: curRev } };
      return { value: { stats, rev: curRev + 1, at: Date.now() }, result: { ok: true, rev: curRev + 1 } };
    });
    return json(out, out.conflict ? 409 : 200);
  }
  if (action === 'settings-put') {
    if (softLimit('se|' + user.uid, 60, 600_000)) return err('Lassabban!', 429);
    const settings = cleanSettings(body.settings);
    await updateJSON(store, uk, raw => raw ? { value: Object.assign(raw, { settings }) } : { write: false });
    if (settings['mail-colors'] !== (user.settings || {})['mail-colors']) await setSubPalette(user, cleanPalette(settings['mail-colors'])).catch(() => {});
    return json({ ok: true, settings });
  }

  // e-mail értesítő új szobákról (csak fiókkal)
  if (action === 'notify') {
    const r = await setAccountSub(user, body.on === true);
    if (r && r.error) return err('Megtelt az értesítési lista.', 503);
    return json({ ok: true, notifyEmail: !!(r && r.on) });
  }

  // ---------- kétfaktoros belépés ----------
  if (action === 'totp-begin') {
    const bad = await confirmPassword();
    if (bad) return err(bad, 401, { field: 'password' });
    if (user.totp && user.totp.on) return err('A kétfaktoros belépés már be van kapcsolva.', 409);
    const secret = newTotpSecret();
    await updateJSON(store, uk, raw => raw ? { value: Object.assign(raw, { totp: { secret, on: false, last: 0, at: Date.now() } }) } : { write: false });
    return json({ ok: true, secret, uri: totpUri(secret, user.email) });
  }
  if (action === 'totp-enable') {
    if (softLimit('te|' + user.uid, 10, 600_000)) return err('Túl sok próbálkozás, várj pár percet.', 429);
    if (!user.totp || !user.totp.secret || user.totp.on) return err('Előbb kezdd el a beállítást.', 409);
    const step = totpCheck(user.totp.secret, body.code, 0);
    if (!step) return err('Hibás kód. Ellenőrizd, hogy a telefonod órája pontos-e, és próbáld újra.', 401, { field: 'code' });
    const codes = newBackupCodes();
    await updateJSON(store, uk, raw => raw && raw.totp ? { value: Object.assign(raw, { totp: Object.assign(raw.totp, { on: true, last: step }), backup: codes.hashed }) } : { write: false });
    await revokeSessions(store, user.uid, s.sh);
    if (await mailAllowed(store)) await sendMail(user.email, 'Bekapcsoltad a kétfaktoros belépést — PIC-ASS-O', mailWrap(`<p>A PIC-ASS-O fiókodon mostantól belépéskor a jelszó mellé a hitelesítő alkalmazásod kódja is kell.</p><p>Ha nem te kapcsoltad be, azonnal kérj új jelszót a belépésnél.</p>`)).catch(e => console.error(e));
    return json({ ok: true, backup: codes.plain });
  }
  if (action === 'totp-disable') {
    const bad = await confirmPassword();
    if (bad) return err(bad, 401, { field: 'password' });
    if (!user.totp || !user.totp.on) return json({ ok: true });
    const code = String(body.code || '').trim();
    const step = totpCheck(user.totp.secret, code, Number(user.totp.last) || 0);
    const bh = backupHash(code);
    if (!step && !(Array.isArray(user.backup) && user.backup.some(h => safeEqual(h, bh)))) { await lockFail(store, user.eh); return err('Hibás ellenőrző kód.', 401, { field: 'code' }); }
    await updateJSON(store, uk, raw => { if (!raw) return { write: false }; delete raw.totp; delete raw.backup; return { value: raw }; });
    if (await mailAllowed(store)) await sendMail(user.email, 'Kikapcsoltad a kétfaktoros belépést — PIC-ASS-O', mailWrap(`<p>A PIC-ASS-O fiókodon kikapcsolták a kétfaktoros belépést.</p><p>Ha nem te voltál, azonnal kérj új jelszót a belépésnél.</p>`)).catch(e => console.error(e));
    return json({ ok: true });
  }

  // ---------- v4.43: jelkulcs hozzáadása / törlése ----------
  if (action === 'pk-reg-begin') {
    if (softLimit('pkr|' + user.uid, 20, 600_000)) return err('Lassabban!', 429);
    if ((user.pk || []).length >= MAX_PASSKEYS) return err(`Legfeljebb ${MAX_PASSKEYS} jelkulcsod lehet. Törölj egyet a régiek közül.`, 409);
    const options = await generateRegistrationOptions({
      rpName: 'PIC-ASS-O', rpID, userName: user.email, userDisplayName: user.name,
      userID: new TextEncoder().encode(user.uid), attestationType: 'none', timeout: 120_000,
      excludeCredentials: (user.pk || []).map(k => ({ id: k.id, transports: k.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }
    });
    await updateJSON(store, uk, raw => raw ? { value: Object.assign(raw, { pkChal: { c: options.challenge, exp: Date.now() + PK_CHALLENGE_MS } }) } : { write: false });
    return json({ ok: true, options });
  }
  if (action === 'pk-reg-finish') {
    const chal = asObj(user.pkChal);
    if (!chal.c || Number(chal.exp) < Date.now()) return err('A hozzáadás lejárt, kezdd újra.', 400);
    await updateJSON(store, uk, raw => { if (!raw) return { write: false }; delete raw.pkChal; return { value: raw }; });
    let v;
    try { v = await verifyRegistrationResponse({ response: asObj(body.response), expectedChallenge: chal.c, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false }); }
    catch (e) { return err('A jelkulcsot nem sikerült ellenőrizni.', 400); }
    if (!v.verified || !v.registrationInfo) return err('A jelkulcsot nem sikerült ellenőrizni.', 400);
    const c = v.registrationInfo.credential;
    const rec = { id: c.id, pub: Buffer.from(c.publicKey).toString('base64url'), counter: c.counter || 0,
      transports: Array.isArray(c.transports) ? c.transports.slice(0, 6) : undefined, at: Date.now(), name: deviceLabel(req) };
    const w = await store.setJSON(pkBlob(c.id), { uid: user.uid }, { onlyIfNew: true }).catch(() => null);
    if (!w || w.modified === false) return err('Ez a jelkulcs már egy fiókhoz tartozik.', 409);
    await updateJSON(store, uk, raw => raw ? { value: Object.assign(raw, { pk: (raw.pk || []).concat(rec).slice(-MAX_PASSKEYS) }) } : { write: false });
    if (await mailAllowed(store)) await sendMail(user.email, 'Új jelkulcs a fiókodon — PIC-ASS-O', mailWrap(`<p>A PIC-ASS-O fiókodhoz most egy új jelkulcsot adtak hozzá (${esc(rec.name)}). Ezzel jelszó nélkül be lehet lépni.</p><p>Ha nem te voltál, azonnal lépj be, töröld a jelkulcsot a fiókodban, és változtass jelszót.</p>`)).catch(e => console.error(e));
    return json({ ok: true, user: await publicUser(await getUser(store, user.uid)) });
  }
  if (action === 'pk-delete') {
    const id = String(body.id || '');
    if (!(user.pk || []).some(k => k.id === id)) return err('Nincs ilyen jelkulcs.', 404);
    await updateJSON(store, uk, raw => raw ? { value: Object.assign(raw, { pk: (raw.pk || []).filter(k => k.id !== id) }) } : { write: false });
    await store.delete(pkBlob(id)).catch(() => {});
    return json({ ok: true, user: await publicUser(await getUser(store, user.uid)) });
  }

  // ---------- jelszócsere ----------
  if (action === 'password') {
    const bad = await confirmPassword();
    if (bad) return err(bad, 401, { field: 'password' });
    const pwErr = passwordProblem(body.newPassword, { name: user.name, email: user.email });
    if (pwErr) return err(pwErr, 400, { field: 'newPassword' });
    const pw = await hashPassword(body.newPassword);
    await updateJSON(store, uk, raw => raw ? { value: Object.assign(raw, { pw }) } : { write: false });
    await revokeSessions(store, user.uid, s.sh);    // a többi eszközről kiléptetjük
    if (await mailAllowed(store)) await sendMail(user.email, 'Megváltozott a jelszavad — PIC-ASS-O', mailWrap(`<p>A PIC-ASS-O fiókod jelszava most megváltozott, a többi eszközödről kiléptettünk.</p><p>Ha nem te voltál, azonnal kérj új jelszót a belépésnél.</p>`)).catch(e => console.error(e));
    return json({ ok: true });
  }

  // ---------- fiók törlése (minden adattal együtt) ----------
  if (action === 'delete') {
    const bad = await confirmPassword();
    if (bad) return err(bad, 401, { field: 'password' });
    const all = Array.isArray(user.sess) ? user.sess : [];
    await Promise.all(all.map(x => store.delete('s/' + x).catch(() => {})));
    await removeSubsOf(user.uid);
    await removePushOf(user.uid).catch(() => {});
    if (user.reset) await store.delete('r/' + user.reset).catch(() => {});
    await store.delete('st/' + user.uid).catch(() => {});
    await Promise.all((user.pk || []).map(k => store.delete(pkBlob(k.id)).catch(() => {})));
    await store.delete(uk).catch(() => {});
    await store.delete('e/' + user.eh).catch(() => {});
    await store.delete(nameBlob(user.key)).catch(() => {});
    await lockClear(store, user.eh);
    // a közös ranglistáról is lekerül (a játékszerver az aláírt kérést ellenőrzi)
    try {
      const proof = await signPayload({ del: user.uid, e: Date.now() + 10 * 60_000 }, store);
      await fetch(GAME_SERVER_URL + '/api/forget', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ proof }), signal: AbortSignal.timeout(5000) });
    } catch (e) { console.warn('a ranglista-törlés nem ért el a játékszerverhez'); }
    if (await mailAllowed(store)) await sendMail(user.email, 'Töröltük a fiókodat — PIC-ASS-O', mailWrap(`<p>A PIC-ASS-O fiókodat (<b>${esc(user.name)}</b>) és a hozzá tartozó adatokat töröltük. A név újra szabadon választható.</p><p>Köszönjük, hogy velünk játszottál!</p>`)).catch(e => console.error(e));
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
  }

  return err('unknown action', 400);
};
