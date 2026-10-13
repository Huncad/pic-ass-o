// PIC-ASS-O — TURN credential proxy (v3.19, Cloudflare support v3.86)
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
        body: JSON.stringify({ ttl: 86400 }),
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (res.ok) {
        const d = await res.json();
        let list = Array.isArray(d) ? d : (Array.isArray(d.iceServers) ? d.iceServers : (d.iceServers ? [d.iceServers] : []));
        // browsers block port 53, so those URLs only cause errors
        list = list.map(x => ({ ...x, urls: [].concat(x.urls || []).filter(u => !/:53(\?|$)/.test(u)) })).filter(x => x.urls.length);
        if (list.length) return json(list);
      }
    } catch (e) { /* fall through to Metered */ }
  }

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
