// PIC-ASS-O — fiókok böngészős ellenőrzése (v4.40)
// Regisztráció e-mail megerősítéssel, belépés, zárolt név és ✔ jelvény, a
// regisztrált név védelme vendég ellen, kétfaktoros belépés, statisztika-szinkron.
// A valódi Netlify-függvények futnak, memóriabeli tárolóval és hamis levélküldővel.
// Futtatás: node tests/e2e/account.cjs
const { chromium } = require('playwright');
const crypto = require('crypto');
const H = require('../support/harness.cjs');

const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`  ${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`); };
const ready = p => p.waitForFunction(() => !document.body.classList.contains('booting'), null, { timeout: 30000 });

(async () => {
  const servers = await H.startServers({ functions: true });
  const browser = await chromium.launch();
  const mails = async () => (await fetch(servers.base + '__test/mails')).json();
  const view = { viewport: { width: 1280, height: 900 } };
  try {
    console.log('Regisztráció (jelszó nélkül) és belépés:');
    const a = await H.newPlayer(browser, servers, 'Péter', view);
    await a.goto(servers.base); await ready(a);
    await a.click('#btn-account');
    check('a belépés ablakban nincs jelszómező', await a.evaluate(() => !document.querySelector('#account-overlay input[type=password]')));
    await a.click('[data-acct-go="register"]');
    await a.fill('#acct-reg-name', 'Péter'); await a.fill('#acct-reg-email', 'peter@pelda.hu');
    await a.check('#acct-f-register input[name=consent]');
    await a.click('#acct-f-register button[type=submit]');
    await a.waitForSelector('#acct-v-registered:not(.hidden)');
    const m = (await mails()).find(x => x.to === 'peter@pelda.hu');
    check('megerősítő levél ment ki', !!m && /Erősítsd meg a regisztrációt/.test(m.subject));
    // a levél linkje: gomb, majd kész — és ezzel be is lépett ezen a böngészőn
    const link = /href="([^"]+\?confirm=[^"]+)"/.exec(m.html)[1];
    await a.goto(link); await a.click('button'); await a.waitForSelector('text=Kész a fiókod');
    check('a megerősítő oldal felajánlja a jelkulcsot', /jelkulcsot/.test(await a.textContent('body')));
    await Promise.all([a.waitForNavigation(), a.click('a.b')]);
    await ready(a);
    await a.waitForSelector('#acct-v-profile:not(.hidden)', { timeout: 10000 });
    check('a játékba visszatérve belépve van, és a fiók ablak nyitva', (await a.textContent('#acct-p-name')) === 'Péter');
    const cookies = await a.context().cookies();
    const sc = cookies.find(x => x.name === '__Host-picasso_s');
    check('a munkamenet-süti HttpOnly, Secure, SameSite=Strict', !!sc && sc.httpOnly && sc.secure && sc.sameSite === 'Strict');
    check('a JavaScript nem látja a munkamenet-kulcsot', !(await a.evaluate(() => document.cookie)).includes('picasso_s'));
    await a.click('#account-close-btn');
    check('a névmező zárolva, a fiók nevével', (await a.inputValue('#home-name')) === 'Péter' && await a.evaluate(() => document.getElementById('home-name').readOnly));
    check('a gomb a fiókot mutatja', /Péter — Fiókom/.test(await a.textContent('#btn-account')));

    console.log('Névvédelem:');
    const g = await H.newPlayer(browser, servers, 'vendég', view);
    await g.goto(servers.base); await ready(g);
    await g.fill('#home-name', 'peter');
    await g.waitForFunction(() => /regisztrált játékosé/.test(document.getElementById('home-name-note').textContent), null, { timeout: 5000 });
    check('vendég a regisztrált névre figyelmeztetést kap (ékezet nélkül is)', true);
    await g.click('#card-create');
    check('…és nem tud vele szobát nyitni', /regisztrált játékosé/.test(await g.textContent('#home-warning')) && await g.isVisible('#screen-home'));

    // Péter szobát nyit; a vendég (szabad névvel) belép, és látja a ✔ jelvényt
    await a.click('#card-create');
    await a.fill('#room-name-input', 'Fiókos szoba');
    await a.click('#btn-create-room');
    await a.waitForFunction(() => /^[A-Z0-9]{5}$/.test((document.getElementById('lobby-code') || {}).textContent || ''), null, { timeout: 15000 });
    const code = (await a.textContent('#lobby-code')).trim();
    await H.joinRoom(g, servers, code, 'Béla');
    await g.waitForSelector('#screen-lobby:not(.hidden)', { timeout: 15000 });
    await g.waitForFunction(() => !!document.querySelector('#lobby-players .acct-badge'), null, { timeout: 8000 });
    const chips = await g.evaluate(() => [...document.querySelectorAll('#lobby-players .player-chip')].map(c => ({ t: c.textContent.replace(/\s+/g, ' ').trim(), b: !!c.querySelector('.acct-badge') })));
    check('a vendég látja a ✔ jelvényt Péter neve mellett, a sajátja mellett nem', chips.some(x => /Péter/.test(x.t) && x.b) && chips.some(x => /Béla/.test(x.t) && !x.b), JSON.stringify(chips));
    await a.waitForFunction(() => document.querySelectorAll('#lobby-players .player-chip').length === 2, null, { timeout: 8000 });
    check('Péter a saját neve mellett is látja', await a.evaluate(() => !!document.querySelector('#lobby-players .player-chip.me .acct-badge')));

    // hamisított kliens: a kezdőképernyő ellenőrzését megkerülve próbál Péter nevével belépni
    const h = await H.newPlayer(browser, servers, 'csaló', view);
    await h.goto(servers.base + '?join=' + code); await ready(h);
    await h.fill('#home-name', 'Vendég2');
    await h.evaluate(() => { const el = document.getElementById('home-name'); el.value = 'Péter'; });   // nincs input esemény: a helyi ellenőrzés nem fut le
    await h.click('#btn-invite-join');
    await h.waitForFunction(() => /regisztrált játékosé/.test(document.getElementById('home-warning').textContent), null, { timeout: 15000 });
    await a.waitForTimeout(500);
    const names = await a.evaluate(() => [...document.querySelectorAll('#lobby-players .player-chip')].map(c => c.textContent.replace(/\s+/g, ' ').trim()));
    check('jegy nélkül a szerver nem engedi be Péter nevével', names.length === 2, names.join(' | '));
    await h.context().close();

    console.log('Újratöltés:');
    await a.goto(servers.base); await ready(a);
    await a.waitForFunction(() => /Fiókom/.test(document.getElementById('btn-account').textContent));
    check('újratöltés után is belépve marad', true);
    console.log('Belépőlink:');
    await Promise.all([a.waitForNavigation(), (async () => { await a.click('#btn-account'); await a.click('#acct-btn-logout'); })()]);
    await ready(a);
    check('kilépés után vendég, a név szerkeszthető', /Belépés/.test(await a.textContent('#btn-account')) && !(await a.evaluate(() => document.getElementById('home-name').readOnly)));
    await a.click('#btn-account');
    await a.fill('#acct-login-email', 'peter@pelda.hu');
    await a.click('#acct-f-login button[type=submit]');
    await a.waitForSelector('#acct-v-link-sent:not(.hidden)');
    const ml = (await mails()).filter(x => x.to === 'peter@pelda.hu' && /Belépés/.test(x.subject)).at(-1);
    check('belépőlink ment ki e-mailben', !!ml);
    await a.goto(/href="([^"]+\?login=[^"]+)"/.exec(ml.html)[1]); await a.click('button'); await a.waitForSelector('text=Beléptél');
    await Promise.all([a.waitForNavigation(), a.click('a.b')]);
    await ready(a);
    await a.waitForFunction(() => /Fiókom/.test(document.getElementById('btn-account').textContent), null, { timeout: 10000 });
    check('a belépőlinkkel belépett', true);
    check('a jelkulcs hozzáadását felajánlja', /jelkulcsot/.test(await a.textContent('#acct-m-profile').catch(() => '')) || !(await a.isVisible('#acct-pk-box')));
    await a.click('#account-close-btn').catch(() => {});

    console.log('Statisztika és értesítő:');
    // egy másik eszközön szerzett eredmény megjelenik itt is
    await a.evaluate(async () => {
      const g1 = await (await fetch('/.netlify/functions/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stats-get' }) })).json();
      await fetch('/.netlify/functions/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stats-put', rev: g1.rev, first: true, stats: { games: 7, wins: 3, points: 900, best: 250 } }) });
    });
    if (await a.isVisible('#account-close-btn')) await a.click('#account-close-btn');
    await a.click('#btn-open-stats');
    await a.waitForFunction(() => /A fiókodban eddig 7 játék, 3 győzelem/.test(document.getElementById('home-stats').textContent), null, { timeout: 8000 });
    check('a fiók statisztikája megjelenik ezen az eszközön', true);
    await a.click('#stats-close-btn');
    await a.click('#sub-toggle');
    await a.check('#sub-email-on');
    await a.waitForFunction(() => /E-mailben szólunk/.test(document.getElementById('sub-status').textContent));
    check('belépve egy pipával kérhető e-mail értesítés', /1 fő/.test(await a.textContent('#sub-count')), await a.textContent('#sub-count'));
    check('vendégnek a feliratkozás helyén belépés gomb van', await g.evaluate(() => !document.getElementById('sub-loggedout').classList.contains('hidden') && document.getElementById('sub-loggedin').classList.contains('hidden')));

    for (const p of [a, g]) { check(`nincs JavaScript-hiba (${p.label})`, p.pageErrors.length === 0, p.pageErrors.join(' | ')); check(`nincs CSP-sértés (${p.label})`, p.cspViolations.length === 0, p.cspViolations.join(' | ')); }
  } catch (e) {
    check('a teszt lefutott', false, e.message.split('\n')[0] + ' @ ' + ((e.stack || '').split('\n').find(l => /account\.cjs/.test(l)) || '').trim());
  } finally {
    await browser.close(); servers.stop();
  }
  const bad = results.filter(x => !x).length;
  console.log(bad ? `\n❌ ${bad} hiba` : `\n✅ mind a ${results.length} ellenőrzés rendben`);
  process.exit(bad ? 1 : 0);
})();
