// PIC-ASS-O — fiókok (v4.40; v4.45: JELSZÓ NÉLKÜL)
// Regisztráció e-mail megerősítéssel, belépés jelkulccsal (passkey) vagy e-mailben
// küldött, egyszer használható belépőlinkkel. Jelszót a rendszer sehol nem kér és
// nem tárol (a v4.45 előtti jelszó-lenyomatokat és 2FA-kulcsokat az első induláskor töröljük).
//
//   GET                    -> { user | null }   (a bejelentkezett fiók adatai)
//   GET  ?name=NÉV         -> { taken }         (regisztrált-e ez a név)
//   GET  ?pubkey=1         -> { key }           (a névigazoló jegyek nyilvános kulcsa)
//   GET  ?confirm=KULCS / ?login=KULCS  -> HTML oldal egy gombbal (a levélszűrők előre megnyitják a linkeket,
//   POST ?confirm=KULCS / ?login=KULCS  -> ezért csak a gomb hoz létre fiókot / léptet be)
//   POST { action, ... }   -> register | magic | pk-login-begin | pk-login-finish | logout | logout-all | ticket |
//                             stats-get | stats-put | settings-put | notify | pk-reg-begin | pk-reg-finish | pk-delete | delete
//
// Környezeti változók: a levélküldéshez ugyanaz kell, mint az értesítőhöz (GMAIL_USER, GMAIL_APP_PASSWORD).
import { json, updateJSON, makeLimiter } from '../lib/util.mjs';
import { esc, cleanEmail, page as basePage, sendMail as baseSendMail, mailWrap, btn, cleanPalette, isPersonalEmail, PERSONAL_EMAIL_TEXT } from '../lib/mail.mjs';
import {
  accountStore, sha, newToken, asObj, publicKey, makeTicket, signPayload, overLimit,
  sessionCookie, clearCookie, getUser, createSession, sessionUser,
  revokeSessions, sameOrigin, ipOf, SESSION_RENEW_MS, SESSION_MS
} from '../lib/account.mjs';
import { setAccountSub, accountSubOn, claimLegacySub, removeSubsOf, setSubPalette } from '../lib/subs.mjs';
import { removePushOf } from '../lib/push.mjs';
import { cleanName, nameKey, isPlainObject, badNameReason, BAD_NAME_TEXT } from '../../js/rules.js';
import { achievementsOf } from '../../js/profile.js';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';

const PENDING_MS = 24 * 3600_000;
const MAX_STATS_BYTES = 60_000;
const MAIL_DAY_CAP = Math.max(1, Number(process.env.ACCOUNT_MAIL_DAILY_CAP) || 200);
const RESERVED = new Set(['valaki', 'vendeg', 'admin', 'adminisztrator', 'moderator', 'picasso', 'pic-ass-o', 'pic ass o', 'rendszer', 'szerver', 'huncraft', 'teged', 'te', 'en']);
const SETTING_KEYS = ['mail-colors', 'avatar-color','dark-mode','theme','master-sound','sfx-vol','sfx-muted','music-vol','music-muted','replay-speed','create-prefs','chat-size','chat-pos','chat-fs','chat-dock','fab-pos','whatis-noimg','tutorial-seen','setup-advanced-open','sub-open','notify-skip-own','phone-hint','announce-dismissed'];
const GAME_SERVER_URL = String(process.env.GAME_SERVER_URL || 'https://picasso.taile8c93.ts.net').replace(/\/+$/, '');
const softLimit = makeLimiter();
/** v4.43: a fiók tulajdonosának színvilága (a játékban látott színek, a beállításokkal szinkronizálva) */
const palOf = u => cleanPalette(u && u.settings && u.settings['mail-colors']) || cleanPalette(u && u.regPal);

const nameBlob = key => 'n/' + Buffer.from(key).toString('hex');
const err = (msg, status = 400, extra = {}) => json(Object.assign({ error: msg }, extra), status);

/** A regisztrálható név: pontosan úgy, ahogy a játék megjelenítené. */
function validName(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (s.length < 3 || s.length > 16 || cleanName(s) !== s) return { error: 'A név 3–16 karakter hosszú legyen.' };
  if (/[\u0000-\u001f\u007f<>"'`\\]/.test(s) || /[​-‏‪-‮⁠-⁯﻿]/.test(s)) return { error: 'A névben nem megengedett karakter van.' };
  const key = nameKey(s);
  if (key.replace(/[^a-z0-9]/g, '').length < 2) return { error: 'A névben legyen legalább két betű vagy szám.' };
  if (RESERVED.has(key) || /^vendeg\b/.test(key)) return { error: 'Ez a név nem választható.' };
  { const why = badNameReason(s); if (why) return { error: BAD_NAME_TEXT[why] }; }   // v4.51: megtévesztő / vulgáris név
  return { name: s, key };
}
async function nameTaken(store, key) {
  const n = await store.get(nameBlob(key), { type: 'json' }).catch(() => null);
  return !!(n && (n.uid || Number(n.until) > Date.now()));
}
const publicUser = async (u) => ({
  name: u.name, email: u.email,
  createdAt: u.createdAt, notifyEmail: await accountSubOn(u).catch(() => false), settings: asObj(u.settings),
  passkeys: (Array.isArray(u.pk) ? u.pk : []).map(k => ({ id: k.id, name: k.name, at: k.at, used: k.used || 0 })),
  // v4.49
  renamedAt: u.renamedAt || 0, roomCode: u.roomCode || '', profilePublic: u.profilePublic !== false, followMail: u.followMail !== false,
  friends: Array.isArray(u.friends) ? u.friends : [], wordlists: Array.isArray(u.wordlists) ? u.wordlists : []
});
// ---- v4.49 ----
const RENAME_EVERY_MS = 30 * 86400_000;      // 30 naponta egyszer
const OLD_NAME_HOLD_MS = 30 * 86400_000;     // a régi név 30 napig foglalt marad
const EMAILCHG_MS = 24 * 3600_000;
const MAX_FRIENDS = 200, MAX_LISTS = 10, MAX_LIST_WORDS = 300, MAX_GALLERY = 50, MAX_IMG = 220_000;
const ROOM_CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;    // ugyanaz az ábécé, mint a játék véletlen kódjainál
function uaLabel(ua) {
  ua = String(ua || '');
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'eszköz';
  const br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return (os + (br ? ' · ' + br : '')).slice(0, 40);
}
function cleanWordlists(v) {
  if (!Array.isArray(v)) return null;
  return v.slice(0, MAX_LISTS).map((l, i) => {
    const name = String((l && l.name) || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30) || `Lista ${i + 1}`;
    const seen = new Set();
    const words = (Array.isArray(l && l.words) ? l.words : []).map(w => String(w || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40))
      .filter(w => w && !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase())).slice(0, MAX_LIST_WORDS);
    return { name, words };
  });
}
/** A nyilvános profil statisztikája (csak összesítők, semmi személyes). */
function profileStats(st) {
  const s = asObj(st), N = x => Number(x) || 0;
  return { games: N(s.games), wins: N(s.wins), podium: N(s.podium), points: N(s.points), best: N(s.best), drawn: N(s.drawn), drawnHit: N(s.drawnHit),
    guessHit: N(s.guessHit), guessRounds: N(s.guessRounds), firstHits: N(s.firstHits), bestStreak: N(s.bestStreak), playMs: N(s.playMs),
    badges: Object.fromEntries(Object.entries(asObj(s.badges)).filter(([k]) => /^[a-z]{2,12}$/.test(k)).map(([k, v]) => [k, N(v)])) };
}
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

// ---- v4.51: trófea-ranglista és a statisztika hihetőségének ellenőrzése ----
// A statisztikát a böngésző számolja, ezért teljes biztonságot nem ad — de a nyilvánvaló csalást kiszűrjük:
// az összefüggéseknek stimmelniük kell, és egy mentés csak keveset léphet előre.
const Nn = v => Number(v) || 0;
function implausible(st) {
  if (Nn(st.wins) > Nn(st.games)) return 'több győzelem, mint játék';
  if (Nn(st.podium) > Nn(st.games)) return 'több dobogó, mint játék';
  if (Nn(st.drawnHit) > Nn(st.drawn)) return 'több kitalált rajz, mint rajz';
  if (Nn(st.guessHit) > Nn(st.guessRounds)) return 'több jó tipp, mint tippkör';
  if (Nn(st.firstHits) > Nn(st.guessHit)) return 'több első tipp, mint jó tipp';
  if (Nn(st.best) > 5000 || Nn(st.points) > Nn(st.games) * 5000 + 5000) return 'túl sok pont';
  if (Nn(st.bestStreak) > Nn(st.guessHit) + 1) return 'túl hosszú sorozat';
  if (Nn(st.playMs) > (Nn(st.games) + 2) * 4 * 3600000) return 'túl sok játékidő';
  return '';
}
const JUMP = { games: 3, wins: 3, podium: 3, drawn: 40, drawnHit: 40, guessRounds: 120, guessHit: 120, firstHits: 120, points: 12000, playMs: 3 * 3600000 };
function jumpTooBig(a, b) {
  for (const [k, max] of Object.entries(JUMP)) if (Nn(b[k]) - Nn(a[k]) > max) return k;
  for (const k of Object.keys(asObj(b.badges))) if (Nn(b.badges[k]) - Nn(asObj(a.badges)[k]) > 3) return 'badges';
  return '';
}
async function updateTrophyBoard(store, user, stats) {
  const A = achievementsOf(stats);
  await updateJSON(store, 'achtop', raw => {
    const d = asObj(raw);
    let rows = (Array.isArray(d.rows) ? d.rows : []).filter(r => r.uid !== user.uid);
    if (user.profilePublic !== false && A.points > 0) rows.push({ uid: user.uid, name: user.name, count: A.count, points: A.points, at: Date.now() });
    rows = rows.sort((x, y) => y.points - x.points || y.count - x.count || x.at - y.at).slice(0, 500);
    return { value: { rows } };
  });
}

const MAGIC_MS = 15 * 60_000;     // a belépőlink 15 percig él, egyszer használható
let migrated = false;
/** v4.45: a régi jelszó-lenyomatok, 2FA-kulcsok és jelszó-visszaállító kulcsok végleges törlése (egyszer). */
async function dropPasswords(store) {
  if (migrated) return;
  if (await store.get('mig/nopw').catch(() => null)) { migrated = true; return; }
  try {
    const { blobs } = await store.list({ prefix: 'u/' });
    for (const b of blobs || []) {
      await updateJSON(store, b.key, raw => {
        if (!raw || !('pw' in raw || 'totp' in raw || 'backup' in raw || 'reset' in raw)) return { write: false };
        delete raw.pw; delete raw.totp; delete raw.backup; delete raw.reset;
        return { value: raw };
      }).catch(() => {});
    }
    for (const pre of ['r/', 'p/', 'lock/']) {
      const { blobs: bl } = await store.list({ prefix: pre }).catch(() => ({ blobs: [] }));
      for (const b of bl || []) {
        if (pre === 'p/') {   // függő regisztrációk: csak a bennük lévő jelszó-lenyomat megy
          await updateJSON(store, b.key, raw => raw && raw.pw ? (delete raw.pw, { value: raw }) : { write: false }).catch(() => {});
        } else await store.delete(b.key).catch(() => {});
      }
    }
    await store.setJSON('mig/nopw', { at: Date.now() });
    migrated = true;
  } catch (e) { console.error('jelszó-törlés: ', e && e.message); }
}

export default async (req) => {
  const url = new URL(req.url);
  const self = url.origin + url.pathname;
  const site = url.origin;
  const store = accountStore();
  await dropPasswords(store);
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
    const user = { uid, name: p.name, key: p.key, email: p.email, eh: p.eh, createdAt: Date.now(), sess: [], settings: {}, regPal: reqPal || undefined,
      consent: 'v4.40: elmúlt 16 éves, és elfogadta az adatkezelési tájékoztatót (' + new Date(p.at).toISOString() + ')' };
    await store.setJSON('u/' + uid, user);
    await store.setJSON(nameBlob(p.key), { uid });
    await store.delete(pk).catch(() => {});
    await claimLegacySub(user);
    // a megerősítés egyben belépés is (ezen az eszközön), utána a játék felajánlja a jelkulcsot
    const tok = await createSession(store, uid, req);
    return page('Kész a fiókod! 🎉', `<p>Szia, <b>${esc(user.name)}</b>! Az e-mail címed megerősítve, és be is léptél. Mostantól ez a név csak a tiéd.</p><p>A játékban adj hozzá egy <b>jelkulcsot</b> — utána ujjlenyomattal vagy arccal lépsz be, jelszó nélkül.</p><a class="b" href="${esc(site)}/?fiok=1&uj=1">Irány a játék</a>`, 200, { 'set-cookie': sessionCookie(tok) });
  }

  // ---------- v4.45: belépés e-mailes belépőlinkkel ----------
  const loginT = url.searchParams.get('login');
  if (loginT) {
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(loginT)) return page('A link hibás', '<p>Ez a belépőlink nem érvényes.</p>', 404);
    const mk = 'm/' + sha(loginT);
    const m = await store.get(mk, { type: 'json' }).catch(() => null);
    const owner = m && Number(m.exp) > Date.now() ? await getUser(store, m.uid) : null;
    reqPal = palOf(owner);
    if (!owner) return page('A link lejárt', `<p>Ez a belépőlink már nem érvényes (15 percig él, és csak egyszer használható). Kérj újat a játékban.</p><a class="b" href="${esc(site)}/?fiok=1">Irány a játék</a>`, 404);
    if (req.method !== 'POST') {
      return page('Belépés', `<p>Szia, <b>${esc(owner.name)}</b>! Egy kattintás, és ezen az eszközön beléptél a PIC-ASS-O-ba.</p>
<form method="post" action="${esc(self)}?login=${encodeURIComponent(loginT)}"><button>✅ Belépek</button></form>
<p style="font-size:.85rem">Ha nem te kérted, zárd be ezt az oldalt — senki nem lép be a fiókodba.</p>`);
    }
    await store.delete(mk).catch(() => {});      // egyszer használható
    if (await store.get('banned/' + owner.uid).catch(() => null)) return page('Kitiltva', '<p>Ez a fiók végleg ki van tiltva a játékból.</p>', 403);
    const tok = await createSession(store, owner.uid, req);
    const hasPk = (owner.pk || []).length > 0;
    return page('Beléptél! 🎉', `<p>Szia, <b>${esc(owner.name)}</b>! Ezen az eszközön beléptél.</p>${hasPk ? '' : '<p>Tipp: a játékban adj hozzá egy <b>jelkulcsot</b>, és legközelebb ujjlenyomattal vagy arccal lépsz be.</p>'}<a class="b" href="${esc(site)}/?fiok=1${hasPk ? '' : '&uj=1'}">Irány a játék</a>`, 200, { 'set-cookie': sessionCookie(tok) });
  }

  // ---------- v4.51: trófea-ranglista ----------
  if (req.method === 'GET' && url.searchParams.has('achtop')) {
    if (softLimit('at|' + ip, 120, 600_000)) return err('Lassabban!', 429);
    const d = asObj(await store.get('achtop', { type: 'json' }).catch(() => null));
    const rows = Array.isArray(d.rows) ? d.rows : [];
    const viewer = await sessionUser(req, store).catch(() => null);
    const i = viewer ? rows.findIndex(r => r.uid === viewer.user.uid) : -1;
    return json({ rows: rows.slice(0, 50).map(r => ({ name: r.name, count: r.count, points: r.points })), mine: i >= 0 ? { rank: i + 1, count: rows[i].count, points: rows[i].points } : null });
  }

  // ---------- v4.49: nyilvános profil ----------
  if (req.method === 'GET' && url.searchParams.has('profile')) {
    if (softLimit('pr|' + ip, 200, 600_000)) return err('Lassabban!', 429);
    const key = nameKey(String(url.searchParams.get('profile') || '').slice(0, 40));
    const nb = key ? await store.get(nameBlob(key), { type: 'json' }).catch(() => null) : null;
    const u = nb && nb.uid ? await getUser(store, nb.uid) : null;
    if (!u) return json({ found: false });
    const viewer = await sessionUser(req, store).catch(() => null);
    const mine = !!viewer && viewer.user.uid === u.uid;
    const following = !!viewer && (viewer.user.friends || []).some(f => f.uid === u.uid);
    const fw = asObj(await store.get('fw/' + u.uid, { type: 'json' }).catch(() => null));
    const base = { found: true, pid: u.uid, name: u.name, createdAt: u.createdAt, avatar: String(asObj(u.settings)['avatar-color'] || '').slice(0, 20),
      followers: (fw.uids || []).length, following, mine, roomCode: u.roomCode || '' };
    if (u.profilePublic === false && !mine) return json(Object.assign(base, { private: true }));
    const st = asObj(await store.get('st/' + u.uid, { type: 'json' }).catch(() => null));
    const g = asObj(await store.get('g/' + u.uid, { type: 'json' }).catch(() => null));
    return json(Object.assign(base, { stats: profileStats(st.stats), gallery: (g.items || []).slice(-24).reverse().map(x => ({ id: x.id, at: x.at, word: x.word })) }));
  }
  if (req.method === 'GET' && url.searchParams.has('img')) {
    const [uid, id] = String(url.searchParams.get('img') || '').split('.');
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(uid || '') || !/^[A-Za-z0-9_-]{6,30}$/.test(id || '')) return new Response('', { status: 404 });
    const u = await getUser(store, uid);
    const viewer = u && u.profilePublic === false ? await sessionUser(req, store).catch(() => null) : null;
    if (!u || (u.profilePublic === false && !(viewer && viewer.user.uid === uid))) return new Response('', { status: 404 });
    const d = await store.get('gi/' + uid + '/' + id).catch(() => null);
    const m = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(d || ''));
    if (!m) return new Response('', { status: 404 });
    return new Response(Buffer.from(m[2], 'base64'), { headers: { 'content-type': m[1], 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' } });
  }
  // ---------- v4.49: e-mail cím cseréje (megerősítés az ÚJ címről) ----------
  const ecT = url.searchParams.get('emailchg');
  if (ecT) {
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(ecT)) return page('A link hibás', '<p>Ez a link nem érvényes.</p>', 404);
    const ek = 'ec/' + sha(ecT);
    const ec = await store.get(ek, { type: 'json' }).catch(() => null);
    const owner = ec && Number(ec.exp) > Date.now() ? await getUser(store, ec.uid) : null;
    reqPal = palOf(owner);
    if (!owner) return page('A link lejárt', `<p>Ez a link már nem érvényes (24 óráig él, egyszer használható). Kérd újra a játékban.</p><a class="b" href="${esc(site)}/?fiok=1">Irány a játék</a>`, 404);
    if (req.method !== 'POST') {
      return page('Új e-mail cím', `<p>Szia, <b>${esc(owner.name)}</b>! Megerősíted, hogy a PIC-ASS-O fiókod e-mail címe mostantól <b>${esc(ec.email)}</b> legyen?</p>
<form method="post" action="${esc(self)}?emailchg=${encodeURIComponent(ecT)}"><button>✅ Igen, ez az új címem</button></form>`);
    }
    await store.delete(ek).catch(() => {});
    const neh = sha('em|' + ec.email);
    const w = await store.setJSON('e/' + neh, { uid: owner.uid }, { onlyIfNew: true }).catch(() => null);
    if (!w || w.modified === false) return page('A cím foglalt', '<p>Ehhez az e-mail címhez közben már tartozik egy másik fiók.</p>', 409);
    const oldEmail = owner.email, oldEh = owner.eh;
    const wasSub = await accountSubOn(owner).catch(() => false);
    await updateJSON(store, 'u/' + owner.uid, raw => raw ? { value: Object.assign(raw, { email: ec.email, eh: neh }) } : { write: false });
    await store.delete('e/' + oldEh).catch(() => {});
    await removeSubsOf(owner.uid).catch(() => {});
    if (wasSub) await setAccountSub(Object.assign({}, owner, { email: ec.email, eh: neh }), true).catch(() => {});
    if (await mailAllowed(store)) await baseSendMail(oldEmail, 'Megváltozott az e-mail címed — PIC-ASS-O', mailWrap(`<p>A PIC-ASS-O fiókod (<b>${esc(owner.name)}</b>) e-mail címét most megváltoztatták egy másik címre. Erre a címre többé nem küldünk levelet.</p><p>Ha nem te voltál, azonnal írj nekünk: picasso.ertesito@gmail.com</p>`), undefined, reqPal).catch(e => console.error(e));
    return page('Kész! ✅', `<p>A fiókod új e-mail címe: <b>${esc(ec.email)}</b>. Mostantól ide küldjük a belépőlinkeket.</p><a class="b" href="${esc(site)}/?fiok=1">Irány a játék</a>`);
  }

  // ---------- a bejelentkezett fiók ----------
  if (req.method === 'GET') {
    const s = await sessionUser(req, store);
    if (!s) return json({ user: null });
    const headers = {};
    if (Number(s.sess.exp) - Date.now() < SESSION_RENEW_MS || Date.now() - Number(s.sess.last || 0) > 3600_000) {   // meghosszabbítás + „utoljára”
      await store.setJSON('s/' + s.sh, Object.assign({}, s.sess, { exp: Date.now() + SESSION_MS, last: Date.now() })).catch(() => {});
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
    if (!isPersonalEmail(email)) return err(PERSONAL_EMAIL_TEXT, 400, { field: 'email' });   // v4.51
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
<p>Belépni a játékban tudsz: jelkulccsal, vagy kérj egy belépőlinket e-mailben. Ha nem te voltál, nincs teendőd.</p>${btn(site + '/?fiok=1', 'Belépés')}`)).catch(e => console.error(e));
      }
      return done;
    }
    if (await overLimit(store, 'regmail|' + eh, 3, 3600_000)) return done;
    if (!(await mailAllowed(store))) return err('Ma már túl sok levelet küldtünk ki, próbáld újra holnap.', 503);
    const token = newToken(32);
    // a név lefoglalása a megerősítésig (24 óra) — ütközésbiztosan
    const reserved = await updateJSON(store, nk, raw => {
      const cur = asObj(raw);
      if (cur.uid || (Number(cur.until) > Date.now() && cur.eh !== eh)) return { write: false, result: false };
      return { value: { eh, until: Date.now() + PENDING_MS }, result: true };
    }).catch(() => false);
    if (!reserved) return err('Ez a név már foglalt, válassz másikat.', 409, { field: 'name' });
    await store.setJSON('p/' + sha(token), { name: vn.name, key: vn.key, email, eh, at: Date.now(), pal: reqPal });
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

  // ---------- v4.45: belépőlink kérése e-mailben ----------
  if (action === 'magic') {
    if (await overLimit(store, 'magic|' + ip, 10, 3600_000)) return err('Túl sok próbálkozás, próbáld újra később.', 429);
    const email = cleanEmail(body.email);
    if (!email) return err('Ez nem tűnik érvényes e-mail címnek.', 400, { field: 'email' });
    const eh = sha('em|' + email);
    const done = json({ ok: true });   // a válaszból nem derül ki, van-e ilyen fiók
    const idx = await store.get('e/' + eh, { type: 'json' }).catch(() => null);
    if (!idx || !idx.uid) return done;
    if (await overLimit(store, 'magicmail|' + eh, 4, 3600_000) || !(await mailAllowed(store))) return done;
    const owner = await getUser(store, idx.uid);
    if (!owner) return done;
    const token = newToken(32);
    await store.setJSON('m/' + sha(token), { uid: owner.uid, exp: Date.now() + MAGIC_MS });
    reqPal = palOf(owner) || reqPal;
    await sendMail(email, 'Belépés a PIC-ASS-O-ba', mailWrap(`<p>Szia, <b>${esc(owner.name)}</b>! Belépőlinket kértél a PIC-ASS-O-hoz.</p>${btn(`${self}?login=${token}`, '🔓 Belépés')}
<p style="font-size:13px;color:#BFD3C4">A link 15 percig érvényes, és csak egyszer használható — azon az eszközön léptet be, ahol megnyitod. Ha nem te kérted, hagyd figyelmen kívül: senki nem lép be a fiókodba.</p>`)).catch(e => console.error(e));
    return done;
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
    if (!cred) return err('Ezt a jelkulcsot nem ismerjük — lehet, hogy törölted a fiókodból. Kérj belépőlinket e-mailben.', 401);
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
    const token = await createSession(store, owner.uid, req);
    return json({ ok: true, user: await publicUser(await getUser(store, owner.uid)) }, 200, { 'set-cookie': sessionCookie(token) });
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
    const bad = implausible(stats);
    if (bad) return err('A statisztika nem hihető (' + bad + ').', 400);
    // egy eszköz első szinkronja (az ott vendégként gyűjtött eredmények) nagyobbat ugorhat — fiókonként naponta legfeljebb 3-szor
    const firstOfDevice = body.first === true && !(await overLimit(store, 'firstsync|' + user.uid, 3, 86400_000));
    const out = await updateJSON(store, 'st/' + user.uid, raw => {
      const cur = asObj(raw), curRev = Number(cur.rev) || 0;
      if (curRev !== rev) return { write: false, result: { conflict: true, stats: isPlainObject(cur.stats) ? cur.stats : null, rev: curRev } };
      // v4.51: egy mentés legfeljebb ennyit léphet előre (az első szinkron — az eszközön addig gyűjtött adat — kivétel)
      const prev = asObj(cur.stats);
      if (cur.rev && Number(cur.firstAt) > 0 && !firstOfDevice) {
        const jump = jumpTooBig(prev, stats);
        if (jump) return { write: false, result: { error: 'A statisztika túl nagyot ugrott (' + jump + ').' } };
      }
      return { value: { stats, rev: curRev + 1, at: Date.now(), firstAt: Number(cur.firstAt) || Date.now() }, result: { ok: true, rev: curRev + 1 } };
    });
    if (out.error) return err(out.error, 400);
    if (out.ok) await updateTrophyBoard(store, user, stats).catch(() => {});
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

  // ---------- v4.43: jelkulcs hozzáadása / törlése ----------
  if (action === 'pk-reg-begin') {
    if (softLimit('pkr|' + user.uid, 20, 600_000)) return err('Lassabban!', 429);
    if ((user.pk || []).length >= MAX_PASSKEYS) return err(`Legfeljebb ${MAX_PASSKEYS} jelkulcsod lehet. Törölj egyet a régiek közül.`, 409);
    const options = await generateRegistrationOptions({
      rpName: 'PIC-ASS-O', rpID, userName: user.email, userDisplayName: user.name,
      userID: new TextEncoder().encode(user.uid), attestationType: 'none', timeout: 120_000,
      // v4.46: a már meglévő jelkulcsok kizárása — a gépi hozzáadásnál a telefonos (QR-kódos) kulcsot NEM soroljuk fel,
      // különben a böngésző a telefont is ellenőrizni akarja, és QR-kódot mutat
      excludeCredentials: (user.pk || []).filter(k => body.phone === true || !(k.transports || []).includes('hybrid')).map(k => ({ id: k.id, transports: k.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      // v4.45: gépen „telefonra” kérve a böngésző QR-kódot mutat, a jelkulcs a telefonon jön létre
      // „ezen az eszközön”: a gép saját tárolója (Windows Hello, Touch ID, Android / iPhone); „telefonra”: QR-kód
      preferredAuthenticatorType: body.phone === true ? 'remoteDevice' : 'localDevice'
    });
    await updateJSON(store, uk, raw => raw ? { value: Object.assign(raw, { pkChal: { c: options.challenge, exp: Date.now() + PK_CHALLENGE_MS, phone: body.phone === true } }) } : { write: false });
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
      transports: Array.isArray(c.transports) ? c.transports.slice(0, 6) : undefined, at: Date.now(),
      name: (chal.phone || (Array.isArray(c.transports) && c.transports.includes('hybrid'))) ? '📱 telefon (QR-kóddal)' : deviceLabel(req) };
    const w = await store.setJSON(pkBlob(c.id), { uid: user.uid }, { onlyIfNew: true }).catch(() => null);
    if (!w || w.modified === false) return err('Ez a jelkulcs már egy fiókhoz tartozik.', 409);
    await updateJSON(store, uk, raw => raw ? { value: Object.assign(raw, { pk: (raw.pk || []).concat(rec).slice(-MAX_PASSKEYS) }) } : { write: false });
    if (await mailAllowed(store)) await sendMail(user.email, 'Új jelkulcs a fiókodon — PIC-ASS-O', mailWrap(`<p>A PIC-ASS-O fiókodhoz most egy új jelkulcsot adtak hozzá (${esc(rec.name)}). Ezzel jelszó nélkül be lehet lépni.</p><p>Ha nem te voltál: lépj be (jelkulccsal vagy egy e-mailes belépőlinkkel), a fiókodban töröld ezt a jelkulcsot, és nyomd meg a „Kiléptetés a többi eszközről” gombot. Mivel a belépőlinkek erre a címre jönnek, érdemes az e-mail fiókod biztonságát is ellenőrizni.</p>`)).catch(e => console.error(e));
    return json({ ok: true, user: await publicUser(await getUser(store, user.uid)) });
  }
  if (action === 'pk-delete') {
    const id = String(body.id || '');
    if (!(user.pk || []).some(k => k.id === id)) return err('Nincs ilyen jelkulcs.', 404);
    await updateJSON(store, uk, raw => raw ? { value: Object.assign(raw, { pk: (raw.pk || []).filter(k => k.id !== id) }) } : { write: false });
    await store.delete(pkBlob(id)).catch(() => {});
    return json({ ok: true, user: await publicUser(await getUser(store, user.uid)) });
  }

  // ---------- v4.49: e-mail csere, névváltoztatás ----------
  if (action === 'email-begin') {
    if (await overLimit(store, 'ec|' + user.uid, 4, 3600_000)) return err('Túl sok próbálkozás, próbáld újra később.', 429);
    const email = cleanEmail(body.email);
    if (!email) return err('Ez nem tűnik érvényes e-mail címnek.', 400, { field: 'email' });
    if (email === user.email) return err('Ez a mostani címed.', 400, { field: 'email' });
    if (!isPersonalEmail(email)) return err(PERSONAL_EMAIL_TEXT, 400, { field: 'email' });   // v4.51
    if (!(await mailAllowed(store))) return err('Ma már túl sok levelet küldtünk ki, próbáld újra holnap.', 503);
    const done = json({ ok: true });      // foglalt címnél is ugyanez a válasz (nem derül ki, kinek van fiókja)
    if (await store.get('e/' + sha('em|' + email), { type: 'json' }).catch(() => null)) return done;
    const token = newToken(32);
    await store.setJSON('ec/' + sha(token), { uid: user.uid, email, exp: Date.now() + EMAILCHG_MS });
    await sendMail(email, 'Erősítsd meg az új e-mail címed — PIC-ASS-O', mailWrap(`<p>Szia, <b>${esc(user.name)}</b>! Ezt a címet adtad meg a PIC-ASS-O fiókod új e-mail címének.</p>${btn(`${self}?emailchg=${token}`, '✅ Megerősítem')}<p style="font-size:13px;color:#BFD3C4">A link 24 óráig érvényes. Ha nem te kérted, hagyd figyelmen kívül.</p>`)).catch(e => console.error(e));
    await sendMail(user.email, 'E-mail cím csere kérése — PIC-ASS-O', mailWrap(`<p>A PIC-ASS-O fiókodhoz (<b>${esc(user.name)}</b>) e-mail cím cserét kértek. Ha nem te voltál, a fiókodban léptess ki minden eszközt („Kiléptetés a többi eszközről”), és írj nekünk.</p>`)).catch(e => console.error(e));
    return done;
  }
  if (action === 'rename') {
    if (Date.now() - (Number(user.renamedAt) || 0) < RENAME_EVERY_MS) {
      const next = new Date((Number(user.renamedAt) || 0) + RENAME_EVERY_MS).toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
      return err(`Névet 30 naponta egyszer változtathatsz. Legközelebb: ${next}.`, 429);
    }
    const vn = validName(body.name);
    if (vn.error) return err(vn.error, 400, { field: 'name' });
    if (vn.key === user.key) {   // csak kis-nagybetű / ékezet változik: ugyanaz a foglalás
      await updateJSON(store, uk, raw => raw ? { value: Object.assign(raw, { name: vn.name }) } : { write: false });
      return json({ ok: true, user: await publicUser(await getUser(store, user.uid)) });
    }
    const nk = nameBlob(vn.key);
    const got = await updateJSON(store, nk, raw => {
      const cur = asObj(raw);
      if ((cur.uid && cur.uid !== user.uid) || (Number(cur.until) > Date.now() && cur.heldUid !== user.uid)) return { write: false, result: false };
      return { value: { uid: user.uid }, result: true };
    }).catch(() => false);
    if (!got) return err('Ez a név már foglalt, válassz másikat.', 409, { field: 'name' });
    await store.setJSON(nameBlob(user.key), { until: Date.now() + OLD_NAME_HOLD_MS, heldUid: user.uid });   // a régi név 30 napig a tiéd marad
    await updateJSON(store, uk, raw => raw ? { value: Object.assign(raw, { name: vn.name, key: vn.key, renamedAt: Date.now(), prevNames: [user.name].concat(raw.prevNames || []).slice(0, 10) }) } : { write: false });
    return json({ ok: true, user: await publicUser(await getUser(store, user.uid)) });
  }
  // ---------- v4.49: aktív eszközök ----------
  if (action === 'sessions') {
    const list = [];
    for (const sh of user.sess || []) {
      const x = await store.get('s/' + sh, { type: 'json' }).catch(() => null);
      if (x) list.push({ id: sh.slice(0, 16), label: uaLabel(x.ua), at: x.at, last: x.last || x.at, current: sh === s.sh });
    }
    return json({ ok: true, sessions: list.sort((a, b) => b.last - a.last) });
  }
  if (action === 'session-revoke') {
    const id = String(body.id || '');
    const sh = (user.sess || []).find(x => x.startsWith(id) && id.length >= 16);
    if (!sh) return err('Nincs ilyen eszköz.', 404);
    if (sh === s.sh) return err('Ezt az eszközt a „Kilépés” gombbal léptetheted ki.', 400);
    await store.delete('s/' + sh).catch(() => {});
    await updateJSON(store, uk, raw => raw ? { value: Object.assign(raw, { sess: (raw.sess || []).filter(x => x !== sh) }) } : { write: false });
    return json({ ok: true });
  }
  // ---------- v4.49: adatok letöltése (GDPR) ----------
  if (action === 'export') {
    const st = asObj(await store.get('st/' + user.uid, { type: 'json' }).catch(() => null));
    const g = asObj(await store.get('g/' + user.uid, { type: 'json' }).catch(() => null));
    const sessions = [];
    for (const sh of user.sess || []) { const x = await store.get('s/' + sh, { type: 'json' }).catch(() => null); if (x) sessions.push({ device: uaLabel(x.ua), at: new Date(x.at).toISOString(), last: new Date(x.last || x.at).toISOString() }); }
    const out = {
      exportedAt: new Date().toISOString(), note: 'A PIC-ASS-O fiókodhoz tárolt adatok. Jelszót a játék nem tárol.',
      account: { name: user.name, email: user.email, createdAt: new Date(user.createdAt).toISOString(), consent: user.consent, previousNames: user.prevNames || [],
        roomCode: user.roomCode || null, profilePublic: user.profilePublic !== false, followMail: user.followMail !== false },
      passkeys: (user.pk || []).map(k => ({ device: k.name, createdAt: new Date(k.at).toISOString(), lastUsed: k.used ? new Date(k.used).toISOString() : null })),
      sessions, settings: asObj(user.settings), wordlists: user.wordlists || [], following: (user.friends || []).map(f => f.name),
      emailNotify: await accountSubOn(user).catch(() => false), stats: asObj(st.stats), gallery: (g.items || []).map(x => ({ word: x.word, at: new Date(x.at).toISOString() }))
    };
    return json(out, 200, { 'content-disposition': 'attachment; filename="picasso-adataim.json"' });
  }
  // ---------- v4.49: profil beállítások, szólisták ----------
  if (action === 'prefs-put') {
    const patch = {};
    if (typeof body.profilePublic === 'boolean') patch.profilePublic = body.profilePublic;
    if (typeof body.followMail === 'boolean') patch.followMail = body.followMail;
    await updateJSON(store, uk, raw => raw ? { value: Object.assign(raw, patch) } : { write: false });
    if ('profilePublic' in patch) { const st = asObj(await store.get('st/' + user.uid, { type: 'json' }).catch(() => null)); await updateTrophyBoard(store, Object.assign({}, user, patch), asObj(st.stats)).catch(() => {}); }
    return json({ ok: true, user: await publicUser(await getUser(store, user.uid)) });
  }
  if (action === 'wordlists-put') {
    if (softLimit('wl|' + user.uid, 60, 600_000)) return err('Lassabban!', 429);
    const lists = cleanWordlists(body.lists);
    if (!lists) return err('hibás lista');
    await updateJSON(store, uk, raw => raw ? { value: Object.assign(raw, { wordlists: lists }) } : { write: false });
    return json({ ok: true, wordlists: lists });
  }
  // ---------- v4.49: követés (barátlista) ----------
  if (action === 'follow' || action === 'unfollow') {
    if (softLimit('fo|' + user.uid, 60, 600_000)) return err('Lassabban!', 429);
    let target = null;
    if (action === 'follow') {
      const key = nameKey(String(body.name || '').slice(0, 40));
      const nb = key ? await store.get(nameBlob(key), { type: 'json' }).catch(() => null) : null;
      target = nb && nb.uid ? await getUser(store, nb.uid) : null;
      if (!target) return err('Nincs ilyen regisztrált játékos.', 404);
      if (target.uid === user.uid) return err('Saját magadat nem követheted. 🙂', 400);
      if ((user.friends || []).length >= MAX_FRIENDS) return err(`Legfeljebb ${MAX_FRIENDS} játékost követhetsz.`, 409);
    }
    const tuid = action === 'follow' ? target.uid : String(body.uid || '');
    await updateJSON(store, uk, raw => {
      if (!raw) return { write: false };
      const f = (raw.friends || []).filter(x => x.uid !== tuid);
      if (action === 'follow') f.push({ uid: target.uid, name: target.name });
      return { value: Object.assign(raw, { friends: f }) };
    });
    await updateJSON(store, 'fw/' + tuid, raw => {
      const d = asObj(raw); const u = (Array.isArray(d.uids) ? d.uids : []).filter(x => x !== user.uid);
      if (action === 'follow') u.push(user.uid);
      return { value: { uids: u.slice(-5000) } };
    }).catch(() => {});
    return json({ ok: true, user: await publicUser(await getUser(store, user.uid)) });
  }
  // ---------- v4.49: rajzgaléria ----------
  if (action === 'gallery-add') {
    if (await overLimit(store, 'gal|' + user.uid, 30, 3600_000)) return err('Óránként legfeljebb 30 rajzot menthetsz.', 429);
    const img = String(body.img || '');
    if (img.length > MAX_IMG || !/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(img)) return err('A rajz túl nagy vagy hibás.', 400);
    const word = String(body.word || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 40);
    const id = newToken(9);
    await store.set('gi/' + user.uid + '/' + id, img);
    const dropped = await updateJSON(store, 'g/' + user.uid, raw => {
      const d = asObj(raw); const items = (Array.isArray(d.items) ? d.items : []).concat({ id, at: Date.now(), word });
      const out = items.splice(0, Math.max(0, items.length - MAX_GALLERY));
      return { value: { items }, result: out };
    });
    await Promise.all((dropped || []).map(x => store.delete('gi/' + user.uid + '/' + x.id).catch(() => {})));
    return json({ ok: true, id, full: (dropped || []).length > 0 });
  }
  if (action === 'gallery-list') {
    const g = asObj(await store.get('g/' + user.uid, { type: 'json' }).catch(() => null));
    return json({ ok: true, pid: user.uid, items: (g.items || []).slice().reverse() });
  }
  if (action === 'gallery-del') {
    const id = String(body.id || '');
    await updateJSON(store, 'g/' + user.uid, raw => { const d = asObj(raw); return { value: { items: (d.items || []).filter(x => x.id !== id) } }; });
    await store.delete('gi/' + user.uid + '/' + id).catch(() => {});
    return json({ ok: true });
  }
  // ---------- v4.49: állandó szobakód ----------
  if (action === 'roomcode-set') {
    const code = String(body.code || '').toUpperCase().trim();
    if (code && !ROOM_CODE_RE.test(code)) return err('A kód 5 karakter legyen: betűk és számok (O, I, 0, 1 nélkül).', 400, { field: 'code' });
    if (code) {
      const got = await updateJSON(store, 'rc/' + code, raw => {
        const d = asObj(raw);
        if (d.uid && d.uid !== user.uid) return { write: false, result: false };
        return { value: { uid: user.uid }, result: true };
      }).catch(() => false);
      if (!got) return err('Ezt a kódot már más foglalta le.', 409, { field: 'code' });
    }
    if (user.roomCode && user.roomCode !== code) await store.delete('rc/' + user.roomCode).catch(() => {});
    await updateJSON(store, uk, raw => raw ? { value: Object.assign(raw, { roomCode: code || undefined }) } : { write: false });
    return json({ ok: true, user: await publicUser(await getUser(store, user.uid)) });
  }

  // ---------- fiók törlése (minden adattal együtt) ----------
  if (action === 'delete') {
    // jelszó nincs: a törlést a fiók nevének pontos begépelése erősíti meg
    if (String(body.confirmName || '').trim() !== user.name) return err('A megerősítéshez írd be pontosan a játékosneved.', 400, { field: 'confirmName' });
    const all = Array.isArray(user.sess) ? user.sess : [];
    await Promise.all(all.map(x => store.delete('s/' + x).catch(() => {})));
    await removeSubsOf(user.uid);
    await removePushOf(user.uid).catch(() => {});
    await store.delete('st/' + user.uid).catch(() => {});
    { const g = asObj(await store.get('g/' + user.uid, { type: 'json' }).catch(() => null)); await Promise.all((g.items || []).map(x => store.delete('gi/' + user.uid + '/' + x.id).catch(() => {}))); }
    await store.delete('g/' + user.uid).catch(() => {});
    await store.delete('fw/' + user.uid).catch(() => {});
    await updateJSON(store, 'achtop', raw => { const d = asObj(raw); return { value: { rows: (d.rows || []).filter(r => r.uid !== user.uid) } }; }).catch(() => {});
    if (user.roomCode) await store.delete('rc/' + user.roomCode).catch(() => {});
    for (const f of user.friends || []) await updateJSON(store, 'fw/' + f.uid, raw => { const d = asObj(raw); return { value: { uids: (d.uids || []).filter(x => x !== user.uid) } }; }).catch(() => {});
    await Promise.all((user.pk || []).map(k => store.delete(pkBlob(k.id)).catch(() => {})));
    await store.delete(uk).catch(() => {});
    await store.delete('e/' + user.eh).catch(() => {});
    await store.delete(nameBlob(user.key)).catch(() => {});
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
