// PIC-ASS-O — v4.53: belépett játékosnál betöltéskor ne villanjon fel a „Belépés / Regisztráció”
// A fiókszolgáltatást szándékosan lelassítjuk (lassú mobilnet), és a betöltés első pillanataiban nézzük a fiókgombot.
// Futtatás: node tests/e2e/acctflash.cjs
const { chromium } = require('playwright');
const H = require('../support/harness.cjs');
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`  ${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`); };
const ready = p => p.waitForFunction(() => !document.body.classList.contains('booting'), null, { timeout: 30000 });

(async () => {
  const servers = await H.startServers({ functions: true });
  const browser = await chromium.launch();
  try {
    const p = await H.newPlayer(browser, servers, 'Péter', { viewport: { width: 1200, height: 850 } });
    await p.goto(servers.base); await ready(p);
    await p.evaluate(async () => { await fetch('/.netlify/functions/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'register', name: 'Péter', email: 'peter@pelda.hu', consent: true }) }); });
    const m = (await (await fetch(servers.base + '__test/mails')).json()).find(x => x.to === 'peter@pelda.hu');
    await p.goto(/href="([^"]+\?confirm=[^"]+)"/.exec(m.html)[1]); await p.click('button'); await p.waitForSelector('text=Kész a fiókod');
    await p.goto(servers.base); await ready(p);
    await p.waitForFunction(() => /Péter — Fiókom/.test(document.getElementById('btn-account').textContent));
    // lassú fiókszerver: 2,5 mp késés
    await p.route('**/.netlify/functions/account', async r => { await new Promise(res => setTimeout(res, 2500)); await r.continue(); });
    const seen = new Set();
    p.on('framenavigated', () => {});
    const watch = async () => { for (let i = 0; i < 40; i++) { try { seen.add(await p.evaluate(() => { const b = document.getElementById('btn-account'); const cs = b && getComputedStyle(b); return b ? (cs.color === 'rgba(0, 0, 0, 0)' ? '[betölt]' : b.textContent.trim()) : ''; })); } catch (e) {} await p.waitForTimeout(80); } };
    await p.reload({ waitUntil: 'commit' });
    await watch();
    console.log('    a fiókgomb állapotai betöltés közben:', [...seen].filter(Boolean).join(' → '));
    check('belépett játékosnál betöltéskor nem villan fel a „Belépés / Regisztráció”', ![...seen].some(t => /Belépés/.test(t)));
    check('a név azonnal (a szerver válasza előtt) látszik', [...seen].some(t => /Péter — Fiókom/.test(t)));
    check('a regisztrációs ajánló sem villan fel', !(await p.isVisible('#reg-promo')));
    // a munkamenet közben megszűnt (pl. másik eszközről kiléptették): csendben vendégre vált
    await p.context().clearCookies();
    await p.reload(); await ready(p);
    await p.waitForFunction(() => /Belépés/.test(document.getElementById('btn-account').textContent), null, { timeout: 10000 }).catch(() => {});
    check('lejárt munkamenetnél a válasz után vendég nézetre vált', /Belépés/.test(await p.textContent('#btn-account')));
    check('…és a név újra szerkeszthető', !(await p.evaluate(() => document.getElementById('home-name').readOnly)));
    await p.unroute('**/.netlify/functions/account');
    // vendégnél semmi nem változik: azonnal a „Belépés / Regisztráció” látszik
    await p.reload({ waitUntil: 'commit' });
    await p.waitForSelector('#btn-account');
    check('vendégnél azonnal a „Belépés / Regisztráció” látszik', /Belépés/.test(await p.textContent('#btn-account')));
    check('nincs JavaScript-hiba', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  } catch (e) {
    check('a teszt lefutott', false, e.message.split('\n')[0]);
  } finally { await browser.close(); servers.stop(); }
  const bad = results.filter(x => !x).length;
  console.log(bad ? `\n❌ ${bad} hiba` : `\n✅ mind a ${results.length} ellenőrzés rendben`);
  process.exit(bad ? 1 : 0);
})();
