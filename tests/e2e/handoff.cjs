// PIC-ASS-O — v4.41: kiesett rajzoló átadása és a telefon „vissza” gombja
// 1. Négy játékos; a rajzoló oldala újratöltődik rajzolás közben → pontosan EGY
//    ember veszi át (a szobanyitó dönt), és a többiek az ő rajzát látják.
// 2. Telefonon a „vissza” a nyitott chatből csak a chatet zárja be, a játékos bent marad.
// Futtatás: node tests/e2e/handoff.cjs
const { chromium, devices } = require('playwright');
const H = require('../support/harness.cjs');

const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`  ${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`); };
const prep = '#btn-prep-reveal:visible, #prep-choices button:visible';

(async () => {
  const servers = await H.startServers();
  const browser = await chromium.launch();
  try {
    const names = ['Anna', 'Bence', 'Cili', 'Dani'];
    const ps = [];
    for (const n of names) ps.push(await H.newPlayer(browser, servers, n, n === 'Dani' ? devices['Pixel 5'] : { viewport: { width: 1200, height: 850 } }));
    const [host] = ps;
    const code = await H.createRoom(host, servers, { roomName: 'Átadás', name: 'Anna', rounds: 3 });
    for (let i = 1; i < ps.length; i++) await H.joinRoom(ps[i], servers, code, names[i]);
    await host.waitForFunction(() => document.querySelectorAll('#lobby-players .player-chip:not(.pending)').length >= 4, null, { timeout: 25000 });
    await host.click('#btn-start-match');
    const di = await Promise.race(ps.map((p, i) => p.waitForSelector(prep, { timeout: 20000 }).then(() => i)));
    console.log('Átadás (első rajzoló: ' + names[di] + '):');

    // ha a szobanyitó rajzol, előbb egy kört lejátszunk, hogy vendég legyen a rajzoló
    let drawerIdx = di;
    if (di === 0) {
      const w = await H.chooseFirstWord(ps[0]);
      await H.drawSquiggle(ps[0]);
      for (let i = 1; i < 4; i++) { await ps[i].fill('#watch-guess-input', w, { timeout: 6000 }).then(() => ps[i].press('#watch-guess-input', 'Enter')).catch(() => {}); }
      drawerIdx = await Promise.race(ps.map((p, i) => i === 0 ? new Promise(() => {}) : p.waitForSelector(prep, { timeout: 40000 }).then(() => i)));
    }
    const drawer = ps[drawerIdx];
    await H.chooseFirstWord(drawer);
    await H.drawSquiggle(drawer);
    await ps[(drawerIdx + 1) % 4].waitForTimeout(800);
    // a rajzoló oldala újratöltődik rajzolás közben
    await drawer.reload();
    await drawer.waitForTimeout(500);
    // ki rajzol most? figyeljük, kinél jelenik meg a szóválasztás
    // (a szerver 60 mp-ig tartja a kiesett helyét: addig várunk, amíg valakinél megjelenik a szóválasztás)
    const others = ps.filter((_, i) => i !== drawerIdx);
    await Promise.race(others.map(p => p.waitForSelector(prep, { timeout: 110000 }))).catch(() => {});
    await host.waitForTimeout(6000);
    const drawing = [];
    for (let i = 0; i < 4; i++) if (i !== drawerIdx && await ps[i].locator(prep).count()) drawing.push(names[i]);
    for (let i = 0; i < 4; i++) console.log('   ', names[i], await ps[i].evaluate(() => [...document.querySelectorAll('[id^=screen-]')].filter(e => !e.classList.contains('hidden')).map(e => e.id).join(',') + ' | ' + [...document.querySelectorAll('#chat-messages .system, .chat-msg.system, .sys')].slice(-4).map(e => e.textContent.trim().slice(0, 70)).join(' / ')));
    check('pontosan egy játékos kapta meg a rajzolást', drawing.length === 1, drawing.join(', ') || 'senki');
    if (drawing.length === 1) {
      const t = ps[names.indexOf(drawing[0])];
      const w2 = await H.chooseFirstWord(t);
      await H.drawSquiggle(t);
      let seen = 0;
      for (let i = 0; i < 4; i++) { if (ps[i] === t || i === drawerIdx) continue; try { await H.waitForDrawingOnWatch(ps[i]); seen++; } catch (e) {} }
      check('a többiek (a visszatérőn kívül) látják az új rajzoló rajzát', seen === 2, `${seen}/2`);
      void w2;
    }

    console.log('Telefon „vissza” gomb:');
    const phone = ps[3];
    const inRoom = () => phone.evaluate(() => [...document.querySelectorAll('[id^=screen-]')].filter(e => !e.classList.contains('hidden')).map(e => e.id).join(','));
    const before = await inRoom();
    await phone.click('#chat-toggle-btn');
    await phone.waitForSelector('#chat-panel:not(.hidden)');
    await phone.goBack({ waitUntil: 'commit' }).catch(() => {});
    await phone.waitForTimeout(600);
    check('„vissza” a chatből: a chat bezárul', await phone.evaluate(() => document.getElementById('chat-panel').classList.contains('hidden')));
    check('…és a játékos a játékban marad', (await inRoom()) === before && !/screen-home/.test(before), before);
    await phone.goBack({ waitUntil: 'commit' }).catch(() => {});
    await phone.waitForTimeout(600);
    check('„vissza” chat nélkül: rákérdez a kilépésre', await phone.isVisible('.pc-confirm'));
    await phone.click('.pc-confirm button:has-text("Mégse")');
    await phone.waitForTimeout(300);
    check('„Mégse” után bent marad', (await inRoom()) === before);

    for (const p of ps) check(`nincs JavaScript-hiba (${p.label})`, p.pageErrors.length === 0, p.pageErrors.join(' | '));
  } catch (e) {
    check('a teszt lefutott', false, e.message.split('\n')[0]);
  } finally { await browser.close(); servers.stop(); }
  const bad = results.filter(x => !x).length;
  console.log(bad ? `\n❌ ${bad} hiba` : `\n✅ mind a ${results.length} ellenőrzés rendben`);
  process.exit(bad ? 1 : 0);
})();
