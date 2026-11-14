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
const PW = 'Nagyon-Titkos-42';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secret, t = Date.now()) {
  let bits = 0, val = 0; const out = [];
  for (const ch of secret) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac('sha1', Buffer.from(out)).update(msg).digest(); const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
const ready = p => p.waitForFunction(() => !document.body.classList.contains('booting'), null, { timeout: 30000 });

(async () => {
  const servers = await H.startServers({ functions: true });
  const browser = await chromium.launch();
  const mails = async () => (await fetch(servers.base + '__test/mails')).json();
  const view = { viewport: { width: 1280, height: 900 } };
  try {
    console.log('Regisztráció és belépés:');
    const a = await H.newPlayer(browser, servers, 'Péter', view);
    await a.goto(servers.base); await ready(a);
    await a.click('#btn-account');
    await a.click('[data-acct-go="register"]');
    await a.fill('#acct-reg-name', 'Péter'); await a.fill('#acct-reg-email', 'peter@pelda.hu');
    await a.fill('#acct-reg-pw', 'rovid'); await a.fill('#acct-reg-pw2', 'rovid');
    await a.check('#acct-f-register input[name=consent]');
    await a.evaluate(() => { document.getElementById('acct-reg-pw').removeAttribute('minlength'); });
    await a.click('#acct-f-register button[type=submit]');
    await a.waitForFunction(() => /10 karakter/.test(document.getElementById('acct-m-register').textContent));
    check('gyenge jelszót a szerver elutasít', true);
    await a.fill('#acct-reg-pw', PW); await a.fill('#acct-reg-pw2', PW);
    await a.click('#acct-f-register button[type=submit]');
    await a.waitForSelector('#acct-v-registered:not(.hidden)');
    const m = (await mails()).find(x => x.to === 'peter@pelda.hu');
    check('megerősítő levél ment ki', !!m && /Erősítsd meg a regisztrációt/.test(m.subject));
    // megerősítés előtt nem lehet belépni
    await a.click('#acct-v-registered [data-acct-go="login"]');
    await a.fill('#acct-login-email', 'peter@pelda.hu'); await a.fill('#acct-login-pw', PW);
    await a.click('#acct-f-login button[type=submit]');
    await a.waitForFunction(() => /Hibás/.test(document.getElementById('acct-m-login').textContent));
    check('megerősítés előtt nincs belépés', true);
    // a levél linkje: gomb, majd kész
    const link = /href="([^"]+\?confirm=[^"]+)"/.exec(m.html)[1];
    const c = await a.context().newPage();
    await c.goto(link); await c.click('button'); await c.waitForSelector('text=Kész a fiókod');
    await c.close();
    await a.fill('#acct-login-pw', PW);
    await a.click('#acct-f-login button[type=submit]');
    await a.waitForSelector('#acct-v-profile:not(.hidden)');
    check('belépés után a profil látszik', (await a.textContent('#acct-p-name')) === 'Péter');
    const cookies = await a.context().cookies();
    const sc = cookies.find(x => x.name === '__Host-picasso_s');
    check('a munkamenet-süti HttpOnly, Secure, SameSite=Strict', !!sc && sc.httpOnly && sc.secure && sc.sameSite === 'Strict');
    check('a JavaScript nem látja a munkamenet-kulcsot', !(await a.evaluate(() => document.cookie)).includes('picasso_s'));
    check('a böngésző tárhelyén nincs jelszó', !(await a.evaluate(() => JSON.stringify(Object.entries(localStorage)))).includes(PW));
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
    await H.joinRoom(g, servers, code, 'Vendég Béla');
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

    console.log('Kétfaktoros belépés:');
    await a.goto(servers.base); await ready(a);
    await a.waitForFunction(() => /Fiókom/.test(document.getElementById('btn-account').textContent));
    check('újratöltés után is belépve marad', true);
    await a.click('#btn-account');
    await a.click('#acct-btn-2fa');
    await a.fill('#acct-totp-pw', PW); await a.click('#acct-f-totp-pw button[type=submit]');
    await a.waitForSelector('#acct-totp-qr canvas');
    const secret = (await a.textContent('#acct-totp-secret')).replace(/\s/g, '');
    check('QR-kód és kézi kulcs látszik', /^[A-Z2-7]{32}$/.test(secret));
    await a.fill('#acct-totp-code', totp(secret)); await a.click('#acct-f-totp-scan button[type=submit]');
    await a.waitForSelector('#acct-v-totp-codes:not(.hidden)');
    const codes = await a.$$eval('#acct-backup-list li', l => l.map(x => x.textContent));
    check('8 tartalék kódot kap', codes.length === 8);
    await a.click('#acct-v-totp-codes [data-acct-go="profile"]');
    check('a profil mutatja, hogy be van kapcsolva', /Bekapcsolva/.test(await a.textContent('#acct-p-2fa')));
    // kilépés, majd belépés: jelszó után kódot kér
    await Promise.all([a.waitForNavigation(), a.click('#acct-btn-logout')]);
    await ready(a);
    check('kilépés után vendég, a név szerkeszthető', /Belépés/.test(await a.textContent('#btn-account')) && !(await a.evaluate(() => document.getElementById('home-name').readOnly)));
    await a.click('#btn-account');
    await a.fill('#acct-login-email', 'peter@pelda.hu'); await a.fill('#acct-login-pw', PW);
    await a.click('#acct-f-login button[type=submit]');
    await a.waitForSelector('#acct-login-code-row:not(.hidden)');
    await a.fill('#acct-login-code', '000000'); await a.click('#acct-f-login button[type=submit]');
    await a.waitForFunction(() => /Hibás/.test(document.getElementById('acct-m-login').textContent));
    check('hibás kóddal nem enged be', await a.isVisible('#acct-v-login'));
    await a.fill('#acct-login-code', codes[0]); await a.click('#acct-f-login button[type=submit]');
    await a.waitForSelector('#acct-v-profile:not(.hidden)');
    check('tartalék kóddal belép, és eggyel kevesebb marad', /7 tartalék/.test(await a.textContent('#acct-p-2fa')));

    console.log('Statisztika és értesítő:');
    // egy másik eszközön szerzett eredmény megjelenik itt is
    await a.evaluate(async () => {
      const g1 = await (await fetch('/.netlify/functions/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stats-get' }) })).json();
      await fetch('/.netlify/functions/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stats-put', rev: g1.rev, stats: { games: 7, wins: 3, points: 900, best: 250 } }) });
    });
    await a.click('#account-close-btn');
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
