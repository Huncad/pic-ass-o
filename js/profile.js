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

// ---------- mérföldkövek ----------
const MILESTONES = [
  ['games', 1, '🎮', 'Első játék'], ['games', 10, '🎮', '10 játék'], ['games', 50, '🎮', '50 játék'], ['games', 100, '🎮', '100 játék'], ['games', 500, '🎮', '500 játék'],
  ['wins', 1, '👑', 'Első győzelem'], ['wins', 10, '👑', '10 győzelem'], ['wins', 50, '👑', '50 győzelem'],
  ['podium', 10, '🥉', '10× dobogón'],
  ['drawnHit', 10, '🎨', '10 kitalált rajz'], ['drawnHit', 50, '🎨', '50 kitalált rajz'], ['drawnHit', 200, '🎨', '200 kitalált rajz'],
  ['guessHit', 10, '🎯', '10 jó tipp'], ['guessHit', 100, '🎯', '100 jó tipp'], ['guessHit', 500, '🎯', '500 jó tipp'],
  ['firstHits', 10, '⚡', '10× elsőként'], ['firstHits', 50, '⚡', '50× elsőként'],
  ['bestStreak', 5, '🔥', '5 jó tipp sorozat'], ['bestStreak', 10, '🔥', '10 jó tipp sorozat']
];
export function milestones(st){
  return MILESTONES.map(([k, n, em, title]) => ({ em, title, done: N(st[k]) >= n, prog: Math.min(N(st[k]), n), of: n }));
}
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
  const ms = milestones(st);
  const badges = Object.entries(st.badges || {}).filter(([k, v]) => BADGE_NAMES[k] && v > 0);
  const gallery = Array.isArray(p.gallery) ? p.gallery : [];
  body.innerHTML = head + `
    <div class="pf-level"><b>Szint ${L.level} · ${esc(levelTitle(L.level))}</b> <span class="pf-sub">${L.xp} XP — a következő szintig ${L.next - L.xp}</span><div class="pf-bar"><i style="width:${L.pct}%"></i></div></div>
    ${pod}
    <div class="pf-stats">
      <div><b>${N(st.games)}</b><span>játék</span></div><div><b>${N(st.wins)}</b><span>győzelem</span></div><div><b>${N(st.best)}</b><span>legjobb pont</span></div>
      <div><b>${N(st.drawnHit)}</b><span>kitalált rajz</span></div><div><b>${N(st.guessHit)}</b><span>jó tipp</span></div><div><b>${esc(fmtHours(st.playMs))}</b><span>játékidő</span></div>
    </div>
    ${badges.length ? `<p class="pf-sub" style="margin:8px 0 4px">Kör végi kitüntetések</p><div class="pf-badges">${badges.map(([k, v])=>`<span class="pf-badge">${esc(BADGE_NAMES[k])} ×${N(v)}</span>`).join('')}</div>` : ''}
    <p class="pf-sub" style="margin:8px 0 4px">Mérföldkövek (${ms.filter(m=>m.done).length}/${ms.length})</p>
    <div class="pf-badges">${ms.map(m=>`<span class="pf-badge${m.done ? '' : ' locked'}" title="${m.prog}/${m.of}">${m.em} ${esc(m.title)}</span>`).join('')}</div>
    ${gallery.length ? `<p class="pf-sub" style="margin:10px 0 4px">Galéria</p><div class="gallery-grid">${gallery.map(g=>`<figure><img loading="lazy" alt="${esc(g.word || 'rajz')}" src="${API}?img=${encodeURIComponent(p.pid + '.' + g.id)}"><figcaption><span>${esc(g.word || '')}</span><span>${esc(new Date(g.at).toLocaleDateString('hu-HU'))}</span></figcaption></figure>`).join('')}</div>` : ''}
    <div style="text-align:center;margin-top:10px">${followBtn}</div>`;
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
