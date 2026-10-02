// PIC-ASS-O — TURN credential proxy (v3.19)
// The Metered API key lives in the Netlify environment variable
// METERED_API_KEY, so it no longer has to be in index.html.
// The page calls /.netlify/functions/turn; if this function fails for any
// reason, the page falls back to its previous behaviour, so nothing breaks.
const METERED_HOST = 'https://picasso-rajzjatek.metered.live';

export default async (req) => {
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });

  if (req.method !== 'GET') return json({ error: 'method' }, 405);
  // Light deterrent only: browsers mark other sites' requests "cross-site".
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'forbidden' }, 403);

  const key = process.env.METERED_API_KEY;
  if (!key) return json({ error: 'not configured' }, 500);

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${METERED_HOST}/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return json({ error: 'upstream ' + res.status }, 502);
    const list = await res.json();
    return json(Array.isArray(list) ? list : []);
  } catch (e) {
    return json({ error: 'upstream unreachable' }, 502);
  }
};
