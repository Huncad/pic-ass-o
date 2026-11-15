// PIC-ASS-O — tömeg-teszt valódi böngészőkkel (v4.52)
// 1. Egy szoba 20 játékossal (telefon és gép vegyesen): váró, egy teljes kör, pontozás — elrendezés és stabilitás.
// 2. Négy szoba párhuzamosan, mindegyikben egy kör: nem keverednek-e (rajz, szó).
// 3. Szobalista 40 nyitott szobával telefonon és gépen.
// Képernyőképek: SHOTS=mappa node tests/e2e/crowd.cjs
const { chromium, devices } = require('playwright');
const crypto = require('crypto');
const WebSocket = require('ws');
const H = require('../support/harness.cjs');
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`  ${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`); };
const prep = '#btn-prep-reveal:visible, #prep-choices button:visible';
const SHOTS = process.env.SHOTS || '';
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const NAMES = ['Anna','Bence','Cili','Dani','Emese','Feri','Gabi','Hanna','Imre','Juli','Kristóf','Lili','Máté','Nóra','Olivér','Panni','Rozi','Soma','Tamás','Zsófi'];
/** vízszintesen kilóg-e valami a képernyőről */
const overflow = p => p.evaluate(() => {
  const w = document.documentElement.clientWidth;
  const bad = [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.position !== 'fixed' && r.right > w + 2 && !el.closest('.roster-scroll, .rosters, [class*="scroll"], .scores'); });
  return { page: document.documentElement.scrollWidth > w + 2, els: bad.slice(0, 3).map(e => e.id || e.className).join(', ') };
});

(async () => {
  const servers = await H.startServers();
  const browser = await chromium.launch();
  try {
    // ---------- 1. egy szoba, 20 játékos ----------
    console.log('Egy szoba, 20 játékos:');
    const ps = [];
    for (let i = 0; i < 20; i++) ps.push(await H.newPlayer(browser, servers, NAMES[i], i % 3 === 1 ? devices['iPhone 13'] : i % 3 === 2 ? devices['Pixel 5'] : { viewport: { width: 1280, height: 800 } }));
    const host = ps[0];
    const code = await H.createRoom(host, servers, { roomName: 'Nagy buli', name: NAMES[0] });
    for (let i = 1; i < 20; i += 5) await Promise.all(ps.slice(i, i + 5).map((p, j) => H.joinRoom(p, servers, code, NAMES[i + j])));
    const allIn = await host.waitForFunction(() => document.querySelectorAll('#lobby-players .player-chip:not(.pending)').length >= 20, null, { timeout: 60000 }).then(() => true).catch(() => false);
    check('mind a 20 játékos bent van a váróban', allIn, String(await host.evaluate(() => document.querySelectorAll('#lobby-players .player-chip').length)));
    await shot(host, 'tomeg-varo-gep'); await shot(ps[1], 'tomeg-varo-iphone');
    for (const p of [host, ps[1], ps[2]]) { const o = await overflow(p); check(`a váró nem lóg ki (${p.label})`, !o.page, o.els); }
    await host.click('#btn-start-match');
    const di = await Promise.race(ps.map((p, i) => p.waitForSelector(prep, { timeout: 30000 }).then(() => i)));
    const drawer = ps[di];
    const word = await H.chooseFirstWord(drawer);
    await H.drawSquiggle(drawer);
    const guessers = ps.filter((_, i) => i !== di);
    const seen = await Promise.all(guessers.map(p => H.waitForDrawingOnWatch(p).then(() => true).catch(() => false)));
    check('mind a 19 tippelő látja a rajzot', seen.every(Boolean), `${seen.filter(Boolean).length}/19`);
    await shot(guessers.find(p => p.label && /iPhone|Pixel/.test('')) || guessers[0], 'tomeg-jatek-gep');
    const phoneG = guessers.find(p => p.viewportSize().width < 500);
    if (phoneG) { await shot(phoneG, 'tomeg-jatek-telefon'); const o = await overflow(phoneG); check('a játékképernyő telefonon sem lóg ki 20 játékosnál', !o.page, o.els); }
    await shot(drawer, 'tomeg-rajzolo');
    // mindenki tippel — sorban, kicsit szétszórva (a „mindenki tippelhet” mód nincs bekapcsolva: az első jó tipp zárja a kört)
    const g0 = guessers[0];
    await H.guess(g0, word);
    const ended = await Promise.all(ps.map(p => p.waitForFunction(() => !document.getElementById('screen-roundend').classList.contains('hidden') || !document.getElementById('screen-gameend').classList.contains('hidden'), null, { timeout: 30000 }).then(() => true).catch(() => false)));
    check('a kör vége mind a 20 eszközön megjelent', ended.every(Boolean), `${ended.filter(Boolean).length}/20`);
    await shot(host, 'tomeg-pontozas-gep'); if (phoneG) await shot(phoneG, 'tomeg-pontozas-telefon');
    const rows = await Promise.all(ps.map(p => p.evaluate(() => document.querySelectorAll('#roundend-scores tr').length)));
    check('a pontozótábla mindenkinél 20 sort mutat', rows.every(n => n >= 20), [...new Set(rows)].join(','));
    if (phoneG) { const o = await overflow(phoneG); check('a pontozás telefonon sem lóg ki', !o.page, o.els); }
    const errs = ps.flatMap(p => p.pageErrors);
    check('nincs JavaScript-hiba egyik eszközön sem', errs.length === 0, errs.slice(0, 3).join(' | '));
    for (const p of ps) await p.context().close();

    // ---------- 2. négy szoba párhuzamosan ----------
    console.log('Négy szoba párhuzamosan:');
    const rooms = [];
    for (let r = 0; r < 4; r++) {
      const members = [];
      for (let i = 0; i < 4; i++) members.push(await H.newPlayer(browser, servers, `S${r}-${NAMES[i]}`, { viewport: { width: 1100, height: 760 } }));
      rooms.push(members);
    }
    const codes = await Promise.all(rooms.map((m, r) => H.createRoom(m[0], servers, { roomName: 'Párhuzamos ' + r, name: NAMES[r * 4] })));
    await Promise.all(rooms.map((m, r) => Promise.all(m.slice(1).map((p, j) => H.joinRoom(p, servers, codes[r], NAMES[r * 4 + j + 1])))));
    await Promise.all(rooms.map(m => m[0].waitForFunction(() => document.querySelectorAll('#lobby-players .player-chip:not(.pending)').length >= 4, null, { timeout: 40000 })));
    await Promise.all(rooms.map(m => m[0].click('#btn-start-match')));
    const words = await Promise.all(rooms.map(async m => {
      const i = await Promise.race(m.map((p, k) => p.waitForSelector(prep, { timeout: 30000 }).then(() => k)));
      const w = await H.chooseFirstWord(m[i]); await H.drawSquiggle(m[i]);
      return { w, i };
    }));
    const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    let leak = 0;
    rooms.forEach((m, r) => m.forEach((p, k) => { if (k === words[r].i) return; words.forEach((o, rr) => { if (rr !== r && p.framesIn.some(f => norm(f).includes('"' + norm(o.w) + '"'))) leak++; }); }));
    check('egyik szobából sem jut át semmi a másikba (a szavak sem)', leak === 0, `${leak} szivárgás`);
    await Promise.all(rooms.map((m, r) => H.guess(m[(words[r].i + 1) % 4], words[r].w)));
    const ok4 = await Promise.all(rooms.map(m => Promise.all(m.map(p => p.waitForFunction(() => !document.getElementById('screen-roundend').classList.contains('hidden'), null, { timeout: 30000 }).then(() => true).catch(() => false)))));
    check('mind a 4 szobában lement a kör, mindenkinél', ok4.every(a => a.every(Boolean)), ok4.map(a => a.filter(Boolean).length).join('/'));
    const words2 = await Promise.all(rooms.map(m => m[1].evaluate(() => document.getElementById('roundend-word').textContent)));
    check('mindegyik szoba a saját szavát látja a kör végén', words2.every((t, r) => norm(t).includes(norm(words[r].w))));
    for (const m of rooms) for (const p of m) await p.context().close();

    // ---------- 3. szobalista 40 szobával ----------
    console.log('Szobalista 40 szobával:');
    const bots = [];
    for (let r = 0; r < 40; r++) {
      const ws = new WebSocket(`ws://127.0.0.1:${servers.srvPort}/ws`, { origin: 'http://localhost', headers: { 'x-forwarded-for': `10.9.${r}.1` } });
      bots.push(ws);
      const id = 'bot' + r + crypto.randomBytes(4).toString('hex');
      const room = 'v2:lista-' + r + crypto.randomBytes(4).toString('hex');
      await new Promise(res => { ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 2, r: 0, id, token: crypto.randomBytes(16).toString('hex'), dir: true }))); ws.on('message', b => { const m = JSON.parse(b); if (m.t === 'welcome') { ws.send(JSON.stringify({ t: 'join', room })); res(); } }); });
      const fp = 'h:' + crypto.createHash('sha256').update(room).digest('hex').slice(0, 32);
      const names = ['Péntek esti buli', 'Családi rajzolás', 'Csak profiknak!!!', 'Szia', 'Nagyon hosszú szobanév, amibe sok minden belefér', 'Kati & Bandi', '🎨🎨🎨', 'Osztálykirándulás 7.b'];
      setTimeout(() => ws.send(JSON.stringify({ t: 'dir', d: { id: fp, name: names[r % names.length] + (r > 7 ? ' ' + r : ''), hostName: NAMES[r % 20], players: 1 + (r % 9), max: r % 4 ? 0 : 10, inGame: r % 3 === 0 } })), 200);
    }
    for (const [label, dev] of [['telefon', devices['iPhone 13']], ['gép', { viewport: { width: 1280, height: 800 } }]]) {
      const p = await H.newPlayer(browser, servers, 'lista-' + label, dev);
      await p.goto(servers.base);
      const n = await p.waitForFunction(() => document.querySelectorAll('#room-list .room-item').length >= 40, null, { timeout: 15000 }).then(() => p.evaluate(() => document.querySelectorAll('#room-list .room-item').length)).catch(() => p.evaluate(() => document.querySelectorAll('#room-list .room-item').length));
      check(`a szobalista mind a 40 szobát mutatja (${label})`, n >= 40, String(n));
      const o = await overflow(p); check(`a szobalista nem lóg ki (${label})`, !o.page, o.els);
      await p.evaluate(() => document.getElementById('room-list').scrollIntoView());
      await shot(p, 'tomeg-szobalista-' + (label === 'gép' ? 'gep' : label));
      check(`nincs JavaScript-hiba (${label})`, p.pageErrors.length === 0, p.pageErrors.join(' | '));
      await p.context().close();
    }
    bots.forEach(b => b.terminate());
  } catch (e) {
    check('a teszt lefutott', false, e.message.split('\n')[0] + ' @ ' + ((e.stack || '').split('\n').find(l => /crowd\.cjs/.test(l)) || '').trim());
  } finally { await browser.close(); servers.stop(); }
  const bad = results.filter(x => !x).length;
  console.log(bad ? `\n❌ ${bad} hiba` : `\n✅ mind a ${results.length} ellenőrzés rendben`);
  process.exit(bad ? 1 : 0);
})();
