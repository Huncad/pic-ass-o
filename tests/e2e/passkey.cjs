// PIC-ASS-O — v4.43: belépés jelkulccsal (passkey), Chrome virtuális hitelesítővel
// Futtatás: node tests/e2e/passkey.cjs
const { chromium } = require('playwright');
const H = require('../support/harness.cjs');
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`  ${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`); };
const PW = 'Nagyon-Titkos-42';
const ready = p => p.waitForFunction(() => !document.body.classList.contains('booting'), null, { timeout: 30000 });

(async () => {
  const servers = await H.startServers({ functions: true });
  const browser = await chromium.launch();
  const base = servers.base.replace('127.0.0.1', 'localhost');   // a WebAuthn IP-címen nem működik
  try {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await ctx.route('**/*', r => (/^(https?|wss?):\/\/(127\.0\.0\.1|localhost)[:/]/.test(r.request().url()) ? r.continue() : r.abort()));
    await ctx.addInitScript(port => { localStorage.setItem('picasso-server-url', 'http://127.0.0.1:' + port); localStorage.setItem('picasso-tutorial-seen', '1'); localStorage.setItem('picasso-theme', 'graphite'); }, servers.srvPort);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    // fiók (API-n át, a böngésző színeivel)
    await p.goto(base); await ready(p);
    console.log('   reg:', await p.evaluate(async pw => { const r = await fetch('/.netlify/functions/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'register', name: 'Jelkulcsos', email: 'pk@pelda.hu', password: pw, consent: true, pal: { bg: '#121314', panel: '#1e1f22', text: '#e9e9e6', dim: '#9a9da0', accent: '#d9d9de', link: '#8ab4f8', btn: '#d9d9de', btnText: '#121314' } }) }); return r.status + ' ' + await r.text(); }, PW));
    const mails = await (await fetch(servers.base + '__test/mails')).json();
    const m = mails.find(x => x.to === 'pk@pelda.hu');
    console.log('E-mail színek:');
    check('a megerősítő levél a játékos színeivel megy (nem zöld)', !!m && m.html.includes('#1e1f22') && !m.html.includes('#20452F'));
    await p.evaluate(u => fetch(u, { method: 'POST' }).then(r => r.status), new URL(/href="([^"]+\?confirm=[^"]+)"/.exec(m.html)[1]).pathname + new URL(/href="([^"]+\?confirm=[^"]+)"/.exec(m.html)[1]).search);
    console.log('Jelkulcs:');
    await p.click('#btn-account');
    await p.fill('#acct-login-email', 'pk@pelda.hu'); await p.fill('#acct-login-pw', PW);
    await p.click('#acct-f-login button[type=submit]');
    // belépéskor a fiók beállításai (színek) átkerülnek az eszközre, ehhez a lap egyszer újratöltődhet
    await p.waitForTimeout(2500); await ready(p);
    if (!(await p.isVisible('#acct-v-profile'))) { await p.waitForFunction(() => /Fiókom/.test(document.getElementById('btn-account').textContent)); await p.click('#btn-account'); }
    await p.waitForSelector('#acct-v-profile:not(.hidden)');
    check('a profilban látszik a jelkulcs rész', await p.isVisible('#acct-pk-box'));
    await p.click('#acct-pk-add');
    await p.waitForFunction(() => /Jelkulcs hozzáadva/.test(document.getElementById('acct-m-profile').textContent), null, { timeout: 15000 }).catch(() => {});
    check('jelkulcs hozzáadva', await p.evaluate(() => document.querySelectorAll('#acct-pk-list li button').length) === 1, await p.textContent('#acct-m-profile'));
    const n = (await (await fetch(servers.base + '__test/mails')).json()).filter(x => /Új jelkulcs/.test(x.subject)).length;
    check('biztonsági levél ment az új jelkulcsról', n === 1);
    await Promise.all([p.waitForNavigation(), p.click('#acct-btn-logout')]);
    await ready(p);
    await p.click('#btn-account');
    check('a belépésnél ott a „Belépés jelkulccsal” gomb', await p.isVisible('#acct-pk-login'));
    await p.click('#acct-pk-login');
    await p.waitForTimeout(2500); await ready(p);
    const inOk = await p.waitForFunction(() => /Fiókom/.test(document.getElementById('btn-account').textContent), null, { timeout: 10000 }).then(() => true).catch(() => false);
    check('jelszó nélkül, jelkulccsal belépett', inOk, await p.textContent('#acct-m-login').catch(() => ''));
    if (!(await p.isVisible('#acct-v-profile'))) await p.click('#btn-account');
    await p.waitForSelector('#acct-pk-list li button');
    // törlés után már nem jó
    await p.click('#acct-pk-list li button');
    await p.waitForFunction(() => !document.querySelector('#acct-pk-list li button'), null, { timeout: 8000 }).catch(() => {});
    await Promise.all([p.waitForNavigation(), p.click('#acct-btn-logout')]);
    await ready(p);
    await p.click('#btn-account'); await p.click('#acct-pk-login');
    await p.waitForFunction(() => /nem ismerjük/.test(document.getElementById('acct-m-login').textContent), null, { timeout: 15000 }).catch(() => {});
    check('a törölt jelkulccsal már nem lehet belépni', /nem ismerjük/.test(await p.textContent('#acct-m-login')));
    check('nincs JavaScript-hiba', errs.length === 0, errs.join(' | '));
  } catch (e) {
    check('a teszt lefutott', false, e.message.split('\n')[0]);
  } finally { await browser.close(); servers.stop(); }
  const bad = results.filter(x => !x).length;
  console.log(bad ? `\n❌ ${bad} hiba` : `\n✅ mind a ${results.length} ellenőrzés rendben`);
  process.exit(bad ? 1 : 0);
})();
