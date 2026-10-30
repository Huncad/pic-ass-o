// PIC-ASS-O — közös tesztkörnyezet a böngészős tesztekhez (v4.31)
// Elindítja a saját játékszervert és egy statikus kiszolgálót, és olyan
// böngészőlapokat ad, amelyek csak a helyi gépet érik el.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.env.PICASSO_ROOT || path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' };

function staticServer(port) {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  }).listen(port, '127.0.0.1');
}

/** Játékszerver + statikus kiszolgáló indítása. */
async function startServers() {
  const srvPort = 21000 + Math.floor(Math.random() * 9000);
  const webPort = srvPort + 1;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'picasso-ui-'));
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: { ...process.env, PORT: String(srvPort), DATA_DIR: dataDir }, stdio: 'ignore'
  });
  const web = staticServer(webPort);
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${srvPort}/api/health`)).ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  return {
    srvPort, webPort, base: `http://127.0.0.1:${webPort}/`,
    stop() { try { web.close(); } catch (e) {} try { srv.kill('SIGTERM'); } catch (e) {} }
  };
}

/**
 * Egy játékos böngészőlapja.
 * opts: { name, avatar, theme, seed, deterministic }
 * deterministic: kiszámítható véletlen (seed), animációk nélkül — a képernyőképekhez.
 */
async function newPlayer(browser, servers, label, contextOpts, opts = {}) {
  const ctx = await browser.newContext(Object.assign({}, contextOpts, opts.deterministic ? { reducedMotion: 'reduce' } : {}));
  await ctx.route('**/*', r => (/^(https?|wss?):\/\/127\.0\.0\.1[:/]/.test(r.request().url()) ? r.continue() : r.abort()));
  await ctx.addInitScript(([port, o]) => {
    try {
      localStorage.setItem('picasso-server-url', 'http://127.0.0.1:' + port);
      localStorage.setItem('picasso-tutorial-seen', '1');
      if (o.name) localStorage.setItem('picasso-name', o.name);
      if (o.avatar) localStorage.setItem('picasso-avatar-color', o.avatar);
      if (o.theme) localStorage.setItem('picasso-theme', o.theme);
    } catch (e) {}
    if (o.deterministic) {
      // mulberry32 — kiszámítható, de nem állandó véletlen (állandó értéknél egy "húzz újat" ciklus végtelen lehet)
      let a = (o.seed || 1) >>> 0;
      Math.random = function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    }
  }, [servers.srvPort, opts]);
  const page = await ctx.newPage();
  if (opts.fixedTime) {
    // álló óra, futó időzítők: a pontszám, az órák és a visszaszámlálók kiszámíthatók; léptetés: advanceClock()
    page.fakeNow = Date.parse('2026-06-01T10:00:00Z');
    await page.clock.setFixedTime(page.fakeNow);
  }
  page.pageErrors = [];
  page.on('pageerror', e => page.pageErrors.push(`${label}: ${e.message}`));
  page.framesIn = [];
  page.on('websocket', ws => ws.on('framereceived', f => page.framesIn.push(String(f.payload))));
  page.label = label;
  return page;
}

/** Szobanyitás a kezdőképernyőről; visszaadja a szobakódot. */
async function createRoom(host, servers, { roomName = 'Teszt szoba', name = 'Anna', rounds } = {}) {
  await host.goto(servers.base);
  await host.fill('#home-name', name);
  await host.click('#card-create');
  await host.fill('#room-name-input', roomName);
  if (rounds) {
    if (await host.isVisible('#setup-advanced-toggle') && await host.getAttribute('#setup-advanced-toggle', 'aria-expanded') !== 'true') await host.click('#setup-advanced-toggle');
    await host.click(`[data-rounds="${rounds}"]`);
  }
  await host.click('#btn-create-room');
  await host.waitForFunction(() => /^[A-Z0-9]{5}$/.test((document.getElementById('lobby-code') || {}).textContent || ''), null, { timeout: 15000 });
  return (await host.textContent('#lobby-code')).trim();
}

async function joinRoom(guest, servers, code, name = 'Bence') {
  await guest.goto(servers.base + '?join=' + code);
  await guest.fill('#home-name', name);
  await guest.click('#btn-invite-join');
}

/** A rajzoló kiválasztja az első felajánlott szót; visszaadja a szót. */
async function chooseFirstWord(drawer) {
  if (await drawer.isVisible('#btn-prep-reveal')) await drawer.click('#btn-prep-reveal');
  await drawer.waitForSelector('#prep-choices button:visible', { timeout: 10000 });
  const btn = drawer.locator('#prep-choices button').first();
  // a gomb a betűszámot is mutatja, pl. "motorblokk (10)"
  const word = (await btn.textContent()).replace(/\s*\(\d+\)\s*$/, '').trim();
  await btn.click();
  return word;
}

/** Egy kiszámítható vonal a rajzlapon. */
async function drawSquiggle(drawer) {
  const box = await (await drawer.waitForSelector('#fd-canvas:visible', { timeout: 10000 })).boundingBox();
  await drawer.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await drawer.mouse.down();
  for (let i = 1; i <= 20; i++) await drawer.mouse.move(box.x + box.width * (0.3 + i * 0.02), box.y + box.height * (0.3 + Math.sin(i / 3) * 0.1));
  await drawer.mouse.up();
}

/** Megvárja, hogy a néző vásznán megjelenjen a rajz. */
async function waitForDrawingOnWatch(guesser) {
  await guesser.waitForSelector('#watch-guess-input:visible', { timeout: 15000 });
  await guesser.waitForFunction(() => {
    const c = document.getElementById('watch-canvas'); if (!c || !c.width) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4 * 7) if (d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120 && d[i + 3] > 200) return true;
    return false;
  }, null, { timeout: 15000 });
}

async function guess(guesser, text) {
  await guesser.fill('#watch-guess-input', text);
  await guesser.press('#watch-guess-input', 'Enter');
}

/** Az álló óra léptetése egyszerre minden lapon (egy lépés legfeljebb 4 mp, hogy egyik időkorlát se járjon le). */
async function advanceClock(pages, seconds) {
  let left = seconds;
  while (left > 0) {
    const step = Math.min(4, left);
    for (const p of pages) { p.fakeNow += step * 1000; await p.clock.setFixedTime(p.fakeNow); }
    left -= step;
    await pages[0].waitForTimeout(150);
  }
}

module.exports = { advanceClock, ROOT, startServers, newPlayer, createRoom, joinRoom, chooseFirstWord, drawSquiggle, waitForDrawingOnWatch, guess };

// ---- kiszámított stílusok kimentése (CSS-átalakítások ellenőrzéséhez, v4.31) ----
// Minden elem (a rejtettek is) a fontos tulajdonságaival; az elem azonosítója
// a DOM-beli útvonala, ami determinisztikus futásnál futásról futásra azonos.
const STYLE_PROPS = ['display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'box-sizing',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius', 'outline-style', 'outline-width', 'outline-color', 'outline-offset',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order', 'justify-content', 'align-items', 'align-self', 'align-content', 'justify-self', 'justify-items',
  'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-area', 'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end', 'row-gap', 'column-gap',
  'overflow-x', 'overflow-y', 'visibility', 'opacity', 'color', 'background-color', 'background-image', 'background-size', 'background-position', 'box-shadow', 'text-shadow',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-decoration-line', 'white-space', 'word-break', 'overflow-wrap', 'text-overflow',
  'vertical-align', 'transform', 'transform-origin', 'filter', 'backdrop-filter', 'pointer-events', 'cursor', 'user-select', 'touch-action', 'object-fit', 'aspect-ratio',
  'animation-name', 'animation-duration', 'transition-property', 'transition-duration', 'content', 'list-style-type', 'mask-image', 'fill', 'stroke', 'stroke-width', 'caret-color', 'accent-color', 'appearance', 'isolation', 'mix-blend-mode', 'clip-path', 'inset'];
async function dumpStyles(page, file) {
  const data = await page.evaluate((props) => {
    const out = {};
    const pathOf = (el) => {
      const parts = [];
      for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
        if (e.id) { parts.unshift('#' + e.id); break; }
        const i = e.parentElement ? [...e.parentElement.children].indexOf(e) : 0;
        parts.unshift(e.tagName.toLowerCase() + ':' + i);
      }
      return parts.join('>');
    };
    const all = [document.documentElement, ...document.querySelectorAll('body, body *')].filter(e => !/^(SCRIPT|STYLE|LINK|META|TITLE|HEAD|BR|TEMPLATE)$/.test(e.tagName));
    for (const el of all) {
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo);
        if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue;
        const rec = {};
        for (const p of props) rec[p] = cs.getPropertyValue(p);
        // az elem azonosítói (nem stílus): a változás visszavezetéséhez a felelős szabályra
        rec._tag = el.tagName.toLowerCase(); rec._id = el.id || ''; rec._cls = typeof el.className === 'string' ? el.className : ((el.className && el.className.baseVal) || '');
        out[pathOf(el) + (pseudo || '')] = rec;
      }
    }
    return out;
  }, STYLE_PROPS);
  require('fs').writeFileSync(file, require('zlib').gzipSync(JSON.stringify(data)));
  return Object.keys(data).length;
}
module.exports.dumpStyles = dumpStyles;
