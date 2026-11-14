// PIC-ASS-O — v4.44: jelzés a szobanyitónak, azonnali kirúgás megerősítéssel, visszalépés más névvel, kitiltott eszköz
// Futtatás: node tests/e2e/kick.cjs
const { chromium } = require('playwright');
const H = require('../support/harness.cjs');
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`  ${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`); };
const view = { viewport: { width: 1200, height: 850 } };
const chips = p => p.evaluate(() => [...document.querySelectorAll('#lobby-players .player-chip')].map(c => c.textContent.replace(/\s+/g, ' ').trim()));

(async () => {
  const servers = await H.startServers();
  const browser = await chromium.launch();
  try {
    const [a, b, c] = [await H.newPlayer(browser, servers, 'Anna', view), await H.newPlayer(browser, servers, 'Bence', view), await H.newPlayer(browser, servers, 'Cili', view)];
    const code = await H.createRoom(a, servers, { roomName: 'Kirúgás', name: 'Anna' });
    await H.joinRoom(b, servers, code, 'Bence');
    await H.joinRoom(c, servers, code, 'Cili');
    await a.waitForFunction(() => document.querySelectorAll('#lobby-players .player-chip:not(.pending)').length >= 3, null, { timeout: 25000 });
    console.log('Jelzés a szobanyitónak:');
    await b.waitForFunction(() => document.querySelectorAll('#lobby-players .lobby-vote-btn').length >= 1);
    const btnIdx = await b.evaluate(() => [...document.querySelectorAll('#lobby-players .player-chip')].findIndex(ch => /Cili/.test(ch.textContent)));
    await b.locator('#lobby-players .player-chip').nth(btnIdx).locator('.lobby-vote-btn').click();
    await b.waitForSelector('.pc-confirm');
    check('a vendégnek választás jelenik meg (szavazás / jelzés)', await b.isVisible('.pc-confirm button:has-text("Jelzés")') && await b.isVisible('.pc-confirm button:has-text("Szavazás")'));
    await b.click('.pc-confirm button:has-text("Jelzés")');
    await a.waitForSelector('.kickreq-toast', { timeout: 8000 }).catch(() => {});
    check('a szobanyitó látja a jelzést', /Bence szerint Cili/.test(await a.textContent('.kickreq-toast').catch(() => '')));
    check('a többiek nem látják', !(await c.isVisible('.kickreq-toast')) && !(await b.isVisible('.kickreq-toast')));
    // ugyanaz a jelzés még egyszer: nem megy ki újra
    await b.locator('#lobby-players .player-chip').nth(btnIdx).locator('.lobby-vote-btn').click();
    await b.click('.pc-confirm button:has-text("Jelzés")');
    await b.waitForSelector('.pc-confirm');
    check('ugyanazt kétszer nem lehet jelezni', /Már jelezted/.test(await b.textContent('.pc-confirm')));
    await b.click('.pc-confirm button');
    console.log('Kirúgás:');
    await a.click('.kickreq-toast button:has-text("Kirúgom")');
    await a.waitForSelector('.pc-confirm');
    check('a szobanyitótól megerősítést kér', /kitiltod Cili/.test(await a.textContent('.pc-confirm')));
    await a.click('.pc-confirm button:has-text("Kirúgom")');
    await c.waitForFunction(() => !document.getElementById('screen-home').classList.contains('hidden'), null, { timeout: 10000 });
    check('Cili kikerült a szobából', true);
    await a.waitForTimeout(500);
    check('a szobanyitónál már csak ketten vannak', (await chips(a)).length === 2, (await chips(a)).join(' | '));
    // visszalépés más névvel, újratöltött oldallal
    await c.reload(); await c.waitForFunction(() => !document.body.classList.contains('booting'));
    await H.joinRoom(c, servers, code, 'Álnév');
    await c.waitForTimeout(4000);
    const onHome = await c.evaluate(() => !document.getElementById('screen-home').classList.contains('hidden') || !document.getElementById('screen-join').classList.contains('hidden'));
    check('más névvel, újratöltve sem jöhet vissza', onHome && (await chips(a)).length === 2, await c.textContent('#home-warning').catch(() => ''));
    console.log('Végleg kitiltott eszköz:');
    const d = await H.newPlayer(browser, servers, 'Tiltott', view);
    await d.addInitScript(() => { try { localStorage.setItem('picasso-lk', '1'); } catch (e) {} });
    await d.goto(servers.base);
    await d.waitForFunction(() => /Ki vagy tiltva/.test(document.body.textContent), null, { timeout: 10000 }).catch(() => {});
    check('a kitiltott eszközön a játék el sem indul', /Ki vagy tiltva/.test(await d.textContent('body')));
    // a jel a localStorage törlése után is megmarad (süti / IndexedDB)
    await d.evaluate(() => localStorage.clear());
    await d.context().clearCookies();
    const e2 = await d.context().newPage();
    await e2.goto(servers.base);
    await e2.waitForTimeout(2500);
    check('a localStorage és a sütik törlése után is kitiltva marad', /Ki vagy tiltva/.test(await e2.textContent('body')));
    for (const p of [a, b, c]) check(`nincs JavaScript-hiba (${p.label})`, p.pageErrors.length === 0, p.pageErrors.join(' | '));
  } catch (e) {
    check('a teszt lefutott', false, e.message.split('\n')[0]);
  } finally { await browser.close(); servers.stop(); }
  const bad = results.filter(x => !x).length;
  console.log(bad ? `\n❌ ${bad} hiba` : `\n✅ mind a ${results.length} ellenőrzés rendben`);
  process.exit(bad ? 1 : 0);
})();
