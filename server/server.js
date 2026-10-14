// =====================================================================
// PIC-ASS-O játékszerver (az otthoni mini PC-n fut, 24/7)
//
// Mit csinál:
//   1. Szoba-továbbító (relay): a játékosok böngészője egyetlen WebSocket
//      kapcsolattal csatlakozik ide, és a szerver továbbítja az üzeneteket a
//      szobán belül. Nincs WebRTC, nincs TURN, nincs iPhone-os mikrofon-trükk.
//      A szerver CSAK annak küldi tovább az üzenetet, akinek szól — ha a
//      játék egy tippet csak a rajzolónak küld, más nem kapja meg.
//   2. Visszacsatlakozás: ha egy telefon lezár és megszakad a kapcsolata,
//      a szerver 60 mp-ig "megtartja" a helyét, és a közben érkezett
//      üzeneteket eltárolja. Feloldás után ugyanazzal az azonosítóval lép
//      vissza, mintha mi sem történt volna.
//   3. Szobalista: a nyitott szobák itt futnak össze, egy új látogató
//      azonnal megkapja az aktuális listát.
//   4. Ranglista: a játék végén a szobanyitó elküldi az eredményt, ebből
//      összesített ranglista készül (/ranglista oldal, /api/ranglista JSON).
//
// A szerver a szobakódot sem látja: a böngésző a kód hash-ével lép be.
// Indítás:  node server.js   (beállítások: környezeti változók, lásd lent)
// =====================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
// Melyik weboldalakról lehet csatlakozni. Vesszővel elválasztva; a
// "*.netlify.app" alak bármelyik netlify.app aloldalt engedi.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*.netlify.app,http://localhost,http://127.0.0.1')
  .split(',').map(s => s.trim()).filter(Boolean);

const RESUME_GRACE_MS = 60_000;      // ennyi ideig tartjuk meg egy megszakadt játékos helyét
const MAX_BUFFERED = 600;            // ennyi üzenetet tárolunk el neki közben
const MAX_PAYLOAD = 4 * 1024 * 1024; // egy üzenet max. mérete (a késői belépő teljes rajzot kap)
const MAX_ROOM_PEERS = 40;
const MAX_ROOMS = 500;
const DIR_TTL_MS = 30_000;           // ennyi ideig él egy szoba-hirdetés frissítés nélkül
const RATE_PER_SEC = 400;            // üzenet / mp / kapcsolat (rajzolásnál sok kicsi jön)
const MAX_RING_BYTES = 16 * 1024 * 1024; // játékosonként ennyi megőrzött üzenet fér el
const HEARTBEAT_MS = 5_000;          // ilyen sűrűn nézzük, él-e a kapcsolat (régen 20 mp volt)

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------------
// Állapot
// ---------------------------------------------------------------------
/** peerId -> { id, token, ws, room, ring[], outQ, inSeq, dropTimer, ip } */
const peers = new Map();
/** roomId -> Set(peerId) */
const rooms = new Map();
/** szobalista: kulcs -> { d, from, at } */
const directory = new Map();

function log(...a){ console.log(new Date().toISOString(), ...a); }
const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

function originAllowed(origin){
  if(!origin) return true;   // pl. curl / egészség-ellenőrzés
  let host, proto;
  try{ const u = new URL(origin); host = u.hostname; proto = u.protocol; }catch(e){ return false; }
  return ALLOWED_ORIGINS.some(rule => {
    if(rule === '*') return true;
    if(rule.startsWith('*.')) return host.endsWith(rule.slice(1)) && proto === 'https:';
    try{ const r = new URL(rule); return r.hostname === host && r.protocol === proto; }catch(e){ return rule === host; }
  });
}

// Szobaforgalom (msg / pjoin / pleave): minden üzenet sorszámot kap (q), és addig megőrizzük,
// amíg a böngésző nem jelzi, hogy megkapta. Így ha a kapcsolat "félholtan" elnyel pár üzenetet,
// újracsatlakozáskor ezek is megérkeznek, a böngésző pedig a sorszám alapján kiszűri a duplát.
function sendRaw(peer, obj){
  if(peer.room){
    const q = ++peer.outQ;
    // obj lehet már kész JSON-szöveg (a továbbított üzenet) vagy objektum
    const str = typeof obj === 'string' ? obj.replace(/}\s*$/, ',"q":' + q + '}') : JSON.stringify(Object.assign({}, obj, { q }));
    const rec = { q, str, sent: false };
    if(peer.ws && peer.ws.readyState === 1){ peer.ws.send(str); rec.sent = true; }
    if(rec.sent && !peer.v2) return;        // régi böngésző: nem nyugtáz, nem tartjuk meg
    peer.ring.push(rec); peer.ringBytes = (peer.ringBytes || 0) + str.length;
    while(peer.ring.length > MAX_BUFFERED || (peer.ringBytes > MAX_RING_BYTES && peer.ring.length > 1)){
      peer.ringBytes -= peer.ring.shift().str.length;
    }
  } else if(peer.ws && peer.ws.readyState === 1){
    peer.ws.send(JSON.stringify(obj));
  }
}
function ackRing(peer, r){
  if(typeof r !== 'number' || !Number.isFinite(r)) return;
  while(peer.ring.length && peer.ring[0].q <= r) peer.ringBytes -= peer.ring.shift().str.length;
}

function roomMembers(roomId){ return rooms.get(roomId) || new Set(); }

function leaveRoom(peer, why){
  const roomId = peer.room;
  if(!roomId) return;
  peer.room = null;
  peer.ring = []; peer.ringBytes = 0;
  const set = rooms.get(roomId);
  if(set){
    set.delete(peer.id);
    if(set.size === 0) rooms.delete(roomId);
    else set.forEach(id => { const p = peers.get(id); if(p) sendRaw(p, { t:'pleave', id: peer.id }); });
  }
  log('kilépés', peer.id.slice(0,6), why || '', 'szoba', roomId.slice(0,8), 'maradt', set ? set.size : 0);
}

function forget(peer, why){
  clearTimeout(peer.dropTimer);
  leaveRoom(peer, why);
  // a tőle származó szobahirdetések is mennek
  directory.forEach((e, k) => { if(e.from === peer.id){ directory.delete(k); broadcastDir({ code: e.d.code, id: e.d.id, removed: true, srv: 1 }, peer.id); } });
  peers.delete(peer.id);
}

function broadcastDir(d, fromId){
  const str = JSON.stringify({ t:'dir', d });
  peers.forEach(p => { if(p.id !== fromId && p.ws && p.ws.readyState === 1 && p.dirSub) p.ws.send(str); });
}

// ---------------------------------------------------------------------
// Ranglista (egyszerű JSON fájl — egy családi játékhoz bőven elég)
// ---------------------------------------------------------------------
const GAMES_FILE = path.join(DATA_DIR, 'games.json');
let games = [];
try{ games = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8')); if(!Array.isArray(games)) games = []; }catch(e){ games = []; }
let saveTimer = null;
function saveGames(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = GAMES_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(games), err => { if(!err) fs.rename(tmp, GAMES_FILE, () => {}); });
  }, 500);
}
const lastReportByRoom = new Map();

function nameKey(n){ return String(n).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim(); }

function recordGame(peer, rows){
  if(!peer.room) return 'nincs szobában';
  const members = roomMembers(peer.room);
  if(members.size < 2) return 'egyedül van';          // a szobanyitón kívül legalább 1 másik ember
  if(!Array.isArray(rows) || rows.length < 2 || rows.length > MAX_ROOM_PEERS) return 'hibás sorok';
  const last = lastReportByRoom.get(peer.room) || 0;
  if(Date.now() - last < 60_000) return 'túl gyakori';
  const clean = [];
  for(const r of rows){
    if(!r || !isStr(r.name, 40)) return 'hibás név';
    const score = Number(r.score);
    if(!Number.isFinite(score) || score < 0 || score > 100000) return 'hibás pont';
    clean.push({ name: r.name.trim(), score: Math.round(score) });
  }
  lastReportByRoom.set(peer.room, Date.now());
  games.push({ at: Date.now(), players: clean });
  if(games.length > 20000) games.splice(0, games.length - 20000);
  saveGames();
  log('játék rögzítve', clean.map(r => `${r.name}:${r.score}`).join(', '));
  return 'ok';
}

function leaderboard(days){
  const since = days ? Date.now() - days * 86400_000 : 0;
  const by = new Map();
  for(const g of games){
    if(g.at < since) continue;
    const top = Math.max(...g.players.map(p => p.score));
    for(const p of g.players){
      const k = nameKey(p.name);
      let e = by.get(k);
      if(!e){ e = { name: p.name, games: 0, wins: 0, total: 0, best: 0, last: 0 }; by.set(k, e); }
      e.games++; e.total += p.score; e.best = Math.max(e.best, p.score);
      if(p.score === top && top > 0) e.wins++;
      if(g.at >= e.last){ e.last = g.at; e.name = p.name; }
    }
  }
  return [...by.values()]
    .map(e => ({ ...e, avg: Math.round(e.total / e.games) }))
    .sort((a, b) => b.wins - a.wins || b.avg - a.avg || b.games - a.games);
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }

function leaderboardPage(days){
  const rows = leaderboard(days);
  const recent = games.slice(-15).reverse();
  const tab = (d, label) => `<a href="?napok=${d}" class="${(days||0) === d ? 'on' : ''}">${label}</a>`;
  const fmt = ts => new Date(ts).toLocaleString('hu-HU', { timeZone:'Europe/Budapest', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PIC-ASS-O ranglista</title>
<style>
  :root{ --bg:#16302A; --card:#1f3d35; --chalk:#F4F1E8; --dim:#b9c7bf; --yellow:#F5D76E; }
  *{ box-sizing:border-box; }
  body{ margin:0; background:var(--bg); color:var(--chalk); font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; padding:20px 16px 40px; }
  main{ max-width:680px; margin:0 auto; }
  h1{ font-size:1.7rem; margin:0 0 4px; } h2{ font-size:1.1rem; margin:28px 0 8px; color:var(--yellow); }
  .sub{ color:var(--dim); margin:0 0 16px; }
  .tabs{ display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  .tabs a{ color:var(--chalk); text-decoration:none; padding:6px 12px; border-radius:999px; background:var(--card); font-size:.9rem; }
  .tabs a.on{ background:var(--yellow); color:#16302A; font-weight:600; }
  table{ width:100%; border-collapse:collapse; background:var(--card); border-radius:12px; overflow:hidden; }
  th,td{ padding:9px 10px; text-align:right; font-variant-numeric:tabular-nums; }
  th{ font-size:.75rem; text-transform:uppercase; letter-spacing:.04em; color:var(--dim); font-weight:600; }
  td:nth-child(2), th:nth-child(2){ text-align:left; }
  tr+tr td{ border-top:1px solid rgba(255,255,255,.07); }
  .rank{ width:2.2em; color:var(--dim); }
  .g{ background:var(--card); border-radius:12px; padding:10px 12px; margin-bottom:8px; font-size:.92rem; }
  .g time{ color:var(--dim); font-size:.8rem; display:block; margin-bottom:2px; }
  .empty{ color:var(--dim); background:var(--card); padding:16px; border-radius:12px; }
  @media (max-width:420px){ .hide-s{ display:none; } th,td{ padding:8px 6px; } }
</style></head><body><main>
<h1>🏆 PIC-ASS-O ranglista</h1>
<p class="sub">Minden befejezett, legalább kétfős játék számít. A sorrend: győzelmek, aztán átlagpont.</p>
<nav class="tabs">${tab(0,'Mindig')}${tab(30,'Utolsó 30 nap')}${tab(7,'Utolsó 7 nap')}</nav>
${rows.length ? `<table><thead><tr><th class="rank">#</th><th>Név</th><th>Győzelem</th><th>Játék</th><th>Átlag</th><th class="hide-s">Legjobb</th></tr></thead><tbody>
${rows.map((r, i) => `<tr><td class="rank">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</td><td>${escapeHtml(r.name)}</td><td>${r.wins}</td><td>${r.games}</td><td>${r.avg}</td><td class="hide-s">${r.best}</td></tr>`).join('')}
</tbody></table>` : `<p class="empty">Még nincs befejezett játék ebben az időszakban.</p>`}
<h2>Legutóbbi játékok</h2>
${recent.length ? recent.map(g => { const s = [...g.players].sort((a,b)=>b.score-a.score); return `<div class="g"><time>${fmt(g.at)}</time>${s.map((p,i)=>`${i===0?'👑 ':''}<b>${escapeHtml(p.name)}</b> ${p.score}`).join(' · ')}</div>`; }).join('') : '<p class="empty">Még nincs.</p>'}
</main></body></html>`;
}

// ---------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const origin = req.headers.origin;
  if(origin && originAllowed(origin)){
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if(url.pathname === '/api/health'){
    res.writeHead(200, { 'content-type':'application/json', 'cache-control':'no-store' });
    res.end(JSON.stringify({ ok:true, peers: peers.size, rooms: rooms.size, games: games.length }));
    return;
  }
  if(url.pathname === '/api/ranglista'){
    const days = Math.max(0, Math.min(3650, Number(url.searchParams.get('napok')) || 0));
    res.writeHead(200, { 'content-type':'application/json', 'cache-control':'no-store' });
    res.end(JSON.stringify(leaderboard(days)));
    return;
  }
  if(url.pathname === '/ranglista' || url.pathname === '/'){
    const days = [0, 7, 30].includes(Number(url.searchParams.get('napok'))) ? Number(url.searchParams.get('napok')) : 0;
    res.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store',
      'x-content-type-options':'nosniff', 'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'" });
    res.end(leaderboardPage(days));
    return;
  }
  res.writeHead(404, { 'content-type':'text/plain; charset=utf-8' });
  res.end('Nincs ilyen oldal.');
});

// ---------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_PAYLOAD, perMessageDeflate: { threshold: 2048 } });

wss.on('connection', (ws, req) => {
  if(!originAllowed(req.headers.origin)){ ws.close(4003, 'origin'); return; }
  const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  let peer = null;
  let tokens = RATE_PER_SEC, lastRefill = Date.now();
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (buf, isBinary) => {
    // egyszerű sebességkorlát
    const now = Date.now();
    tokens = Math.min(RATE_PER_SEC, tokens + (now - lastRefill) / 1000 * RATE_PER_SEC);
    lastRefill = now;
    if(--tokens < 0){ return; }
    if(isBinary) return;
    let m; try{ m = JSON.parse(buf.toString()); }catch(e){ return; }
    if(!m || typeof m !== 'object') return;

    // --- bemutatkozás (új vagy visszatérő) ---
    if(m.t === 'hello'){
      if(peer) return;
      if(!isStr(m.id, 64) || !isStr(m.token, 128)) { ws.close(4000, 'hello'); return; }
      const v2 = m.v === 2;   // a böngésző ismeri a sorszámozást
      const old = peers.get(m.id);
      if(old){
        if(old.token !== m.token){ ws.close(4001, 'azonosító foglalt'); return; }
        // visszatérés: régi kapcsolat le, a félretett üzenetek mennek
        clearTimeout(old.dropTimer);
        if(old.ws && old.ws !== ws){ try{ old.ws.close(4002, 'átvéve'); }catch(e){} }
        old.ws = ws; old.ip = ip; old.dirSub = !!m.dir; old.v2 = v2;
        peer = old;
        const resumedRoom = peer.room && m.room === peer.room;
        ws.send(JSON.stringify({ t:'welcome', v:2, resumed: !!resumedRoom, online: peers.size, s: peer.inSeq,
          peers: resumedRoom ? [...roomMembers(peer.room)].filter(id => id !== peer.id) : [] }));
        if(!resumedRoom && peer.room) leaveRoom(peer, 'más szobával tért vissza');
        // ami nem biztosan ért át: újra (az új böngésző megmondja, meddig kapta meg; a régi csak a ki nem küldötteket kapja)
        if(v2) ackRing(peer, Number(m.r));
        const again = peer.ring.filter(x => v2 || !x.sent);
        again.forEach(x => { ws.send(x.str); x.sent = true; });
        log('visszatért', peer.id.slice(0,6), resumedRoom ? `(${again.length} üzenet újra)` : '');
      } else {
        peer = { id: m.id, token: m.token, ws, room: null, ring: [], ringBytes: 0, outQ: 0, inSeq: 0, v2, dropTimer: null, ip, dirSub: !!m.dir };
        peers.set(peer.id, peer);
        ws.send(JSON.stringify({ t:'welcome', v:2, fresh:true, resumed:false, peers: [], online: peers.size, s: 0 }));
      }
      if(peer.dirSub){
        const now2 = Date.now();
        directory.forEach((e, k) => { if(now2 - e.at > DIR_TTL_MS) directory.delete(k); else if(e.from !== peer.id) ws.send(JSON.stringify({ t:'dir', d: e.d })); });
      }
      return;
    }
    if(!peer || peer.ws !== ws) return;
    ws.isAlive = true;   // bármilyen üzenet bizonyítja, hogy él a kapcsolat

    switch(m.t){
      case 'join': {
        if(!isStr(m.room, 128)) return;
        if(peer.room === m.room) return;
        if(peer.room) leaveRoom(peer, 'új szoba');
        let set = rooms.get(m.room);
        if(!set){
          if(rooms.size >= MAX_ROOMS){ ws.send(JSON.stringify({ t:'error', e:'full' })); return; }
          set = new Set(); rooms.set(m.room, set);
        }
        if(set.size >= MAX_ROOM_PEERS){ ws.send(JSON.stringify({ t:'error', e:'roomfull' })); return; }
        const others = [...set];
        set.add(peer.id);
        peer.room = m.room;
        ws.send(JSON.stringify({ t:'joined', room: m.room, peers: others }));
        others.forEach(id => { const p = peers.get(id); if(p) sendRaw(p, { t:'pjoin', id: peer.id }); });
        log('belépés', peer.id.slice(0,6), 'szoba', m.room.slice(0,8), 'létszám', set.size);
        return;
      }
      case 'leave':
        leaveRoom(peer, 'kilépett');
        return;
      case 'send': {
        if(!peer.room || !isStr(m.a, 32)) return;
        if(typeof m.s === 'number'){            // újraküldött példány, amit már továbbítottunk
          if(m.s <= peer.inSeq) return;
          peer.inSeq = m.s;
        }
        const set = roomMembers(peer.room);
        const out = JSON.stringify({ t:'msg', a: m.a, d: m.d, f: peer.id });
        if(Array.isArray(m.to)){
          m.to.slice(0, MAX_ROOM_PEERS).forEach(id => {
            if(typeof id === 'string' && id !== peer.id && set.has(id)){ const p = peers.get(id); if(p) sendRaw(p, out); }
          });
        } else {
          set.forEach(id => { if(id !== peer.id){ const p = peers.get(id); if(p) sendRaw(p, out); } });
        }
        return;
      }
      case 'dir': {
        const d = m.d;
        if(!d || typeof d !== 'object') return;
        const key = String(d.code || d.id || '').slice(0, 64);
        if(!key) return;
        const str = JSON.stringify(d);
        if(str.length > 4000) return;
        const tagged = Object.assign({}, d, { srv: 1 });
        const prev = directory.get(key);
        if(d.removed){ if(prev && prev.from !== peer.id) return; directory.delete(key); }
        else {
          if(prev && prev.from !== peer.id && Date.now() - prev.at < DIR_TTL_MS) return;   // más szobáját nem írhatja felül
          if(directory.size > 300 && !prev) return;
          directory.set(key, { d: tagged, from: peer.id, at: Date.now() });
        }
        broadcastDir(tagged, peer.id);
        return;
      }
      case 'dirsync': {
        const now2 = Date.now();
        directory.forEach((e) => { if(now2 - e.at <= DIR_TTL_MS && e.from !== peer.id) ws.send(JSON.stringify({ t:'dir', d: e.d })); });
        return;
      }
      case 'result': {
        const r = recordGame(peer, m.rows);
        ws.send(JSON.stringify({ t:'resultack', r }));
        return;
      }
      case 'bye':
        forget(peer, 'bezárta az oldalt');
        try{ ws.close(1000); }catch(e){}
        return;
      case 'ping':
        ackRing(peer, Number(m.r));
        ws.send(JSON.stringify({ t:'pong', s: peer.inSeq }));
        return;
    }
  });

  ws.on('close', () => {
    if(!peer || peer.ws !== ws || !peers.has(peer.id)) return;
    peer.ws = null;
    // nem dobjuk ki azonnal: lehet, hogy csak lezárt a telefon
    clearTimeout(peer.dropTimer);
    peer.dropTimer = setTimeout(() => { if(!peer.ws) forget(peer, 'nem tért vissza'); }, peer.room ? RESUME_GRACE_MS : 5000);
  });
  ws.on('error', () => {});
});

// halott kapcsolatok kiszűrése (a mobilhálózat néha szó nélkül eldobja). 5 mp-enként nézzük,
// így egy "félholt" kapcsolatot 5–10 mp alatt lezárunk, és onnantól a neki szóló üzeneteket
// félretesszük, amíg vissza nem tér (régen ez 20–40 mp volt, közben az üzenetek elvesztek).
setInterval(() => {
  wss.clients.forEach(ws => {
    if(!ws.isAlive){ try{ ws.terminate(); }catch(e){} return; }
    ws.isAlive = false;
    try{ ws.ping(); }catch(e){}
  });
}, HEARTBEAT_MS);
setInterval(() => {
  const now = Date.now();
  directory.forEach((e, k) => { if(now - e.at > DIR_TTL_MS) directory.delete(k); });
  const online = JSON.stringify({ t:'online', n: peers.size });
  peers.forEach(p => { if(p.ws && p.ws.readyState === 1) p.ws.send(online); });
  lastReportByRoom.forEach((t, k) => { if(now - t > 3600_000) lastReportByRoom.delete(k); });
}, 20_000);

server.listen(PORT, () => log(`PIC-ASS-O szerver fut: http://0.0.0.0:${PORT}  (engedélyezett oldalak: ${ALLOWED_ORIGINS.join(', ')})`));
process.on('SIGTERM', () => { saveGames(); setTimeout(() => process.exit(0), 700); });
