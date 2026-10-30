// PIC-ASS-O — teljes kör két böngészőben (v4.30, v4.31: közös tesztkörnyezettel)
// Elindítja a saját játékszervert és egy statikus kiszolgálót, majd két
// játékos (egy asztali és egy telefonos nézet) végigjátszik egy kört:
// szobanyitás, belépés meghívó linkkel, indítás, szóválasztás, rajzolás,
// rossz és helyes tipp, kör vége. Közben ellenőrzi, hogy a titkos szó a tipp
// előtt nem jut el a nézőhöz a hálózaton. Külső hálózatot nem használ.
//
// Futtatás:  npm run test:e2e        (kell hozzá: Playwright + Chromium)
// Látható böngészővel:  HEADED=1 npm run test:e2e
const { chromium, devices } = require('playwright');
const H = require('../support/harness.cjs');

const step = (msg) => console.log('  •', msg);
const fail = (msg) => { throw new Error(msg); };

(async () => {
  const servers = await H.startServers();
  const browser = await chromium.launch({ headless: !process.env.HEADED });
  let ok = false, pages = [];
  try {
    const host = await H.newPlayer(browser, servers, 'szobanyitó', { viewport: { width: 1280, height: 800 } }, { name: 'Anna' });
    const guest = await H.newPlayer(browser, servers, 'vendég', devices['Pixel 5'], { name: 'Bence' });
    pages = [host, guest];

    step('szobanyitás');
    const code = await H.createRoom(host, servers, { roomName: 'E2E teszt', name: 'Anna' });
    step('szobakód: ' + code);

    step('belépés meghívó linkkel (telefon)');
    await H.joinRoom(guest, servers, code, 'Bence');
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
    const word = await H.chooseFirstWord(drawer);
    step('választott szó: ' + word);

    step('rajzolás');
    await H.drawSquiggle(drawer);

    step('a néző látja a rajzot');
    await H.waitForDrawingOnWatch(guesser);

    step('a titkos szó nem érkezett meg a nézőhöz a hálózaton');
    const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const leaked = guesser.framesIn.filter(f => norm(f).includes(norm(word)));
    if (leaked.length) fail(`a szó tipp előtt kiszivárgott ${leaked.length} üzenetben, pl.: ${leaked[0].slice(0, 300)}`);

    step('rossz, majd jó tipp');
    await H.guess(guesser, 'biztosannemezaszo');
    await guesser.waitForTimeout(400);
    await H.guess(guesser, word);

    step('kör vége mindkét eszközön');
    for (const p of [guesser, drawer]) {
      await p.waitForSelector('#screen-roundend:not(.hidden)', { timeout: 15000 });
      const shown = (await p.textContent('#roundend-word')) || '';
      if (!shown.toLowerCase().includes(word.toLowerCase())) fail(`a kör végén nem a szó látszik: "${shown}"`);
    }
    const errs = pages.flatMap(p => p.pageErrors);
    if (errs.length) fail('oldalhibák:\n' + errs.join('\n'));
    ok = true;
    console.log('✅ A teljes kör rendben lement.');
  } catch (e) {
    console.error('❌ ' + e.message);
    const errs = pages.flatMap(p => p.pageErrors || []);
    if (errs.length) console.error(errs.join('\n'));
  } finally {
    await browser.close();
    servers.stop();
    process.exitCode = ok ? 0 : 1;
  }
})();
