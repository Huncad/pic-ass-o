// PIC-ASS-O — képernyőképek a menükről és ablakokról (v4.31)
// Kezdőképernyő, súgó, adatvédelem, visszajelzés, statisztika, kiadási napló,
// témaválasztó, beállítások, feliratkozás, szobabeállítás (csukva / nyitva),
// admin belépés — több kijelzőn és témában.
// Használat: node tests/visual/menus.cjs <kimeneti mappa>   (STYLES=1: kiszámított stílusok is)
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const H = require('../support/harness.cjs');

const VIEWS = [
  ['asztali', { viewport: { width: 1400, height: 900 } }, 'graphite', false],
  ['telefon', devices['Pixel 5'], 'graphite', false],
  ['telefon-sotet', devices['Pixel 5'], 'graphite', true],
  ['telefon-kremes', devices['Pixel 5'], 'cream', false],
  ['iphonese', devices['iPhone SE'], 'graphite', false],
  ['fekvo', devices['Pixel 5 landscape'], 'graphite', false],
];
const STATES = [
  ['kezdo', null],
  ['sugo', p => p.click('#btn-open-tutorial')],
  ['adatvedelem', p => p.click('#btn-open-privacy')],
  ['visszajelzes', p => p.click('#btn-open-feedback')],
  ['statisztika', p => p.click('#btn-open-stats')],
  ['naplo', p => p.click('#app-version')],
  ['tema', p => p.click('#theme-toggle-btn')],
  ['beallitasok', async p => { await p.click('#card-create'); await p.click('#settings-fab', { timeout: 3000 }); }],
  ['feliratkozas', p => p.click('#sub-toggle')],
  ['szobabeallitas', p => p.click('#card-create')],
  ['szobabeallitas-nyitva', async p => { await p.click('#card-create'); if (await p.isVisible('#setup-advanced-toggle')) await p.click('#setup-advanced-toggle'); }],
  ['admin', p => p.evaluate(() => { location.hash = '#admin'; })],
];
const HIDE = '#fx-canvas{ visibility:hidden !important; } *{ caret-color:transparent !important; } html, body, *{ scroll-behavior:auto !important; }';

(async () => {
  const out = process.argv[2] || 'shots-menus';
  fs.mkdirSync(out, { recursive: true });
  const servers = await H.startServers();
  const browser = await chromium.launch();
  const errors = [];
  try {
    for (const [vname, opts, theme, dark] of VIEWS) {
      const page = await H.newPlayer(browser, servers, vname, opts, { name: 'Teszt', avatar: '#5FB6DE', theme, seed: 5, deterministic: true, fixedTime: true });
      if (dark) await page.addInitScript(() => { try { localStorage.setItem('picasso-dark-mode', '1'); } catch (e) {} });
      for (const [sname, act] of STATES) {
        await page.goto(servers.base);
        // a szobalista állapota a helyi szerverhez kapcsolódás után áll be (addig üres, és telefonon egy sornyi magasság)
        await page.waitForFunction(() => { const s = document.getElementById('room-list-status'); return s && s.textContent.trim().length > 0; }, null, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(500);
        await page.addStyleTag({ content: HIDE });
        if (act) {
          try { await act(page); } catch (e) { console.log(`  (kihagyva: ${vname}-${sname} — nem elérhető ezen a kijelzőn)`); continue; }
          await page.waitForTimeout(450);
        }
        // determinisztikus kép: az egér ne álljon gomb fölött (hover), a lap a tetején legyen
        await page.mouse.move(1, 1);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(200);
        const name = `${vname}-${sname}`;
        await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true, animations: 'disabled', caret: 'hide',
          mask: [page.locator('.online-count'), page.locator('#online-count')], maskColor: '#ff00ff' });
        if (process.env.STYLES) await H.dumpStyles(page, path.join(out, name + '.styles.json.gz'));
      }
      errors.push(...page.pageErrors);
      await page.context().close();
    }
  } finally { await browser.close(); servers.stop(); }
  if (errors.length) { console.log('OLDALHIBÁK:\n' + errors.join('\n')); process.exitCode = 1; }
  else console.log('kész:', out, `(${fs.readdirSync(out).filter(f => f.endsWith('.png')).length} kép)`);
})();
