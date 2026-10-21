// PIC-ASS-O — TURN credential proxy (v3.19, Cloudflare support v3.86)
// The Metered API key lives in the Netlify environment variable
// METERED_API_KEY, so it no longer has to be in index.html.
// The page calls /.netlify/functions/turn; if this function fails for any
// reason, the page falls back to its previous behaviour, so nothing breaks.
const METERED_HOST = 'https://picasso-rajzjatek.metered.live';

// v3.86: sok játékos esetén sem kérünk minden belépéskor új adatot a szolgáltatótól:
// az eredményt 10 percig a függvénypéldány megjegyzi, a Netlify CDN pedig ugyanennyi ideig
// kiszolgálja (így a legtöbb kérés a függvényt sem indítja el). Hiba esetén a régi adat használható.
let cache = null, cacheAt = 0, inflight = null, lastTry = 0;
const FRESH_MS = 600000, STALE_OK_MS = 3600000;
// v4.11: a TURN-hitelesítő 6 óráig érvényes (régen 24), így egy kiszivárgott példány
// hamar lejár. Ennek az ablaknak hosszabbnak kell lennie, mint FRESH + CDN-újrahasznosítás
// (10 perc + 1 óra + 1 óra CDN) plusz egy hosszú játék, különben a játékosok lejárt adatot kaphatnának.
// A forgalmi visszaélés ellen a szolgáltatónál beállított havi keret és riasztás véd.
const CRED_TTL_S = 6 * 3600;

export default async (req) => {
  const json = (body, status = 200, cacheable = false) => new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ 'content-type': 'application/json', 'cache-control': cacheable ? 'public, max-age=60' : 'no-store' },
      cacheable ? { 'netlify-cdn-cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' } : {})
  });

  if (req.method !== 'GET') return json({ error: 'method' }, 405);
  // Light deterrent only: browsers mark other sites' requests "cross-site".
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'forbidden' }, 403);

  const fresh = cache && Date.now() - cacheAt < FRESH_MS;
  if (!fresh && (!cache || Date.now() - lastTry > 30000)) {   // hiba esetén 30 mp-ig nem ostromoljuk a szolgáltatót
    lastTry = Date.now();
    if (!inflight) inflight = fetchList().finally(() => { inflight = null; });
    const list = await inflight;
    if (list && list.length) { cache = list; cacheAt = Date.now(); }
  }
  if (cache && Date.now() - cacheAt < STALE_OK_MS) return json(cache, 200, true);
  return json({ error: 'upstream unavailable' }, 502);
};

async function fetchList() {
  // v3.86: Cloudflare Realtime TURN (1000 GB/month free) is preferred when its two
  // environment variables are set; otherwise (or if Cloudflare fails) Metered is used as before.
  const cfId = process.env.CF_TURN_KEY_ID, cfToken = process.env.CF_TURN_API_TOKEN;
  if (cfId && cfToken) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cfId)}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + cfToken, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: CRED_TTL_S }),
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (res.ok) {
        const d = await res.json();
        let list = Array.isArray(d) ? d : (Array.isArray(d.iceServers) ? d.iceServers : (d.iceServers ? [d.iceServers] : []));
        // browsers block port 53, so those URLs only cause errors
        list = list.map(x => ({ ...x, urls: [].concat(x.urls || []).filter(u => !/:53(\?|$)/.test(u)) })).filter(x => x.urls.length);
        if (list.length) return list;
      }
    } catch (e) { /* fall through to Metered */ }
  }

  const key = process.env.METERED_API_KEY;
  if (!key) return null;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${METERED_HOST}/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return null;
  }
}
