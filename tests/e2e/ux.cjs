// PIC-ASS-O — a v4.33 javításainak böngészős ellenőrzése
// Betöltés (CLS, azonnal látható kezdőképernyő), MQTT csak szerver nélkül,
// avatarok billentyűzettel, saját megerősítő ablak + helyi tiltólista,
// nem létező kód gyors hibája, visszalépés frissítés után, kilépés előtti kérdés.
// Futtatás: node tests/e2e/ux.cjs   (a CSP a _headers szerint érvényes)
const { chromium, devices } = require('playwright');
const H = require('../support/harness.cjs');

const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`  ${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`); };
const scr = p => p.evaluate(() => [...document.querySelectorAll('[id^=screen-]')].filter(e => !e.classList.contains('hidden')).map(e => e.id).join(','));
const BROKERS = /emqx|hivemq|mosquitto/;

(async () => {
  const servers = await H.startServers();
  const browser = await chromium.launch();
  const pages = [];
  try {
    // ---- betöltés lassított telefonon ----
    console.log('Betöltés:');
    const p = await H.newPlayer(browser, servers, 'betöltés', devices['Pixel 5'], { name: 'Perf' });
    pages.push(p);
    const ws = []; p.on('websocket', w => ws.push(w.url()));
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await p.addInitScript(() => { window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
    const t0 = Date.now();
    await p.goto(servers.base, { waitUntil: 'commit' });
    await p.waitForFunction(() => { const h = document.getElementById('screen-home'); return h && !h.classList.contains('hidden') && h.getBoundingClientRect().height > 200; }, null, { polling: 20, timeout: 20000 });
    const tHome = Date.now() - t0;
    await p.waitForFunction(() => !document.body.classList.contains('booting'), null, { timeout: 30000 });
    await p.waitForTimeout(4000);
    const cls = await p.evaluate(() => window.__cls);
    check('a kezdőképernyő azonnal látszik (nem vár a P2P-könyvtárakra)', tHome < 1500, `${tHome} ms`);
    check('nincs számottevő elrendezés-ugrás (CLS < 0,1)', cls < 0.1, `CLS ${cls.toFixed(3)}`);
    check('szerver módban nem kapcsolódik nyilvános MQTT-brókerhez', !ws.some(u => BROKERS.test(u)), ws.filter(u => BROKERS.test(u)).join(' ') || 'egy sem');
    // avatarok billentyűzettel
    const tabStops = await p.evaluate(() => [...document.querySelectorAll('#home-avatars .home-av')].filter(b => b.tabIndex === 0).length);
    check('az avatarok egyetlen Tab-megállót adnak', tabStops === 1, `${tabStops} megálló`);
    await p.focus('#home-avatars .home-av[tabindex="0"]');
    const before = await p.evaluate(() => document.querySelector('#home-avatars .home-av[aria-checked="true"]').getAttribute('aria-label'));
    await p.keyboard.press('ArrowRight');
    const after = await p.evaluate(() => ({ sel: document.querySelector('#home-avatars .home-av[aria-checked="true"]').getAttribute('aria-label'), focused: document.activeElement.getAttribute('aria-label'), outline: getComputedStyle(document.activeElement).outlineStyle }));
    check('nyíllal a következő avatar lesz kiválasztva és fókuszban, látható kerettel', after.sel !== before && after.focused === after.sel && after.outline !== 'none', `${before} → ${after.sel}, keret: ${after.outline}`);
    await p.context().close();

    // ---- nem létező kód ----
    console.log('Nem létező szobakód:');
    const solo = await H.newPlayer(browser, servers, 'egyedül', devices['Pixel 5'], { name: 'Egyedül' });
    pages.push(solo);
    await solo.goto(servers.base + '?join=ZZZZZ');
    await solo.fill('#home-name', 'Egyedül');
    const tj = Date.now();
    await solo.click('#btn-invite-join');
    await solo.waitForFunction(() => /Nincs ilyen nyitott szoba/.test((document.getElementById('join-warning') || {}).textContent || ''), null, { timeout: 40000 }).catch(() => {});
    const msg = await solo.evaluate(() => (document.getElementById('join-warning') || {}).textContent || '');
    check('nem létező kódnál gyorsan, egyértelmű hiba', /Nincs ilyen nyitott szoba/.test(msg) && Date.now() - tj < 35000, `${Math.round((Date.now() - tj) / 1000)} mp: „${msg.slice(0, 70)}”`);
    await solo.context().close();

    // ---- kirúgás saját ablakkal, helyi tiltólista ----
    console.log('Kirúgás:');
    const host = await H.newPlayer(browser, servers, 'szobanyitó', { viewport: { width: 1280, height: 800 } }, { name: 'Anna' });
    const cili = await H.newPlayer(browser, servers, 'Cili', { viewport: { width: 1100, height: 800 } }, { name: 'Cili' });
    const bence = await H.newPlayer(browser, servers, 'Bence', devices['Pixel 5'], { name: 'Bence' });
    pages.push(host, cili, bence);
    let nativeDialog = false; host.on('dialog', d => { nativeDialog = true; d.dismiss(); });
    const code = await H.createRoom(host, servers, { roomName: 'UX' });
    await H.joinRoom(cili, servers, code, 'Cili');
    await H.joinRoom(bence, servers, code, 'Bence');
    await host.waitForFunction(() => document.querySelectorAll('#lobby-players .player-chip:not(.pending)').length >= 3, null, { timeout: 20000 });
    await host.evaluate(() => { const chip = [...document.querySelectorAll('#lobby-players .player-chip')].find(c => /Cili/.test(c.textContent)); chip.querySelector('.lobby-kick-btn').click(); });
    await host.waitForSelector('.pc-confirm', { timeout: 3000 });
    check('a kirúgás a játék saját megerősítő ablakát nyitja (nem a böngészőét)', !nativeDialog && (await host.isVisible('.pc-confirm')));
    await host.click('.pc-confirm button:has-text("Kirúgom")');
    await cili.waitForFunction(() => /eltávolított/.test(document.getElementById('home-warning').textContent), null, { timeout: 8000 }).catch(() => {});
    check('a kirúgott játékos üzenetet kap', /eltávolított/.test(await cili.evaluate(() => document.getElementById('home-warning').textContent)));
    await H.joinRoom(cili, servers, code, 'Cili');
    await cili.waitForTimeout(5000);
    const n = await host.evaluate(() => document.querySelectorAll('#lobby-players .player-chip:not(.pending)').length);
    check('a kirúgott eszköz nem léphet vissza, akkor sem, ha a tiltó szerver nem érhető el', n === 2, `${n} játékos a váróteremben; Cili: ${await scr(cili)}`);

    // ---- frissítés játék közben → visszalépés; Vissza gomb kérdez ----
    console.log('Frissítés és Vissza gomb:');
    await host.click('#btn-start-match');
    const w = await H.chooseFirstWord(host);
    await H.drawSquiggle(host);
    await H.waitForDrawingOnWatch(bence);
    let asked = false;
    bence.on('dialog', d => { if (d.type() === 'beforeunload') asked = true; d.accept(); });
    await bence.mouse.click(5, 5);   // a böngésző csak felhasználói interakció után kérdez
    await bence.reload();
    await bence.waitForTimeout(2500);
    check('frissítés előtt a böngésző rákérdez (játék közben)', asked);
    const hint = await bence.evaluate(() => (document.getElementById('invite-room-hint') || {}).textContent || '');
    check('frissítés után felajánlja a visszalépést', /visszaléphetsz/.test(hint), hint.slice(0, 70));
    await bence.click('#btn-invite-join');
    await bence.waitForSelector('#screen-watch:not(.hidden)', { timeout: 25000 }).catch(() => {});
    check('egy koppintással visszakerül a játékba', /screen-watch/.test(await scr(bence)), await scr(bence));
    const errs = pages.flatMap(pg => [...pg.pageErrors, ...pg.cspViolations.map(v => 'CSP: ' + v)]);
    check('nincs oldalhiba és CSP-tiltás', !errs.length, errs.slice(0, 3).join(' | '));
    void w;
  } catch (e) {
    console.error('❌ ' + e.message.split('\n')[0]); results.push(false);
  } finally {
    await browser.close();
    servers.stop();
    const ok = results.length && results.every(Boolean);
    console.log(ok ? '✅ Minden v4.33-as javítás működik.' : '❌ Valami nem stimmel.');
    process.exitCode = ok ? 0 : 1;
  }
})();
