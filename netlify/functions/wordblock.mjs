// PIC-ASS-O — reported words quarantine (v3.36)
// When enough players in a game mark a word as broken / meaningless, the
// word is put "on hold" here and no game anywhere offers it again until the
// admin reviews it (fixes, deletes or keeps it).
//   GET                         -> { words: ["ajto", ...] }   (normalised keys)
//   POST { word, votes, players } -> puts the word on hold (votes must reach the rule)
//   POST { action:"release", word } + header x-netlify-token -> admin only
// The admin is checked against the Netlify API: the token must be able to
// read THIS site, i.e. it belongs to the site's owner/team.
import { getStore } from '@netlify/blobs';

const KEY = 'held';
const norm = w => String(w || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);

export default async (req) => {
  const json = (body, status = 200, cache = 'no-store') => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': cache }
  });
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'forbidden' }, 403);
  const store = getStore({ name: 'picasso-wordblock', consistency: 'strong' });
  const read = async () => {
    const v = await store.get(KEY, { type: 'json' }).catch(() => null);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  };

  if (req.method === 'GET') {
    const held = await read();
    return json({ words: Object.keys(held) }, 200, 'public, max-age=30');
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const word = String(body.word || '').trim().slice(0, 60);
  const k = norm(word);
  if (!k) return json({ error: 'no word' }, 400);

  if (body.action === 'release') {
    const token = req.headers.get('x-netlify-token') || '';
    const site = process.env.SITE_ID;
    if (!token || !site) return json({ error: 'unauthorized' }, 401);
    try {
      const r = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(site)}`,
        { headers: { authorization: 'Bearer ' + token } });
      if (!r.ok) return json({ error: 'unauthorized' }, 401);
    } catch (e) { return json({ error: 'netlify unreachable' }, 502); }
    const held = await read();
    delete held[k];
    await store.setJSON(KEY, held);
    return json({ ok: true, words: Object.keys(held) });
  }

  // the same rule as in the game: at least 2 marks, and at least half the players
  const votes = Math.floor(Number(body.votes) || 0), players = Math.floor(Number(body.players) || 0);
  if (players < 2 || votes < Math.max(2, Math.ceil(players / 2)) || votes > players) return json({ error: 'not enough votes' }, 400);
  const held = await read();
  if (Object.keys(held).length > 2000) return json({ error: 'full' }, 429);
  if (!held[k]) held[k] = { word, at: new Date().toISOString() };
  await store.setJSON(KEY, held);
  return json({ ok: true });
};
