// PIC-ASS-O — képernyőképek a JÁTÉK képernyőiről (v4.31)
// Két játékos végigjátszik egy teljes, egykörös játékot (2 rajz) a helyi
// játékszerveren, és minden fontos állapotról kép készül mindkét eszközön:
// váróterem, szóválasztás, rajzolás, tippelés, kör vége, játék vége.
// A változó részek (időzítők, pontszámok, szobakód) ki vannak takarva.
//
// Használat: node tests/visual/game.cjs <kimeneti mappa> [forgatókönyv]
// Összevetés: python3 tests/visual/diff.py <régi mappa> <új mappa>
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const H = require('../support/harness.cjs');

const SCENARIOS = {
  // asztali szobanyitó + álló telefon, Grafit téma
  a: { theme: 'graphite', host: { viewport: { width: 1400, height: 900 } }, guest: devices['Pixel 5'] },
  // fekvő telefon + kis álló telefon, világos (Krém) téma
  b: { theme: 'cream', host: devices['Pixel 5 landscape'], guest: devices['iPhone SE'] },
};

// ami futásonként változik (az idő áll, ezért az órák, pontok és visszaszámlálók nem kellenek ide)
const MASK = ['#lobby-code', '.online-count', '#online-count'];
const HIDE = '#fx-canvas, .floating-reaction{ visibility:hidden !important; } *{ caret-color:transparent !important; }';

async function snap(page, out, name) {
  if (process.env.VERBOSE) {
    const info = await page.evaluate(() => { const c = document.getElementById('fd-canvas'); if (!c || !c.offsetParent) return ''; const r = c.getBoundingClientRect(); const w = document.getElementById('fd-canvas-wrap').getBoundingClientRect(); return `vászon ${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.width.toFixed(1)}x${r.height.toFixed(1)} (tartó ${w.width.toFixed(1)}x${w.height.toFixed(1)}) belső ${c.width}x${c.height} görgetés ${scrollY}`; });
    console.log('  📸', name, info);
  }
  await page.mouse.move(1, 1);       // ne maradjon hover-állapotban gomb
  await page.waitForTimeout(450);   // a beúszó elemek (prefers-reduced-motion mellett is) álljanak meg
  const mask = MASK.map(s => page.locator(s));
  if (!page.hideStyled) { await page.addStyleTag({ content: HIDE }); page.hideStyled = true; }
  await page.screenshot({ path: path.join(out, name + '.png'), animations: 'disabled', caret: 'hide', mask, maskColor: '#ff00ff' });
  // STYLES=1: a kiszámított stílusok is (CSS-átalakítás ellenőrzéséhez — lásd tests/visual/style-diff.cjs)
  if (process.env.STYLES) await H.dumpStyles(page, path.join(out, name + '.styles.json.gz'));
}

async function run(key, out) {
  const sc = SCENARIOS[key];
  const servers = await H.startServers();
  const browser = await chromium.launch();
  const errors = [];
  try {
    const host = await H.newPlayer(browser, servers, `${key}-szobanyitó`, sc.host, { name: 'Anna', avatar: '#FFD166', theme: sc.theme, seed: 11, deterministic: true, fixedTime: true });
    const guest = await H.newPlayer(browser, servers, `${key}-vendég`, sc.guest, { name: 'Bence', avatar: '#5FB6DE', theme: sc.theme, seed: 22, deterministic: true, fixedTime: true });
    const tick = (s) => H.advanceClock([host, guest], s);
    const P = (role) => (role === 'host' ? host : guest);

    await H.createRoom(host, servers, { roomName: 'Képteszt', name: 'Anna', rounds: 1 });
    await H.joinRoom(guest, servers, await host.textContent('#lobby-code'), 'Bence');
    await host.waitForFunction(() => document.querySelectorAll('#lobby-players .player-chip:not(.pending)').length >= 2, null, { timeout: 20000 });
    await guest.waitForSelector('#screen-lobby:not(.hidden)');
    await snap(host, out, `${key}-01-varoterem-szobanyito`);
    await snap(guest, out, `${key}-01-varoterem-vendeg`);

    await host.click('#btn-start-match');
    // két rajz: előbb a szobanyitó (belépési sorrend), aztán a vendég
    for (const [n, drawerRole] of [[1, 'host'], [2, 'guest']]) {
      const drawer = P(drawerRole), guesser = P(drawerRole === 'host' ? 'guest' : 'host');
      const tag = `${key}-r${n}`;
      if (n === 2) {
        // a következő rajzoló "Én jövök" gombot kap (vagy magától indul)
        await Promise.race([
          drawer.waitForSelector('#btn-next-round-mine:visible', { timeout: 20000 }).then(b => b.click()).catch(() => {}),
          drawer.waitForSelector('#btn-prep-reveal:visible, #prep-choices button:visible', { timeout: 20000 }).catch(() => {}),
        ]);
      }
      await drawer.waitForSelector('#btn-prep-reveal:visible, #prep-choices button:visible', { timeout: 20000 });
      await snap(drawer, out, `${tag}-02-szovalasztas-elott`);
      if (await drawer.isVisible('#btn-prep-reveal')) await drawer.click('#btn-prep-reveal');
      await drawer.waitForSelector('#prep-choices button:visible');
      await snap(drawer, out, `${tag}-03-szovalasztas`);
      await snap(guesser, out, `${tag}-03-varakozas`);
      const word = await H.chooseFirstWord(drawer);
      await drawer.waitForSelector('#fd-canvas:visible');
      await snap(drawer, out, `${tag}-04-rajzlap-ures`);
      await H.drawSquiggle(drawer);
      await H.waitForDrawingOnWatch(guesser);
      await snap(drawer, out, `${tag}-05-rajzolas`);
      await snap(guesser, out, `${tag}-05-nezo`);
      if (n === 1) {
        // a játékbeli chat és menü is legyen lefedve
        await guesser.click('#chat-toggle-btn');
        await guesser.waitForSelector('#chat-panel:not(.hidden)');
        await snap(guesser, out, `${tag}-05b-chat-nezo`);
        await guesser.click('#chat-toggle-btn');
        await drawer.click('#screen-fulldraw .menu-open-btn');
        await drawer.waitForSelector('#ingame-menu-overlay:not(.hidden)');
        await snap(drawer, out, `${tag}-05c-menu-rajzolo`);
        await drawer.keyboard.press('Escape');
        if (await drawer.isVisible('#ingame-menu-overlay')) await drawer.click('#ingame-menu-overlay', { position: { x: 5, y: 5 } });
        await drawer.waitForSelector('#ingame-menu-overlay', { state: 'hidden' });
      }
      await tick(4);
      await H.guess(guesser, 'biztosannemezaszo');
      await guesser.waitForSelector('#watch-guess-feed .gentry');
      await drawer.waitForTimeout(300);
      await snap(guesser, out, `${tag}-06-rossz-tipp-nezo`);
      await snap(drawer, out, `${tag}-06-rossz-tipp-rajzolo`);
      await tick(4);
      await H.guess(guesser, word);
      for (const p of [guesser, drawer]) await p.waitForSelector('#screen-roundend:not(.hidden)', { timeout: 15000 });
      await snap(guesser, out, `${tag}-07-kor-vege-nezo`);
      await snap(drawer, out, `${tag}-07-kor-vege-rajzolo`);
    }
    for (const p of [host, guest]) await p.waitForSelector('#screen-gameend:not(.hidden)', { timeout: 30000 });
    await snap(host, out, `${key}-08-jatek-vege-szobanyito`);
    await snap(guest, out, `${key}-08-jatek-vege-vendeg`);
    errors.push(...host.pageErrors, ...guest.pageErrors);
  } finally {
    await browser.close();
    servers.stop();
  }
  return errors;
}

(async () => {
  const out = process.argv[2] || 'shots-game';
  const only = process.argv[3];
  fs.mkdirSync(out, { recursive: true });
  let errors = [];
  try {
    for (const key of Object.keys(SCENARIOS)) if (!only || only === key) errors = errors.concat(await run(key, out));
  } catch (e) {
    console.error('❌ ' + e.message); process.exitCode = 1; return;
  }
  if (errors.length) { console.log('OLDALHIBÁK:\n' + errors.join('\n')); process.exitCode = 1; }
  else console.log('kész:', out, `(${fs.readdirSync(out).filter(f => f.endsWith('.png')).length} kép)`);
})();
