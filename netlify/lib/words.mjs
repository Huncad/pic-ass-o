// PIC-ASS-O — közös segédfüggvények a szólista-végpontokhoz (v4.11)
// A hivatalos szólista a nyilvános GitHub Gistben van (ugyanaz, amit a játék
// betölt). A wordused / wordblock csak olyan szót fogad el, ami tényleg rajta
// van — kitalált szót nem lehet "elhasználttá" vagy "felfüggesztetté" tenni.
import { timingSafeEqual } from 'node:crypto';

const GIST_ID = process.env.WORDS_GIST_ID || 'fe34dbe63eefd11f324555359ec4cf53';

export const norm = w => String(w || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);


let cache = null, cacheAt = 0;
/** A hivatalos szavak normalizált kulcsai (Set), vagy null, ha nem elérhető. */
export async function officialWords() {
  if (cache && Date.now() - cacheAt < 10 * 60 * 1000) return cache;
  try {
    // v4.30: tokennel olvasunk, ha van (hitelesítés nélkül óránként csak 60 kérés jár)
    const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: Object.assign({ accept: 'application/vnd.github+json', 'user-agent': 'pic-ass-o-netlify' },
        process.env.GITHUB_TOKEN ? { authorization: 'token ' + process.env.GITHUB_TOKEN } : {})
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

// v4.12: a globális szójelentéseket CSAK a saját játékszerver küldheti, egy
// közös titkos kulccsal (Netlify: PICASSO_SERVER_SECRET, szerver: WORDS_SECRET).
// A szerver előtte ellenőrzi, hogy ugyanabban a szobában legalább ketten
// (tiltásnál a játékosok legalább fele) jelezték a szót — böngészőből vagy
// kitalált eszközazonosítókkal így nem lehet a listákat módosítani.
export function fromGameServer(req) {
  const want = process.env.PICASSO_SERVER_SECRET || '';
  const got = req.headers.get('x-picasso-secret') || '';
  if (want.length < 24 || got.length !== want.length) return false;
  try { return timingSafeEqual(Buffer.from(got), Buffer.from(want)); } catch (e) { return false; }
}
