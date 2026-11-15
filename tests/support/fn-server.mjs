// PIC-ASS-O — helyi kiszolgáló a böngészős fióktesztekhez (v4.40)
// A játék fájljai mellett a VALÓDI Netlify-függvényeket (account, subscribe, push)
// is futtatja, memóriabeli tárolóval és hamis levélküldővel. A kiküldött levelek
// a /__test/mails címen olvashatók ki.
// Indítás: node --experimental-test-module-mocks tests/support/fn-server.mjs PORT JÁTÉKSZERVER_PORT
import { mock } from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.argv[2]), SRV_PORT = Number(process.argv[3]);

const stores = new Map(); let etagSeq = 0;
function fakeStore(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  const m = stores.get(name);
  const write = async (key, text, opts = {}) => {
    const cur = m.get(key);
    if (opts.onlyIfNew && cur) return { modified: false };
    if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
    const etag = 'e' + (++etagSeq); m.set(key, { text, etag }); return { modified: true, etag };
  };
  return {
    async get(key, o = {}) { const c = m.get(key); return !c ? null : o.type === 'json' ? JSON.parse(c.text) : c.text; },
    async getWithMetadata(key, o = {}) { const c = m.get(key); return !c ? null : { data: o.type === 'json' ? JSON.parse(c.text) : c.text, etag: c.etag, metadata: {} }; },
    set: (k, v, o) => write(k, String(v), o), setJSON: (k, v, o) => write(k, JSON.stringify(v), o),
    async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) { return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
  };
}
mock.module('@netlify/blobs', { namedExports: { getStore: ({ name }) => fakeStore(name) } });
const mails = [];
mock.module('nodemailer', { defaultExport: { createTransport: () => ({ async sendMail(msg) { mails.push({ to: msg.to, subject: msg.subject, html: msg.html }); return {}; } }) } });
process.env.GMAIL_USER = 'jatek@gmail.com'; process.env.ACCOUNT_EXTRA_EMAIL_DOMAINS = 'pelda.hu'; process.env.GMAIL_APP_PASSWORD = 'x';
process.env.GAME_SERVER_URL = 'http://127.0.0.1:' + SRV_PORT;

const fns = {};
for (const n of ['account', 'subscribe', 'push']) fns[n] = (await import(`../../netlify/functions/${n}.mjs`)).default;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
let csp = '';
try { csp = /Content-Security-Policy:\s*(.+)/.exec(fs.readFileSync(path.join(ROOT, '_headers'), 'utf8'))[1].trim().replace("connect-src 'self'", `connect-src 'self' http://127.0.0.1:${SRV_PORT} ws://127.0.0.1:${SRV_PORT}`); } catch (e) {}

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || "") ? req.headers.host : "127.0.0.1:" + PORT}`);
  if (u.pathname === '/__test/mails') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(mails)); return; }
  const fm = /^\/\.netlify\/functions\/(\w+)$/.exec(u.pathname);
  if (fm && fns[fm[1]]) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const r = await fns[fm[1]](new Request(u.href, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
    const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
    res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let p = decodeURIComponent(u.pathname); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  const headers = { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' };
  if (csp && f.endsWith('.html')) headers['content-security-policy'] = csp;
  res.writeHead(200, headers); fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('kész'));
