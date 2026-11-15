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
//   4. Ranglista: a játék végén minden játékos elküldi az eredményt; csak a
//      többség által egyezően megerősített eredmény kerül be (v4.11)
//      (/ranglista oldal, /api/ranglista JSON). v4.40: a ranglistán csak
//      regisztrált (fiókkal igazolt) játékosok szerepelnek.
//   5. Névvédelem (v4.40): regisztrált játékos nevével csak a fiók gazdája
//      léphet be — a böngésző a Netlify-on kapott, aláírt névigazoló jegyet
//      mutatja be, a szerver a nyilvános kulccsal ellenőrzi.
//
// A szerver a szobakódot sem látja: a böngésző a kód lassított (PBKDF2)
// lenyomatával lép be. Az üzenetek TARTALMÁT viszont látja (továbbítja) —
// nincs végpontok közötti titkosítás, ezt az adatvédelmi tájékoztató is mondja.
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
// Melyik weboldalakról lehet csatlakozni. Vesszővel elválasztva.
// A "*" kezdetű szabály végződésre illeszt, csak https-en: a
// "*--pic-ass-o.netlify.app" a Netlify ág-előnézeteket (pl. test--pic-ass-o)
// engedi, de MÁS netlify.app oldalt nem (v4.11: régen az összeset engedte).
// v4.33: csak a test ág címe. A régi production (pic-ass-o.netlify.app, v4.13)
// és a régi deployok állandó címei (<azonosító>--pic-ass-o.netlify.app) már
// javított hibákat (pl. a titkos szó kiszivárgását) hordoznak, ezért nem
// csatlakozhatnak ugyanabba a játékba. Más cím: ALLOWED_ORIGINS környezeti változó.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://test--pic-ass-o.netlify.app,http://localhost,http://127.0.0.1')
  .split(',').map(s => s.trim()).filter(Boolean);
// Origin nélküli WebSocket (nem böngésző) alapból tiltva; teszthez: ALLOW_NO_ORIGIN=1
const ALLOW_NO_ORIGIN = process.env.ALLOW_NO_ORIGIN === '1';

const RESUME_GRACE_MS = 60_000;      // ennyi ideig tartjuk meg egy megszakadt játékos helyét
const MAX_BUFFERED = 600;            // ennyi üzenetet tárolunk el neki közben
const MAX_PAYLOAD = 2 * 1024 * 1024; // egy üzenet max. mérete (a késői belépő teljes rajzot kap)
const MAX_ROOM_PEERS = 40;
const MAX_ROOMS = 500;
const DIR_TTL_MS = 30_000;           // ennyi ideig él egy szoba-hirdetés frissítés nélkül
const RATE_PER_SEC = 200;            // üzenet / mp / kapcsolat (rajzolásnál sok kicsi jön)
const RATE_BURST = 600;              // v4.30: egyszeri löket (újracsatlakozáskor a böngésző akár 400 üzenetet küld újra)
const THROTTLE_CLOSE_MAX = 3;        // v4.30: percenként legfeljebb ennyiszer bontunk túlterhelés miatt (utána csak eldobunk)
// v4.11: bájtalapú korlát is — a beküldött és a szobába továbbított forgalomra
const BYTES_PER_SEC = 512 * 1024;    // tartós beküldés / kapcsolat
const BYTES_BURST = 6 * 1024 * 1024; // egyszeri löket (pl. teljes rajz egy késői belépőnek)
const FANOUT_BYTES_PER_SEC = 4 * 1024 * 1024;   // ennyit továbbíthat a szerver egy küldő nevében mp-enként
const FANOUT_BURST = 24 * 1024 * 1024;
const MAX_WS_BUFFER = 8 * 1024 * 1024;           // ha egy lassú kliens kimenő puffere ennél nagyobb, várunk
const MAX_CONN_PER_IP = 40;                      // egyszerre ennyi kapcsolat egy IP-ről (egy család bőven elfér)
const MAX_RING_BYTES = 16 * 1024 * 1024; // játékosonként ennyi megőrzött üzenet fér el
const MAX_RING_TOTAL = 96 * 1024 * 1024; // audit: az összes megőrzött üzenet együtt (a konténer 512 MB)
const KICK_BAN_MS = 24 * 3600_000;      // v4.43: a kirúgott ennyi ideig nem léphet vissza abba a szobába — más névvel, újratöltve, másik böngészőből sem
// v4.43: szoba -> kitiltások. Külön a szoba adataitól, mert a szoba üresen egy pillanatra megszűnhet (a tiltás akkor is marad).
const kickBans = new Map();   // roomId -> { ips: Map(ip -> lejárat), devs: Map, uids: Map, peers: Set, ownerIps: Set }
function kickBanOf(roomId, create){
  let b = kickBans.get(roomId);
  if(!b && create){
    if(kickBans.size > 2000){ const now = Date.now(); for(const [k, v] of kickBans) if(v.until < now) kickBans.delete(k); }
    b = { ips: new Map(), devs: new Map(), uids: new Map(), peers: new Set(), until: 0 }; kickBans.set(roomId, b);
  }
  return b || null;
}
function isKicked(roomId, peer, ownerIp){
  const b = kickBans.get(roomId), now = Date.now();
  if(!b) return false;
  if(b.until < now){ kickBans.delete(roomId); return false; }
  const hit = (map, k) => k && (map.get(k) || 0) > now;
  // az IP-tiltás nem vonatkozik arra, aki a szobanyitóval egy hálózaton van (különben a szobanyitó sem jöhetne vissza egy újratöltés után)
  return b.peers.has(peer.id) || hit(b.devs, peer.dev) || (peer.acct && hit(b.uids, peer.acct.uid)) || (peer.ip !== ownerIp && hit(b.ips, peer.ip));
}
const HEARTBEAT_MS = 5_000;
// v4.32: játékon belüli akciók korlátja (üzenet / időablak / küldő). A böngészők
// maguk is korlátoznak (szigorúbban), ide csak egy módosított kliens áradata jut el:
// a felesleget a szerver eldobja, és naplózza (a tartalmat nem).
const ACTION_LIMITS = { chat: [10, 10_000], chatreact: [15, 10_000], greact: [15, 10_000], reaction: [6, 10_000], guess: [20, 8_000], typing: [30, 10_000] };          // ilyen sűrűn nézzük, él-e a kapcsolat (régen 20 mp volt)

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------------
// Állapot
// ---------------------------------------------------------------------
/** peerId -> { id, token, ws, room, ring[], outQ, inSeq, dropTimer, ip } */
const peers = new Map();
/** roomId -> Set(peerId) */
const rooms = new Map();
/** roomId -> { createdAt, ever:Set(peerId), ips:Set } — a ranglista-ellenőrzéshez */
const roomInfo = new Map();
/** ip -> élő kapcsolatok száma */
const connPerIp = new Map();
/** szobalista: kulcs -> { d, from, at } */
const directory = new Map();

function log(...a){ console.log(new Date().toISOString(), ...a); }
const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
// v4.30: csak akkor küldünk, ha a kliens kimenő puffere nincs tele (lassú telefon ne tömje a memóriát)
const canSend = ws => ws && ws.readyState === 1 && ws.bufferedAmount < MAX_WS_BUFFER;

// v4.12: a továbbító fejlécekben csak akkor bízunk, ha a kérés helyi
// proxyból (Tailscale Funnel / serve a gépen) jön; ilyenkor is a LEGUTOLSÓ
// értéket vesszük, mert azt a proxy írta, az elejét a kliens is kitalálhatja.
function clientIp(req){
  const sock = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const local = sock === '127.0.0.1' || sock === '::1' || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(sock) || sock.startsWith('fd7a:115c:a1e0');
  if(local){
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
    if(xff.length) return xff[xff.length - 1];
  }
  return sock || 'x';
}

function originAllowed(origin, forWs){
  if(!origin) return !forWs || ALLOW_NO_ORIGIN;   // curl / egészség-ellenőrzés: csak HTTP-n
  let host, proto;
  let port;
  try{ const u = new URL(origin); host = u.hostname; proto = u.protocol; port = u.port; }catch(e){ return false; }
  return ALLOWED_ORIGINS.some(rule => {
    if(rule === '*') return true;
    if(rule.startsWith('*')) return host.endsWith(rule.slice(1)) && proto === 'https:' && !port;
    try{ const r = new URL(rule); return r.hostname === host && r.protocol === proto && (r.port === port || r.hostname === 'localhost' || r.hostname === '127.0.0.1'); }catch(e){ return false; }
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
    // lassú kliens: nem tömjük tovább, a gyűrűben megvárja (újracsatlakozáskor megkapja)
    if(peer.ws && peer.ws.readyState === 1 && peer.ws.bufferedAmount < MAX_WS_BUFFER){ peer.ws.send(str); rec.sent = true; }
    if(rec.sent && !peer.v2) return;        // régi böngésző: nem nyugtáz, nem tartjuk meg
    rec.bytes = Buffer.byteLength(str, 'utf8');
    peer.ring.push(rec); peer.ringBytes = (peer.ringBytes || 0) + rec.bytes; ringTotal += rec.bytes;
    while(peer.ring.length > MAX_BUFFERED || (peer.ringBytes > MAX_RING_BYTES && peer.ring.length > 1)){
      ringDrop(peer);
    }
    // audit: közös plafon — ha betelt, ennek a játékosnak a már kiküldött, de nem nyugtázott üzeneteit engedjük el
    while(ringTotal > MAX_RING_TOTAL && peer.ring.length && peer.ring[0].sent) ringDrop(peer);
    if(ringTotal > MAX_RING_TOTAL) ringClear(peer);
  } else if(peer.ws && peer.ws.readyState === 1 && peer.ws.bufferedAmount < MAX_WS_BUFFER){
    peer.ws.send(JSON.stringify(obj));
  }
}
let ringTotal = 0;
function ringDrop(peer){ const b = peer.ring.shift().bytes || 0; peer.ringBytes -= b; ringTotal -= b; }
function ringClear(peer){ ringTotal -= peer.ringBytes || 0; peer.ring = []; peer.ringBytes = 0; }
function ackRing(peer, r){
  if(typeof r !== 'number' || !Number.isFinite(r)) return;
  while(peer.ring.length && peer.ring[0].q <= r) ringDrop(peer);
}

function roomMembers(roomId){ return rooms.get(roomId) || new Set(); }

function leaveRoom(peer, why){
  const roomId = peer.room;
  if(!roomId) return;
  peer.room = null;
  ringClear(peer);
  directory.forEach((e, k) => { if(e.room === roomId && e.from === peer.id){ directory.delete(k); broadcastDir({ code: e.d.code, id: e.d.id, removed: true, srv: 1 }, peer.id); } });
  const set = rooms.get(roomId);
  if(set){
    set.delete(peer.id);
    if(set.size === 0){ rooms.delete(roomId); roomInfo.delete(roomId); pendingResults.delete(roomId); wordReps.delete(roomId); }
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

// ---------------------------------------------------------------------
// Szobalista-bejelentés hitelesítése (v4.12)
// Nyilvános szobánál a kód úgyis publikus, ezért a szerver maga kiszámolja
// belőle a szobaazonosítót (ugyanazzal a lassított PBKDF2-vel, mint a
// böngésző), és csak akkor fogadja el a bejelentést, ha a bejelentő TÉNYLEG
// abban a szobában van, és ő nyitotta meg (az első belépő). Zárt szobánál a
// kódot nem ismerjük, ott annyit ellenőrzünk, hogy a bejelentő egy szoba
// megnyitója, és szobánként csak egy bejegyzés lehet.
// ---------------------------------------------------------------------
const APP_ID = 'rajzold-ki-huncraft-party-jatek-v1';
const ridCache = new Map();
function ridForCode(code){
  if(ridCache.has(code)) return ridCache.get(code);
  const p = new Promise((res) => {
    crypto.pbkdf2(code, 'picasso-srv-room-v2|' + APP_ID, 150000, 32, 'sha256', (err, key) => res(err ? null : 'v2:' + key.toString('hex')));
  });
  if(ridCache.size > 2000) ridCache.clear();
  ridCache.set(code, p);
  return p;
}
const clampStr = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
const clampInt = (v, lo, hi) => { const x = Math.floor(Number(v)); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : 0; };

// v4.30: a PBKDF2 drága (kb. 100 ms CPU) — egy kapcsolat percenként legfeljebb
// ennyi új (gyorsítótárban nem lévő) kódot ellenőriztethet
const RID_PER_MIN = 6;
function ridAllowed(peer, code){
  if(ridCache.has(code)) return true;
  const now = Date.now();
  peer.ridTimes = (peer.ridTimes || []).filter(t => now - t < 60_000);
  if(peer.ridTimes.length >= RID_PER_MIN) return false;
  peer.ridTimes.push(now);
  return true;
}

async function handleDir(peer, d){
  if(!d || typeof d !== 'object') return;
  const code = /^[A-Z0-9]{4,8}$/.test(String(d.code || '')) ? String(d.code) : '';
  const fp = !code && typeof d.id === 'string' && /^[a-z]:[0-9a-f]{8,64}$/.test(d.id) ? d.id : '';
  const key = code || fp;
  if(!key) return;
  const prev = directory.get(key);
  if(d.removed){
    if(prev && prev.from !== peer.id) return;
    if(directory.delete(key)) broadcastDir({ code: code || undefined, id: fp || undefined, removed: true, srv: 1 }, peer.id);
    return;
  }
  const roomId = peer.room;
  const info = roomId && roomInfo.get(roomId);
  if(!info) return;
  // csak a szoba megnyitója hirdethet; ha ő már nincs bent (átadta a szobát), a következő bent lévő
  if(info.owner !== peer.id){
    if(roomMembers(roomId).has(info.owner)) return;
    info.owner = peer.id;
    roomMembers(roomId).forEach(id => { const p = peers.get(id); if(p) sendRaw(p, { t:'owner', id: peer.id }); });
  }
  if(code){
    if(!ridAllowed(peer, code)) return;
    const rid = await ridForCode(code);
    if(!rid || rid !== peer.room) return;                      // a kód nem ehhez a szobához tartozik
  }
  if(prev && prev.from !== peer.id && Date.now() - prev.at < DIR_TTL_MS) return;   // más szobáját nem írhatja felül
  // v4.13: egy IP-ről egyszerre legfeljebb 3 hirdetett szoba (zárt szobánál a
  // kódot nem ismerjük, így ez fogja vissza a hamis zárt szobákat)
  if(!prev || prev.from !== peer.id){
    let fromIp = 0;
    directory.forEach((e2, k2) => { if(k2 !== key && e2.ip === peer.ip && Date.now() - e2.at <= DIR_TTL_MS) fromIp++; });
    if(fromIp >= 3) return;
  }
  // szobánként (és bejelentőnként) egyetlen bejegyzés
  for(const [k, e] of directory){ if(k !== key && (e.from === peer.id || e.room === roomId)) directory.delete(k); }
  if(directory.size > 300 && !prev) return;
  const clean = { srv: 1, name: clampStr(d.name, 60), hostName: clampStr(d.hostName, 24),
    players: clampInt(d.players, 0, 999), max: clampInt(d.max, 0, 999), inGame: !!d.inGame, regOnly: d.regOnly === true || undefined };
  if(!clean.name) return;
  // v4.40: regisztrált nevet csak a gazdája hirdethet szobanyitóként
  {
    let ok = mayUseNameSync(peer, clean.hostName);
    if(ok === null) ok = !(await nameRegistered(nameKey(clean.hostName)));
    if(!ok) clean.hostName = 'Vendég';
  }
  if(peer.acct && nameKey(clean.hostName) === peer.acct.key) clean.verified = true;
  if(code) clean.code = code; else { clean.id = fp; clean.isPrivate = true; }
  directory.set(key, { d: clean, from: peer.id, room: roomId, ip: peer.ip, at: Date.now(), firstAt: prev && prev.from === peer.id ? (prev.firstAt || prev.at) : Date.now() });
  broadcastDir(clean, peer.id);
}

// ---------------------------------------------------------------------
// Szójelentések (v4.12): a böngészők ide jelzik a lerajzolt / hibásnak jelölt
// szavakat, és a szerver csak akkor továbbítja a Netlify felé (titkos kulccsal),
// ha ugyanabban a szobában elég különböző játékos jelezte. Kitalált
// eszközazonosítóval így nem lehet a közös szólistákat módosítani.
// Beállítás: WORDS_SECRET (ugyanaz, mint a Netlify PICASSO_SERVER_SECRET).
// ---------------------------------------------------------------------
const WORDS_SECRET = process.env.WORDS_SECRET || '';
const WORDS_API = String(process.env.WORDS_API_BASE || 'https://pic-ass-o.netlify.app').replace(/\/+$/, '');
/** roomId -> Map("kind|szó" -> { word, peers:Set, sent }) */
const wordReps = new Map();
// v4.13: napi plafon MINDEN szobára együtt — ennyi szót tehet "elhasználttá" /
// "felfüggesztetté" egy nap az egész játék. Kitalált kapcsolatokkal így sem
// lehet a szólistát kiüríteni (a felfüggesztést az admin panelen fel lehet oldani).
const WORD_DAY_CAP = { used: Number(process.env.WORD_USED_DAY_CAP || 300), block: Number(process.env.WORD_BLOCK_DAY_CAP || 20) };
const wordDay = { day: '', used: 0, block: 0 };
const wordNorm = w => String(w || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
function handleWordRep(peer, m){
  if(!WORDS_SECRET || !peer.room) return;
  const kind = m.k === 'used' ? 'used' : m.k === 'block' ? 'block' : '';
  const word = typeof m.w === 'string' ? m.w.trim().slice(0, 60) : '';
  const k = wordNorm(word);
  if(!kind || !k) return;
  const members = roomMembers(peer.room);
  if(members.size < 2) return;
  let map = wordReps.get(peer.room);
  if(!map){ map = new Map(); wordReps.set(peer.room, map); }
  const key = kind + '|' + k;
  let e = map.get(key);
  if(!e){
    if(map.size >= 400) return;          // egy szobából ennél több különböző szó nem jöhet
    e = { word, peers: new Set(), sent: false }; map.set(key, e);
  }
  if(e.sent) return;
  e.peers.add(peer.id);
  const live = [...e.peers].filter(id => members.has(id)).length;
  // v4.13: 2 különböző játékos elég (a "játékosok fele" szabályt a böngésző ellenőrzi,
  // mert csak ő tudja, ki játékos és ki néző — a szerver a nézőket is a szobában látja)
  if(live < 2) return;
  const today = new Date().toISOString().slice(0, 10);
  if(wordDay.day !== today){ wordDay.day = today; wordDay.used = 0; wordDay.block = 0; }
  if(wordDay[kind] >= WORD_DAY_CAP[kind]){ e.sent = true; log('szójelentés napi plafon', kind); return; }
  wordDay[kind]++;
  e.sent = true;
  const fn = kind === 'used' ? 'wordused' : 'wordblock';
  fetch(`${WORDS_API}/.netlify/functions/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-picasso-secret': WORDS_SECRET },
    body: JSON.stringify({ word: e.word, votes: live, players: members.size }),
    signal: AbortSignal.timeout(8000)
  }).then(r => log('szójelentés', kind, r.status)).catch(err => log('szójelentés hiba', kind, err && err.message));
}

function broadcastDir(d, fromId){
  const str = JSON.stringify({ t:'dir', d });
  peers.forEach(p => { if(p.id !== fromId && p.dirSub && canSend(p.ws)) p.ws.send(str); });
}

// ---------------------------------------------------------------------
// Ranglista (egyszerű JSON fájl — egy családi játékhoz bőven elég)
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Fiókok (v4.40): névigazoló jegyek ellenőrzése és a regisztrált nevek védelme.
// A fiókokat a Netlify-függvény (account) kezeli; a szerver csak a NYILVÁNOS
// kulcsot kéri le tőle, jelszót vagy e-mail címet soha nem lát.
// Beállítás (nem kötelező): ACCOUNT_API_BASE — alapból a WORDS_API_BASE, majd
// az engedélyezett oldalak címei közül az első, amelyik válaszol.
// ---------------------------------------------------------------------
const ACCOUNT_BASES = [...new Set([process.env.ACCOUNT_API_BASE, WORDS_API, ...ALLOWED_ORIGINS.filter(o => o.startsWith('https://'))]
  .filter(Boolean).map(b => String(b).replace(/\/+$/, '')))];
const ACCOUNT_PATH = '/.netlify/functions/account';
let keyLoading = null;   // v4.50: egyszerre csak egy kulcsletöltés
let accountKey = null, accountBase = '';
async function loadAccountKey(){
  for(const base of (process.env.ACCOUNT_API_BASE ? [String(process.env.ACCOUNT_API_BASE).replace(/\/+$/, '')] : ACCOUNT_BASES)){
    try{
      const r = await fetch(base + ACCOUNT_PATH + '?pubkey=1', { signal: AbortSignal.timeout(6000), headers: { accept: 'application/json' } });
      if(!r.ok) continue;
      const j = await r.json();
      if(!j || !j.key || j.key.kty !== 'EC' || j.key.crv !== 'P-256') continue;
      accountKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: String(j.key.x), y: String(j.key.y) }, format: 'jwk' });
      if(accountBase !== base) log('fiókkulcs betöltve innen:', base);
      accountBase = base;
      return true;
    }catch(e){ /* következő cím */ }
  }
  return false;
}
(function keepAccountKey(){
  loadAccountKey().then(ok => { setTimeout(keepAccountKey, ok ? 6 * 3600_000 : 10_000).unref?.(); });   // v4.50: hiba után 10 mp múlva újra
})();
/** Aláírt "törzs.aláírás" ellenőrzése; a törzs tartalma, vagy null. */
function verifySigned(str){
  if(!accountKey || typeof str !== 'string' || str.length > 1200) return null;
  const i = str.indexOf('.');
  if(i < 10) return null;
  const body = str.slice(0, i), sig = str.slice(i + 1);
  if(!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]{80,90}$/.test(sig)) return null;
  try{
    if(!crypto.verify('sha256', Buffer.from(body), { key: accountKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))) return null;
    const c = JSON.parse(Buffer.from(body, 'base64url').toString());
    return (c && typeof c === 'object' && Number(c.e) > Date.now()) ? c : null;
  }catch(e){ return null; }
}
/** key -> { taken, at } — a regisztrált nevek rövid életű gyorsítótára */
const nameCache = new Map();
function nameCached(key){
  const c = nameCache.get(key);
  return (c && Date.now() - c.at < (c.taken ? 5 * 60_000 : 30_000)) ? c : null;
}
/** Regisztrált-e a név. Ha a fiókszolgáltatás nem érhető el, nem akadályozzuk a játékot (false). */
async function nameRegistered(key){
  const c = nameCached(key);
  if(c) return c.taken;
  if(!accountBase) return false;
  try{
    const r = await fetch(accountBase + ACCOUNT_PATH + '?name=' + encodeURIComponent(key), { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } });
    if(!r.ok) return false;
    const taken = !!(await r.json()).taken;
    if(nameCache.size > 5000) nameCache.clear();
    nameCache.set(key, { taken, at: Date.now() });
    return taken;
  }catch(e){ return false; }
}
/** Használhatja-e ez a kapcsolat ezt a nevet: szabad név, vagy a saját (igazolt) neve. */
function mayUseNameSync(peer, name){
  const key = nameKey(String(name || '').slice(0, 40));
  if(!key || !accountKey) return true;
  if(peer.acct && peer.acct.key === key) return true;
  const c = nameCached(key);
  return c ? !c.taken : null;      // null: még nem tudjuk, le kell kérdezni
}

// ---------------------------------------------------------------------
// v4.44: végleges kitiltás az egész játékból. Az admin a Netlify-on dönt, onnan aláírt kérés jön (/api/ban).
// A szerver az eszközt, az eszközhöz látott IP-címeket és a fiókot tiltja; lemezre menti (bans.json),
// így újraindítás után is érvényes. A kitiltott kapcsolatot azonnal bontja (4030).
// ---------------------------------------------------------------------
const BANS_FILE = path.join(DATA_DIR, 'bans.json');
let permBans = { devs: {}, ips: {}, uids: {} };
try{ const b = JSON.parse(fs.readFileSync(BANS_FILE, 'utf8')); if(b && typeof b === 'object') permBans = { devs: b.devs || {}, ips: b.ips || {}, uids: b.uids || {} }; }catch(e){}
function saveBans(){
  try{ fs.mkdirSync(DATA_DIR, { recursive: true }); const tmp = BANS_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(permBans)); fs.renameSync(tmp, BANS_FILE); }catch(e){ log('a tiltólista mentése nem sikerült', e.message); }
}
const devIps = new Map();   // eszköz -> az utóbbi időben látott IP-k (a tiltáshoz)
function noteDevIp(dev, ip){
  if(!dev || !ip) return;
  let set = devIps.get(dev);
  if(!set){ if(devIps.size > 20000) devIps.delete(devIps.keys().next().value); set = new Set(); devIps.set(dev, set); }
  set.add(ip); if(set.size > 8) set.delete(set.values().next().value);
}
function permBanned(peer){
  return !!((peer.dev && permBans.devs[peer.dev]) || permBans.ips[peer.ip] || (peer.acct && permBans.uids[peer.acct.uid]));
}
function dropBanned(peer){
  try{ if(peer.ws && peer.ws.readyState === 1){ peer.ws.send(JSON.stringify({ t:'error', e:'banned' })); peer.ws.close(4030, 'kitiltva'); } }catch(e){}
  forget(peer, 'végleg kitiltva');
}

const GAMES_FILE = path.join(DATA_DIR, 'games.json');
let games = [];
try{ games = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8')); if(!Array.isArray(games)) games = []; }catch(e){ games = []; }
let saveTimer = null;
function saveGames(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = GAMES_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(games), err => {
      if(err){ log('ranglista mentési hiba', err.message); return; }
      fs.rename(tmp, GAMES_FILE, e2 => { if(e2) log('ranglista mentési hiba', e2.message); });
    });
  }, 500);
}
// v4.30: leállításkor szinkron mentés (régen egy 500 ms-os időzítőn és egy 700 ms-os kilépésen múlt)
function saveGamesNow(){
  clearTimeout(saveTimer); saveTimer = null;
  try{
    const tmp = GAMES_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(games));
    fs.renameSync(tmp, GAMES_FILE);
  }catch(e){ log('ranglista mentési hiba', e.message); }
}
const lastReportByRoom = new Map();
/** roomId -> Map(hash -> { rows, voters:Set(peerId), at }) — még meg nem erősített eredmények */
const pendingResults = new Map();
/** ip-csoport -> [rögzítés időpontjai] — egy IP-ről naponta legfeljebb ennyi játék kerülhet be */
const recordsByIpSet = new Map();
const MAX_GAMES_PER_IPSET_DAY = 40;
const MIN_GAME_MS = Number(process.env.MIN_GAME_MS || 90_000);            // ennél rövidebb ideig élő szoba eredménye nem számít

function nameKey(n){ return String(n).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim(); }

// GDPR: a ranglista bejegyzései 1 év után törlődnek
const GAME_RETENTION_MS = 365 * 86400_000;
function pruneOldGames(){
  const cut = Date.now() - GAME_RETENTION_MS;
  const keep = games.filter(g => (g.at || 0) >= cut);
  if(keep.length !== games.length){ games.length = 0; games.push(...keep); return true; }
  return false;
}
setInterval(() => { if(pruneOldGames()) saveGames(); }, 6 * 3600_000).unref?.();
setTimeout(() => { if(pruneOldGames()) saveGames(); }, 5000).unref?.();

// v4.11: a ranglistára csak az az eredmény kerül fel, amit a szoba TÖBB tagja
// egymástól függetlenül, ugyanúgy küld be (legalább 2 különböző játékos, és a
// szobában lévők legalább fele). Egyetlen játékos kitalált eredménye így nem
// jut be, és nem is "foglalhatja le" a szoba helyét a valódi elől.
// Őszinte korlát: aki több böngészőfüllel egyedül játszik "kétfős" játékot,
// azt a szerver nem tudja megkülönböztetni — ezt a napi/IP korlát fogja vissza.
// pl. 1 óra 12 perc / 37 perc
function idotartam(ms){ const p = Math.max(1, Math.round(ms / 60000)), o = Math.floor(p / 60), m = p % 60; return o ? `${o} óra${m ? ' ' + m + ' perc' : ''}` : `${m} perc`; }
function recordGame(peer, rows){
  if(!peer.room) return 'nincs szobában';
  const roomId = peer.room;
  const members = roomMembers(roomId);
  const info = roomInfo.get(roomId);
  if(!info || members.size < 2) return 'egyedül van';
  if(Date.now() - info.createdAt < MIN_GAME_MS) return 'túl rövid';
  if(!Array.isArray(rows) || rows.length < 2 || rows.length > MAX_ROOM_PEERS) return 'hibás sorok';
  if(rows.length > info.ever.size) return 'több sor, mint ahányan a szobában jártak';
  if(Date.now() - (peer.lastResultAt || 0) < 20_000) return 'túl gyakori';
  peer.lastResultAt = Date.now();
  const clean = [];
  for(const r of rows){
    if(!r || !isStr(r.name, 40)) return 'hibás név';
    const score = Number(r.score);
    if(!Number.isFinite(score) || score < 0 || score > 100000) return 'hibás pont';
    if(!nameKey(r.name)) return 'hibás név';
    clean.push({ name: r.name.trim(), score: Math.round(score) });
  }
  const canon = [...clean].sort((a, b) => nameKey(a.name) < nameKey(b.name) ? -1 : nameKey(a.name) > nameKey(b.name) ? 1 : a.score - b.score);
  const hash = crypto.createHash('sha256').update(JSON.stringify(canon.map(r => [nameKey(r.name), r.score]))).digest('hex');
  let pend = pendingResults.get(roomId);
  if(!pend){ pend = new Map(); pendingResults.set(roomId, pend); }
  const now = Date.now();
  pend.forEach((v, k) => { if(now - v.at > 5 * 60_000) pend.delete(k); });
  let e = pend.get(hash);
  if(!e){ if(pend.size >= 20) return 'túl sok eltérő eredmény'; e = { rows: clean, voters: new Set(), at: now, done: false }; pend.set(hash, e); }
  if(e.done) return 'már rögzítve';
  e.voters.add(peer.id);
  const live = [...e.voters].filter(id => members.has(id)).length;
  const need = Math.max(2, Math.ceil(members.size / 2));
  if(live < need) return 'megerősítésre vár';
  // ugyanabból a szobából 60 mp-en belül csak egy játék (pl. dupla küldés)
  if(now - (lastReportByRoom.get(roomId) || 0) < 60_000) return 'túl gyakori';
  // napi korlát a szobában lévők IP-címeire (egy család egy IP-n is bőven elfér)
  const ipKey = [...info.ips].sort().join('|');
  const recent = (recordsByIpSet.get(ipKey) || []).filter(t => now - t < 86400_000);
  if(recent.length >= MAX_GAMES_PER_IPSET_DAY) return 'napi korlát';
  recent.push(now); recordsByIpSet.set(ipKey, recent);
  // v4.40: a ranglistára csak regisztrált (jeggyel igazolt) játékos kerül név szerint;
  // a vendégek sora név nélkül marad meg (a győztes megállapításához kell a pontjuk)
  const players = e.rows.map(r => { const a = info.accts && info.accts.get(nameKey(r.name)); return a ? { name: a.name, score: r.score, u: a.uid } : { g: 1, score: r.score }; });
  if(!players.some(p => p.u)) return 'nincs regisztrált játékos';
  e.done = true;
  lastReportByRoom.set(roomId, now);
  games.push({ at: now, start: info.createdAt, players });
  pruneOldGames();
  if(games.length > 20000) games.splice(0, games.length - 20000);
  saveGames();
  log('játék rögzítve', `${players.length} játékos (${players.filter(p => p.u).length} regisztrált), ${live} megerősítés`);   // nevek/pontok nem kerülnek a naplóba
  return 'ok';
}

/** Fióktörlés: a játékos sorai névtelenné válnak; amiben már nincs regisztrált játékos, az a játék törlődik. */
function forgetAccount(uid){
  let changed = 0;
  for(const g of games){
    g.players = g.players.map(p => { if(p.u !== uid) return p; changed++; return { g: 1, score: p.score }; });
  }
  if(!changed) return 0;
  const keep = games.filter(g => g.players.some(p => p.u));
  games.length = 0; games.push(...keep);
  saveGames();
  return changed;
}

// v4.49: szezonális (havi) ranglista — a hónapot budapesti idő szerint számoljuk
const monthFmt = new Intl.DateTimeFormat('sv-SE', { timeZone:'Europe/Budapest', year:'numeric', month:'2-digit' });
const monthKey = ts => monthFmt.format(new Date(ts)).slice(0, 7);
function prevMonthKey(){ const [y, m] = monthKey(Date.now()).split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
const HU_MONTHS = ['január','február','március','április','május','június','július','augusztus','szeptember','október','november','december'];
const monthLabel = k => { const [y, m] = k.split('-'); return `${y}. ${HU_MONTHS[Number(m) - 1]}`; };
/** A lezárt hónapok dobogósai: hónap -> [uid, uid, uid] (gyorsítótárazva, a lezárt hónap nem változik). */
const podiumCache = new Map();
function monthPodium(k){
  if(k !== monthKey(Date.now()) && podiumCache.has(k)) return podiumCache.get(k);
  const top = leaderboard(0, k).slice(0, 3).map(r => r.uid);
  if(k !== monthKey(Date.now())) podiumCache.set(k, top);
  return top;
}
function podiumsOf(uid){
  const months = [...new Set(games.map(g => monthKey(g.at)))].filter(k => k !== monthKey(Date.now())).sort().reverse();
  const out = [];
  for(const k of months){ const i = monthPodium(k).indexOf(uid); if(i >= 0) out.push({ month: k, label: monthLabel(k), place: i + 1 }); }
  return out;
}

function leaderboard(days, month){
  const since = days ? Date.now() - days * 86400_000 : 0;
  const by = new Map();
  for(const g of games){
    if(g.at < since) continue;
    if(month && monthKey(g.at) !== month) continue;
    const top = Math.max(...g.players.map(p => p.score));
    for(const p of g.players){
      if(!p.u) continue;               // v4.40: csak regisztrált játékos (a régi, fiók előtti sorok sem)
      const k = p.u;
      let e = by.get(k);
      if(!e){ e = { name: p.name, uid: p.u, games: 0, wins: 0, total: 0, best: 0, last: 0 }; by.set(k, e); }
      e.games++; e.total += p.score; e.best = Math.max(e.best, p.score);
      if(p.score === top && top > 0) e.wins++;
      if(g.at >= e.last){ e.last = g.at; e.name = p.name; }
    }
  }
  return [...by.values()]
    .map(e => ({ ...e, verified: true, avg: Math.round(e.total / e.games) }))
    .sort((a, b) => b.wins - a.wins || b.avg - a.avg || b.games - a.games);
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }

function leaderboardPage(days, month){
  const rows = leaderboard(days, month);
  const prevTop = monthPodium(prevMonthKey());
  const recent = games.filter(g => g.players.some(p => p.u)).slice(-15).reverse();
  const tab = (d, label) => `<a href="?napok=${d}" class="${!month && (days||0) === d ? 'on' : ''}">${label}</a>`;
  const mtab = (k, label) => `<a href="?honap=${k}" class="${month === k ? 'on' : ''}">${label}</a>`;
  const fmt = ts => new Date(ts).toLocaleString('hu-HU', { timeZone:'Europe/Budapest', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PIC-ASS-O ranglista</title>
<style>
  :root{ --bg:#1b1c1f; --card:#25262a; --line:#33353a; --chalk:#F4F1E8; --dim:#a9adb5; --yellow:#F5D76E; }
  *{ box-sizing:border-box; }
  body{ margin:0; background:var(--bg); color:var(--chalk); font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; padding:20px 16px 40px; }
  main{ max-width:680px; margin:0 auto; }
  h1{ font-size:1.7rem; margin:0 0 4px; } h2{ font-size:1.1rem; margin:28px 0 8px; color:var(--yellow); }
  .sub{ color:var(--dim); margin:0 0 16px; }
  .tabs{ display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  .tabs a{ color:var(--chalk); text-decoration:none; padding:6px 12px; border-radius:999px; background:var(--card); font-size:.9rem; }
  .tabs a.on{ background:var(--yellow); color:#1b1c1f; font-weight:600; }
  table{ width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
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
<p class="sub">Minden befejezett, legalább kétfős játék számít, amelyben volt regisztrált játékos. A listán csak regisztrált (✔) játékosok szerepelnek. A sorrend: győzelmek, aztán átlagpont.</p>
<nav class="tabs">${mtab(monthKey(Date.now()), '🏁 Ez a hónap')}${mtab(prevMonthKey(), 'Előző hónap')}${tab(0,'Mindig')}${tab(30,'Utolsó 30 nap')}${tab(7,'Utolsó 7 nap')}</nav>
${month ? `<p class="sub">${month === monthKey(Date.now()) ? 'A havi szezon: minden hónap elején újraindul, és a hónap legjobb 3 játékosa 🏆 jelvényt kap a profiljára.' : monthLabel(month) + ' végeredménye.'}</p>` : ''}
${rows.length ? `<table><thead><tr><th class="rank">#</th><th>Név</th><th>Győzelem</th><th>Játék</th><th>Átlag</th><th class="hide-s">Legjobb</th></tr></thead><tbody>
${rows.map((r, i) => `<tr><td class="rank">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</td><td>${escapeHtml(r.name)} <span title="regisztrált játékos">✔</span>${prevTop.includes(r.uid) ? ` <span title="${escapeHtml(monthLabel(prevMonthKey()))}: ${prevTop.indexOf(r.uid) + 1}. hely">🏆</span>` : ''}</td><td>${r.wins}</td><td>${r.games}</td><td>${r.avg}</td><td class="hide-s">${r.best}</td></tr>`).join('')}
</tbody></table>` : `<p class="empty">Még nincs befejezett játék ebben az időszakban.</p>`}
<h2>Legutóbbi játékok</h2>
${recent.length ? recent.map(g => { const s = [...g.players].sort((a,b)=>b.score-a.score); return `<div class="g"><time>${fmt(g.at)}${g.start ? ' · ⏱ a szoba ' + idotartam(g.at - g.start) + ' élt' : ''}</time>${s.map((p,i)=>`${i===0?'👑 ':''}${p.u ? `<b>${escapeHtml(p.name)}</b> ✔` : '<i>vendég</i>'} ${p.score}`).join(' · ')}</div>`; }).join('') : '<p class="empty">Még nincs.</p>'}
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
  // v4.11: a nyilvános szobák listája — az e-mail értesítő ezzel ellenőrzi,
  // hogy tényleg nyílt-e szoba (a nevet és a szobanyitót is innen veszi)
  if(url.pathname === '/api/szobak'){
    const now = Date.now();
    const list = [];
    directory.forEach(e => {
      if(now - e.at > DIR_TTL_MS || !e.d || e.d.removed || !e.d.code) return;
      list.push({ code: String(e.d.code).slice(0, 8), name: String(e.d.name || '').slice(0, 60),
        hostName: String(e.d.hostName || '').slice(0, 24), firstAt: e.firstAt || e.at, verified: !!e.d.verified });
    });
    res.writeHead(200, { 'content-type':'application/json', 'cache-control':'no-store' });
    res.end(JSON.stringify({ rooms: list }));
    return;
  }
  // v4.40: fióktörléskor a Netlify-függvény aláírt kéréssel jelzi, hogy a játékos a ranglistáról is lekerüljön
  if(url.pathname === '/api/ban' && req.method === 'POST'){
    let raw = '';
    req.on('data', c => { raw += c; if(raw.length > 4000) req.destroy(); });
    req.on('end', () => {
      let c = null;
      try{ c = verifySigned(String(JSON.parse(raw).proof || '')); }catch(e){}
      const dev = c && (c.ban || c.unban);
      if(!c || !/^[A-Za-z0-9_-]{8,40}$/.test(String(dev || ''))){ res.writeHead(403, { 'content-type':'application/json' }); res.end('{"error":"forbidden"}'); return; }
      const uids = Array.isArray(c.uids) ? c.uids.filter(u => isStr(u, 64)).slice(0, 10) : [];
      if(c.ban){
        permBans.devs[dev] = Date.now();
        for(const ip of devIps.get(dev) || []) permBans.ips[ip] = dev;
        uids.forEach(u => { permBans.uids[u] = dev; });
        for(const p of [...peers.values()]) if(permBanned(p)) dropBanned(p);
      } else {
        delete permBans.devs[dev];
        for(const [k, v] of Object.entries(permBans.ips)) if(v === dev) delete permBans.ips[k];
        for(const [k, v] of Object.entries(permBans.uids)) if(v === dev) delete permBans.uids[k];
        uids.forEach(u => { delete permBans.uids[u]; });
      }
      saveBans();
      log(c.ban ? 'végleges kitiltás' : 'kitiltás feloldva', String(dev).slice(0, 6));
      res.writeHead(200, { 'content-type':'application/json' }); res.end('{"ok":true}');
    });
    return;
  }
  if(url.pathname === '/api/forget' && req.method === 'POST'){
    let raw = '';
    req.on('data', c => { raw += c; if(raw.length > 4000) req.destroy(); });
    req.on('end', () => {
      let c = null;
      try{ c = verifySigned(String(JSON.parse(raw).proof || '')); }catch(e){}
      if(!c || !isStr(c.del, 64)){ res.writeHead(403, { 'content-type':'application/json' }); res.end('{"error":"forbidden"}'); return; }
      const n = forgetAccount(c.del);
      for(const p of peers.values()) if(p.acct && p.acct.uid === c.del) p.acct = null;
      nameCache.clear();
      log('fiók törölve a ranglistáról', `${n} sor`);
      res.writeHead(200, { 'content-type':'application/json' }); res.end('{"ok":true}');
    });
    return;
  }
  // v4.49: egy játékos dobogós helyezései a lezárt havi szezonokban (a profilhoz)
  if(url.pathname === '/api/dobogo'){
    const pid = String(url.searchParams.get('pid') || '');
    res.writeHead(200, { 'content-type':'application/json', 'cache-control':'public, max-age=300' });
    res.end(JSON.stringify({ podiums: /^[A-Za-z0-9_-]{8,40}$/.test(pid) ? podiumsOf(pid) : [] }));
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
    const hm = String(url.searchParams.get('honap') || '');
    const month = /^\d{4}-\d{2}$/.test(hm) ? hm : (url.searchParams.has('napok') ? '' : monthKey(Date.now()));   // alapból a havi szezon
    res.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store',
      'x-content-type-options':'nosniff', 'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'" });
    res.end(leaderboardPage(days, month));
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
  if(!originAllowed(req.headers.origin, true)){ ws.close(4003, 'origin'); return; }
  const ip = clientIp(req);
  const nConn = (connPerIp.get(ip) || 0) + 1;
  if(nConn > MAX_CONN_PER_IP){ ws.close(4029, 'túl sok kapcsolat'); return; }
  connPerIp.set(ip, nConn);
  ws.on('close', () => { const n = (connPerIp.get(ip) || 1) - 1; if(n <= 0) connPerIp.delete(ip); else connPerIp.set(ip, n); });
  let peer = null;
  let tokens = RATE_BURST, lastRefill = Date.now();
  let byteTokens = BYTES_BURST, fanTokens = FANOUT_BURST;
  let throttled = false;
  // v4.30: túlterheléskor régen csendben eldobtuk az üzenetet, de a később
  // érkezők sorszáma "nyugtázta" az eldobottat is, így az végleg elveszett.
  // Most bontjuk a kapcsolatot: a böngésző azonnal visszacsatlakozik, és
  // a szerver által visszaigazolt sorszám után mindent újraküld.
  // Percenként legfeljebb néhányszor — utána marad a régi eldobás (visszaélés ellen).
  function overLimit(why){
    if(throttled) return;
    const now = Date.now();
    if(peer && peer.v2){
      peer.throttleCloses = (peer.throttleCloses || []).filter(t => now - t < 60_000);
      if(peer.throttleCloses.length < THROTTLE_CLOSE_MAX){
        peer.throttleCloses.push(now);
        throttled = true;
        log('túlterhelés, újracsatlakoztatás', peer.id.slice(0,6), why);
        try{ ws.close(4008, 'túl gyors'); }catch(e){}
        return;
      }
    }
  }
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // v4.40: regisztrált névvel csak a gazdája mutatkozhat be — az ilyen üzenetet nem továbbítjuk
  function rejectName(m){
    if(typeof m.s === 'number' && m.s > peer.inSeq) peer.inSeq = m.s;
    try{ ws.send(JSON.stringify({ t:'error', e:'name-taken', name: String(m.d.name).slice(0, 16) })); }catch(e){}
    log('foglalt név elutasítva', peer.id.slice(0,6));
  }
  function relaySend(m){
        if(!peer.room || !isStr(m.a, 32)) return;
        if(typeof m.s === 'number' && m.s <= peer.inSeq) return;   // újraküldött példány, amit már továbbítottunk
        const lim = ACTION_LIMITS[m.a];
        if(lim){
          const now2 = Date.now();
          peer.act = peer.act || {};
          const arr = (peer.act[m.a] || []).filter(t => now2 - t < lim[1]);
          if(arr.length >= lim[0]){
            peer.act[m.a] = arr;
            if(typeof m.s === 'number') peer.inSeq = m.s;   // szándékosan eldobva: nem kell újraküldeni
            if(!peer.actLogAt || now2 - peer.actLogAt > 30_000){ peer.actLogAt = now2; log('áradat eldobva', peer.id.slice(0,6), m.a, 'szoba', String(peer.room).slice(0,8)); }
            return;
          }
          arr.push(now2); peer.act[m.a] = arr;
        }
        const set = roomMembers(peer.room);
        const out = JSON.stringify({ t:'msg', a: m.a, d: m.d, f: peer.id });
        const targets = Array.isArray(m.to) ? m.to.filter(id => typeof id === 'string' && set.has(id)).length : Math.max(0, set.size - 1);
        const cost = Buffer.byteLength(out, 'utf8') * targets;
        // v4.30: a sorszámot csak a továbbítás után léptetjük, így egy itt eldobott üzenet újra jöhet
        if(fanTokens - cost < 0){ overLimit('továbbítás'); return; }
        fanTokens -= cost;
        if(typeof m.s === 'number') peer.inSeq = m.s;
        if(Array.isArray(m.to)){
          m.to.slice(0, MAX_ROOM_PEERS).forEach(id => {
            if(typeof id === 'string' && id !== peer.id && set.has(id)){ const p = peers.get(id); if(p) sendRaw(p, out); }
          });
        } else {
          set.forEach(id => { if(id !== peer.id){ const p = peers.get(id); if(p) sendRaw(p, out); } });
        }
  }

  ws.on('message', (buf, isBinary) => {
    // egyszerű sebességkorlát
    const now = Date.now();
    const dt = (now - lastRefill) / 1000;
    tokens = Math.min(RATE_BURST, tokens + dt * RATE_PER_SEC);
    byteTokens = Math.min(BYTES_BURST, byteTokens + dt * BYTES_PER_SEC);
    fanTokens = Math.min(FANOUT_BURST, fanTokens + dt * FANOUT_BYTES_PER_SEC);
    lastRefill = now;
    if(throttled) return;                 // a bontás után érkezőket már nem dolgozzuk fel (újra jönnek)
    if(--tokens < 0){ overLimit('üzenetszám'); return; }
    byteTokens -= buf.length;
    if(byteTokens < 0){ overLimit('bájt'); return; }
    if(isBinary) return;
    let m; try{ m = JSON.parse(buf.toString()); }catch(e){ return; }
    if(!m || typeof m !== 'object') return;
    handleMsg(m);
  });

  // v4.50: az üzenet feldolgozása külön függvényben (az igazolás kulcsletöltés után újra lefuthat)
  function handleMsg(m){

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
        if(/^[A-Za-z0-9]{16,40}$/.test(String(m.dev || ''))) old.dev = String(m.dev);
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
        peer = { id: m.id, token: m.token, dev: /^[A-Za-z0-9]{16,40}$/.test(String(m.dev || '')) ? String(m.dev) : '', ws, room: null, ring: [], ringBytes: 0, outQ: 0, inSeq: 0, v2, dropTimer: null, ip, dirSub: !!m.dir };
        peers.set(peer.id, peer);
        ws.send(JSON.stringify({ t:'welcome', v:2, fresh:true, resumed:false, peers: [], online: peers.size, s: 0 }));
      }
      noteDevIp(peer.dev, peer.ip);
      if(permBanned(peer)){ dropBanned(peer); return; }
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
        if(/^[A-Za-z0-9]{16,40}$/.test(String(m.dev || ''))) peer.dev = String(m.dev);
        noteDevIp(peer.dev, peer.ip);
        if(permBanned(peer)){ dropBanned(peer); return; }
        if(peer.room) leaveRoom(peer, 'új szoba');
        {
          // v4.43: akit a szobanyitó kirúgott, az 24 óráig nem léphet vissza: se ugyanazzal a kapcsolattal, se ugyanarról
          // az eszközről, se a fiókjával, se ugyanarról az IP-címről (más névvel, újratöltve sem)
          const inf = roomInfo.get(m.room);
          const ownerIp = inf && peers.get(inf.owner) ? peers.get(inf.owner).ip : '';
          // v4.49: „csak regisztráltak” szoba — fiók (igazolt jegy) nélkül nem lehet belépni
          if(inf && inf.regOnly && !peer.acct && inf.owner !== peer.id){ ws.send(JSON.stringify({ t:'error', e:'regonly' })); return; }
          if(isKicked(m.room, peer, ownerIp)){ ws.send(JSON.stringify({ t:'error', e:'kicked' })); log('kirúgott próbált visszalépni', peer.id.slice(0,6)); return; }
        }
        let set = rooms.get(m.room);
        if(!set){
          if(rooms.size >= MAX_ROOMS){ ws.send(JSON.stringify({ t:'error', e:'full' })); return; }
          set = new Set(); rooms.set(m.room, set);
        }
        if(set.size >= MAX_ROOM_PEERS){ ws.send(JSON.stringify({ t:'error', e:'roomfull' })); return; }
        const others = [...set];
        set.add(peer.id);
        peer.room = m.room;
        let info = roomInfo.get(m.room);
        if(!info){ info = { createdAt: Date.now(), ever: new Set(), ips: new Set(), owner: peer.id }; roomInfo.set(m.room, info); }
        info.ever.add(peer.id); if(info.ips.size < 50) info.ips.add(peer.ip);
        if(peer.acct){ info.accts = info.accts || new Map(); info.accts.set(peer.acct.key, peer.acct); }
        ws.send(JSON.stringify({ t:'joined', room: m.room, peers: others, owner: info.owner }));
        others.forEach(id => { const p = peers.get(id); if(p) sendRaw(p, { t:'pjoin', id: peer.id }); });
        log('belépés', peer.id.slice(0,6), 'szoba', m.room.slice(0,8), 'létszám', set.size);
        return;
      }
      case 'leave':
        leaveRoom(peer, 'kilépett');
        return;
      case 'kick': {
        // audit: csak a szoba megnyitója tehet ki valakit; a szerver tényleg kiteszi és nem engedi vissza
        const info = peer.room && roomInfo.get(peer.room);
        if(!info || info.owner !== peer.id || !isStr(m.id, 64) || m.id === peer.id) return;
        const target = peers.get(m.id);
        if(!target || target.room !== peer.room) return;
        const b = kickBanOf(peer.room, true), until = Date.now() + KICK_BAN_MS;
        b.until = until;
        if(b.peers.size < 500) b.peers.add(target.id);
        if(target.dev && b.devs.size < 500) b.devs.set(target.dev, until);
        if(target.acct && b.uids.size < 500) b.uids.set(target.acct.uid, until);
        if(target.ip !== peer.ip && b.ips.size < 500) b.ips.set(target.ip, until);   // közös wifin (a szobanyitóval egy IP) az IP-t nem, csak az eszközt és a fiókot tiltjuk
        log('kirúgás', target.id.slice(0,6), target.ip !== peer.ip ? '(IP is tiltva)' : '(közös hálózat: eszköz/fiók tiltva)');
        try{ if(target.ws && target.ws.readyState === 1) target.ws.send(JSON.stringify({ t:'error', e:'kicked' })); }catch(e){}
        leaveRoom(target, 'kirúgva');
        return;
      }
      case 'rflags': {
        // v4.49: a szobanyitó beállításai, amiket a szerver is betart
        const info = peer.room && roomInfo.get(peer.room);
        if(!info || info.owner !== peer.id) return;
        info.regOnly = !!m.regOnly;
        if(info.regOnly) roomMembers(peer.room).forEach(id => { const p = peers.get(id); if(p && p.id !== peer.id && !p.acct){ try{ p.ws && p.ws.send(JSON.stringify({ t:'error', e:'regonly' })); }catch(e){} leaveRoom(p, 'csak regisztráltak'); } });
        return;
      }
      case 'auth': {
        // v4.50: ha a kulcs még nincs meg (pl. indulás után a Netlify nem válaszolt), most azonnal lekérjük, és utána ellenőrzünk
        if(!accountKey && !m._retried){
          const again = Object.assign({}, m, { _retried: true });
          (keyLoading || (keyLoading = loadAccountKey().finally(() => { keyLoading = null; }))).then(() => { if(peer.ws === ws) handleMsg(again); });
          return;
        }
        // v4.40: névigazoló jegy — a Netlify írta alá, és ehhez a kapcsolat-azonosítóhoz szól
        const c = verifySigned(m.k);
        // a jegy a kapcsolat titkos kulcsához is kötött: aki csak látta a jegyet (pl. szobatársként), nem tudja felhasználni
        const th = crypto.createHash('sha256').update(String(peer.token)).digest('hex');
        if(!c || c.p !== peer.id || c.h !== th || !isStr(c.u, 64) || !isStr(c.n, 16) || !nameKey(c.n)){ ws.send(JSON.stringify({ t:'authed', ok:false })); return; }
        peer.acct = { uid: c.u, name: c.n, key: nameKey(c.n) };
        if(permBanned(peer)){ dropBanned(peer); return; }
        const info = peer.room && roomInfo.get(peer.room);
        if(info){ info.accts = info.accts || new Map(); info.accts.set(peer.acct.key, peer.acct); }
        ws.send(JSON.stringify({ t:'authed', ok:true, name: c.n }));
        return;
      }
      case 'send': {
        if(!peer.room || !isStr(m.a, 32)) return;
        // v4.40: amíg egy bemutatkozás névellenőrzése folyik, a kapcsolat többi üzenete sorban vár (a sorrend megmarad)
        if(peer.holdQ){ if(peer.holdQ.length < 300) peer.holdQ.push(m); return; }
        if(m.a === 'hello' && m.d && typeof m.d === 'object' && typeof m.d.name === 'string'){
          const ok = mayUseNameSync(peer, m.d.name);
          if(ok === false){ rejectName(m); return; }
          if(ok === null){
            peer.holdQ = [];
            nameRegistered(nameKey(m.d.name.slice(0, 40))).then(taken => {
              const q = peer.holdQ || []; peer.holdQ = null;
              if(taken && !(peer.acct && peer.acct.key === nameKey(m.d.name.slice(0, 40)))) rejectName(m); else relaySend(m);
              q.forEach(x => { if(peer.room) relaySend(x); });
            });
            return;
          }
        }
        relaySend(m);
        return;
      }
      case 'dir': {
        handleDir(peer, m.d);
        return;
      }
      case 'wordrep':
        handleWordRep(peer, m);
        return;
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
  }

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
  peers.forEach(p => { if(canSend(p.ws)) p.ws.send(online); });
  lastReportByRoom.forEach((t, k) => { if(now - t > 3600_000) lastReportByRoom.delete(k); });
  recordsByIpSet.forEach((arr, k) => { const a = arr.filter(t => now - t < 86400_000); if(a.length) recordsByIpSet.set(k, a); else recordsByIpSet.delete(k); });
}, 20_000);

server.listen(PORT, () => log(`PIC-ASS-O szerver fut: http://0.0.0.0:${PORT}  (engedélyezett oldalak: ${ALLOWED_ORIGINS.join(', ')})`));
function shutdown(sig){
  log('leállás', sig);
  saveGamesNow();
  try{ wss.clients.forEach(ws => { try{ ws.close(1012, 'újraindul'); }catch(e){} }); }catch(e){}
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
