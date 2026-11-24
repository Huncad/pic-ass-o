// PIC-ASS-O — játékos profil, szintek és kitüntetések (v4.49)
// A profil a regisztrált játékos nyilvános adatlapja: szint, mérföldkövek, havi
// dobogós helyezések, statisztika és a galéria. Mindent textContent / escape-elt
// HTML-ként rajzol ki (a nevek és szavak játékosoktól jönnek).
const API = '/.netlify/functions/account';
const N = v => Number(v) || 0;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// ---------- szint ----------
/** Tapasztalati pont: a pontok mellett a játékok és győzelmek is számítanak. */
export function xpOf(st){ return N(st.points) + 20 * N(st.games) + 60 * N(st.wins) + 10 * N(st.drawnHit); }
export function levelOf(st){
  const xp = xpOf(st);
  const level = Math.floor(Math.sqrt(xp / 60)) + 1;          // 1: 0 XP, 2: 60, 3: 240, 4: 540, 5: 960 …
  const cur = 60 * (level - 1) ** 2, next = 60 * level ** 2;
  return { level, xp, cur, next, pct: Math.max(0, Math.min(100, Math.round(100 * (xp - cur) / (next - cur)))) };
}
const LEVEL_TITLES = [[1,'Firkász'],[3,'Vázlatoló'],[5,'Krétaművész'],[8,'Tusrajzoló'],[12,'Festő'],[16,'Mester'],[22,'Picasso'],[30,'Legenda']];
export const levelTitle = l => LEVEL_TITLES.filter(([n]) => l >= n).pop()[1];

// ---------- trófeák (v4.51) ----------
// Négy fokozat, pontokkal: ezekből lesz a trófea-ranglista. A szerver (Netlify) ugyanezt a listát
// használja a pontszámításhoz, ezért a feltételek csak a statisztikából dolgoznak, mellékhatás nélkül.
export const TIERS = { b: { name: 'bronz', pts: 10, em: '🥉' }, s: { name: 'ezüst', pts: 25, em: '🥈' }, g: { name: 'arany', pts: 50, em: '🥇' }, d: { name: 'gyémánt', pts: 100, em: '💎' } };
const tierFor = (i, n) => 'bsgd'[Math.min(3, Math.floor(i * 4 / n))];   // minden sorozat bronzzal indul, és (4+ fokozatnál) gyémánttal zárul
const H = 3600000;
const val = (st, k) => k === 'hours' ? N(st.playMs) / H : k === 'mates' ? Object.keys(st.mates && typeof st.mates === 'object' ? st.mates : {}).length
  : k.includes('.') ? N((st[k.split('.')[0]] || {})[k.split('.')[1]]) : N(st[k]);
const SERIES = [
  ['games', '🎮', [1, 10, 25, 50, 100, 250, 500, 1000], ['Első játék', 'Visszatérő', 'Törzsvendég', 'Rajzbolond', 'Százas klub', 'Veterán', 'Félezres', 'Ezres legenda'], n => `${n} befejezett játék`],
  ['wins', '👑', [1, 5, 10, 25, 50, 100, 250], ['Első győzelem', 'Győztes típus', 'Bajnok', 'Hódító', 'Uralkodó', 'Százszoros bajnok', 'Halhatatlan'], n => `${n} megnyert játék`],
  ['podium', '🏅', [5, 25, 100], ['Dobogós', 'Dobogó-törzstag', 'Dobogó-király'], n => `${n}× az első háromban (3+ fős játékban)`],
  ['points', '💰', [1000, 5000, 20000, 50000, 100000], ['Pontgyűjtő', 'Pontvadász', 'Pontmágnás', 'Pontbáró', 'Pontmilliomos'], n => `összesen ${n.toLocaleString('hu-HU')} pont`],
  ['best', '🚀', [300, 600, 1000], ['Jó nap', 'Csúcsforma', 'Rekorder'], n => `${n} pont egyetlen játékban`],
  ['drawn', '✏️', [10, 50, 100, 250, 500], ['Firkáló', 'Vázlatkészítő', 'Rajztanár', 'Galériás', 'Rajzgép'], n => `${n} lerajzolt szó`],
  ['drawnHit', '🎨', [10, 50, 100, 250, 500], ['Érthető vonalak', 'Beszédes rajzok', 'Képíró', 'Mesterrajzoló', 'Picasso utóda'], n => `${n} rajzodat kitalálták`],
  ['tiers.nehez', '🧗', [5, 25, 100], ['Bátor rajzoló', 'Nehézsúlyú', 'Lehetetlen nincs'], n => `${n} nehéz szót rajzoltál`],
  ['guessHit', '🎯', [10, 50, 100, 250, 500, 1000], ['Jó szem', 'Rájövő', 'Kitaláló', 'Gondolatolvasó', 'Látnok', 'Mindentudó'], n => `${n} jó tipp`],
  ['firstHits', '⚡', [5, 25, 100, 250], ['Gyors kéz', 'Villámkezű', 'Elsőszámú', 'Fénysebesség'], n => `${n}× te találtad ki elsőként`],
  ['bestStreak', '🔥', [3, 5, 10, 15], ['Sorozat', 'Lángoló', 'Megállíthatatlan', 'Tűzvihar'], n => `${n} jó tipp egymás után`],
  ['hours', '⏱️', [1, 5, 10, 25, 50, 100], ['Ráérős', 'Délutáni játékos', 'Elkötelezett', 'Hűséges', 'Életstílus', 'Száz óra'], n => `${n} óra játékidő`],
  ['biggestRoom', '🎉', [5, 8, 12], ['Társasági', 'Bulizó', 'Nagy buli'], n => `${n}+ fős játékban vettél részt`],
  ['mates', '🤝', [5, 20, 50], ['Barátkozó', 'Közösségi', 'Mindenki ismer'], n => `${n} különböző játékostárssal játszottál`],
  ['badges.fast', '⚡', [1, 10], ['Leggyorsabb tippelő', 'Gyorsasági bajnok'], n => `${n}× „Leggyorsabb tippelő” egy játék végén`],
  ['badges.draw', '🖌️', [1, 10], ['A kör rajzolója', 'Rajzbajnok'], n => `${n}× „Legjobb rajzoló” egy játék végén`],
  ['badges.streak', '🔥', [1, 10], ['Sorozatgyártó', 'Sorozatbajnok'], n => `${n}× „Leghosszabb sorozat” egy játék végén`],
  ['badges.first', '🥇', [1, 10], ['Villám', 'Villámbajnok'], n => `${n}× „Villámkezű” egy játék végén`],
  ['badges.flawless', '💯', [1, 5], ['Hibátlan', 'Tökéletes'], n => `${n}× „Hibátlan tippelő” egy játék végén`],
  ['badges.brave', '🤪', [1, 5], ['Bátor tippelő', 'Rendíthetetlen'], n => `${n}× „Legbátrabb tippelő” egy játék végén`]
];
const SPECIAL = [
  { id: 'fast3', em: '🏎️', name: 'Gyorsabb a gondolatnál', desc: '3 mp-en belül kitaláltál egy rajzot', tier: 's', test: st => N(st.fastest && st.fastest.ms) > 0 && N(st.fastest.ms) < 3000 },
  { id: 'fast15', em: '☄️', name: 'Előre tudtam', desc: '1,5 mp-en belül kitaláltál egy rajzot', tier: 'g', test: st => N(st.fastest && st.fastest.ms) > 0 && N(st.fastest.ms) < 1500 },
  { id: 'easy10', em: '🖍️', name: 'Három vonás', desc: 'a rajzodat 10 mp-en belül kitalálták', tier: 's', test: st => N(st.easiest && st.easiest.ms) > 0 && N(st.easiest.ms) < 10000 },
  { id: 'clutch', em: '⌛', name: 'Utolsó pillanat', desc: 'a rajzodat 80 mp után, de kitalálták', tier: 'b', test: st => N(st.hardestHit && st.hardestHit.ms) > 80000 },
  { id: 'allrounder', em: '🌈', name: 'Mindenes', desc: 'mindhárom nehézségi szinten rajzoltál már', tier: 'b', test: st => ['konnyu', 'kozepes', 'nehez'].every(k => N((st.tiers || {})[k]) > 0) },
  { id: 'collector', em: '🎖️', name: 'Gyűjtő', desc: 'mind a 6-féle kör végi kitüntetést megszerezted', tier: 'g', test: st => ['fast', 'draw', 'streak', 'first', 'flawless', 'brave'].every(k => N((st.badges || {})[k]) > 0) },
  { id: 'winrate', em: '🦁', name: 'Ragadozó', desc: 'legalább 20 játék, és a felét megnyerted', tier: 'g', test: st => N(st.games) >= 20 && N(st.wins) * 2 >= N(st.games) },
  { id: 'accuracy', em: '🧠', name: 'Éleslátó', desc: 'legalább 50 körben tippeltél, és 80%-ban eltaláltad', tier: 'g', test: st => N(st.guessRounds) >= 50 && N(st.guessHit) >= 0.8 * N(st.guessRounds) },
  { id: 'clear', em: '🔍', name: 'Kristálytiszta', desc: 'legalább 30 rajz, és 90%-ukat kitalálták', tier: 'g', test: st => N(st.drawn) >= 30 && N(st.drawnHit) >= 0.9 * N(st.drawn) }
];
export const ACHIEVEMENTS = (() => {
  const out = [];
  SERIES.forEach(([k, em, ns, names, desc]) => ns.forEach((n, i) => out.push({ id: k.replace('.', '-') + '-' + n, em, name: names[i], desc: desc(n), tier: tierFor(i, ns.length), test: st => val(st, k) >= n, k, n })));
  return out.concat(SPECIAL);
})();
/** A statisztikából: { list: [{…, done}], ids:Set, count, points } */
export function achievementsOf(st){
  st = st && typeof st === 'object' ? st : {};
  const list = ACHIEVEMENTS.map(a => Object.assign({}, a, { done: !!a.test(st), prog: a.k ? Math.min(val(st, a.k), a.n) : 0 }));
  const done = list.filter(a => a.done);
  return { list, ids: new Set(done.map(a => a.id)), count: done.length, points: done.reduce((s, a) => s + TIERS[a.tier].pts, 0), total: ACHIEVEMENTS.length };
}
/** Régi felület kedvéért: a trófeák mérföldkő-formában */
export function milestones(st){ return achievementsOf(st).list.map(a => ({ em: a.em, title: a.name, done: a.done, prog: Math.round(a.prog), of: a.n || 1 })); }
const BADGE_NAMES = { fast:'⚡ Leggyorsabb tippelő', draw:'🎨 Legjobb rajzoló', streak:'🔥 Leghosszabb sorozat', first:'🥇 Villámkezű', flawless:'🎯 Hibátlan tippelő', brave:'🤪 Legbátrabb tippelő' };

// ---------- profil ablak ----------
let ctx = { serverBase: '', account: null, onFollow: null };
export function initProfile(opts){ ctx = Object.assign(ctx, opts || {});
  const ov = $('profile-overlay'); if(!ov) return;
  $('profile-close-btn').addEventListener('click', closeProfile);
  ov.addEventListener('click', e=>{ if(e.target === ov) closeProfile(); });
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && !ov.classList.contains('hidden')) closeProfile(); });
}
export function closeProfile(){ const ov = $('profile-overlay'); if(ov) ov.classList.add('hidden'); }
const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('hu-HU', { year:'numeric', month:'long', day:'numeric' }) : '';
const fmtHours = ms => { const h = Math.round(N(ms) / 3600000); return h < 1 ? '<1 óra' : h + ' óra'; };

export async function openProfile(name){
  const ov = $('profile-overlay'), body = $('profile-body');
  { const t = $('profile-title'); if(t) t.textContent = '👤 Profil'; }
  if(!ov || !body) return;
  ov.classList.remove('hidden');
  body.innerHTML = '<p class="center-note">Betöltés…</p>';
  let p = null;
  try{ const r = await fetch(API + '?profile=' + encodeURIComponent(String(name).slice(0, 40)), { credentials:'same-origin', cache:'no-store' }); p = r.ok ? await r.json() : null; }catch(e){}
  if(!p){ body.innerHTML = '<p class="center-note">A profil most nem tölthető be.</p>'; return; }
  if(!p.found){ body.innerHTML = `<p class="center-note">„${esc(name)}” nem regisztrált játékos (vendég), ezért nincs profilja.</p>`; return; }
  let podiums = [];
  if(ctx.serverBase && p.pid){
    try{ const r = await fetch(ctx.serverBase + '/api/dobogo?pid=' + encodeURIComponent(p.pid)); if(r.ok) podiums = (await r.json()).podiums || []; }catch(e){}
  }
  const av = String(p.avatar || '');
  const avEm = ctx.avatarEmoji ? ctx.avatarEmoji(av) : '';
  const head = `<div class="pf-head"><span class="pf-av" style="--c:${/^#[0-9a-fA-F]{3,8}$/.test(av) ? av : '#556'}">${esc(avEm || String(p.name || '?').slice(0, 1).toUpperCase())}</span>
    <div><div class="pf-name"><span class="acct-badge">✔</span> ${esc(p.name)}</div>
    <div class="pf-sub">Regisztrált: ${esc(fmtDate(p.createdAt))} · ${N(p.followers)} követő${p.roomCode ? ` · 🏷️ ${esc(p.roomCode)}` : ''}</div></div></div>`;
  const followBtn = p.mine ? '' : (ctx.account && ctx.account.user
    ? `<button type="button" class="${p.following ? 'ghost' : 'secondary'} small" id="pf-follow" data-pid="${esc(p.pid)}" data-name="${esc(p.name)}">${p.following ? '✓ Követed — leállítás' : '+ Követés'}</button>`
    : '<p class="acct-why">Lépj be, ha követni szeretnéd — akkor szólunk, amikor szobát nyit.</p>');
  const pod = podiums.length ? `<div class="pf-badges">${podiums.slice(0, 12).map(x=>`<span class="pf-badge">🏆 ${esc(x.label)}: ${x.place}. hely</span>`).join('')}</div>` : '';
  if(p.private){ body.innerHTML = head + pod + '<p class="center-note">🔒 Ez a profil nem nyilvános.</p>' + followBtn; wireFollow(); return; }
  const st = p.stats || {};
  const L = levelOf(st);
  const A = achievementsOf(st);
  const badges = Object.entries(st.badges || {}).filter(([k, v]) => BADGE_NAMES[k] && v > 0);
  const gallery = Array.isArray(p.gallery) ? p.gallery : [];
  body.innerHTML = head + `<div class="pf-cols"><div class="pf-col">
    <div class="pf-level"><b>Szint ${L.level} · ${esc(levelTitle(L.level))}</b> <span class="pf-sub">${L.xp} XP — a következő szintig ${L.next - L.xp}</span><div class="pf-bar"><i style="width:${L.pct}%"></i></div></div>
    ${pod}
    <div class="pf-stats">
      <div><b>${N(st.games)}</b><span>játék</span></div><div><b>${N(st.wins)}</b><span>győzelem</span></div><div><b>${N(st.best)}</b><span>legjobb pont</span></div>
      <div><b>${N(st.drawnHit)}</b><span>kitalált rajz</span></div><div><b>${N(st.guessHit)}</b><span>jó tipp</span></div><div><b>${esc(fmtHours(st.playMs))}</b><span>játékidő</span></div>
    </div>
    ${badges.length ? `<p class="pf-sub" style="margin:8px 0 4px">Kör végi kitüntetések</p><div class="pf-badges">${badges.map(([k, v])=>`<span class="pf-badge">${esc(BADGE_NAMES[k])} ×${N(v)}</span>`).join('')}</div>` : ''}
    </div><div class="pf-col">
    <p class="pf-sub" style="margin:8px 0 4px">🏆 Trófeák: <b>${A.count}/${A.total}</b> · ${A.points} trófeapont</p>
    <div class="pf-badges">${A.list.filter(a=>a.done).map(a=>`<span class="pf-badge t-${a.tier}" title="${esc(a.desc)} (${TIERS[a.tier].name})">${a.em} ${esc(a.name)}</span>`).join('') || '<span class="pf-sub">Még nincs.</span>'}</div>
    ${gallery.length ? `<p class="pf-sub" style="margin:10px 0 4px">Galéria</p><div class="gallery-grid">${gallery.map(g=>`<figure><img loading="lazy" alt="${esc(g.word || 'rajz')}" src="${API}?img=${encodeURIComponent(p.pid + '.' + g.id)}"><figcaption><span>${esc(g.word || '')}</span><span>${esc(new Date(g.at).toLocaleDateString('hu-HU'))}</span></figcaption></figure>`).join('')}</div>` : ''}
    </div></div>
    <div style="text-align:center;margin-top:10px">${followBtn} <button type="button" class="ghost small" id="pf-board">🏆 Trófea-ranglista</button></div>`;
  { const tb = $('pf-board'); if(tb) tb.addEventListener('click', ()=>openTrophyBoard()); }
  wireFollow();
}
function wireFollow(){
  const b = $('pf-follow');
  if(!b) return;
  b.addEventListener('click', async ()=>{
    b.disabled = true;
    const following = /Követed/.test(b.textContent);
    try{ if(ctx.onFollow) await ctx.onFollow(!following, b.dataset.name, b.dataset.pid); }catch(e){}
    openProfile(b.dataset.name);
  });
}

// ---------- v4.51: trófea-ranglista ----------
export async function openTrophyBoard(){
  const ov = $('profile-overlay'), body = $('profile-body');
  if(!ov || !body) return;
  ov.classList.remove('hidden');
  const title = $('profile-title'); if(title) title.textContent = '🏆 Trófea-ranglista';
  body.innerHTML = '<p class="center-note">Betöltés…</p>';
  let d = null;
  try{ const r = await fetch(API + '?achtop=1', { credentials:'same-origin', cache:'no-store' }); d = r.ok ? await r.json() : null; }catch(e){}
  if(!d){ body.innerHTML = '<p class="center-note">A ranglista most nem tölthető be.</p>'; return; }
  const me = ctx.account && ctx.account.user ? ctx.account.user.name : '';
  const rows = Array.isArray(d.rows) ? d.rows : [];
  body.innerHTML = `<p class="pf-sub">A regisztrált játékosok (nyilvános profillal) a megszerzett trófeák pontjai szerint: 🥉 10, 🥈 25, 🥇 50, 💎 100 pont. Összesen ${ACHIEVEMENTS.length} trófea gyűjthető.</p>
    ${rows.length ? `<ol class="trophy-board">${rows.map((r, i)=>`<li class="${r.name === me ? 'me' : ''}"><span class="rk">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span><a href="#" class="nm pf-link" data-name="${esc(r.name)}">${esc(r.name)}</a><span>${N(r.count)} 🏆</span><b>${N(r.points)}</b></li>`).join('')}</ol>` : '<p class="center-note">Még üres — légy te az első! 🏆</p>'}
    ${d.mine ? `<p class="pf-sub" style="text-align:center">A te helyezésed: <b>${N(d.mine.rank)}.</b> · ${N(d.mine.count)} trófea · ${N(d.mine.points)} pont</p>` : ''}`;
  body.querySelectorAll('a.nm').forEach(a=>a.addEventListener('click', e=>{ e.preventDefault(); if(title) title.textContent = '👤 Profil'; openProfile(a.dataset.name); }));
}
