// PIC-ASS-O — fiók a böngészőben (v4.40)
// Belépés / regisztráció ablak, névigazoló jegy, a regisztrált nevek védelme,
// valamint a statisztika és a beállítások szinkronja az eszközök között.
//
// Biztonság: a munkamenet-kulcs HttpOnly sütiben van, ez a kód soha nem látja.
// A jelszó csak a belépés / regisztráció kérésében utazik (HTTPS-en), a
// böngésző tárhelyére nem kerül. Minden szerverválasz szövegként (textContent)
// kerül a lapra, soha nem HTML-ként.
import { nameKey, isPlainObject } from './rules.js';

const API = '/.netlify/functions/account';
const SUBSCRIBE_URL = '/.netlify/functions/subscribe';
const STATS_KEY = 'picasso-stats', BASE_KEY = 'picasso-stats-base', REV_KEY = 'picasso-stats-rev', OWNER_KEY = 'picasso-stats-owner';
const SETTINGS_MAP = { avatar: 'picasso-avatar-color', dark: 'picasso-dark-mode', theme: 'picasso-theme', sound: 'picasso-master-sound', replay: 'picasso-replay-speed' };
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

async function call(body, opts = {}){
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
  for(const [k, key] of Object.entries(SETTINGS_MAP)){ const v = ls.get(key); if(typeof v === 'string' && v.length && v.length <= 40) o[k] = v; }
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
/** Belépéskor / induláskor: ha a fiókban más beállítás van, és itt közben nem változott, azt vesszük át. */
function pullSettings(){
  if(!user) return false;
  const remote = isPlainObject(user.settings) ? user.settings : {};
  const cur = localSettings(), mark = ls.get(SETTINGS_MARK);
  if(!Object.keys(remote).length || sj(remote) === sj(cur)){ if(Object.keys(remote).length) ls.set(SETTINGS_MARK, sj(remote)); else pushSettings(); return false; }
  if(mark && mark !== sj(cur)){ pushSettings(); return false; }       // itt változott utoljára: ez megy fel
  for(const [k, key] of Object.entries(SETTINGS_MAP)){ if(typeof remote[k] === 'string') ls.set(key, remote[k]); }
  ls.set(SETTINGS_MARK, sj(remote));
  let once = false; try{ once = sessionStorage.getItem('picasso-settings-reload') === '1'; sessionStorage.setItem('picasso-settings-reload', '1'); }catch(e){ once = true; }
  return !once;      // az új beállítások egy újratöltéssel lépnek életbe (legfeljebb egyszer)
}
setInterval(()=>pushSettings(), 30_000);

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
let view = 'login', resetToken = '', totpSecret = '';
const VIEWS = ['login','register','registered','forgot','forgot-sent','reset','profile','password','totp-pw','totp-scan','totp-codes','totp-off','delete'];
function show(v){
  view = v;
  VIEWS.forEach(x=>{ const el = $('acct-v-' + x); if(el) el.classList.toggle('hidden', x !== v); });
  document.querySelectorAll('#account-overlay .acct-msg').forEach(el=>{ el.textContent = ''; el.className = 'acct-msg'; });
  document.querySelectorAll('#account-overlay input[type=password], #account-overlay input[inputmode=numeric]').forEach(el=>{ el.value = ''; });
  if(v === 'profile') paintProfile();
  if(v === 'login'){ const c = $('acct-login-code-row'); if(c) c.classList.add('hidden'); }
  const first = $('acct-v-' + v) && $('acct-v-' + v).querySelector('input:not([type=checkbox]),button');
  if(first){ try{ first.focus(); }catch(e){} }
}
function open(v){
  const ov = $('account-overlay');
  if(!ov) return;
  ov.classList.remove('hidden');
  show(v || (user ? 'profile' : 'login'));
}
function close(){ const ov = $('account-overlay'); if(ov) ov.classList.add('hidden'); totpSecret = ''; const q = $('acct-totp-qr'); if(q) q.textContent = ''; const s = $('acct-totp-secret'); if(s) s.textContent = ''; const b = $('acct-backup-list'); if(b) b.textContent = ''; }
function msg(id, text, kind){ const el = $(id); if(el){ el.textContent = text || ''; el.className = 'acct-msg' + (kind ? ' ' + kind : ''); } }
function paintProfile(){
  if(!user){ show('login'); return; }
  $('acct-p-name').textContent = user.name;
  $('acct-p-email').textContent = user.email;
  $('acct-p-since').textContent = user.createdAt ? new Date(user.createdAt).toLocaleDateString('hu-HU', { year:'numeric', month:'long', day:'numeric' }) : '';
  $('acct-p-2fa').textContent = user.twofa ? `✅ Bekapcsolva (${N(user.backupLeft)} tartalék kód maradt)` : 'Nincs bekapcsolva';
  $('acct-btn-2fa').textContent = user.twofa ? 'Kikapcsolás' : 'Bekapcsolás';
  const n = $('acct-p-notify'); if(n) n.checked = !!user.notifyEmail;
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
function loadQr(){
  return new Promise((res, rej)=>{
    if(window.qrcode) return res(window.qrcode);
    const s = document.createElement('script');
    s.src = 'vendor/qrcode.js'; s.onload = ()=>window.qrcode ? res(window.qrcode) : rej(new Error('qr')); s.onerror = ()=>rej(new Error('qr'));
    document.head.appendChild(s);
  });
}
async function drawQr(text){
  const box = $('acct-totp-qr');
  box.textContent = '';
  try{
    const qrcode = await loadQr();
    const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
    const n = qr.getModuleCount(), scale = 5, pad = 4;
    const cv = document.createElement('canvas'); cv.width = cv.height = (n + pad * 2) * scale;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#000';
    for(let r = 0; r < n; r++) for(let c = 0; c < n; c++) if(qr.isDark(r, c)) ctx.fillRect((c + pad) * scale, (r + pad) * scale, scale, scale);
    cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'QR-kód a hitelesítő alkalmazáshoz');
    box.appendChild(cv);
  }catch(e){ box.textContent = 'A QR-kódot nem sikerült kirajzolni — írd be kézzel az alábbi kulcsot.'; }
}

function wire(){
  const ov = $('account-overlay');
  if(!ov) return;
  $('btn-account') && $('btn-account').addEventListener('click', ()=>{ try{ hooks.click && hooks.click(); }catch(e){} open(); });
  $('account-close-btn').addEventListener('click', close);
  ov.addEventListener('click', e=>{ if(e.target === ov && !['totp-codes','registered'].includes(view)) close(); });
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && !ov.classList.contains('hidden') && view !== 'totp-codes') close(); });
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
    const body = { action:'login', email: String(fd.get('email') || '').trim(), password: String(fd.get('password') || '') };
    const code = String(fd.get('code') || '').trim();
    if(code) body.code = code;
    const r = await call(body);
    if(r.j.need2fa){
      $('acct-login-code-row').classList.remove('hidden');
      msg('acct-m-login', r.ok ? 'Írd be a hitelesítő alkalmazásod 6 jegyű kódját (vagy egy tartalék kódot).' : (r.j.error || 'Hibás kód.'), r.ok ? '' : 'bad');
      $('acct-login-code').value = ''; $('acct-login-code').focus();
      return;
    }
    if(!r.ok){ msg('acct-m-login', r.j.error || 'Nem sikerült belépni.', 'bad'); return; }
    await afterLogin(r.j.user);
    show('profile');
    msg('acct-m-profile', `Szia, ${user.name}! Beléptél.`, 'ok');
  });
  form('acct-f-register', 'acct-m-register', async fd=>{
    const password = String(fd.get('password') || '');
    if(password !== String(fd.get('password2') || '')){ msg('acct-m-register', 'A két jelszó nem egyezik.', 'bad'); return; }
    if(!fd.get('consent')){ msg('acct-m-register', 'A regisztrációhoz pipáld be a nyilatkozatot.', 'bad'); return; }
    const email = String(fd.get('email') || '').trim();
    const r = await call({ action:'register', name: String(fd.get('name') || '').trim(), email, password, consent:true });
    if(!r.ok){ msg('acct-m-register', r.j.error || 'Nem sikerült a regisztráció.', 'bad'); return; }
    $('acct-registered-email').textContent = email;
    show('registered');
  });
  form('acct-f-forgot', 'acct-m-forgot', async fd=>{
    const r = await call({ action:'forgot', email: String(fd.get('email') || '').trim() });
    if(!r.ok){ msg('acct-m-forgot', r.j.error || 'Nem sikerült.', 'bad'); return; }
    show('forgot-sent');
  });
  form('acct-f-reset', 'acct-m-reset', async fd=>{
    const password = String(fd.get('password') || '');
    if(password !== String(fd.get('password2') || '')){ msg('acct-m-reset', 'A két jelszó nem egyezik.', 'bad'); return; }
    const r = await call({ action:'reset', token: resetToken, password });
    if(!r.ok){ msg('acct-m-reset', r.j.error || 'Nem sikerült.', 'bad'); return; }
    resetToken = '';
    show('login');
    msg('acct-m-login', '✅ Az új jelszavad beállítva. Most lépj be vele.', 'ok');
  });
  form('acct-f-password', 'acct-m-password', async fd=>{
    const np = String(fd.get('newPassword') || '');
    if(np !== String(fd.get('password2') || '')){ msg('acct-m-password', 'A két új jelszó nem egyezik.', 'bad'); return; }
    const r = await call({ action:'password', password: String(fd.get('password') || ''), newPassword: np });
    if(!r.ok){ msg('acct-m-password', r.j.error || 'Nem sikerült.', 'bad'); return; }
    show('profile'); msg('acct-m-profile', '✅ A jelszavad megváltozott. A többi eszközödről kiléptettünk.', 'ok');
  });
  $('acct-btn-2fa').addEventListener('click', ()=>show(user && user.twofa ? 'totp-off' : 'totp-pw'));
  form('acct-f-totp-pw', 'acct-m-totp-pw', async fd=>{
    const r = await call({ action:'totp-begin', password: String(fd.get('password') || '') });
    if(!r.ok){ msg('acct-m-totp-pw', r.j.error || 'Nem sikerült.', 'bad'); return; }
    totpSecret = r.j.secret;
    show('totp-scan');
    $('acct-totp-secret').textContent = String(totpSecret).replace(/(.{4})/g, '$1 ').trim();
    const link = $('acct-totp-link'); if(link) link.href = r.j.uri;
    drawQr(r.j.uri);
  });
  form('acct-f-totp-scan', 'acct-m-totp-scan', async fd=>{
    const r = await call({ action:'totp-enable', code: String(fd.get('code') || '').trim() });
    if(!r.ok){ msg('acct-m-totp-scan', r.j.error || 'Nem sikerült.', 'bad'); return; }
    if(user){ user.twofa = true; user.backupLeft = (r.j.backup || []).length; }
    show('totp-codes');
    const list = $('acct-backup-list'); list.textContent = '';
    (r.j.backup || []).forEach(c=>{ const li = document.createElement('li'); li.textContent = c; list.appendChild(li); });
  });
  $('acct-backup-copy').addEventListener('click', async ()=>{
    const text = [...$('acct-backup-list').children].map(li=>li.textContent).join('\n');
    try{ await navigator.clipboard.writeText(text); msg('acct-m-totp-codes', '📋 Kimásolva. Tedd biztos helyre (pl. jelszókezelőbe)!', 'ok'); }
    catch(e){ msg('acct-m-totp-codes', 'Nem sikerült a másolás — írd le kézzel a kódokat.', 'bad'); }
  });
  form('acct-f-totp-off', 'acct-m-totp-off', async fd=>{
    const r = await call({ action:'totp-disable', password: String(fd.get('password') || ''), code: String(fd.get('code') || '').trim() });
    if(!r.ok){ msg('acct-m-totp-off', r.j.error || 'Nem sikerült.', 'bad'); return; }
    if(user){ user.twofa = false; user.backupLeft = 0; }
    show('profile'); msg('acct-m-profile', 'A kétfaktoros belépés kikapcsolva.', 'ok');
  });
  form('acct-f-delete', 'acct-m-delete', async fd=>{
    if(!fd.get('sure')){ msg('acct-m-delete', 'Pipáld be, hogy biztosan törölni szeretnéd.', 'bad'); return; }
    const r = await call({ action:'delete', password: String(fd.get('password') || '') });
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

/** A levélből érkező linkek: ?reset=KULCS (új jelszó) és ?fiok=1 (belépés ablak). A kulcs azonnal kikerül a címsorból. */
function handleUrl(){
  let u; try{ u = new URL(location.href); }catch(e){ return; }
  const t = u.searchParams.get('reset'), f = u.searchParams.has('fiok');
  if(!t && !f) return;
  u.searchParams.delete('reset'); u.searchParams.delete('fiok');
  try{ history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams : '') + u.hash); }catch(e){}
  if(t && /^[A-Za-z0-9_-]{20,80}$/.test(t)){ resetToken = t; open('reset'); }
  else if(f) open();
}

let readyResolve; const ready = new Promise(r=>{ readyResolve = r; });
async function init(opts){
  selfId = String(opts.selfId || '');
  hooks = opts.hooks || {};
  wire();
  paintHome();
  try{
    const r = await fetch(API, { credentials:'same-origin', cache:'no-store' });
    if(r.ok){ const j = await r.json(); if(j && j.user){ setUser(j.user); await fetchTicket(); if(pullSettings()){ location.reload(); return; } syncStats(); } }
    else if(r.status === 404){ const b = $('btn-account'); if(b) b.classList.add('hidden'); }   // a fiókszolgáltatás nincs telepítve (pl. helyi próba)
  }catch(e){ if(location.protocol === 'file:'){ const b = $('btn-account'); if(b) b.classList.add('hidden'); } }
  readyResolve();
  handleUrl();
  checkTypedName();
}

export const Account = {
  init, ready, open, close,
  get user(){ return user; },
  get ticket(){ return (user && ticket && ticketExp > Date.now()) ? ticket : ''; },
  onChange(f){ listeners.add(f); },
  verifyTicket, nameTaken, mayUse, nameProblem, syncStats, resetStats, fetchTicket
};
