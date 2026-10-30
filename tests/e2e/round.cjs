// PIC-ASS-O — teljes kör két böngészőben (v4.30)
// Elindítja a saját játékszervert (server/server.js) és egy statikus
// kiszolgálót, majd két játékos (egy asztali és egy telefonos nézet)
// végigjátszik egy kört: szobanyitás, belépés meghívó linkkel, indítás,
// szóválasztás, rajzolás, helyes tipp, kör vége. Külső hálózatot nem használ.
//
// Futtatás:  npm run test:e2e        (kell hozzá: Playwright + Chromium)
// Látható böngészővel:  HEADED=1 npm run test:e2e
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRV_PORT = 21000 + Math.floor(Math.random() * 9000);
const WEB_PORT = SRV_PORT + 1;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' };

function staticServer() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(WEB_PORT, '127.0.0.1');
}

const step = (msg) => console.log('  •', msg);
const fail = (msg) => { throw new Error(msg); };

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'picasso-e2e-'));
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: { ...process.env, PORT: String(SRV_PORT), DATA_DIR: dataDir }, stdio: 'ignore'
  });
  const web = staticServer();
  const browser = await chromium.launch({ headless: !process.env.HEADED });
  const pageErrors = [];
  let ok = false;
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${SRV_PORT}/api/health`)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
    const base = `http://127.0.0.1:${WEB_PORT}/`;
    const mk = async (label, opts, name) => {
      const ctx = await browser.newContext(opts);
      // csak a helyi gépet érheti el: a P2P-hálózatok és a Netlify-függvények kiesnek (a játék ilyenkor is működik)
      await ctx.route('**/*', r => (/^https?:\/\/127\.0\.0\.1[:/]|^wss?:\/\/127\.0\.0\.1[:/]/.test(r.request().url()) ? r.continue() : r.abort()));
      await ctx.addInitScript(([port, nm]) => {
        localStorage.setItem('picasso-server-url', 'http://127.0.0.1:' + port);
        localStorage.setItem('picasso-tutorial-seen', '1');
        localStorage.setItem('picasso-name', nm);
      }, [SRV_PORT, name]);
      const p = await ctx.newPage();
      p.on('pageerror', e => pageErrors.push(`${label}: ${e.message}`));
      // minden bejövő hálózati üzenet, hogy ellenőrizni lehessen: a titkos szó nem szivárog ki
      p.frames_in = [];
      p.on('websocket', ws => ws.on('framereceived', f => p.frames_in.push(String(f.payload))));
      return p;
    };
    const host = await mk('szobanyitó', { viewport: { width: 1280, height: 800 } }, 'Anna');
    const guest = await mk('vendég', devices['Pixel 5'], 'Bence');

    step('szobanyitás');
    await host.goto(base);
    await host.fill('#home-name', 'Anna');
    await host.click('#card-create');
    await host.fill('#room-name-input', 'E2E teszt');
    await host.click('#btn-create-room');
    await host.waitForFunction(() => /^[A-Z0-9]{5}$/.test((document.getElementById('lobby-code') || {}).textContent || ''), null, { timeout: 15000 });
    const code = (await host.textContent('#lobby-code')).trim();
    step('szobakód: ' + code);

    step('belépés meghívó linkkel (telefon)');
    await guest.goto(base + '?join=' + code);
    await guest.fill('#home-name', 'Bence');
    await guest.click('#btn-invite-join');
    await host.waitForFunction(() => document.querySelectorAll('#lobby-players .player-chip:not(.pending)').length >= 2, null, { timeout: 20000 });

    step('indítás');
    await host.click('#btn-start-match');
    // ki rajzol először? Akinél megjelenik a szóválasztás.
    const drawerIs = await Promise.race([
      host.waitForSelector('#btn-prep-reveal:visible, #prep-choices button:visible', { timeout: 20000 }).then(() => 'host'),
      guest.waitForSelector('#btn-prep-reveal:visible, #prep-choices button:visible', { timeout: 20000 }).then(() => 'guest'),
    ]);
    const drawer = drawerIs === 'host' ? host : guest;
    const guesser = drawerIs === 'host' ? guest : host;
    step('rajzol: ' + (drawerIs === 'host' ? 'Anna (gép)' : 'Bence (telefon)'));
    if (await drawer.isVisible('#btn-prep-reveal')) await drawer.click('#btn-prep-reveal');
    await drawer.waitForSelector('#prep-choices button:visible', { timeout: 10000 });
    const btn = drawer.locator('#prep-choices button').first();
    // a gomb a betűszámot is mutatja, pl. "motorblokk (10)"
    const word = (await btn.textContent()).replace(/\s*\(\d+\)\s*$/, '').trim();
    await btn.click();
    step('választott szó: ' + word);

    step('rajzolás');
    const box = await (await drawer.waitForSelector('#fd-canvas:visible', { timeout: 10000 })).boundingBox();
    if (!box) fail('nincs rajzlap');
    await drawer.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await drawer.mouse.down();
    for (let i = 1; i <= 20; i++) await drawer.mouse.move(box.x + box.width * (0.3 + i * 0.02), box.y + box.height * (0.3 + Math.sin(i / 3) * 0.1));
    await drawer.mouse.up();

    step('a néző látja a rajzot');
    await guesser.waitForSelector('#watch-guess-input:visible', { timeout: 15000 });
    await guesser.waitForFunction(() => {
      const c = document.getElementById('watch-canvas'); if (!c || !c.width) return false;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      // van-e a papírtól eltérő (sötét) képpont
      for (let i = 0; i < d.length; i += 4 * 7) if (d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120 && d[i + 3] > 200) return true;
      return false;
    }, null, { timeout: 15000 });

    step('a titkos szó nem érkezett meg a nézőhöz a hálózaton');
    // a pillanatképet is kérjük: régen ebben (és a kör kihirdetésében) olvashatóan benne volt
    const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const leaked = guesser.frames_in.filter(f => norm(f).includes(norm(word)));
    if (leaked.length) fail(`a szó tipp előtt kiszivárgott ${leaked.length} üzenetben, pl.: ${leaked[0].slice(0, 300)}`);

    step('rossz, majd jó tipp');
    await guesser.fill('#watch-guess-input', 'biztosannemezaszo');
    await guesser.press('#watch-guess-input', 'Enter');
    await guesser.waitForTimeout(400);
    await guesser.fill('#watch-guess-input', word);
    await guesser.press('#watch-guess-input', 'Enter');

    step('kör vége mindkét eszközön');
    for (const p of [guesser, drawer]) {
      await p.waitForSelector('#screen-roundend:not(.hidden)', { timeout: 15000 });
      const shown = (await p.textContent('#roundend-word')) || '';
      if (!shown.toLowerCase().includes(word.toLowerCase())) fail(`a kör végén nem a szó látszik: "${shown}"`);
    }
    if (pageErrors.length) fail('oldalhibák:\n' + pageErrors.join('\n'));
    ok = true;
    console.log('✅ A teljes kör rendben lement.');
  } catch (e) {
    console.error('❌ ' + e.message);
    if (pageErrors.length) console.error(pageErrors.join('\n'));
  } finally {
    await browser.close();
    web.close();
    srv.kill('SIGTERM');
    process.exitCode = ok ? 0 : 1;
  }
})();
