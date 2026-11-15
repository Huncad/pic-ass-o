// PIC-ASS-O — v4.42: vendégjelölés, gyorsreakció a tippekre (hosszan nyomva), a tipp célba érésének figyelése
// Futtatás: node tests/e2e/guessreact.cjs
const { chromium, devices } = require('playwright');
const H = require('../support/harness.cjs');
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`  ${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`); };
const prep = '#btn-prep-reveal:visible, #prep-choices button:visible';

(async () => {
  const servers = await H.startServers({ functions: true });
  const browser = await chromium.launch();
  try {
    const names = ['Anna', 'Bence', 'Cili'];
    const ps = [];
    for (const n of names) ps.push(await H.newPlayer(browser, servers, n, n === 'Cili' ? devices['Pixel 5'] : { viewport: { width: 1200, height: 850 } }));
    // v4.51: mindenkinek 9 jó tippje van — a következő jó tipp a „Jó szem” trófea
    for (const p of ps) await p.addInitScript(() => { try { if (!localStorage.getItem('picasso-stats')) localStorage.setItem('picasso-stats', JSON.stringify({ guessRounds: 9, guessHit: 9, since: Date.now() })); } catch (e) {} });
    console.log('Tiltott név:');
    await ps[0].goto(servers.base);
    await ps[0].fill('#home-name', '4dm1n');
    await ps[0].waitForTimeout(300);
    check('vendégként sem választható megtévesztő név', /megtévesztő/.test(await ps[0].textContent('#home-name-note')), await ps[0].textContent('#home-name-note'));
    await ps[0].click('#card-create');
    check('…és nem nyithat vele szobát', /megtévesztő/.test(await ps[0].textContent('#home-warning')) && await ps[0].isVisible('#screen-home'));
    const code = await H.createRoom(ps[0], servers, { roomName: 'Reakció', name: 'Anna' });
    await H.joinRoom(ps[1], servers, code, 'Bence');
    await H.joinRoom(ps[2], servers, code, 'Cili');
    await ps[0].waitForFunction(() => document.querySelectorAll('#lobby-players .player-chip:not(.pending)').length >= 3, null, { timeout: 25000 });
    console.log('Vendégjelölés:');
    await ps[1].waitForFunction(() => document.querySelectorAll('#lobby-players .guest-badge').length >= 3, null, { timeout: 8000 }).catch(() => {});
    check('fiók nélkül mindenki „vendég” jelölést kap a váróban', await ps[1].evaluate(() => document.querySelectorAll('#lobby-players .guest-badge').length) === 3);
    await ps[0].click('#btn-start-match');
    const di = await Promise.race(ps.map((p, i) => p.waitForSelector(prep, { timeout: 20000 }).then(() => i)));
    const drawer = ps[di], g = ps.filter((_, i) => i !== di);
    const word = await H.chooseFirstWord(drawer);
    await H.drawSquiggle(drawer);
    await H.waitForDrawingOnWatch(g[0]);
    await H.waitForDrawingOnWatch(g[1]);
    check('a játékban a vendég avatarja szaggatott keretes', await g[0].evaluate(() => document.querySelectorAll('.rav.acct-guest').length > 0));
    console.log('Gyorsreakció a tippre:');
    await g[0].fill('#watch-guess-input', 'biztosannemezaszo'); await g[0].press('#watch-guess-input', 'Enter');
    const entry = '#watch-guess-feed .gentry[data-gid]';
    await g[1].waitForSelector(entry, { timeout: 8000 });
    const box = await (await g[1].$(entry)).boundingBox();
    await g[1].mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await g[1].mouse.down(); await g[1].waitForTimeout(650); await g[1].mouse.up();
    check('hosszú nyomásra megjelenik a reakcióválasztó', await g[1].isVisible('.greact-row'));
    await g[1].click('.greact-row button[data-emoji="😂"]');
    await g[0].waitForSelector(`${entry} .greact-chip`, { timeout: 6000 }).catch(() => {});
    const chip = await g[0].$eval(entry, el => (el.querySelector('.greact-chip') || {}).textContent || '').catch(() => '');
    check('a tippelő látja a reakciót a saját tippjén', /😂\s*1/.test(chip), chip);
    const dchip = await drawer.$$eval('#fd-guess-feed [data-gid] .greact-chip', l => l.map(x => x.textContent).join(',')).catch(() => '');
    check('a rajzoló is látja', /😂/.test(dchip), dchip);
    console.log('Tipp célba érése:');
    await g[1].fill('#watch-guess-input', word); await g[1].press('#watch-guess-input', 'Enter');
    const ok = await g[0].waitForFunction(() => /eltalálta|kitalálta/.test(document.body.textContent), null, { timeout: 10000 }).then(() => true).catch(() => false);
    check('a jó tipp célba ér (elfogadja a játék)', ok);
    console.log('Trófea:');
    const toast = await g[1].waitForSelector('.trophy-toast', { timeout: 8000 }).then(t => t.textContent()).catch(() => '');
    check('játék közben felugrik az új trófea', /Új trófea: Jó szem/.test(toast), toast);
    for (const p of ps) check(`nincs JavaScript-hiba (${p.label})`, p.pageErrors.length === 0, p.pageErrors.join(' | '));
  } catch (e) {
    check('a teszt lefutott', false, e.message.split('\n')[0]);
  } finally { await browser.close(); servers.stop(); }
  const bad = results.filter(x => !x).length;
  console.log(bad ? `\n❌ ${bad} hiba` : `\n✅ mind a ${results.length} ellenőrzés rendben`);
  process.exit(bad ? 1 : 0);
})();
