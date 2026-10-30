// PIC-ASS-O — képernyőképek a vizuális összehasonlításhoz (v4.30)
// Használat: node tests/visual/snap.cjs http://127.0.0.1:8765/ <kimeneti mappa>
// Külső hálózatot nem ér el (determinisztikus kép), az animációk kikapcsolva.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const VIEWS = [
  ['mobile', devices['Pixel 5']],
  ['iphone-se', devices['iPhone SE']],
  ['desktop', { viewport: { width: 1400, height: 900 } }],
];
const THEMES = ['graphite', 'cream'];

(async () => {
  const base = process.argv[2] || 'http://127.0.0.1:8765/';
  const out = process.argv[3] || 'shots';
  fs.mkdirSync(out, { recursive: true });
  const host = new URL(base).host;
  const browser = await chromium.launch();
  const errors = [];
  for (const [name, opts] of VIEWS) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
      await ctx.route('**/*', r => (new URL(r.request().url()).host === host ? r.continue() : r.abort()));
      await ctx.addInitScript(([t]) => {
        try {
          localStorage.setItem('picasso-tutorial-seen', '1');
          localStorage.setItem('picasso-avatar-color', '#5FB6DE');
          localStorage.setItem('picasso-theme', t);
          localStorage.setItem('picasso-name', 'Teszt');
        } catch (e) {}
        Math.random = () => 0.42;
      }, [theme]);
      const p = await ctx.newPage();
      p.on('pageerror', e => errors.push(`${name}/${theme}: ${e.message}`));
      await p.goto(base, { waitUntil: 'load' });
      await p.waitForTimeout(1200);
      await p.addStyleTag({ content: '*{caret-color:transparent!important} #online-count, .online-count{visibility:hidden!important}' });
      await p.screenshot({ path: path.join(out, `${name}-${theme}-home.png`), fullPage: true });
      await p.click('#card-create').catch(() => {});
      await p.waitForTimeout(500);
      await p.screenshot({ path: path.join(out, `${name}-${theme}-create.png`), fullPage: true });
      await ctx.close();
    }
  }
  await browser.close();
  if (errors.length) { console.log('OLDALHIBÁK:\n' + errors.join('\n')); process.exitCode = 1; }
  else console.log('kész:', out);
})();
