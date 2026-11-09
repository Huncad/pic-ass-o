// PIC-ASS-O — a v4.36 újdonságainak böngészős ellenőrzése
// Gyakorlás egyedül, csapatmód, eltűnő tinta, egy vonal.
// Futtatás: node tests/e2e/modes.cjs
const { chromium, devices } = require('playwright');
const H = require('../support/harness.cjs');

const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`  ${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`); };
const scr = p => p.evaluate(() => [...document.querySelectorAll('[id^=screen-]')].filter(e => !e.classList.contains('hidden')).map(e => e.id).join(','));
const hasInk = (p, id) => p.evaluate((id) => {
  const c = document.getElementById(id); if (!c || !c.width) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < d.length; i += 4 * 7) if (d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120 && d[i + 3] > 200) return true;
  return false;
}, id);
const teams = p => p.evaluate(() => { const o = {}; document.querySelectorAll('#watch-roster .rchip, #fd-roster .rchip').forEach(c => { const n = c.querySelector('.rname').textContent; o[n] = c.classList.contains('team-a') ? 'A' : c.classList.contains('team-b') ? 'B' : '-'; }); return o; });
const whoDraws = async (pages) => Promise.race(pages.map(p => p.waitForSelector('#btn-prep-reveal:visible, #prep-choices button:visible', { timeout: 20000 }).then(() => p)));

(async () => {
  const servers = await H.startServers();
  const browser = await chromium.launch();
  const all = [];
  try {
    // ---- gyakorlás egyedül ----
    console.log('Gyakorlás egyedül:');
    const solo = await H.newPlayer(browser, servers, 'egyedül', devices['Pixel 5'], { name: 'Solo' });
    all.push(solo);
    const ws = []; solo.on('websocket', w => ws.push(w.url()));
    await solo.goto(servers.base);
    await solo.waitForFunction(() => !document.body.classList.contains('booting'), null, { timeout: 30000 });
    await solo.fill('#home-name', 'Solo');
    await solo.click('#btn-practice');
    await solo.waitForSelector('#fd-canvas:visible', { timeout: 8000 });
    const w1 = (await solo.textContent('#fd-word-text')).trim();
    check('a rajzlap megnyílik egy szóval, szoba nélkül', !!w1 && /fulldraw/.test(await scr(solo)), `szó: ${w1}`);
    await H.drawSquiggle(solo);
    check('lehet rajzolni', await hasInk(solo, 'fd-canvas'));
    await solo.click('#screen-fulldraw .menu-open-btn');
    await solo.click('#menu-btn-practice-next');
    await solo.waitForFunction((w) => (document.getElementById('fd-word-text').textContent || '').trim() !== w, w1, { timeout: 5000 }).catch(() => {});
    const w2 = (await solo.textContent('#fd-word-text')).trim();
    check('a menüből új szó kérhető, tiszta lappal', w2 && w2 !== w1 && !(await hasInk(solo, 'fd-canvas')), `új szó: ${w2}`);
    await solo.click('#screen-fulldraw .menu-open-btn');
    await solo.click('#menu-btn-leave');
    if (await solo.isVisible('.pc-confirm')) await solo.click('.pc-confirm-row button:last-child');
    await solo.waitForSelector('#screen-home:not(.hidden)', { timeout: 5000 }).catch(() => {});
    check('kilépés után a kezdőképernyő jön', /screen-home/.test(await scr(solo)), await scr(solo));
    await solo.click('#card-create');
    check('utána rendesen lehet szobát nyitni', await solo.isVisible('#btn-create-room'));
    await solo.context().close();

    // ---- csapatmód + eltűnő tinta ----
    console.log('Csapatmód és eltűnő tinta:');
    const host = await H.newPlayer(browser, servers, 'Anna', { viewport: { width: 1280, height: 800 } }, { name: 'Anna' });
    const b = await H.newPlayer(browser, servers, 'Bence', devices['Pixel 5'], { name: 'Bence' });
    const c = await H.newPlayer(browser, servers, 'Cili', { viewport: { width: 1100, height: 800 } }, { name: 'Cili' });
    const d = await H.newPlayer(browser, servers, 'Dani', { viewport: { width: 1100, height: 800 } }, { name: 'Dani' });
    const four = [host, b, c, d]; all.push(...four);
    const code = await H.createRoom(host, servers, { roomName: 'Csapat', name: 'Anna', rounds: 1, pills: ['[data-teammode="on"]', '[data-drawmode="fade"]'] });
    await H.joinRoom(b, servers, code, 'Bence'); await H.joinRoom(c, servers, code, 'Cili'); await H.joinRoom(d, servers, code, 'Dani');
    await host.waitForFunction(() => document.querySelectorAll('#lobby-players .player-chip:not(.pending)').length >= 4, null, { timeout: 25000 });
    await host.click('#btn-start-match');
    const drawer = await whoDraws(four);
    const others = four.filter(p => p !== drawer);
    const word = await H.chooseFirstWord(drawer);
    await H.drawSquiggle(drawer);
    await H.waitForDrawingOnWatch(others[0]);
    const tv = await Promise.all(four.map(teams));
    const same = tv.every(t => JSON.stringify(Object.entries(t).sort()) === JSON.stringify(Object.entries(tv[0]).sort()));
    const sizes = Object.values(tv[0]).reduce((o, t) => (o[t] = (o[t] || 0) + 1, o), {});
    check('mind a 4 eszköz ugyanazt a csapatbeosztást látja, 2–2 fővel', same && sizes.A === 2 && sizes.B === 2, JSON.stringify(tv[0]));
    check('látszik a csapatpontszám', await others[0].isVisible('#watch-roster .team-score'));
    check('a rajz megérkezik a nézőhöz', await hasInk(others[0], 'watch-canvas'));
    if (process.env.SHOTS) { await b.screenshot({ path: process.env.SHOTS + '/team-phone.png' }); await host.screenshot({ path: process.env.SHOTS + '/team-desktop.png' }); }
    await drawer.waitForTimeout(7500);
    check('eltűnő tinta: 6 mp után eltűnik a rajzolónál és a nézőnél is', !(await hasInk(drawer, 'fd-canvas')) && !(await hasInk(others[0], 'watch-canvas')));
    await H.drawSquiggle(drawer);
    await others[0].waitForTimeout(600);
    await H.guess(others[0], word);
    for (const p of four) await p.waitForSelector('#screen-roundend:not(.hidden)', { timeout: 15000 });
    const rows = await others[1].evaluate(() => [...document.querySelectorAll('#screen-roundend tr.team-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()));
    check('a kör végén csapatsorok is vannak a táblázatban', rows.length === 2, rows.join(' | '));
    const sum = await others[1].evaluate(() => { const n = s => parseInt((s.match(/(\d+) pont/) || [])[1] || '0', 10); const t = [...document.querySelectorAll('#screen-roundend tr.team-row')].reduce((a, r) => a + n(r.textContent), 0); const p = [...document.querySelectorAll('#screen-roundend tr:not(.team-row)')].reduce((a, r) => a + n(r.textContent), 0); return [t, p]; });
    check('a csapatpontok összege = a játékosok pontjainak összege', sum[0] === sum[1] && sum[0] > 0, `${sum[0]} / ${sum[1]}`);
    if (process.env.SHOTS) await b.screenshot({ path: process.env.SHOTS + '/team-roundend.png', fullPage: true });
    const errs4 = four.flatMap(p => [...p.pageErrors, ...p.cspViolations.map(v => 'CSP: ' + v)]);
    check('nincs oldalhiba (csapatmód)', !errs4.length, errs4.slice(0, 3).join(' | '));
    for (const p of four) await p.context().close();

    // ---- egy vonal ----
    console.log('Egy vonal:');
    const h2 = await H.newPlayer(browser, servers, 'Anna', { viewport: { width: 1280, height: 800 } }, { name: 'Anna' });
    const g2 = await H.newPlayer(browser, servers, 'Bence', { viewport: { width: 1100, height: 800 } }, { name: 'Bence' });
    all.push(h2, g2);
    const code2 = await H.createRoom(h2, servers, { roomName: 'Vonal', name: 'Anna', rounds: 1, pills: ['[data-drawmode="oneline"]'] });
    await H.joinRoom(g2, servers, code2, 'Bence');
    await h2.waitForFunction(() => document.querySelectorAll('#lobby-players .player-chip:not(.pending)').length >= 2, null, { timeout: 20000 });
    await h2.click('#btn-start-match');
    const dr = await whoDraws([h2, g2]);
    await H.chooseFirstWord(dr);
    await H.drawSquiggle(dr);
    const box = await (await dr.$('#fd-canvas')).boundingBox();
    await dr.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8); await dr.mouse.down();
    await dr.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.85, { steps: 5 }); await dr.mouse.up();
    const toast = await dr.evaluate(() => { const t = document.getElementById('fd-toast'); return t && !t.classList.contains('hidden') ? t.textContent : ''; });
    const lower = await dr.evaluate(() => { const c = document.getElementById('fd-canvas'); const d = c.getContext('2d').getImageData(0, Math.floor(c.height * 0.7), c.width, Math.floor(c.height * 0.25)).data; for (let i = 0; i < d.length; i += 4) if (d[i] < 120 && d[i + 3] > 200) return true; return false; });
    check('a második vonal nem kerül a lapra, a játék megmondja, miért', /Egy vonal/.test(toast) && !lower, toast.slice(0, 50));
    const errs2 = [h2, g2].flatMap(p => [...p.pageErrors, ...p.cspViolations.map(v => 'CSP: ' + v)]);
    check('nincs oldalhiba (egy vonal)', !errs2.length, errs2.slice(0, 3).join(' | '));
  } catch (e) {
    console.error('❌ ' + e.message.split('\n').slice(0, 6).join(' / ')); results.push(false);
    for (const p of all) { try { if (!p.isClosed()) console.error('  ' + p.label + ' képernyő: ' + await p.evaluate(() => { const v = id => { const e = document.getElementById(id); return e && !e.classList.contains('hidden') && e.offsetParent !== null; }; return [...document.querySelectorAll('[id^=screen-]')].filter(e => !e.classList.contains('hidden')).map(e => e.id).join(',') + ' | prepare:' + v('fd-prepare') + ' reveal:' + v('btn-prep-reveal') + ' choices:' + document.querySelectorAll('#prep-choices button').length + ' | ' + ((document.getElementById('late-waiting-text') || {}).textContent || '').slice(0, 60); })); } catch (x) {} }
    for (const p of all) { try { const er = p.pageErrors || []; if (er.length) console.error('  ' + p.label + ': ' + er.slice(0, 2).join(' | ')); } catch (x) {} }
  } finally {
    await browser.close();
    servers.stop();
    const ok = results.length && results.every(Boolean);
    console.log(ok ? '✅ A v4.36 játékmódjai működnek.' : '❌ Valami nem stimmel.');
    process.exitCode = ok ? 0 : 1;
  }
})();
