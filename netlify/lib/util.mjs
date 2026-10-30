// PIC-ASS-O — közös segédfüggvények a Netlify-függvényekhez (v4.30)
// Korábban minden függvényben külön másolat volt belőlük.

/** JSON-válasz, alapból gyorsítótár nélkül. */
export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, headers)
});

/** A kérő IP-címe (a Netlify saját fejléce, ha van). */
export const ipOf = req => req.headers.get('x-nf-client-connection-ip')
  || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'x';

/**
 * Egyszerű, függvénypéldányonkénti sebességkorlát.
 * A "meleg" példány újrahasználja a memóriát, így ez csak fék, nem garancia.
 */
export function makeLimiter(maxKeys = 3000) {
  const hits = new Map();
  return function limited(key, max, windowMs) {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    arr.push(now); hits.set(key, arr);
    if (hits.size > maxKeys) for (const k of hits.keys()) { if (!(hits.get(k) || []).some(t => now - t < windowMs)) hits.delete(k); }
    return arr.length > max;
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Egy JSON-bejegyzés olvasása az ETag-jével együtt (sérült tartalomnál data = null). */
async function readWithEtag(store, key) {
  try {
    const r = await store.getWithMetadata(key, { type: 'text' });
    if (!r) return { data: null, etag: null };
    let data = null;
    try { data = JSON.parse(r.data); } catch (e) { data = null; }
    return { data, etag: r.etag || null };
  } catch (e) {
    return { data: null, etag: null, failed: true };
  }
}

/**
 * Olvasás–módosítás–írás ütközésvédelemmel (v4.30).
 * A mutate(current) visszaad: { value, result } (írás) vagy { result, write:false } (nincs írás).
 * Ha közben valaki más írt (az ETag megváltozott), újraolvas és újra próbálja,
 * így két egyszerre érkező kérés nem írja felül egymás változását.
 * A mutate-ben NE legyen mellékhatás (levélküldés stb.), mert többször is lefuthat.
 */
export async function updateJSON(store, key, mutate, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const cur = await readWithEtag(store, key);
    const out = await mutate(cur.data);
    if (!out || out.write === false) return out ? out.result : undefined;
    // ha az olvasás nem sikerült, nincs mihez feltételt kötni: sima írás
    const opts = cur.failed ? undefined : (cur.etag ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    const w = await store.setJSON(key, out.value, opts);
    if (!opts || !w || w.modified !== false) return out.result;
    await sleep(30 + Math.floor(Math.random() * 120) * (i + 1));
  }
  throw new Error('a tároló írása ütközés miatt nem sikerült');
}
