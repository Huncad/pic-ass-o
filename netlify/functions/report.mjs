// PIC-ASS-O — gyanús viselkedés naplója (v4.32)
// A játékosok eszközei (elsősorban a tippeket elbíráló rajzolóé és a
// szobanyitóé) jelzik ide, ha egy másik játékostól szabálytalan, hamisított
// vagy elárasztó üzenet érkezik — ilyet a játék módosítatlan változata nem
// küld, tehát valaki a böngésző fejlesztőeszközével (vagy más módon) piszkálja.
//
//   POST { action:"report", room, roomName, subject, subjectDev, kind, detail, reporter, v }
//        bárki (a játék) — sebességkorláttal, napi plafonnal, ismétlésszűréssel
//   POST { action:"list" }            + x-admin-session -> { items } (legújabb elöl)
//   POST { action:"delete", id }      + x-admin-session
//   POST { action:"clear" }           + x-admin-session
//
// Egy bejegyzés: becenév, (véletlen) eszközazonosító, szoba, a gyanú fajtája,
// ki jelezte, hányszor. A jelzést is egy böngésző küldi, ezért ez TÁJÉKOZTATÓ
// napló, nem bizonyíték: a döntés az adminé. A bejegyzések 60 nap után törlődnek.
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { json, ipOf, makeLimiter, updateJSON } from '../lib/util.mjs';
import { isAdminRequest } from '../lib/adminauth.mjs';

const KEY = 'log';
const KINDS = ['chat-flood', 'chat-dup', 'voice-flood', 'guess-flood', 'react-flood', 'chatreact-flood', 'forged', 'fast-guess', 'spoiler', 'bad-data'];
const KEEP_MS = 60 * 86400000;
const MERGE_MS = 10 * 60000;          // ugyanaz a gyanú ugyanarról a játékosról 10 percen belül: egy bejegyzés
const MAX_ITEMS = 400;
const DAY_CAP = 1500;                 // ennyi új jelzés naponta összesen (szemetelés ellen)
const IP_DAY_CAP = 60;                // v4.33: egy hálózatról naponta ennyi (a példányokon átívelően, a tárolóban számolva)

const limited = makeLimiter();
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const tidy = raw => {
  const d = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const now = Date.now();
  d.items = (Array.isArray(d.items) ? d.items : []).filter(x => x && now - (x.last || x.at || 0) < KEEP_MS);
  return d;
};

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'forbidden' }, 403);
  let b = {};
  try { b = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const store = getStore({ name: 'picasso-reports', consistency: 'strong' });

  if (b.action === 'list' || b.action === 'delete' || b.action === 'clear') {
    if (limited('a|' + ipOf(req), 60, 60000)) return json({ error: 'slow down' }, 429);
    if (!(await isAdminRequest(req))) return json({ error: 'A belépés lejárt — lépj be újra.' }, 401);
    if (b.action === 'list') {
      const d = tidy(await store.get(KEY, { type: 'json' }).catch(() => null));
      return json({ items: [...d.items].sort((x, y) => (y.last || 0) - (x.last || 0)) });
    }
    const id = clean(b.id, 40);
    const left = await updateJSON(store, KEY, raw => {
      const d = tidy(raw);
      d.items = b.action === 'clear' ? [] : d.items.filter(x => x.id !== id);
      return { value: d, result: d.items.length };
    });
    return json({ ok: true, left });
  }

  if (b.action !== 'report') return json({ error: 'unknown action' }, 400);
  const kind = KINDS.includes(b.kind) ? b.kind : '';
  const subject = clean(b.subject, 16);
  if (!kind || !subject) return json({ error: 'bad' }, 400);
  const ip = ipOf(req);
  if (limited('r|' + ip, 40, 3600000)) return json({ ok: true, skipped: 'ip' });
  const room = clean(b.room, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const reporter = clean(b.reporter, 16) || 'ismeretlen';
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  // a jelző IP-címe nem tárolódik, csak egy rövid lenyomata (ha valaki a naplót szemeteli, látszik, hogy egy helyről jön)
  const ipH = createHash('sha256').update('picasso-report|' + ip).digest('hex').slice(0, 10);
  const res = await updateJSON(store, KEY, raw => {
    const d = tidy(raw);
    if (d.day !== today) { d.day = today; d.n = 0; d.byIp = {}; }
    if ((d.n || 0) >= DAY_CAP) return { write: false, result: 'cap' };
    d.byIp = (d.byIp && typeof d.byIp === 'object') ? d.byIp : {};
    if ((d.byIp[ipH] || 0) >= IP_DAY_CAP) return { write: false, result: 'ip-cap' };
    d.byIp[ipH] = (d.byIp[ipH] || 0) + 1;
    const same = d.items.find(x => x.room === room && x.subject === subject && x.kind === kind && now - (x.last || 0) < MERGE_MS);
    if (same) {
      same.count = (same.count || 1) + 1; same.last = now;
      if (!same.reporters.includes(reporter) && same.reporters.length < 10) same.reporters.push(reporter);
      if (!same.ipH.includes(ipH) && same.ipH.length < 10) same.ipH.push(ipH);
    } else {
      d.items.push({ id: now.toString(36) + Math.random().toString(36).slice(2, 7), at: now, last: now, count: 1,
        room, roomName: clean(b.roomName, 60), subject, subjectDev: clean(b.subjectDev, 40).replace(/[^A-Za-z0-9_-]/g, ''),
        kind, detail: clean(b.detail, 120), reporters: [reporter], ipH: [ipH], v: clean(b.v, 10) });
      if (d.items.length > MAX_ITEMS) d.items.splice(0, d.items.length - MAX_ITEMS);
    }
    d.n = (d.n || 0) + 1;
    return { value: d, result: 'ok' };
  }).catch(() => 'error');
  return json({ ok: res === 'ok', skipped: res === 'ok' ? undefined : res });
};
