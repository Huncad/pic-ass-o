// PIC-ASS-O — elárasztás és csalás elleni védelem böngészőben (v4.32)
// Két játékos a helyi játékszerveren. A "csaló" a fejlesztőeszközből küldhető
// nyers üzeneteket is kipróbálja (a játék saját kapcsolatán át, a saját korlátok
// megkerülésével) — a másik eszköznek ezeket el kell dobnia és jeleznie kell.
// Futtatás: node tests/e2e/antispam.cjs
const { chromium } = require('playwright');
const H = require('../support/harness.cjs');

const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`  ${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`); };

(async () => {
  const servers = await H.startServers();
  const browser = await chromium.launch();
  try {
    const host = await H.newPlayer(browser, servers, 'szobanyitó', { viewport: { width: 1300, height: 850 } }, { name: 'Anna' });
    const guest = await H.newPlayer(browser, servers, 'vendég', { viewport: { width: 1300, height: 850 } }, { name: 'Bence' });
    // a gyanús esetek jelentéseit a szobanyitó oldalán figyeljük
    const reports = [];
    for (const p of [host, guest]) p.on('request', r => { if (r.url().includes('/.netlify/functions/report')) { try { reports.push({ by: p.label, ...JSON.parse(r.postData()) }); } catch (e) {} } });
    const code = await H.createRoom(host, servers, { roomName: 'Védelem', name: 'Anna' });
    await H.joinRoom(guest, servers, code, 'Bence');
    await host.waitForFunction(() => document.querySelectorAll('#lobby-players .player-chip:not(.pending)').length >= 2, null, { timeout: 20000 });
    const chatCount = (p, text) => p.evaluate(t => [...document.querySelectorAll('#chat-messages .chat-body')].filter(e => e.textContent.includes(t)).length, text);

    // 1. chat — rendes felületen
    console.log('Chat a felületen:');
    await guest.click('#chat-toggle-btn');
    for (let i = 0; i < 10; i++) { await guest.fill('#chat-text-input', 'gyors üzenet ' + i); await guest.press('#chat-text-input', 'Enter'); }
    await host.waitForTimeout(800);
    const got = await host.evaluate(() => [...document.querySelectorAll('#chat-messages .chat-body')].filter(e => e.textContent.includes('gyors üzenet')).length);
    check('10 gyors üzenetből legfeljebb 5 megy ki', got === 5, `${got} érkezett`);
    const note = await guest.evaluate(() => [...document.querySelectorAll('#chat-messages .chat-msg')].some(e => /Lassíts/.test(e.textContent)));
    check('a küldő barátságos figyelmeztetést kap', note);
    await guest.waitForTimeout(10500);
    await guest.fill('#chat-text-input', 'ugyanaz'); await guest.press('#chat-text-input', 'Enter');
    await guest.fill('#chat-text-input', 'UGYANAZ '); await guest.press('#chat-text-input', 'Enter');
    await host.waitForTimeout(600);
    check('ugyanaz az üzenet kétszer nem megy ki', (await chatCount(host, 'ugyanaz')) + (await chatCount(host, 'UGYANAZ')) === 1);

    // 2. gyorsreakció számbillentyűkkel
    console.log('Gyorsreakciók:');
    await host.click('#btn-start-match');
    await guest.waitForTimeout(1500);
    await guest.mouse.click(5, 5);
    const before = host.framesIn.length;
    for (let i = 0; i < 30; i++) { await guest.keyboard.press(String(1 + (i % 7))); await guest.waitForTimeout(40); }
    await host.waitForTimeout(800);
    const reacts = host.framesIn.slice(before).filter(f => /"a":"reaction"/.test(f)).length;
    check('30 billentyűnyomásból legfeljebb 3 reakció', reacts <= 3, `${reacts} ment ki`);

    // 3. csalás a fejlesztőeszközből: nyers chat-áradat a saját korlátok megkerülésével
    console.log('Nyers üzenetek (fejlesztőeszköz):');
    await guest.waitForTimeout(10500);
    const shownBefore = await chatCount(host, 'nyers');
    await guest.evaluate(() => { for (let i = 0; i < 25; i++) window.__picassoSrv.send({ t: 'send', a: 'chat', d: { type: 'text', id: 'x' + i + Date.now(), name: 'Bence', text: 'nyers ' + i, ts: Date.now() } }); });
    await host.waitForTimeout(1200);
    const raw = (await chatCount(host, 'nyers')) - shownBefore;
    check('a nyers áradatból a szobanyitónál legfeljebb 7 jelenik meg', raw <= 7, `${raw} jelent meg`);
    const warned = await host.evaluate(() => [...document.querySelectorAll('#chat-messages .chat-msg')].some(e => /⚠️ Bence/.test(e.textContent)));
    check('a szobanyitó diszkrét figyelmeztetést kap', warned);
    check('jelentés megy a naplóba (chat-áradat)', reports.some(r => r.subject === 'Bence' && r.kind === 'chat-flood'));

    // hamisított kör: a vendég a szobanyitó nevében hirdet kört
    const hostId = await host.evaluate(() => window.__picassoSrv && window.__picassoSelfId);
    await guest.evaluate((hid) => window.__picassoSrv.send({ t: 'send', a: 'round', d: { idx: 0, drawerId: hid || 'valaki-mas', drawerName: 'Anna', tier: 'konnyu', phase: 'drawing' } }), hostId);
    await host.waitForTimeout(800);
    check('más nevében hirdetett kör: jelentés', reports.some(r => r.subject === 'Bence' && r.kind === 'forged'));

    // 4. hangüzenet: a lejátszóból nem menthető le
    console.log('Hangüzenet:');
    await guest.waitForTimeout(10500);   // a szerver akciókorlátja (10 chat / 10 mp) az áradat után még tart
    await guest.evaluate(() => window.__picassoSrv.send({ t: 'send', a: 'chat', d: { type: 'voice', id: 'v' + Date.now(), name: 'Bence', dataUrl: 'data:audio/webm;base64,GkXfo0AgQoaBAUL3gQFC8oEEQvOBCEKCQAR3ZWJtQoeBAkKFgQIYU4BnQI0VSalmQCgq17FAAw9CQE2AQAZ3aGFtbXlXQUAGd2hhbW15RIlACECPQAAAAAAAFlSua0AxrkAu14EBY8WBAZyBACK1nEADdW5khkAFVl9WUDglhohAA1ZQOIOBAeBABrCBCLqBCB9DtnVAIueBAKNAHIEAAIAwAQCdASoIAAgAAUAmJaQAA3AA/vz0AAA=', ts: Date.now() } }));
    await host.waitForSelector('#chat-messages audio', { timeout: 5000 }).catch(() => {});
    const audio = await host.evaluate(() => { const a = document.querySelector('#chat-messages audio'); return a ? { cl: a.getAttribute('controlsList') || '', drag: a.draggable } : null; });
    check('a lejátszón nincs letöltés (controlsList=nodownload)', !!audio && /nodownload/.test(audio.cl), audio ? audio.cl : 'nincs lejátszó');
    const ctxBlocked = await host.evaluate(() => { const a = document.querySelector('#chat-messages audio'); if (!a) return false; const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); a.dispatchEvent(ev); return ev.defaultPrevented; });
    check('a jobb gombos (mentés) menü tiltva a lejátszón', ctxBlocked);

    const errs = [...host.pageErrors, ...guest.pageErrors];
    check('nincs oldalhiba', !errs.length, errs.join(' | '));
  } catch (e) {
    console.error('❌ ' + e.message); results.push(false);
  } finally {
    await browser.close();
    servers.stop();
    const ok = results.length && results.every(Boolean);
    console.log(ok ? '✅ Minden védelem működik.' : '❌ Valami nem stimmel.');
    process.exitCode = ok ? 0 : 1;
  }
})();
