// PIC-ASS-O — e-mail értesítés új szobáról (v4.10, v4.30)
// v4.40: értesítést csak regisztrált, bejelentkezett játékos kérhet; a cím a
// fiók megerősített e-mail címe. A korábbi (fiók nélküli) feliratkozók egy
// tájékoztató levelet kapnak, és 30 nap után törlődnek, ha nem regisztrálnak.
// Minden levél alján egyedi leiratkozó link van.
//
//   GET                         -> { count, loggedIn, subscribed }
//   POST { action:"subscribe", consent:true } / { action:"unsubscribe" }  (belépve)
//   POST { action:"notify", code }   (nyilvános szoba nyílt — a játékszerver
//        szobalistájából ellenőrizve, v4.11; v4.36: push értesítés is megy)
//   POST { action:"drain" } + x-picasso-internal -> a levélsor folytatása (v4.30)
//   GET  ?unsub=TOKEN  -> HTML oldal egy gombbal
//   POST ?unsub=TOKEN  -> elvégzi (a gomb, ill. a levelezők "egykattintásos
//        leiratkozás" funkciója) — a GET szándékosan nem módosít, mert a
//        levélszűrők előre megnyitják a linkeket.
//
// v4.30: az értesítő levelek egy tartós sorba (Netlify Blobs) kerülnek. Egy
// hívás legfeljebb ~7 mp-ig küld, a maradékot egy láncolt "drain" hívás viszi
// tovább — régen egyetlen hívás próbálta kiküldeni az összeset, és sok
// feliratkozónál kifutott a Netlify időkorlátjából (a levelek egy része
// csendben elmaradt). Napi plafon védi a Gmail küldési korlátját (~500/nap).
// Minden írás ütközésbiztos (két egyszerre érkező kérés nem írja felül egymást).
//
// Környezeti változók (Netlify → Site configuration → Environment variables):
//   GMAIL_USER          — a küldő Gmail cím
//   GMAIL_APP_PASSWORD  — a Google fiók 16 karakteres alkalmazásjelszava
//   MAIL_FROM_NAME (nem kötelező, alapból "PIC-ASS-O")
//   MAIL_DAILY_CAP (nem kötelező, alapból 450 levél / nap)
//   GAME_SERVER_URL (nem kötelező, alapból a saját játékszerver címe)
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { esc, page, sendMail, mailWrap, btn, mailConfigured } from '../lib/mail.mjs';
import { json, ipOf, makeLimiter, updateJSON } from '../lib/util.mjs';
import { sendPushToAll, subId } from '../lib/push.mjs';
import { sessionUser, sameOrigin } from '../lib/account.mjs';
import { subsStore, tidySubs, countSubs, setAccountSub, accountSubOn, LEGACY_GRACE_MS, MAX_SUBS } from '../lib/subs.mjs';

const KEY = 'subs';
const QUEUE_KEY = 'mailq';
const GAME_SERVER_URL = String(process.env.GAME_SERVER_URL || 'https://picasso.taile8c93.ts.net').replace(/\/+$/, '');
const NOTIFY_COOLDOWN_MS = 15 * 60 * 1000;   // legfeljebb 1 értesítés / 15 perc
const DAILY_CAP = Math.max(1, Number(process.env.MAIL_DAILY_CAP) || 450);
const BATCH = 8;                              // egyszerre ennyi levél megy
const SEND_BUDGET_MS = 7000;                  // egy hívás legfeljebb eddig küld
const QUEUE_TTL_MS = 6 * 3600 * 1000;         // ennél régebbi értesítés már nem megy ki

const limited = makeLimiter();
const asObj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};

// a láncolt "drain" hívás belső kulcsa (magától jön létre, csak a szerver látja)
let internalCache = null;
async function internalSecret(store) {
  if (internalCache) return internalCache;
  let v = await store.get('internal-secret').catch(() => null);
  if (!v || v.length < 32) {
    await store.set('internal-secret', randomBytes(32).toString('hex'), { onlyIfNew: true }).catch(() => null);
    v = await store.get('internal-secret').catch(() => null);
  }
  if (v && v.length >= 32) internalCache = v;
  return internalCache;
}
function sameSecret(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length >= 32 && timingSafeEqual(x, y);
}

/** A levélsor feldolgozása időkerettel. Visszaadja, maradt-e még levél. */
async function drainQueue(store, self, budgetMs) {
  const until = Date.now() + budgetMs;
  const today = new Date().toISOString().slice(0, 10);
  let sent = 0;
  while (Date.now() < until) {
    // egy adag kivétele a sorból (ütközésbiztosan, így két hívás nem küldi ki kétszer)
    const take = await updateJSON(store, QUEUE_KEY, raw => {
      const q = asObj(raw);
      q.items = Array.isArray(q.items) ? q.items.filter(x => x && Date.now() - (x.at || 0) < (x.kind === 'legacy' ? 3 * 86400_000 : QUEUE_TTL_MS)) : [];
      if (q.day !== today) { q.day = today; q.sentToday = 0; }
      const room = Math.max(0, DAILY_CAP - (q.sentToday || 0));
      if (!q.items.length || !room) return { value: q, result: { batch: [], left: q.items.length, capped: !room && q.items.length > 0 } };
      const batch = q.items.splice(0, Math.min(BATCH, room));
      q.sentToday = (q.sentToday || 0) + batch.length;
      return { value: q, result: { batch, left: q.items.length } };
    });
    if (take.capped) { console.warn('levélsor: a napi plafon betelt, a maradék holnapig vár'); return false; }
    if (!take.batch.length) return false;
    const res = await Promise.allSettled(take.batch.map(it => {
      const unsub = `${self}?unsub=${it.ut}`;
      if (it.kind === 'legacy') {
        // v4.40: egyszeri tájékoztató a korábbi (fiók nélküli) feliratkozóknak
        return sendMail(it.to, 'Az értesítőd mostantól fiókhoz kötött — PIC-ASS-O',
          mailWrap(`<p>Szia! A PIC-ASS-O-ban mostantól lehet regisztrálni, és az új szobákról szóló értesítést ezentúl csak regisztrált játékosok kaphatnak.</p>
<p><b>Ha szeretnéd megtartani az értesítőt:</b> regisztrálj <b>${esc(it.until)}</b>-ig ugyanezzel az e-mail címmel — a feliratkozásod magától megmarad. Ha nem regisztrálsz, a határidő után töröljük a címedet, és nem kapsz több levelet.</p>
${btn(it.joinUrl, '✏️ Regisztrálok')}`, unsub), unsub);
      }
      return sendMail(it.to, `🎨 Új szoba nyílt: ${it.name}`,
        mailWrap(`<p><b>${esc(it.host)}</b> most nyitotta meg a(z) <b>„${esc(it.name)}”</b> szobát. Gyere rajzolni!</p>${btn(it.joinUrl, '🚀 Csatlakozás')}`, unsub), unsub, it.pal);   // v4.43: a játékos saját színeivel
    }));
    sent += res.filter(r => r.status === 'fulfilled').length;
    res.forEach(r => { if (r.status === 'rejected') console.error('levélküldési hiba', r.reason && r.reason.message); });
    if (!take.left) return false;
  }
  console.log(`levélsor: ${sent} levél elküldve ebben a hívásban, folytatás következik`);
  return true;
}

/** A sor folytatása egy új függvényhívásban (a válaszát nem várjuk meg). */
async function kickDrain(store, self) {
  const sec = await internalSecret(store);
  if (!sec) return;
  try {
    await fetch(self, { method: 'POST', headers: { 'content-type': 'application/json', 'x-picasso-internal': sec },
      body: JSON.stringify({ action: 'drain' }), signal: AbortSignal.timeout(1500) });
  } catch (e) { /* időtúllépés várható: a másik hívás közben fut */ }
}

/**
 * v4.40: a fiók nélküli feliratkozók egyszeri tájékoztatása és a türelmi idő indítása.
 * A határidő után a tidySubs törli azokat, akik nem regisztráltak ugyanazzal a címmel.
 */
async function startLegacyGrace(store, self, site) {
  const until = Date.now() + LEGACY_GRACE_MS;
  const list = await updateJSON(store, KEY, raw => {
    const d = tidySubs(raw);
    if (d.legacyUntil) return { write: false, result: null };
    d.legacyUntil = until; d.legacyNoticeAt = Date.now();
    return { value: d, result: Object.values(d.subs).filter(s => s.status === 'ok' && !s.uid).map(s => ({ to: s.email, ut: s.ut })) };
  });
  if (!list) return;
  const untilText = new Date(until).toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Budapest' });
  try {
    await sendPushToAll({ title: 'PIC-ASS-O: az értesítő fiókhoz kötött', body: `Regisztrálj ${untilText}-ig és lépj be ezen az eszközön, különben az értesítések megszűnnek.`, url: site + '/?fiok=1' }, { budgetMs: 4000, onlyLegacy: true });
  } catch (e) { /* nem baj */ }
  if (!list.length) return;
  const at = Date.now();
  await updateJSON(store, QUEUE_KEY, raw => {
    const q = asObj(raw);
    q.items = (Array.isArray(q.items) ? q.items : []).concat(list.map(x => ({ ...x, kind: 'legacy', until: untilText, joinUrl: site + '/?fiok=1', at })));
    return { value: q };
  });
  await kickDrain(store, self);
}

export default async (req) => {
  const url = new URL(req.url);
  const self = url.origin + url.pathname;
  const site = url.origin;
  const store = subsStore();
  const tidy = tidySubs, count = countSubs;
  const read = async () => tidy(await store.get(KEY, { type: 'json' }).catch(() => null));
  const findBy = (d, field, t) => t && Object.entries(d.subs).find(([, s]) => s[field] === t);

  const unsubT = url.searchParams.get('unsub');

  // v4.40: a régi (fiók nélküli) megerősítő linkek már nem élnek
  if (url.searchParams.get('confirm')) {
    return page('Az értesítő fiókhoz kötött', `<p>Az új szobákról szóló értesítést mostantól csak regisztrált játékosok kérhetik. Regisztrálj vagy lépj be, és a fiókodban egy kattintással bekapcsolhatod.</p><a class="b" href="${esc(site)}/?fiok=1">Irány a játék</a>`, 410);
  }

  // ---- leiratkozás ----
  if (unsubT) {
    if (req.method === 'POST') {
      await updateJSON(store, KEY, raw => {
        const d = tidy(raw);
        const h = findBy(d, 'ut', unsubT);
        if (!h) return { write: false };
        delete d.subs[h[0]];
        return { value: d };
      });
      // a sorban várakozó levelei se menjenek ki
      await updateJSON(store, QUEUE_KEY, raw => {
        const q = asObj(raw);
        if (!Array.isArray(q.items) || !q.items.some(x => x && x.ut === unsubT)) return { write: false };
        q.items = q.items.filter(x => x && x.ut !== unsubT);
        return { value: q };
      }).catch(() => {});
      return page('Leiratkoztál', '<p>Töröltük az e-mail címedet, több értesítést nem kapsz. Ha meggondolnád magad, a játék kezdőoldalán újra feliratkozhatsz.</p>');
    }
    return page('Leiratkozás', `<p>Biztosan nem kérsz több értesítést az új szobákról?</p>
<form method="post" action="${esc(self)}?unsub=${encodeURIComponent(unsubT)}"><button class="r">Leiratkozom</button></form>`);
  }

  if (req.method === 'GET') {
    const d = await read();
    // v4.40: egyszeri tájékoztató a korábbi feliratkozóknak + a 30 napos türelmi idő indítása
    if (!d.legacyUntil && mailConfigured()) await startLegacyGrace(store, self, site).catch(e => console.error(e));
    const s = await sessionUser(req).catch(() => null);
    return json({ count: count(d), loggedIn: !!s, subscribed: s ? await accountSubOn(s.user, store) : false });
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  // ---- a levélsor folytatása (csak belső, láncolt hívás) ----
  if (req.headers.get('x-picasso-internal')) {
    const sec = await internalSecret(store);
    if (!sameSecret(req.headers.get('x-picasso-internal'), sec)) return json({ error: 'forbidden' }, 403);
    const more = await drainQueue(store, self, SEND_BUDGET_MS);
    if (more) await kickDrain(store, self);
    return json({ ok: true, more });
  }

  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const ip = ipOf(req);

  // ---- feliratkozás (v4.40: csak bejelentkezett, regisztrált játékosnak) ----
  // A cím a fiók megerősített e-mail címe, ezért nem kell külön megerősítő levél.
  if (body.action === 'subscribe' || body.action === 'unsubscribe') {
    if (limited('s|' + ip, 20, 3600000)) return json({ error: 'Túl sok próbálkozás, próbáld újra később.' }, 429);
    const s = await sessionUser(req);
    if (!s) return json({ error: 'Az értesítéshez be kell lépned.', login: true }, 401);
    const on = body.action === 'subscribe';
    if (on && body.consent !== true) return json({ error: 'A feliratkozáshoz hozzájárulás kell.' }, 400);
    const r = await setAccountSub(s.user, on, store);
    if (r && r.error) return json({ error: 'Megtelt a lista.' }, 503);
    return json({ ok: true, subscribed: !!(r && r.on), count: count(await read()) });
  }

  // ---- értesítés új szobáról ----
  // v4.11: a kérés csak jelzés ("nézd meg, nyílt-e szoba"). Hogy tényleg nyílt-e,
  // azt a játékszerver nyilvános szobalistájából ellenőrizzük, és a levélbe a
  // szoba nevét / a szobanyitót is ONNAN vesszük, nem a kérésből — így kitalált
  // szobáról vagy kitalált szöveggel senki nem tud levelet küldetni.
  if (body.action === 'notify') {
    if (limited('n|' + ip, 6, 3600000)) return json({ ok: true, skipped: 'ip' });
    const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!code) return json({ ok: true, skipped: 'nocode' });
    let room = null;
    try {
      const r = await fetch(GAME_SERVER_URL + '/api/szobak', { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
      if (r.ok) {
        const d = await r.json();
        room = (d && Array.isArray(d.rooms) ? d.rooms : []).find(x => x && String(x.code).toUpperCase() === code) || null;
      }
    } catch (e) { room = null; }
    // csak frissen (3 percen belül) megnyílt, a szerveren tényleg látható nyilvános szoba
    if (!room || Date.now() - Number(room.firstAt || 0) > 3 * 60 * 1000) return json({ ok: true, skipped: 'unverified' });
    const name = String(room.name || '').slice(0, 60).trim() || 'Új szoba';
    const host = String(room.hostName || '').slice(0, 24).trim() || 'Valaki';
    const res = await updateJSON(store, KEY, raw => {
      const d = tidy(raw);
      if (Date.now() - (d.lastNotifyAt || 0) < NOTIFY_COOLDOWN_MS) return { write: false, result: { skipped: 'cooldown' } };
      d.notified = asObj(d.notified);
      for (const k of Object.keys(d.notified)) if (Date.now() - d.notified[k] > 86400000) delete d.notified[k];
      if (d.notified[code]) return { write: false, result: { skipped: 'already' } };
      d.notified[code] = Date.now();
      d.lastNotifyAt = Date.now();
      return { value: d, result: { legacyOver: Number(d.legacyUntil) > 0 && Date.now() > Number(d.legacyUntil), list: Object.values(d.subs).filter(s => s.status === 'ok').map(s => ({ to: s.email, ut: s.ut, pal: s.pal })) } };
    });
    if (res.skipped) return json({ ok: true, skipped: res.skipped });
    const joinUrl = `${site}/?join=${encodeURIComponent(code)}`;
    // v4.36: push értesítés a feliratkozott eszközöknek (a szobát nyitó eszköz kivételével)
    let push = { sent: 0 };
    try {
      const skip = String(body.skipPush || '').slice(0, 1000);
      push = await sendPushToAll({ title: '🎨 Új szoba nyílt!', body: `${host} megnyitotta: ${name}. Koppints a csatlakozáshoz!`, url: joinUrl },
        { skipId: skip ? subId(skip) : '', budgetMs: 5000, legacyOk: !res.legacyOver });
    } catch (e) { push = { sent: 0, error: true }; }
    if (!res.list.length) return json({ ok: true, queued: 0, push: push.sent });
    const at = Date.now();
    await updateJSON(store, QUEUE_KEY, raw => {
      const q = asObj(raw);
      q.items = (Array.isArray(q.items) ? q.items : []).concat(res.list.map(x => ({ ...x, name, host, joinUrl, at })));
      if (q.items.length > MAX_SUBS * 2) q.items = q.items.slice(-MAX_SUBS * 2);
      return { value: q };
    });
    const more = await drainQueue(store, self, SEND_BUDGET_MS);
    if (more) await kickDrain(store, self);
    return json({ ok: true, queued: res.list.length, more });
  }

  return json({ error: 'unknown action' }, 400);
};
