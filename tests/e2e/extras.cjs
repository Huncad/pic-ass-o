// PIC-ASS-O — v4.49: fiók-extrák böngészőben
// Állandó szobakód, „csak regisztráltak” szoba, profil a ✔ jelvényre koppintva, követés,
// szólista mentése / betöltése, rajz mentése a galériába, eszközlista, névváltoztatás.
// Futtatás: node tests/e2e/extras.cjs
const { chromium } = require('playwright');
const H = require('../support/harness.cjs');
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`  ${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`); };
const ready = p => p.waitForFunction(() => !document.body.classList.contains('booting'), null, { timeout: 30000 });
const prep = '#btn-prep-reveal:visible, #prep-choices button:visible';

(async () => {
  const servers = await H.startServers({ functions: true });
  const browser = await chromium.launch();
  const mails = async () => (await fetch(servers.base + '__test/mails')).json();
  const view = { viewport: { width: 1280, height: 900 } };
  async function account(label, name, email) {
    const p = await H.newPlayer(browser, servers, label, view);
    await p.goto(servers.base); await ready(p);
    await p.evaluate(async ([n, e]) => { await fetch('/.netlify/functions/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'register', name: n, email: e, consent: true }) }); }, [name, email]);
    const m = (await mails()).find(x => x.to === email);
    await p.goto(/href="([^"]+\?confirm=[^"]+)"/.exec(m.html)[1]); await p.click('button'); await p.waitForSelector('text=Kész a fiókod');
    await Promise.all([p.waitForNavigation(), p.click('a.b')]); await ready(p);
    await p.waitForTimeout(1500); await ready(p);
    if (await p.isVisible('#account-close-btn')) await p.click('#account-close-btn');
    return p;
  }
  try {
    const a = await account('Anna', 'Anna', 'anna@pelda.hu');
    const b = await account('Bence', 'Bence', 'bence@pelda.hu');
    console.log('Fiók extrák:');
    await a.click('#btn-account');
    await a.fill('#acct-roomcode-input', 'anna5'); await a.click('#acct-f-roomcode button[type=submit]');
    await a.waitForFunction(() => /ANNA5/.test(document.getElementById('acct-m-roomcode').textContent));
    check('állandó szobakód beállítva', true);
    await a.fill('#acct-follow-input', 'bence'); await a.click('#acct-f-follow button[type=submit]');
    await a.waitForFunction(() => /követed/.test(document.getElementById('acct-m-follow').textContent));
    check('követés név alapján', /Bence/.test(await a.textContent('#acct-friends')));
    if (process.env.SHOTS) await a.screenshot({ path: process.env.SHOTS + '/account.png', fullPage: true });
    await a.click('#acct-btn-devices');
    await a.waitForSelector('#acct-devices li');
    check('az eszközlista mutatja ezt az eszközt', /ez az eszköz/.test(await a.textContent('#acct-devices')));
    await a.click('#acct-v-devices [data-acct-go="profile"]');
    const [dl] = await Promise.all([a.waitForEvent('download', { timeout: 8000 }), a.click('#acct-btn-export')]);
    check('adatok letöltése (JSON)', dl.suggestedFilename() === 'picasso-adataim.json');
    await a.click('#account-close-btn');

    console.log('Saját kód + csak regisztráltak:');
    await a.click('#card-create');
    check('szobanyitáskor ott a „csak regisztráltak” és a saját kód', await a.isVisible('#opt-regonly') && /ANNA5/.test(await a.textContent('#opt-owncode-code')));
    await a.check('#opt-regonly');
    await a.fill('#room-name-input', 'Fiókosok');
    await a.click('#btn-create-room');
    await a.waitForFunction(() => /^[A-Z0-9]{5}$/.test((document.getElementById('lobby-code') || {}).textContent || ''), null, { timeout: 15000 });
    check('a szoba a saját kóddal nyílt', (await a.textContent('#lobby-code')).trim() === 'ANNA5');
    const g = await H.newPlayer(browser, servers, 'vendég', view);
    await H.joinRoom(g, servers, 'ANNA5', 'Vili');
    await g.waitForFunction(() => /csak regisztrált/.test(document.getElementById('home-warning').textContent), null, { timeout: 15000 }).catch(() => {});
    check('vendég nem léphet be', /csak regisztrált/.test(await g.textContent('#home-warning')), await g.textContent('#home-warning'));
    await H.joinRoom(b, servers, 'ANNA5', 'Bence');
    await a.waitForFunction(() => document.querySelectorAll('#lobby-players .player-chip').length === 2, null, { timeout: 15000 });
    check('regisztrált beléphet', true);

    console.log('Profil:');
    await b.waitForSelector('#lobby-players .acct-badge.clickable', { timeout: 8000 });
    const idx = await b.evaluate(() => [...document.querySelectorAll('#lobby-players .player-chip')].findIndex(c => /Anna/.test(c.textContent)));
    await b.locator('#lobby-players .player-chip').nth(idx).locator('.acct-badge.clickable').click();
    await b.waitForSelector('#profile-overlay:not(.hidden) .pf-name', { timeout: 8000 });
    check('a ✔ jelvényre koppintva megnyílik a profil', /Anna/.test(await b.textContent('.pf-name')) && /Szint/.test(await b.textContent('#profile-body')));
    if (process.env.SHOTS) await b.screenshot({ path: process.env.SHOTS + '/profile.png' });
    await b.click('#pf-follow');
    await b.waitForFunction(() => /Követed/.test((document.getElementById('pf-follow') || {}).textContent || ''), null, { timeout: 8000 });
    check('a profilból követhető', true);
    await b.click('#profile-close-btn');

    console.log('Szólista:');
    await a.fill('#lobby-words-input', 'kalap\nesernyő\nbiciklitároló');
    a.once('dialog', d => d.accept('Kedvencek'));
    await a.click('#wordlist-save');
    await a.waitForFunction(() => /Kedvencek \(3 szó\)/.test(document.getElementById('wordlist-select').textContent), null, { timeout: 8000 });
    check('szólista elmentve a fiókba', true);
    await a.fill('#lobby-words-input', '');
    await a.click('#wordlist-load');
    check('szólista betöltve', (await a.inputValue('#lobby-words-input')).split('\n').length === 3);

    console.log('Galéria:');
    await a.click('#btn-start-match');
    const di = await Promise.race([a, b].map((p, i) => p.waitForSelector(prep, { timeout: 20000 }).then(() => i)));
    const drawer = [a, b][di], guesser = [a, b][1 - di];
    const word = await H.chooseFirstWord(drawer);
    await H.drawSquiggle(drawer);
    await H.waitForDrawingOnWatch(guesser);
    await H.guess(guesser, word);
    await drawer.waitForSelector('#btn-gallery-save:visible', { timeout: 15000 });
    check('a rajzoló a kör végén látja a „Mentés a galériámba” gombot', true);
    check('a tippelő nem', !(await guesser.isVisible('#btn-gallery-save')));
    await drawer.click('#btn-gallery-save');
    await drawer.waitForFunction(() => /Elmentve/.test(document.getElementById('gallery-save-status').textContent), null, { timeout: 10000 });
    check('a rajz bekerült a galériába', true);
    const prof = await drawer.evaluate(async n => (await (await fetch('/.netlify/functions/account?profile=' + encodeURIComponent(n))).json()), drawer === a ? 'Anna' : 'Bence');
    check('a profilon is látszik a rajz a szóval', (prof.gallery || []).some(x => x.word === word), JSON.stringify(prof.gallery));
    for (const p of [a, b, g]) check(`nincs JavaScript-hiba (${p.label})`, p.pageErrors.length === 0, p.pageErrors.join(' | '));
  } catch (e) {
    check('a teszt lefutott', false, e.message.split('\n')[0] + ' @ ' + ((e.stack || '').split('\n').find(l => /extras\.cjs/.test(l)) || '').trim());
  } finally { await browser.close(); servers.stop(); }
  const bad = results.filter(x => !x).length;
  console.log(bad ? `\n❌ ${bad} hiba` : `\n✅ mind a ${results.length} ellenőrzés rendben`);
  process.exit(bad ? 1 : 0);
})();
