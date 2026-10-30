// PIC-ASS-O — a játék tiszta szabályai és bemenet-ellenőrzői (v4.30)
// Az index.html-ből kiemelve, tartalmuk változatlan. Nincs bennük DOM- vagy
// hálózati függőség, így a tesztek (tests/) közvetlenül be tudják tölteni őket.

export function normalize(s){
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
}
// v2.89: tolerant guess checking. Spaces, hyphens and punctuation don't
// count ("hó-ember" = "hóember"), a short Hungarian ending is fine
// ("hóemberek", "biciklit"), and a long word forgives one typo.
export function squash(s){ return normalize(String(s || '')).replace(/[^a-z0-9]/g, ''); }
export function editDistance(a, b, cap){
  if(Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({length: b.length + 1}, (_, j)=>j);
  for(let i = 1; i <= a.length; i++){
    const cur = [i];
    let rowMin = i;
    for(let j = 1; j <= b.length; j++){
      const v = Math.min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + (a[i-1] === b[j-1] ? 0 : 1));
      cur.push(v);
      if(v < rowMin) rowMin = v;
    }
    if(rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}
// 'correct' | 'close' | 'wrong'
export function guessVerdict(guess, word){
  const g = squash(guess), w = squash(word);
  if(!w) return normalize(String(guess)) === normalize(String(word)) ? 'correct' : 'wrong';
  if(!g) return 'wrong';
  if(g === w) return 'correct';
  // v3.27: near misses (a typo, an extra ending) are only "close" — no points
  if(w.length >= 4 && g.startsWith(w) && g.length - w.length <= 3) return 'close';
  const d = editDistance(g, w, 3);
  if(w.length >= 4 && d <= (w.length >= 8 ? 3 : 2)) return 'close';
  if(g.length >= 4 && w.length >= 4 && (w.includes(g) || g.includes(w))) return 'close';
  return 'wrong';
}

export function isPlainObject(v){ return !!v && typeof v === 'object' && !Array.isArray(v); }
export function cleanText(v, max){ return String(v === undefined || v === null ? '' : v).slice(0, max); }
export function cleanName(v){ return cleanText(v || 'Valaki', 16).trim() || 'Valaki'; }
// v3.35: names are compared case-, accent- and whitespace-insensitively,
// so "Ádám", "adam" and " Adam " count as the same name.
export function nameKey(n){
  return String(n||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}

export const SAFE_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// Network payload ceilings (a hostile or buggy peer must not be able to
// freeze the page with one giant message).
export const MAX_STROKES = 600;             // strokes per drawing
export const STROKE_TYPES = ['fill','line','circle','rect'];   // v2.89: + rect   // v2.55: non-freehand strokes (freehand has no t)
export const MAX_POINTS_PER_STROKE = 1500;  // points per stroke
export const MAX_TOTAL_POINTS = 40000;      // points in one drawing

export function clampNum(v, lo, hi, dflt){
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}
export function cleanPeerId(v){ return String(v || '').slice(0,64); }

export function sanitizeStrokes(raw){
  if(!Array.isArray(raw)) return [];
  const out = [];
  let total = 0;
  for(let i=0; i<raw.length && out.length < MAX_STROKES && total < MAX_TOTAL_POINTS; i++){
    const s = raw[i];
    if(!isPlainObject(s) || !Array.isArray(s.points)) continue;
    const pts = [];
    for(let j=0; j<s.points.length && pts.length < MAX_POINTS_PER_STROKE && total < MAX_TOTAL_POINTS; j++){
      const pt = s.points[j];
      if(!isPlainObject(pt)) continue;
      const x = Number(pt.x), y = Number(pt.y);
      if(!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const q = { x: Math.min(1.5, Math.max(-0.5, x)), y: Math.min(1.5, Math.max(-0.5, y)) };
      if(s.pr){ const p = Number(pt.p); q.p = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0.5; }
      pts.push(q);
      total++;
    }
    if(pts.length === 0) continue;
    const t = STROKE_TYPES.includes(s.t) ? s.t : '';
    const clean = {
      color: (typeof s.color === 'string' && SAFE_COLOR_RE.test(s.color)) ? s.color : '#222222',
      sizeFrac: clampNum(s.sizeFrac, 0.0005, 0.3, 0.01),
      eraser: t ? false : !!s.eraser,
      points: t === 'fill' ? pts.slice(0,1) : (t ? [pts[0], pts[pts.length-1]] : pts)
    };
    if(t) clean.t = t;
    else if(s.pr) clean.pr = 1;          // v3.05: a pen stroke with pressure
    out.push(clean);
  }
  return out;
}
