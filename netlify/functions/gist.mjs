// PIC-ASS-O — a közös Gist (szólista, zenelista, közlemény) gyorsítótárazott másolata (v4.30)
// Régen minden oldalbetöltés közvetlenül az api.github.com-ot hívta, ami
// hitelesítés nélkül IP-címenként óránként csak 60 kérést enged: egy családi
// buli egy wifin, néhány újratöltéssel, gyorsan elérte. Most a böngésző ezt a
// függvényt hívja, a Netlify CDN 1 percig ugyanazt a választ adja mindenkinek,
// a függvény pedig GITHUB_TOKEN-nel (óránként 5000 kérés) olvas.
// A válasz alakja a GitHub API-éval azonos ({ files: { név: { content } } }),
// de az admin.json (jelszó-lenyomat) soha nem kerül bele.
import { json } from '../lib/util.mjs';

const GIST_ID = process.env.WORDS_GIST_ID || 'fe34dbe63eefd11f324555359ec4cf53';
const PUBLIC_FILES = ['szavak.json', 'zene.json', 'kozlemeny.json', 'ertesites.json'];
const FRESH_MS = 30000, STALE_OK_MS = 6 * 3600000;
let cache = null, cacheAt = 0, inflight = null;

async function fetchGist() {
  const headers = Object.assign({ accept: 'application/vnd.github+json', 'user-agent': 'pic-ass-o-netlify' },
    process.env.GITHUB_TOKEN ? { authorization: 'token ' + process.env.GITHUB_TOKEN } : {});
  const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers, signal: AbortSignal.timeout(6000) });
  if (!r.ok) return null;
  const d = await r.json();
  const files = {};
  for (const name of PUBLIC_FILES) {
    const f = d && d.files && d.files[name];
    if (!f) continue;
    let content = f.content;
    if (f.truncated && f.raw_url) {
      const rr = await fetch(f.raw_url, { signal: AbortSignal.timeout(6000) }).catch(() => null);
      if (rr && rr.ok) content = await rr.text();
    }
    if (typeof content === 'string') files[name] = { content };
  }
  return { id: GIST_ID, files, updated_at: d && d.updated_at };
}

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'method' }, 405);
  if (!cache || Date.now() - cacheAt > FRESH_MS) {
    if (!inflight) inflight = fetchGist().catch(() => null).finally(() => { inflight = null; });
    const fresh = await inflight;
    if (fresh) { cache = fresh; cacheAt = Date.now(); }
  }
  if (cache && Date.now() - cacheAt < STALE_OK_MS) {
    return json(cache, 200, { 'cache-control': 'public, max-age=0, must-revalidate',
      'netlify-cdn-cache-control': 'public, s-maxage=60, stale-while-revalidate=600' });
  }
  return json({ error: 'upstream unavailable' }, 502);
};
