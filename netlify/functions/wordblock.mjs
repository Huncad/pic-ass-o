// PIC-ASS-O — reported words quarantine (v3.36)
// When enough players in a game mark a word as broken / meaningless, the
// word is put "on hold" here and no game anywhere offers it again until the
// admin reviews it (fixes, deletes or keeps it).
//   GET                         -> { words: ["ajto", ...] }   (normalised keys)
//   POST { word } + header x-picasso-secret -> CSAK a saját játékszerver (v4.12):
//        a szerver akkor küldi, ha egy szobában legalább 2 játékos, és a bent
//        lévők legalább fele hibásnak jelölte a szót. Böngészőből nem fogad el.
//   POST { action:"release", word } + header x-netlify-token -> admin only
// The admin is checked against the Netlify API: the token must be able to
// read THIS site, i.e. it belongs to the site's owner/team.
import { getStore } from '@netlify/blobs';
import { norm, officialWords, fromGameServer } from '../lib/words.mjs';
import { isAdminRequest } from '../lib/adminauth.mjs';
import { json as baseJson, ipOf, makeLimiter, updateJSON } from '../lib/util.mjs';

const KEY = 'held';


// sebességkorlát és gyorsítótár (példányonként; a meleg függvénypéldány újrahasználja)
const limited = makeLimiter();
let listCache = null, listCacheAt = 0;

export default async (req) => {
  const json = (body, status = 200, cache = 'no-store') => baseJson(body, status, cache === 'no-store' ? {} :
    { 'cache-control': cache, 'netlify-cdn-cache-control': 'public, s-maxage=60, stale-while-revalidate=600' });
  const asObj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'forbidden' }, 403);
  const store = getStore({ name: 'picasso-wordblock', consistency: 'strong' });
  const read = async () => {
    const v = await store.get(KEY, { type: 'json' }).catch(() => null);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  };

  if (req.method === 'GET') {
    if (!listCache || Date.now() - listCacheAt > 20000) { listCache = Object.keys(await read()); listCacheAt = Date.now(); }
    return json({ words: listCache }, 200, 'public, max-age=30');
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const trusted = fromGameServer(req);
  if (!trusted && limited('p|' + ipOf(req), 10, 60000)) return json({ error: 'slow down' }, 429);

  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const word = String(body.word || '').trim().slice(0, 60);
  const k = norm(word);
  if (!k) return json({ error: 'no word' }, 400);

  if (body.action === 'release') {
    if (!(await isAdminRequest(req))) return json({ error: 'unauthorized' }, 401);   // v4.19
    const words = await updateJSON(store, KEY, raw => {
      const held = asObj(raw);
      if (!held[k]) return { write: false, result: Object.keys(held) };
      delete held[k];
      return { value: held, result: Object.keys(held) };
    });
    listCache = null;
    return json({ ok: true, words });
  }

  if (!trusted) return json({ error: 'forbidden', why: 'csak a játékszerver jelezhet' }, 403);
  const official = await officialWords();
  if (!official) return json({ ok: false, skipped: 'wordlist unavailable' }, 503);
  if (!official.has(k)) return json({ ok: false, skipped: 'not an official word' });
  // v4.30: ütközésbiztos írás (két egyszerre érkező jelzés nem írja felül egymást)
  const res = await updateJSON(store, KEY, raw => {
    const held = asObj(raw);
    if (held[k]) return { write: false, result: 'already' };
    if (Object.keys(held).length > 2000) return { write: false, result: 'full' };
    held[k] = { word, at: new Date().toISOString(), votes: Math.max(0, Math.floor(Number(body.votes) || 0)) };
    return { value: held, result: 'ok' };
  });
  if (res === 'already') return json({ ok: true, already: true });
  if (res === 'full') return json({ error: 'full' }, 429);
  listCache = null;
  return json({ ok: true });
};
