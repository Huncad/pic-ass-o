// PIC-ASS-O — fiók a böngészőben (v4.40)
// Belépés / regisztráció ablak, névigazoló jegy, a regisztrált nevek védelme,
// valamint a statisztika és a beállítások szinkronja az eszközök között.
//
// Biztonság: a munkamenet-kulcs HttpOnly sütiben van, ez a kód soha nem látja.
// v4.45: jelszó nincs — belépés jelkulccsal vagy e-mailes belépőlinkkel. Minden szerverválasz szövegként (textContent)
// kerül a lapra, soha nem HTML-ként.
import { nameKey, isPlainObject } from './rules.js';

const API = '/.netlify/functions/account';
const SUBSCRIBE_URL = '/.netlify/functions/subscribe';
const STATS_KEY = 'picasso-stats', BASE_KEY = 'picasso-stats-base', REV_KEY = 'picasso-stats-rev', OWNER_KEY = 'picasso-stats-owner';
// v4.42: MINDEN beállítás a fiókkal megy (a localStorage-kulcs 'picasso-' előtag nélkül)
const SETTINGS_KEYS = ['mail-colors', 'avatar-color','dark-mode','theme','master-sound','sfx-vol','sfx-muted','music-vol','music-muted','replay-speed','create-prefs','chat-size','chat-pos','chat-fs','chat-dock','fab-pos','whatis-noimg','tutorial-seen','setup-advanced-open','sub-open','notify-skip-own','phone-hint','announce-dismissed'];
const SETTINGS_MARK = 'picasso-settings-synced';
const $ = id => document.getElementById(id);
const ls = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  set(k, v){ try{ localStorage.setItem(k, v); }catch(e){} },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} },
  json(k){ try{ const v = JSON.parse(localStorage.getItem(k) || 'null'); return isPlainObject(v) ? v : null; }catch(e){ return null; } }
};

let user = null;            // { name, email, twofa, backupLeft, notifyEmail, settings, createdAt } vagy null
let selfId = '';
let ticket = '', ticketExp = 0, ticketBusy = null;
let hooks = {};
const listeners = new Set();
const N = v => Number(v) || 0;

// ---------- v4.43: a játékban látott színek a levelekhez ----------
// A téma és a sötét mód tényleges színeit egy pixelre festve olvassuk ki (így a color-mix() is pontos hexa lesz).
function readPalette(){
  try{
    const cs = getComputedStyle(document.documentElement);
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const ctx = cv.getContext('2d', { willReadFrequently:true });
    const hex = v=>{
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = String(v || '').trim() || '#000'; ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return '#' + [d[0], d[1], d[2]].map(x=>x.toString(16).padStart(2, '0')).join('');
    };
    const g = n=>cs.getPropertyValue(n);
    return { bg: hex(g('--bg')), panel: hex(g('--panel')), text: hex(g('--chalk')), dim: hex(g('--chalk-dim')),
      accent: hex(g('--yellow')), link: hex(g('--blue')), btn: hex(g('--green')), btnText: hex(g('--bg')) };
  }catch(e){ return null; }
}
function storePalette(){
  const p = readPalette();
  if(p){ const v = JSON.stringify(p); if(ls.get('picasso-mail-colors') !== v) ls.set('picasso-mail-colors', v); }
  return p;
}
try{
  new MutationObserver(()=>setTimeout(storePalette, 50)).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme', 'class'] });
}catch(e){}

async function call(body, opts = {}){
  if(body && ['register', 'forgot'].includes(body.action)){ const p = storePalette(); if(p) body = Object.assign({}, body, { pal: p }); }
  const r = await fetch(API, { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'same-origin', cache:'no-store',
    keepalive: !!opts.keepalive, body: JSON.stringify(body) });
  let j = {}; try{ j = await r.json(); }catch(e){}
  if(r.status === 401 && j && j.login && user){ setUser(null); }   // a munkamenet közben megszűnt
  return { ok: r.ok, status: r.status, j: j || {} };
}
function setUser(u){
  const was = user ? user.name : '';
  user = u || null;
  if(!user){ ticket = ''; ticketExp = 0; }
  if((user ? user.name : '') !== was || user) listeners.forEach(f=>{ try{ f(user); }catch(e){} });
  paintHome();
}

// ---------- névigazoló jegy ----------
async function fetchTicket(){
  if(!user || !selfId) return '';
  if(ticketBusy) return ticketBusy;
  ticketBusy = (async ()=>{
    try{
      let th = ''; try{ th = hooks.tokenHash ? await hooks.tokenHash() : ''; }catch(e){}
      const r = await call({ action:'ticket', pid: selfId, th });
      if(r.ok && r.j.ticket){ ticket = r.j.ticket; ticketExp = N(r.j.exp); try{ hooks.onTicket && hooks.onTicket(ticket); }catch(e){} }
    }catch(e){}
    ticketBusy = null;
    return ticket;
  })();
  return ticketBusy;
}
// a jegy 15 percig él: pár percenként frissítjük, hogy egy újonnan belépő szobatárs mindig érvényeset lásson
setInterval(()=>{ if(user && (!ticket || ticketExp - Date.now() < 9 * 60_000)) fetchTicket(); }, 60_000);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible' && user && ticketExp - Date.now() < 9 * 60_000) fetchTicket(); });

let pubKeyP = null;
function pubKey(){
  if(!pubKeyP){
    pubKeyP = (async ()=>{
      const r = await fetch(API + '?pubkey=1');
      const j = await r.json();
      return crypto.subtle.importKey('jwk', { kty:'EC', crv:'P-256', x: j.key.x, y: j.key.y }, { name:'ECDSA', namedCurve:'P-256' }, false, ['verify']);
    })();
    pubKeyP.catch(()=>{ pubKeyP = null; });
  }
  return pubKeyP;
}
const b64uBytes = s => { const pad = '='.repeat((4 - s.length % 4) % 4); const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c=>c.charCodeAt(0)); };
/** Egy másik játékos jegyének ellenőrzése: { name, uid } ha érvényes ÉS az ő kapcsolatához szól, különben null. */
async function verifyTicket(tk, peerId){
  try{
    if(typeof tk !== 'string' || tk.length > 1200) return null;
    const i = tk.indexOf('.');
    if(i < 10) return null;
    const body = tk.slice(0, i), sig = tk.slice(i + 1);
    const key = await pubKey();
    const ok = await crypto.subtle.verify({ name:'ECDSA', hash:'SHA-256' }, key, b64uBytes(sig), new TextEncoder().encode(body));
    if(!ok) return null;
    const c = JSON.parse(new TextDecoder().decode(b64uBytes(body)));
    if(!c || c.p !== peerId || N(c.e) < Date.now() || typeof c.n !== 'string' || !nameKey(c.n)) return null;
    return { name: c.n.slice(0, 16), uid: String(c.u || '') };
  }catch(e){ return null; }
}

// ---------- regisztrált nevek ----------
const nameCache = new Map();   // key -> { taken, at }
function cachedTaken(name){
  const c = nameCache.get(nameKey(name));
  return c && Date.now() - c.at < (c.taken ? 300_000 : 30_000) ? c.taken : null;
}
/** Regisztrált-e a név (hálózati hiba esetén false: a szerver úgyis ellenőrzi). */
async function nameTaken(name){
  const key = nameKey(name);
  if(!key) return false;
  const c = cachedTaken(name);
  if(c !== null) return c;
  try{
    const r = await fetch(API + '?name=' + encodeURIComponent(key), { cache:'no-store' });
    if(!r.ok) return false;
    const taken = !!(await r.json()).taken;
    nameCache.set(key, { taken, at: Date.now() });
    return taken;
  }catch(e){ return false; }
}
/** Használhatja-e a nevet az a játékos, aki ezt a jegyet mutatta be (szobanyitó ellenőrzi). */
async function mayUse(name, tk, peerId){
  const key = nameKey(name);
  if(tk){ const c = await verifyTicket(tk, peerId); if(c && nameKey(c.name) === key) return true; }
  return !(await nameTaken(name));
}
/** A kezdőképernyőn beírt név gondja szövegesen, vagy '' ha mehet. */
function nameProblem(name){
  const key = nameKey(name);
  if(!key) return '';
  if(user && nameKey(user.name) === key){
    if(!ticket){ fetchTicket(); return 'Még ellenőrizzük a fiókodat — próbáld újra egy pillanat múlva.'; }
    return '';
  }
  if(cachedTaken(name) === true) return 'Ez a név egy regisztrált játékosé. Lépj be, vagy válassz másik nevet.';
  return '';
}

// ---------- statisztika: háromutas összefésülés ----------
// base = amit utoljára szinkronizáltunk; local = ami most az eszközön van; remote = ami a fiókban van.
// A számlálóknál a helyi VÁLTOZÁS (local − base) adódik a fiók értékéhez, így két eszköz nem írja felül egymást.
const ADD = ['games','wins','podium','points','playMs','drawn','drawnHit','drawnMiss','drawPts','passes','guessRounds','guessHit','guessPts','guessMsSum','firstHits'];
const MAXK = ['bestStreak','biggestRoom','lastPlayed'];
const MAPS = ['badges','mates','tiers'];
export function mergeStats(base, local, remote){
  base = isPlainObject(base) ? base : {}; local = isPlainObject(local) ? local : {}; remote = isPlainObject(remote) ? remote : {};
  const out = {};
  const add = (b, l, r) => Math.max(0, N(r) + (N(l) - N(b)));
  for(const k of ADD){ const v = add(base[k], local[k], remote[k]); if(v || k in local || k in remote) out[k] = v; }
  for(const k of MAXK){ const v = Math.max(N(local[k]), N(remote[k])); if(v) out[k] = v; }
  // a legjobb eredmény a hozzá tartozó adatokkal együtt megy
  const bestSrc = N(local.best) >= N(remote.best) ? local : remote;
  out.best = N(bestSrc.best);
  if(bestSrc.bestAt) out.bestAt = N(bestSrc.bestAt);
  if(bestSrc.bestPlayers) out.bestPlayers = N(bestSrc.bestPlayers);
  const since = [local.since, remote.since].map(N).filter(x=>x > 0);
  if(since.length) out.since = Math.min(...since);
  for(const k of MAPS){
    const b = isPlainObject(base[k]) ? base[k] : {}, l = isPlainObject(local[k]) ? local[k] : {}, r = isPlainObject(remote[k]) ? remote[k] : {};
    const m = {};
    for(const key of new Set([...Object.keys(l), ...Object.keys(r)])){
      if(key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const v = add(b[key], l[key], r[key]); if(v > 0) m[String(key).slice(0, 40)] = v;
    }
    if(Object.keys(m).length || k in local || k in remote) out[k] = k === 'mates' ? Object.fromEntries(Object.entries(m).sort((a, c)=>c[1] - a[1]).slice(0, 40)) : m;
  }
  const rec = (a, b, lower) => { const va = isPlainObject(a) && N(a.ms) > 0 ? a : null, vb = isPlainObject(b) && N(b.ms) > 0 ? b : null;
    if(!va || !vb) return va || vb; return (lower ? N(va.ms) <= N(vb.ms) : N(va.ms) >= N(vb.ms)) ? va : vb; };
  const clean = x => x ? { w: String(x.w || '').slice(0, 60), ms: N(x.ms) } : null;
  const e = clean(rec(local.easiest, remote.easiest, true)); if(e) out.easiest = e;
  const f = clean(rec(local.fastest, remote.fastest, true)); if(f) out.fastest = f;
  const h = clean(rec(local.hardestHit, remote.hardestHit, false)); if(h) out.hardestHit = h;
  const missed = [...(Array.isArray(local.missed) ? local.missed : []), ...(Array.isArray(remote.missed) ? remote.missed : [])].map(x=>String(x).slice(0, 60));
  if(missed.length) out.missed = [...new Set(missed)].slice(0, 5);
  return out;
}
let statsBusy = false;
async function syncStats(opts = {}){
  if(!user || statsBusy) return;
  statsBusy = true;
  try{
    const me = nameKey(user.name);
    const foreign = ls.get(OWNER_KEY) && ls.get(OWNER_KEY) !== me;       // ezen az eszközön előzőleg más fiók volt
    const fresh = ls.get(OWNER_KEY) !== me;
    const localRaw = foreign ? '{}' : (ls.get(STATS_KEY) || '{}');
    const local = foreign ? {} : (ls.json(STATS_KEY) || {});
    const base = fresh ? {} : (ls.json(BASE_KEY) || {});
    let remote = null, rev = 0;
    const g = await call({ action:'stats-get' });
    if(!g.ok) return;
    remote = g.j.stats || {}; rev = N(g.j.rev);
    let merged = mergeStats(base, local, remote);
    for(let i = 0; i < 3 && JSON.stringify(merged) !== JSON.stringify(remote); i++){
      const p = await call({ action:'stats-put', stats: merged, rev }, opts);
      if(p.ok){ rev = N(p.j.rev); break; }
      if(p.status !== 409) return;
      remote = p.j.stats || {}; rev = N(p.j.rev);
      merged = mergeStats(base, local, remote);
    }
    // ami a hálózati kérés ALATT változott az eszközön (pl. épp véget ért egy kör), az nem veszhet el
    const nowLocal = foreign ? null : ls.json(STATS_KEY);
    const final = (nowLocal && (ls.get(STATS_KEY) || '{}') !== localRaw) ? mergeStats(local, nowLocal, merged) : merged;
    ls.set(STATS_KEY, JSON.stringify(final));
    ls.set(BASE_KEY, JSON.stringify(merged));
    ls.set(REV_KEY, String(rev));
    ls.set(OWNER_KEY, me);
    try{ hooks.onStats && hooks.onStats(); }catch(e){}
  }catch(e){ /* legközelebb újra */ }
  finally{ statsBusy = false; }
}
/** Nullázás: a fiókban tárolt statisztika is üres lesz (minden eszközön). */
async function resetStats(){
  if(!user) return;
  for(let i = 0; i < 3; i++){
    const g = await call({ action:'stats-get' });
    if(!g.ok) return;
    const fresh = ls.json(STATS_KEY) || {};
    const p = await call({ action:'stats-put', stats: fresh, rev: N(g.j.rev) });
    if(p.ok){ ls.set(BASE_KEY, JSON.stringify(fresh)); ls.set(REV_KEY, String(N(p.j.rev))); ls.set(OWNER_KEY, nameKey(user.name)); return; }
    if(p.status !== 409) return;
  }
}
const statsDirty = () => !!user && ls.get(OWNER_KEY) === nameKey(user.name) && (ls.get(STATS_KEY) || '{}') !== (ls.get(BASE_KEY) || '{}');
setInterval(()=>{ if(statsDirty()) syncStats(); }, 45_000);
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'hidden'){ if(statsDirty()) syncStats({ keepalive:true }); pushSettings({ keepalive:true }); }
  else if(user) syncStats();
});

// ---------- beállítások szinkronja ----------
function localSettings(){
  const o = {};
  for(const k of SETTINGS_KEYS){ const v = ls.get('picasso-' + k); if(typeof v === 'string' && v.length && v.length <= 4000) o[k] = v; }
  return o;
}
const sj = o => JSON.stringify(Object.keys(o).sort().map(k=>[k, o[k]]));
async function pushSettings(opts = {}){
  if(!user) return;
  const cur = localSettings();
  if(sj(cur) === ls.get(SETTINGS_MARK)) return;
  try{
    const r = await call({ action:'settings-put', settings: cur }, opts);
    if(r.ok){ ls.set(SETTINGS_MARK, sj(r.j.settings || cur)); if(user) user.settings = r.j.settings || cur; }
  }catch(e){}
}
/**
 * Belépéskor / induláskor / visszatéréskor: ha a fiókban más beállítás van, és itt az utolsó szinkron óta
 * nem változott semmi, a fiókét vesszük át pontosan (ami ott nincs, az itt is törlődik).
 * Visszaadja, kell-e újratölteni (a legtöbb beállítás betöltéskor lép életbe).
 */
function pullSettings(){
  if(!user) return false;
  const remote = isPlainObject(user.settings) ? user.settings : {};
  const cur = localSettings(), mark = ls.get(SETTINGS_MARK);
  if(sj(remote) === sj(cur)){ ls.set(SETTINGS_MARK, sj(remote)); return false; }
  if(!Object.keys(remote).length || (mark && mark !== sj(cur))){ pushSettings(); return false; }   // itt változott utoljára: ez megy fel
  for(const k of SETTINGS_KEYS){ if(typeof remote[k] === 'string') ls.set('picasso-' + k, remote[k]); else ls.del('picasso-' + k); }
  ls.set(SETTINGS_MARK, sj(remote));
  // ugyanarra az állapotra legfeljebb egyszer töltünk újra (nincs újratöltési hurok)
  let done = ''; try{ done = sessionStorage.getItem('picasso-settings-reload') || ''; sessionStorage.setItem('picasso-settings-reload', sj(remote)); }catch(e){ done = sj(remote); }
  return done !== sj(remote);
}
/** Egy másik eszközön közben megváltozott beállítások átvétele (csak ha épp nem vagy szobában). */
async function refreshFromServer(){
  if(!user) return;
  try{ if(hooks.inRoom && hooks.inRoom()) return; }catch(e){}
  await pushSettings();
  try{
    const r = await fetch(API, { credentials:'same-origin', cache:'no-store' });
    const j = r.ok ? await r.json() : null;
    if(!j || !j.user) return;
    user.settings = j.user.settings;
    if(pullSettings()) location.reload();
  }catch(e){}
}
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible') refreshFromServer(); });
setInterval(()=>pushSettings(), 15_000);

// ---------- a kezdőképernyő ----------
function paintHome(){
  const btn = $('btn-account'), nameEl = $('home-name'), note = $('home-name-note');
  if(btn){
    btn.textContent = '';
    const ico = document.createElement('span'); ico.textContent = user ? '✔' : '👤'; ico.className = user ? 'acct-badge' : '';
    btn.append(ico, document.createTextNode(user ? ` ${user.name} — Fiókom` : ' Belépés / Regisztráció'));
    btn.classList.toggle('logged-in', !!user);
  }
  if(nameEl){
    if(user){ nameEl.value = user.name; nameEl.readOnly = true; nameEl.classList.add('name-locked'); ls.set('picasso-name', user.name); }
    else if(nameEl.readOnly){ nameEl.readOnly = false; nameEl.classList.remove('name-locked'); }
  }
  if(note){ if(user){ note.textContent = '✔ Regisztrált név — csak te használhatod.'; note.className = 'name-note ok'; } else checkTypedName(); }
  paintSubBox();
}
let nameTimer = 0;
function checkTypedName(){
  const nameEl = $('home-name'), note = $('home-name-note');
  if(!nameEl || !note || user) return;
  const v = nameEl.value.trim();
  clearTimeout(nameTimer);
  const show = taken => {
    if(nameEl.value.trim() !== v || user) return;
    note.textContent = taken ? '🔒 Ez a név egy regisztrált játékosé. Lépj be, vagy válassz másik nevet.' : '';
    note.className = 'name-note' + (taken ? ' bad' : '');
  };
  if(nameKey(v).length < 2){ show(false); return; }
  const c = cachedTaken(v);
  if(c !== null){ show(c); return; }
  nameTimer = setTimeout(()=>nameTaken(v).then(show), 350);
}

// ---------- értesítő doboz (csak fiókkal) ----------
function paintSubBox(){
  const out = $('sub-loggedout'), inn = $('sub-loggedin'), chk = $('sub-email-on'), addr = $('sub-email-addr');
  if(!out || !inn) return;
  out.classList.toggle('hidden', !!user);
  inn.classList.toggle('hidden', !user);
  if(user && chk){ chk.checked = !!user.notifyEmail; if(addr) addr.textContent = user.email; }
}
async function toggleEmailNotify(on){
  const st = $('sub-status');
  const say = (t, c) => { if(st){ st.textContent = t; st.style.color = c || 'var(--chalk-dim)'; } };
  say('Mentés…');
  try{
    const r = await fetch(SUBSCRIBE_URL, { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'same-origin',
      body: JSON.stringify(on ? { action:'subscribe', consent:true } : { action:'unsubscribe' }) });
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    if(user) user.notifyEmail = !!j.subscribed;
    say(j.subscribed ? '✅ E-mailben szólunk, ha valaki nyilvános szobát nyit (legfeljebb 15 percenként egy levél).' : 'Kikapcsolva — nem küldünk több e-mailt új szobákról.', j.subscribed ? 'var(--green)' : '');
    try{ hooks.onSubCount && hooks.onSubCount(j.count); }catch(e){}
  }catch(e){ say('Nem sikerült: ' + e.message, 'var(--red)'); }
  paintSubBox();
}

// ---------- a fiók ablak ----------
let view = 'login';
const VIEWS = ['login','register','registered','link-sent','profile','delete'];
function show(v){
  view = v;
  VIEWS.forEach(x=>{ const el = $('acct-v-' + x); if(el) el.classList.toggle('hidden', x !== v); });
  document.querySelectorAll('#account-overlay .acct-msg').forEach(el=>{ el.textContent = ''; el.className = 'acct-msg'; });
  { const d = $('acct-del-name'); if(d) d.value = ''; const h = $('acct-del-name-hint'); if(h) h.textContent = user ? user.name : ''; }
  if(v === 'profile') paintProfile();
  if(v === 'login'){ const w = $('acct-pk-login-wrap'); if(w) w.classList.toggle('hidden', !pkSupported()); const hint = w && w.querySelector('.acct-why'); if(hint && !isPhone()) hint.textContent = 'A gépeden, vagy a telefonoddal: a böngésző QR-kódot mutat, azt olvasd be a telefonnal.'; }
  const first = $('acct-v-' + v) && $('acct-v-' + v).querySelector('input:not([type=checkbox]),button');
  if(first){ try{ first.focus(); }catch(e){} }
}
function open(v){
  const ov = $('account-overlay');
  if(!ov) return;
  ov.classList.remove('hidden');
  show(v || (user ? 'profile' : 'login'));
}
function close(){ const ov = $('account-overlay'); if(ov) ov.classList.add('hidden'); }
function msg(id, text, kind){ const el = $(id); if(el){ el.textContent = text || ''; el.className = 'acct-msg' + (kind ? ' ' + kind : ''); } }
function paintProfile(){
  if(!user){ show('login'); return; }
  $('acct-p-name').textContent = user.name;
  $('acct-p-email').textContent = user.email;
  $('acct-p-since').textContent = user.createdAt ? new Date(user.createdAt).toLocaleDateString('hu-HU', { year:'numeric', month:'long', day:'numeric' }) : '';
  const n = $('acct-p-notify'); if(n) n.checked = !!user.notifyEmail;
  paintPasskeys();
}
/** Űrlap bekötése: a gombot a kérés idejére letiltja, a hibát az űrlap üzenetsorába írja. */
function form(id, msgId, fn){
  const f = $(id);
  if(!f) return;
  f.addEventListener('submit', async e=>{
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]');
    if(btn && btn.disabled) return;
    if(btn) btn.disabled = true;
    msg(msgId, 'Egy pillanat…');
    try{ await fn(new FormData(f), f); }
    catch(err){ msg(msgId, 'Nem sikerült kapcsolódni. Ellenőrizd az internetet, és próbáld újra.', 'bad'); }
    finally{ if(btn) btn.disabled = false; }
  });
}
async function afterLogin(u){
  setUser(u);
  await fetchTicket();
  await syncStats();
  if(pullSettings()){ location.reload(); return; }
  try{ hooks.onLogin && hooks.onLogin(); }catch(e){}
}
// ---------- v4.43: jelkulcs (passkey) ----------
const pkSupported = ()=> typeof window.PublicKeyCredential === 'function' && !!navigator.credentials && window.isSecureContext;
function loadWebAuthn(){
  return new Promise((res, rej)=>{
    if(window.SimpleWebAuthnBrowser) return res(window.SimpleWebAuthnBrowser);
    const s = document.createElement('script');
    s.src = 'vendor/simplewebauthn-browser.js';
    s.onload = ()=>window.SimpleWebAuthnBrowser ? res(window.SimpleWebAuthnBrowser) : rej(new Error('webauthn'));
    s.onerror = ()=>rej(new Error('webauthn'));
    document.head.appendChild(s);
  });
}
const pkCancelled = e => e && (e.name === 'NotAllowedError' || e.name === 'AbortError' || /cancel|abort|not allowed/i.test(String(e.message || '')));
function paintPasskeys(){
  const box = $('acct-pk-box'), list = $('acct-pk-list');
  if(!box || !list) return;
  box.classList.toggle('hidden', !pkSupported());
  { const ph = $('acct-pk-add-phone'), hint = $('acct-pk-phone-hint'); const show = pkSupported() && !isPhone(); if(ph) ph.classList.toggle('hidden', !show); if(hint) hint.classList.toggle('hidden', !show); }
  // v4.47: ahol a gép maga nem tud jelkulcsot tárolni (pl. Linux), a gépi gomb helyett egy rövid magyarázat
  if(!isPhone()) localPasskeyOk().then(ok=>{
    const why = $('acct-pk-nolocal');
    if(why){ why.textContent = ok ? '' : noLocalText(); why.classList.toggle('hidden', ok); }
  });
  list.textContent = '';
  const keys = (user && Array.isArray(user.passkeys)) ? user.passkeys : [];
  if(!keys.length){ const li = document.createElement('li'); li.className = 'acct-why'; li.textContent = 'Még nincs jelkulcsod.'; list.appendChild(li); return; }
  keys.forEach(k=>{
    const li = document.createElement('li');
    const t = document.createElement('span');
    t.textContent = `${k.name || 'jelkulcs'} · ${new Date(k.at).toLocaleDateString('hu-HU')}${k.used ? ' · utoljára: ' + new Date(k.used).toLocaleDateString('hu-HU') : ''}`;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost small'; b.textContent = 'Törlés';
    b.addEventListener('click', async ()=>{
      b.disabled = true;
      const r = await call({ action:'pk-delete', id: k.id }).catch(()=>({ ok:false, j:{} }));
      if(r.ok && r.j.user){ user.passkeys = r.j.user.passkeys; paintPasskeys(); msg('acct-m-profile', 'A jelkulcsot töröltük. (A telefonodon a jelszókezelőből külön törölheted.)', 'ok'); }
      else { b.disabled = false; msg('acct-m-profile', r.j.error || 'Nem sikerült törölni.', 'bad'); }
    });
    li.append(t, b); list.appendChild(li);
  });
}
// v4.47: tud-e ez a gép maga jelkulcsot tárolni (Windows Hello, Mac Touch ID, Chrome / Google Jelszókezelő)
let localPkCache = null;
function localPasskeyOk(){
  if(localPkCache) return localPkCache;
  localPkCache = (async ()=>{ try{ return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }catch(e){ return false; } })();
  return localPkCache;
}
function osName(){
  const ua = navigator.userAgent || '';
  return /Windows/.test(ua) ? 'windows' : /Mac OS X|Macintosh/.test(ua) ? 'mac' : /CrOS/.test(ua) ? 'chromeos' : /Linux|X11/.test(ua) ? 'linux' : 'other';
}
function noLocalText(){
  const os = osName();
  if(os === 'windows') return 'Ezen a gépen nincs beállítva Windows Hello, ezért ide nem lehet jelkulcsot tenni. Állítsd be (Beállítások → Fiókok → Bejelentkezési lehetőségek → PIN), vagy használd a telefonodat.';
  if(os === 'linux') return 'Linuxon a rendszer maga nem tárol jelkulcsot, de egy jelszókezelő igen: a Chrome bejelentkezve a Google Jelszókezelőbe teszi, vagy egy bővítmény (Bitwarden, KeePassXC, 1Password, Proton Pass). Ha ilyened van, próbáld az „Ezen az eszközön” gombot; ha nincs, a „📱 A telefonomra” gombbal a telefonodra tehetsz jelkulcsot.';
  return 'Ez a gép / böngésző nem tud jelkulcsot tárolni — használd a telefonodat a „📱 A telefonomra” gombbal.';
}
const isPhone = ()=> /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
async function addPasskey(phone){
  const btn = $(phone === true ? 'acct-pk-add-phone' : 'acct-pk-add');
  btn.disabled = true;
  msg('acct-m-profile', phone === true ? '📱 Olvasd be a megjelenő QR-kódot a telefonoddal, és erősítsd meg ott…' : 'Kövesd a telefonod / géped utasításait…');
  try{
    const W = await loadWebAuthn();
    // v4.48: a gombot akkor is megpróbáljuk, ha a rendszernek nincs saját tárolója — egy jelszókezelő (Google Jelszókezelő,
    // Bitwarden, KeePassXC, 1Password…) ilyenkor is el tudja menteni. Ha nem sikerül, a hibaüzenet elmondja a lehetőségeket.
    const noLocal = phone !== true && !isPhone() && !(await localPasskeyOk());
    const b = await call({ action:'pk-reg-begin', phone: phone === true });
    if(!b.ok){ msg('acct-m-profile', b.j.error || 'Nem sikerült.', 'bad'); return; }
    let resp;
    try{ resp = await W.startRegistration({ optionsJSON: b.j.options }); }
    catch(e){ msg('acct-m-profile', noLocal ? noLocalText() : pkCancelled(e) ? (phone === true ? 'Megszakítva.' : 'Megszakítva. (Ha a gép QR-kódot mutatott, az a telefonos út — ehhez inkább a „📱 A telefonomra” gombot használd.)') : (e && e.name === 'InvalidStateError' ? 'Ezen az eszközön már van jelkulcsod ehhez a fiókhoz.' : 'Ez az eszköz most nem tudott jelkulcsot létrehozni.'), pkCancelled(e) ? '' : 'bad'); return; }
    const f = await call({ action:'pk-reg-finish', response: resp });
    if(!f.ok){ msg('acct-m-profile', f.j.error || 'Nem sikerült.', 'bad'); return; }
    user.passkeys = f.j.user.passkeys;
    paintPasskeys();
    msg('acct-m-profile', '✅ Jelkulcs hozzáadva! Legközelebb a „Belépés jelkulccsal” gombbal jelszó nélkül beléphetsz.', 'ok');
  }catch(e){ msg('acct-m-profile', 'Nem sikerült kapcsolódni. Próbáld újra.', 'bad'); }
  finally{ btn.disabled = false; }
}
async function loginWithPasskey(){
  const btn = $('acct-pk-login');
  btn.disabled = true;
  msg('acct-m-login', 'Kövesd a telefonod / géped utasításait…');
  try{
    const W = await loadWebAuthn();
    const b = await call({ action:'pk-login-begin' });
    if(!b.ok){ msg('acct-m-login', b.j.error || 'Nem sikerült.', 'bad'); return; }
    let resp;
    try{ resp = await W.startAuthentication({ optionsJSON: b.j.options }); }
    catch(e){ msg('acct-m-login', pkCancelled(e) ? 'Megszakítva. Ha még nincs jelkulcsod, lépj be jelszóval, és a fiókodban add hozzá.' : 'Ez az eszköz most nem tudott jelkulccsal belépni.', pkCancelled(e) ? '' : 'bad'); return; }
    const f = await call({ action:'pk-login-finish', response: resp });
    if(!f.ok){ msg('acct-m-login', f.j.error || 'Nem sikerült belépni.', 'bad'); return; }
    await afterLogin(f.j.user);
    show('profile');
    msg('acct-m-profile', `Szia, ${user.name}! Beléptél a jelkulcsoddal.`, 'ok');
  }catch(e){ msg('acct-m-login', 'Nem sikerült kapcsolódni. Próbáld újra.', 'bad'); }
  finally{ btn.disabled = false; }
}

function wire(){
  const ov = $('account-overlay');
  if(!ov) return;
  $('btn-account') && $('btn-account').addEventListener('click', ()=>{ try{ hooks.click && hooks.click(); }catch(e){} open(); });
  $('account-close-btn').addEventListener('click', close);
  ov.addEventListener('click', e=>{ if(e.target === ov && view !== 'registered') close(); });
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && !ov.classList.contains('hidden')) close(); });
  ov.querySelectorAll('[data-acct-go]').forEach(b=>b.addEventListener('click', e=>{ e.preventDefault(); show(b.dataset.acctGo); }));
  ov.querySelectorAll('[data-acct-close]').forEach(b=>b.addEventListener('click', close));
  ov.querySelectorAll('[data-acct-privacy]').forEach(b=>b.addEventListener('click', e=>{ e.preventDefault(); const p = $('btn-open-privacy'); if(p) p.click(); }));
  ov.querySelectorAll('.acct-eye').forEach(b=>b.addEventListener('click', ()=>{ const i = b.parentElement.querySelector('input'); if(i){ i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? '👁' : '🙈'; } }));
  const nameEl = $('home-name');
  if(nameEl) nameEl.addEventListener('input', checkTypedName);
  const subLogin = $('sub-login-btn'); if(subLogin) subLogin.addEventListener('click', ()=>open());
  const subChk = $('sub-email-on'); if(subChk) subChk.addEventListener('change', ()=>toggleEmailNotify(subChk.checked));
  const pChk = $('acct-p-notify'); if(pChk) pChk.addEventListener('change', async ()=>{ await toggleEmailNotify(pChk.checked); paintProfile(); });

  form('acct-f-login', 'acct-m-login', async fd=>{
    const r = await call({ action:'magic', email: String(fd.get('email') || '').trim() });
    if(!r.ok){ msg('acct-m-login', r.j.error || 'Nem sikerült.', 'bad'); return; }
    show('link-sent');
  });
  form('acct-f-register', 'acct-m-register', async fd=>{
    if(!fd.get('consent')){ msg('acct-m-register', 'A regisztrációhoz pipáld be a nyilatkozatot.', 'bad'); return; }
    const email = String(fd.get('email') || '').trim();
    const r = await call({ action:'register', name: String(fd.get('name') || '').trim(), email, consent:true });
    if(!r.ok){ msg('acct-m-register', r.j.error || 'Nem sikerült a regisztráció.', 'bad'); return; }
    $('acct-registered-email').textContent = email;
    show('registered');
  });
  $('acct-pk-add') && $('acct-pk-add').addEventListener('click', ()=>addPasskey(false));
  $('acct-pk-add-phone') && $('acct-pk-add-phone').addEventListener('click', ()=>addPasskey(true));
  $('acct-pk-login') && $('acct-pk-login').addEventListener('click', loginWithPasskey);
  form('acct-f-delete', 'acct-m-delete', async fd=>{
    if(!fd.get('sure')){ msg('acct-m-delete', 'Pipáld be, hogy biztosan törölni szeretnéd.', 'bad'); return; }
    const r = await call({ action:'delete', confirmName: String(fd.get('confirmName') || '').trim() });
    if(!r.ok){ msg('acct-m-delete', r.j.error || 'Nem sikerült.', 'bad'); return; }
    [STATS_KEY, BASE_KEY, REV_KEY, OWNER_KEY, SETTINGS_MARK, 'picasso-name', 'picasso-push-sync'].forEach(ls.del);
    location.reload();
  });
  $('acct-btn-logout').addEventListener('click', async ()=>{
    $('acct-btn-logout').disabled = true;
    try{ if(statsDirty()) await syncStats(); await pushSettings(); await call({ action:'logout' }); }catch(e){}
    // a fiók statisztikája nem marad ezen az eszközön (közös gépen más ne lássa, és újra belépve ne számolódjon duplán)
    [STATS_KEY, BASE_KEY, REV_KEY, OWNER_KEY, SETTINGS_MARK, 'picasso-name'].forEach(ls.del);
    location.reload();
  });
  $('acct-btn-logout-all').addEventListener('click', async ()=>{
    const r = await call({ action:'logout-all' });
    msg('acct-m-profile', r.ok ? '✅ Minden más eszközről kiléptettünk.' : (r.j.error || 'Nem sikerült.'), r.ok ? 'ok' : 'bad');
  });
}

/** A levélből érkező linkek: ?fiok=1 (fiók ablak), ?uj=1 (épp most lépett be először ezen az eszközön: jelkulcs ajánlása). */
function handleUrl(){
  let u; try{ u = new URL(location.href); }catch(e){ return; }
  const f = u.searchParams.has('fiok'), fresh = u.searchParams.has('uj');
  ['fiok', 'uj', 'reset'].forEach(k=>u.searchParams.delete(k));
  if(!f && !fresh) return;
  try{ history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams : '') + u.hash); }catch(e){}
  open();
  if(user && fresh && !(user.passkeys || []).length && pkSupported()){
    msg('acct-m-profile', `Szia, ${user.name}! 👇 Adj hozzá egy jelkulcsot ezen az eszközön, és legközelebb ujjlenyomattal vagy arccal lépsz be.`, 'ok');
    const b = $('acct-pk-add'); if(b){ b.classList.add('pulse-cta'); try{ b.scrollIntoView({ block:'center' }); }catch(e){} }
  }
}

let accountsOn = false;   // v4.42: van-e fiókszolgáltatás (helyi próbánál nincs: ilyenkor senki sincs vendégnek jelölve)
let readyResolve; const ready = new Promise(r=>{ readyResolve = r; });
async function init(opts){
  storePalette();
  selfId = String(opts.selfId || '');
  hooks = opts.hooks || {};
  wire();
  paintHome();
  try{
    const r = await fetch(API, { credentials:'same-origin', cache:'no-store' });
    if(r.ok){ accountsOn = true; const j = await r.json(); if(j && j.user){ setUser(j.user); await fetchTicket(); if(pullSettings()){ location.reload(); return; } syncStats(); } }
    else if(r.status === 404){ const b = $('btn-account'); if(b) b.classList.add('hidden'); }   // a fiókszolgáltatás nincs telepítve (pl. helyi próba)
  }catch(e){ if(location.protocol === 'file:'){ const b = $('btn-account'); if(b) b.classList.add('hidden'); } }
  readyResolve();
  handleUrl();
  checkTypedName();
}

export const Account = {
  init, ready, open, close,
  get user(){ return user; },
  get accountsOff(){ return !accountsOn; },
  get ticket(){ return (user && ticket && ticketExp > Date.now()) ? ticket : ''; },
  onChange(f){ listeners.add(f); },
  verifyTicket, nameTaken, mayUse, nameProblem, syncStats, resetStats, fetchTicket
};
