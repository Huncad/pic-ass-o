// PIC-ASS-O — közös segédfüggvények a szólista-végpontokhoz (v4.11)
// A hivatalos szólista a nyilvános GitHub Gistben van (ugyanaz, amit a játék
// betölt). A wordused / wordblock csak olyan szót fogad el, ami tényleg rajta
// van — kitalált szót nem lehet "elhasználttá" vagy "felfüggesztetté" tenni.
import { createHash } from 'node:crypto';

const GIST_ID = process.env.WORDS_GIST_ID || 'fe34dbe63eefd11f324555359ec4cf53';

export const norm = w => String(w || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);

export const ipOf = req => req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || 'x';
// az IP-címet nem tároljuk, csak egy sózott lenyomatát
export const ipHash = req => createHash('sha256').update('picasso-ip|' + (process.env.SITE_ID || '') + '|' + ipOf(req)).digest('hex').slice(0, 20);

// eszközazonosító: a böngésző véletlen azonosítója (selfId) — csak formai ellenőrzés
export const cleanDev = d => { const s = String(d || ''); return /^[A-Za-z0-9_-]{6,64}$/.test(s) ? s : ''; };

let cache = null, cacheAt = 0;
/** A hivatalos szavak normalizált kulcsai (Set), vagy null, ha nem elérhető. */
export async function officialWords() {
  if (cache && Date.now() - cacheAt < 10 * 60 * 1000) return cache;
  try {
    const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'pic-ass-o-netlify' }
    });
    if (!r.ok) return cache;
    const d = await r.json();
    const f = d && d.files && d.files['szavak.json'];
    if (!f) return cache;
    let text = f.content;
    if (f.truncated && f.raw_url) { const rr = await fetch(f.raw_url); if (rr.ok) text = await rr.text(); }
    const parsed = JSON.parse(text);
    const set = new Set();
    ['konnyu', 'kozepes', 'nehez'].forEach(t => (Array.isArray(parsed[t]) ? parsed[t] : []).forEach(w => { const k = norm(w); if (k) set.add(k); }));
    if (set.size) { cache = set; cacheAt = Date.now(); }
  } catch (e) { /* marad a régi */ }
  return cache;
}

// napi kvóta IP-lenyomatonként, a blob-tárban (több függvénypéldány között is érvényes)
export async function dailyQuota(store, key, ipH, max) {
  const day = new Date().toISOString().slice(0, 10);
  const v = await store.get(key, { type: 'json' }).catch(() => null);
  const q = (v && v.day === day && v.n && typeof v.n === 'object') ? v : { day, n: {} };
  const n = (q.n[ipH] || 0) + 1;
  if (n > max) return false;
  q.n[ipH] = n;
  await store.setJSON(key, q);
  return true;
}
