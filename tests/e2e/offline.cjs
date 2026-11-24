// Picasso offline csapatverseny (offline/Picasso-offline.html) — teljes böngészős ellenőrzés
// file:// alól, webszerver nélkül: semmilyen hálózati kérés; csapatok megadása (egyenként és listából),
// fix idejű menetek, a játékvezető a kitaláló nevére koppint, 10 mp-es javítás, személyes top 10,
// összesítő + menetnapló, menet törlése, félbeszakadt menet, mentés/betöltés, automatikus lejárat,
// rendezvény lezárása, licencek, rajzeszközök, kivetítő (a szó ott nem látszik), felbontások.
// Futtatás: node offline/build.mjs && node tests/e2e/offline.cjs   (SHOTS=mappa: képernyőképek)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const FILE = path.join(__dirname, '..', '..', 'offline', 'Picasso-offline.html');
const URL = pathToFileURL(FILE).href;
const KEY = 'picasso-verseny-v1';
const SHOTS = process.env.SHOTS || '';
const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`  ${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`); };

async function open(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  const net = [], errors = [];
  page.on('request', r => { if (!/^(file|data|blob|about):/.test(r.url())) net.push(r.url()); });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.install();
  await page.goto(URL);
  return { ctx, page, net, errors };
}
const active = p => p.evaluate(() => document.querySelector('.screen.active').id);
const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
const stored = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
const seed = (p, obj) => p.evaluate(([k, o]) => localStorage.setItem(k, JSON.stringify(o)), [KEY, obj]);
const peekWord = async p => { await p.locator('#peek').hover(); await p.mouse.down(); const w = (await p.textContent('#peek-w')).trim(); await p.mouse.up(); return w; };
// az óra a háttérben valós időben is halad, ezért ±1 mp eltérés megengedett
const near = (txt, sec) => { const m = /^(\d+):(\d\d)$/.exec(String(txt).trim()); return !!m && Math.abs(+m[1] * 60 + +m[2] - sec) <= 1; };
const strip = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
async function scribble(page, color) {
  if (color !== undefined) await page.click(`#swatches .swatch >> nth=${color % 11}`);
  const b = await page.locator('#board').boundingBox();
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.3);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(b.x + b.width * (0.2 + i * 0.03), b.y + b.height * (0.3 + Math.sin(i / 3) * 0.1));
  await page.mouse.up();
}
const inked = p => p.evaluate(() => {
  const c = document.getElementById('board'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 0; i < d.length; i += 4 * 7) if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) n++; return n;
});
const pixel = (p, x, y) => p.evaluate(([x, y]) => Array.from(document.getElementById('board').getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3)), [x, y]);
const teamCard = (page, num) => page.locator('.teamcard').filter({ has: page.locator(`.teamnum:text-is("${num}")`) });
async function addTeam(page, num, name, members) {
  await page.click('#add-team');
  const card = page.locator('.teamcard').last();
  await card.locator('input[type=number]').fill(String(num)); await card.locator('input[type=number]').dispatchEvent('change');
  const c2 = teamCard(page, num);
  if (name) { await c2.locator('input[type=text] >> nth=0').fill(name); await c2.locator('input[type=text] >> nth=0').dispatchEvent('change'); }
  for (const m of members) { await c2.locator('.addm input').fill(m); await c2.locator('.addm button').click(); }
}
const rowsOf = (p, sel) => p.evaluate(sel => [...document.querySelectorAll(sel + ' li')].map(li => ({ rank: li.querySelector('.rk').textContent, num: li.querySelector('.teamnum').textContent, name: li.querySelector('.nm').textContent, pts: +li.querySelector('.pt b').textContent, sub: li.querySelector('.pt small').textContent })), sel);
async function home(page) { if (await active(page) !== 's-home') await page.evaluate(() => document.querySelector('.screen.active [data-home]').click()); }
async function startTeam(page, num, drawer) {
  await home(page);
  await page.click('#go-pick');
  await page.locator('#pickgrid button').filter({ has: page.locator(`.teamnum:text-is("${num}")`) }).click();
  if (drawer) await page.click(`#rd-who button:text-is("${drawer}")`); else await page.click('#rd-who button');
}
const guess = (page, name) => page.click(`#guessers [data-guesser="${name}"]`);
const pickDrawer = (page, name) => page.locator('#pk-who button').filter({ hasText: new RegExp('^' + name + '( \\(megint\\))?$') }).click();

(async () => {
  if (!fs.existsSync(FILE)) { console.error('Előbb: node offline/build.mjs'); process.exit(1); }
  const browser = await chromium.launch();
  try {
    // ---------------- betöltés, hálózat, tartalom, licencek, kinézet ----------------
    console.log('Betöltés file:// alól:');
    const { ctx, page, net, errors } = await open(browser);
    check('kezdőlap látszik', await active(page) === 's-home');
    check('cím: „Picasso”, sehol „PIC-ASS-O”', (await page.title()) === 'Picasso offline' && (await page.textContent('h1')) === 'Picasso' && !/pic-ass-o/i.test(await page.content()));
    const html = fs.readFileSync(FILE, 'utf8');
    const noLicense = html.replace(/<details class="licenses"[\s\S]*?<\/details>/, '').replace(/base64,[A-Za-z0-9+/=]+/g, '');
    check('nincs külső URL a fájlban (a licencszövegen kívül)', !/(https?:)?\/\/[a-z0-9-]+\.[a-z]{2,}\//i.test(noLicense));
    check('nincs zene / hang', !/<audio|<video|new Audio|AudioContext|\.mp3|\.ogg|\.wav/i.test(html));
    const blocked = await page.evaluate(async () => { try { await fetch('https://example.com/'); return false; } catch (e) { return true; } });
    check('a CSP minden hálózati kérést tilt', blocked);
    check('beágyazott betűtípusok', await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('700 20px Kalam') && document.fonts.check('800 16px Nunito'); }));
    const lic = await page.textContent('#licenses');
    check('licencek: OFL 1.1 teljes szövege és a szerzői jogok', /SIL OPEN FONT LICENSE Version 1\.1/.test(lic) && /The Nunito Project Authors/.test(lic) && /Indian Type Foundry/.test(lic) && /DISCLAIMER/.test(lic));
    const words = JSON.parse((html.match(/const WORDS = (\{.*?\});/) || [])[1]);
    check('a teljes szótár benne van', words.konnyu.length + words.kozepes.length + words.nehez.length > 12000, `${words.konnyu.length} / ${words.kozepes.length} / ${words.nehez.length}`);
    check('szürke skin', await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(26, 26, 30)');
    check('animációk: képernyőváltás, logó', await page.evaluate(() => getComputedStyle(document.querySelector('.screen.active')).animationName === 'enter' && getComputedStyle(document.querySelector('.logo h1')).animationName === 'wiggle'));
    check('alapértelmezett lejárat: 24 óra', await page.getAttribute('.pills[data-opt=keep] [data-v="24"]', 'aria-pressed') === 'true');
    await shot(page, '01-kezdolap');

    // ---------------- csapatok megadása ----------------
    console.log('Csapatok:');
    await page.click('#go-pick');
    check('csapat nélkül nem indítható (a csapatoldalra visz)', await active(page) === 's-teams');
    await addTeam(page, 1, 'Kék bálnák', ['Anna', 'Béla', 'Csilla']);
    await addTeam(page, 2, '', ['Dénes', 'Emese']);
    await addTeam(page, 5, 'Egyszemélyes', ['Ferenc']);
    check('3 csapat létrehozva', await page.locator('.teamcard').count() === 3);
    await teamCard(page, 2).locator('.addm input').fill('anna');
    await teamCard(page, 2).locator('.addm button').click();
    check('egy ember csak egy csapatban lehet', /már tag itt: 1\. csapat/.test(await page.textContent('#toast')) && await teamCard(page, 2).locator('.members li').count() === 2);
    await teamCard(page, 5).locator('input[type=number]').fill('2');
    await teamCard(page, 5).locator('input[type=number]').dispatchEvent('change');
    check('azonos csapatszám elutasítva', /Már van 2\. csapat/.test(await page.textContent('#toast')) && await teamCard(page, 5).count() === 1);
    await teamCard(page, 5).locator('input[type=number]').fill('3');
    await teamCard(page, 5).locator('input[type=number]').dispatchEvent('change');
    check('csapatszám átírható', await teamCard(page, 3).count() === 1 && await teamCard(page, 5).count() === 0);
    await teamCard(page, 1).locator('.addm input').fill('<img src=x onerror=alert(1)>');
    await teamCard(page, 1).locator('.addm button').click();
    check('HTML a névben szövegként jelenik meg', await page.locator('.teamcard img').count() === 0);
    await teamCard(page, 1).locator('.members li:has-text("img") button').click();
    await page.click('#bulk summary');
    await page.fill('#bulk-in', '4 Zöld Sárkányok: Gábor, Hajni, István\n6: Judit, Kata\n2: Dénes, Emese, Laci\nhibás sor\n7: Anna');
    await page.click('#bulk-btn');
    const st1 = await stored(page);
    check('listából: új csapatok és frissítés', st1.teams.length === 6 && st1.teams.find(t => t.num === 4).name === 'Zöld Sárkányok' && st1.teams.find(t => t.num === 2).members.join() === 'Dénes,Emese,Laci');
    check('listából: hibás sor és foglalt tag jelezve', /4\. sor/.test(await page.textContent('#bulk-err')) && /Anna \(már tag itt: 1\. csapat\)/.test(await page.textContent('#bulk-err')));
    await teamCard(page, 7).locator('button.danger').click(); await page.click('#mc-yes');
    await shot(page, '02-csapatok');
    await page.reload();
    check('újratöltés után megmaradnak a csapatok', (await stored(page)).teams.map(t => t.num).sort().join() === '1,2,3,4,6');

    await page.click('.pills[data-opt=time] [data-v="60"]');
    await page.fill('#time-custom', '1.5'); await page.locator('#time-custom').dispatchEvent('change');
    check('egyéni idő: 1,5 perc', (await stored(page)).cfg.time === 90 && /1,5 perc/.test(await page.textContent('#go-pick-sub')));
    await page.click('.pills[data-opt=time] [data-v="60"]');
    await page.click('.pills[data-opt=diff] [data-v=kozepes]');
    const middle = new Set(words.kozepes.map(w => w.toLowerCase()));

    // ---------------- 1. menet: 2. csapat (Dénes, Emese, Laci) ----------------
    console.log('Menet (2. csapat, 1 perc):');
    await page.click('#go-pick');
    await page.locator('#pickgrid button').filter({ has: page.locator('.teamnum:text-is("2")') }).click();
    check('indulás: csapat, tagok, rajzoló választó', await active(page) === 's-ready' && await page.locator('#rd-who button').count() === 3);
    await page.clock.runFor(10000);
    await page.click('#rd-who button:text-is("Emese")');
    check('az óra csak a rajzoló kiválasztásakor indul', await active(page) === 's-play' && near(await page.textContent('#timer'), 60));
    check('kitaláló gombok: a csapattagok, a rajzoló nélkül', (await page.locator('#guessers [data-guesser]').allTextContents()).join() === 'Dénes,Laci');
    check('a szó alapból rejtve', /tartsd lenyomva/.test(await page.textContent('#peek-w')));
    const w1 = await peekWord(page);
    check('nyomva tartva látszik a szó (közepes szólistából)', middle.has(w1.toLowerCase()), w1);
    await scribble(page, 2);
    await page.clock.runFor(7000);
    check('az óra megy', near(await page.textContent('#timer'), 53));
    await shot(page, '03-jatek');
    await guess(page, 'Dénes');
    check('+1 felvillan a szóval és a kitaláló nevével', await page.evaluate(() => document.getElementById('fx').classList.contains('run')) && (await page.textContent('#fx-w')) === `${w1} — Dénes`);
    check('pontszám: 1, animálva', (await page.textContent('#p-score')) === '⭐ 1' && await page.evaluate(() => document.getElementById('p-score').classList.contains('bump')));
    check('rajzolóválasztó jön, a szó és a rajz eltűnik', await page.isVisible('#m-picker') && /tartsd/.test(await page.textContent('#peek-w')) && await inked(page) === 0);
    check('javítás gomb 10 mp-ig, visszaszámlálással', await page.isVisible('#pk-undo') && /Javítás: Dénes \((10|9)\)/.test(await page.textContent('#pk-undo')));
    await page.clock.runFor(3000);
    { const tt = await page.textContent('#timer'); check('az óra választás közben is megy', near(tt, 50), tt); }
    const ink0 = await inked(page); await scribble(page);
    check('választás közben nem lehet rajzolni', await inked(page) === ink0);
    await shot(page, '04-rajzolovalasztas');
    await pickDrawer(page, 'Laci');
    const w2 = await peekWord(page);
    check('új rajzoló, új szó; kitalálók: Dénes, Emese', /rajzol: Laci/.test(await page.textContent('#p-drawer')) && w2 !== w1 && (await page.locator('#guessers [data-guesser]').allTextContents()).join() === 'Dénes,Emese');
    check('a javítás az új szónál is elérhető (10 mp-en belül)', await page.isVisible('#undo-btn2'));
    await page.click('#pass-btn');
    check('passz: nincs pont, és nem kínál javítást', (await page.textContent('#p-score')) === '⭐ 1' && /Passz/.test(await page.textContent('#fx-big')) && !(await page.isVisible('#pk-undo')));
    await pickDrawer(page, 'Dénes');
    const w3 = await peekWord(page);
    await guess(page, 'Emese');
    // javítás: valójában Laci találta ki
    await page.click('#pk-undo');
    check('javító ablak: a rajzoló és a mostani kitaláló nélkül + „Senki”', await page.isVisible('#m-fix') && (await page.locator('#fix-who button').allTextContents()).join() === 'Laci,Senki — nincs pont');
    await page.click('#fix-who button:text-is("Laci")');
    check('javítva: a pont Lacié, a pontszám nem változik', (await page.textContent('#p-score')) === '⭐ 2' && /Javítva/.test(await page.textContent('#fx-big')) && (await page.textContent('#fx-w')) === `${w3} — Laci`);
    check('a javítás után nincs újabb javítás', !(await page.isVisible('#pk-undo')));
    await pickDrawer(page, 'Dénes');
    const w4 = await peekWord(page);
    await guess(page, 'Laci');
    await page.click('#pk-undo');
    await page.click('#fix-who button:text-is("Senki — nincs pont")');
    check('javítás: „Senki” → a pont törlődik', (await page.textContent('#p-score')) === '⭐ 2');
    await pickDrawer(page, 'Dénes');
    const w5 = await peekWord(page);
    await guess(page, 'Emese');
    await page.clock.runFor(11000);
    check('10 mp után már nem javítható', !(await page.isVisible('#pk-undo')));
    await pickDrawer(page, 'Laci');
    const w6 = await peekWord(page);
    await page.click('#pause-btn');
    const tp = await page.textContent('#timer');
    await page.clock.runFor(20000);
    check('szünetben áll az óra, a rajz és a szó takarva', (await page.textContent('#timer')) === tp && await page.isVisible('#m-pause') && /tartsd/.test(await page.textContent('#peek-w')));
    await page.click('#resume-btn');
    await page.clock.runFor(70000);
    check('lejárt idő: ki találta ki az utolsót? (a rajzoló nélkül)', await page.isVisible('#m-picker') && /Lejárt/.test(await page.textContent('#pk-title')) && (await page.textContent('#pk-sub')).includes(w6) && (await page.locator('#pk-who button').allTextContents()).join() === 'Dénes,Emese,Senki');
    const ink1 = await inked(page); await scribble(page);
    check('lejárt idő után nem lehet rajzolni', await inked(page) === ink1);
    await page.keyboard.press('Escape');
    check('Esc nem zárja be', await page.isVisible('#m-picker'));
    await page.click('#pk-who button:text-is("Emese")');
    await page.clock.runFor(2000);
    check('eredmény: 4 kitalált rajz', await active(page) === 's-result' && (await page.textContent('#rs-num')) === '4');
    const rw = await page.locator('#rs-words li').allTextContents();
    check('szólista a kitalálókkal', rw.join('|') === [`✔ ${w1} · Dénes`, w2, `✔ ${w3} · Laci`, w4, `✔ ${w5} · Emese`, `✔ ${w6} · Emese`].join('|'), rw.join('|'));
    check('konfetti', await page.locator('canvas.confetti').count() === 1);
    await shot(page, '05-eredmeny');
    const st3 = await stored(page);
    const r1 = st3.runs[0];
    check('napló: kitaláló, rajzoló, időpont, javítás jelölve', r1.points === 4 && r1.words[0].by === 'Dénes' && r1.words[0].dr === 'Emese' && r1.words[2].by === 'Laci' && r1.words[2].fixed && !r1.words[3].ok && r1.words[3].fixed && r1.words[0].t >= 6 && r1.words[0].t <= 8);
    check('a használt szavak megjegyezve', [w1, w2, w3, w4].every(w => st3.used.includes(strip(w))));

    // ---------------- további menetek ----------------
    console.log('További menetek:');
    await startTeam(page, 3, 'Ferenc');
    check('egytagú csapat: egyetlen „Kitalálták” gomb', await page.isVisible('#ok-btn') && await page.locator('#guessers [data-guesser]').count() === 0);
    for (let i = 0; i < 4; i++) await page.click('#ok-btn');
    check('egytagú csapat: választás nélkül jön a következő szó, a javítás a sávban', !(await page.isVisible('#m-picker')) && (await page.textContent('#p-score')) === '⭐ 4' && await page.isVisible('#undo-btn2'));
    await page.clock.runFor(61000);
    await page.click('#mc-no');
    await page.clock.runFor(2000);
    check('3. csapat: 4 pont', (await page.textContent('#rs-num')) === '4');
    await startTeam(page, 1, 'Anna');
    await guess(page, 'Béla');
    await page.clock.runFor(63000);
    check('választás közben lejárt idő: rögtön eredmény', await active(page) === 's-result' && (await page.textContent('#rs-num')) === '1' && !(await page.isVisible('#m-picker')));
    await startTeam(page, 4, 'Gábor');
    await guess(page, 'Hajni'); await pickDrawer(page, 'Hajni');
    await page.click('#quit-btn');
    const tq = await page.textContent('#timer'); await page.clock.runFor(5000);
    check('megszakítás kérdésénél áll az óra', (await page.textContent('#timer')) === tq);
    await page.click('#mc-no'); await page.clock.runFor(2000);
    await page.click('#quit-btn'); await page.click('#mc-yes');
    check('megszakított menet nem kerül be', await active(page) === 's-home' && (await stored(page)).runs.length === 3 && (await stored(page)).live === null);

    // ---------------- összesítő + személyes top 10 ----------------
    console.log('Összesítő:');
    await page.click('#go-board');
    let rows = await rowsOf(page, '#board-list');
    check('csapatok: 2. és 3. holtversenyben (4 p), 1. (1 p), nem játszók', rows.map(r => r.rank + r.num + ':' + r.pts).join() === '1.2:4,1.3:4,3.1:1,4.4:0,4.6:0', rows.map(r => r.rank + r.num + ':' + r.pts).join());
    let people = await rowsOf(page, '#people-list');
    check('személyek: Emese 2, utána Béla, Dénes, Laci 1-1 (holtverseny)', people.map(r => r.rank + r.name + ':' + r.pts).join() === '1.Emese:2,2.Béla:1,2.Dénes:1,2.Laci:1', people.map(r => r.rank + r.name + ':' + r.pts).join());
    check('a rajzoló nem kap pontot, névtelen „kitalálták” nem kerül a listára', !people.some(r => r.name === 'Ferenc') && !people.some(r => r.name === 'Hajni'));
    check('sávok animálva', await page.evaluate(() => getComputedStyle(document.querySelector('#board-list .bar')).animationName === 'grow'));
    await shot(page, '06-osszesito');
    await page.click('#board-list li:first-child');
    await page.click('#mt-runs details summary');
    const logTxt = await page.textContent('#mt-runs .log');
    check('menetnapló: szó, kitaláló, rajzoló, javítás', logTxt.includes(`${w1} — ✔ Dénes · rajzolta: Emese`) && logTxt.includes(`${w3} — ✔ Laci · rajzolta: Dénes · (javítva)`) && logTxt.includes(`${w4} — nem találták ki / passz · rajzolta: Dénes · (javítva)`));
    await shot(page, '07-menetnaplo');
    await page.keyboard.press('Escape');
    // 12 tippelő → csak a top 10 látszik
    {
      const o = await open(browser);
      const names = Array.from({ length: 12 }, (_, i) => 'Játékos' + (i + 1));
      await seed(o.page, { teams: [{ id: 'x', num: 1, name: '', members: names }], runs: [{ id: 'r', team: 'x', at: Date.now(), time: 60, words: names.flatMap((n, i) => Array.from({ length: 12 - i }, () => ({ w: 'szó', ok: true, by: n }))) }], last: Date.now() });
      await o.page.reload(); await o.page.click('#go-board');
      const pl = await rowsOf(o.page, '#people-list');
      check('személyes lista: legfeljebb 10 fő, csökkenő sorrendben', pl.length === 10 && pl[0].name === 'Játékos1' && pl[0].pts === 12 && pl[9].name === 'Játékos10');
      await o.ctx.close();
    }

    // ---------------- félbeszakadt menet ----------------
    console.log('Félbeszakadt menet:');
    await startTeam(page, 6, 'Judit');
    await guess(page, 'Kata'); await pickDrawer(page, 'Kata'); await guess(page, 'Judit'); await pickDrawer(page, 'Judit');
    await page.clock.runFor(12000);
    await page.reload();
    check('újranyitáskor felajánlja a folytatást', await page.isVisible('#m-confirm') && /Félbeszakadt menet: 6\. csapat, 2 pont/.test(await page.textContent('#mc-text')));
    await page.click('#mc-yes');
    check('folytatás szüneteltetve, pontok, idő és kitalálók megmaradtak', await active(page) === 's-play' && await page.isVisible('#m-pause') && (await page.textContent('#p-score')) === '⭐ 2' && /0:[45]\d/.test(await page.textContent('#timer')) && (await stored(page)).live.words.map(w => w.by).join() === 'Kata,Judit');
    await page.click('#resume-btn');
    await guess(page, 'Kata'); await pickDrawer(page, 'Kata');
    await page.clock.runFor(70000); await page.click('#pk-who button:text-is("Senki")'); await page.clock.runFor(2000);
    check('folytatott menet: 3 pont', (await page.textContent('#rs-num')) === '3');
    await startTeam(page, 4, 'István');
    await guess(page, 'Hajni'); await pickDrawer(page, 'Hajni');
    await page.reload();
    await page.click('#mc-no');
    check('második kérdés: lezárás vagy elvetés', /Lezárás \(1 pont\)/.test(await page.textContent('#mc-yes')));
    await page.click('#mc-yes');
    check('lezárva 1 ponttal, Hajni személyes pontjával', await active(page) === 's-result' && (await stored(page)).runs.some(r => r.points === 1 && r.words[0].by === 'Hajni'));

    // ---------------- menet törlése ----------------
    await page.click('#rs-board');
    await page.locator('#board-list li').filter({ has: page.locator('.teamnum:text-is("6")') }).click();
    await page.click('#mt-runs li:last-child button.danger');
    await page.click('#mc-yes');
    await page.keyboard.press('Escape');
    people = await rowsOf(page, '#people-list');
    check('menet törlése a személyes pontokat is levonja', !people.some(r => r.name === 'Kata' || r.name === 'Judit'));

    // ---------------- mentés / betöltés / eredmények törlése ----------------
    console.log('Adatok:');
    await home(page);
    const before = await stored(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
    const dlPath = path.join(os.tmpdir(), 'picasso-test-export.json');
    await dl.saveAs(dlPath);
    const exp = JSON.parse(fs.readFileSync(dlPath, 'utf8'));
    check('mentés fájlba', /^picasso-eredmenyek_\d{4}-\d\d-\d\d_\d{4}\.json$/.test(dl.suggestedFilename()) && exp.app === 'picasso-offline' && exp.runs.length === before.runs.length);
    await page.click('#reset-btn'); await page.click('#mc-yes');
    check('eredmények törlése (a csapatok maradnak)', (await stored(page)).runs.length === 0 && (await stored(page)).teams.length === 5);
    await page.setInputFiles('#import-file', { name: 'rossz.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
    check('idegen fájl elutasítva', await page.waitForFunction(() => /nem Picasso/.test(document.getElementById('toast').textContent), null, { timeout: 3000 }).then(() => true, () => false));
    await page.setInputFiles('#import-file', dlPath);
    await page.waitForSelector('#m-confirm.open');
    await page.click('#mc-yes');
    const after = await stored(page);
    check('betöltés visszaállítja az eredményeket a kitalálókkal együtt', after.runs.length === before.runs.length && JSON.stringify(after.runs.map(r => r.words)) === JSON.stringify(before.runs.map(r => r.words)));
    fs.unlinkSync(dlPath);

    // ---------------- rajzeszközök ----------------
    console.log('Rajzeszközök:');
    await startTeam(page, 1, 'Csilla');
    check('új szónál üres a lap', await inked(page) === 0);
    await scribble(page, 2);
    check('rajzolás egérrel', await inked(page) > 20);
    await page.click('#undo-btn');
    check('visszavonás', await inked(page) === 0);
    const b = await page.locator('#board').boundingBox();
    await page.click('.tool[data-size="12"]');
    await page.mouse.move(b.x + b.width * .4, b.y + b.height * .4); await page.mouse.down();
    for (const [x, y] of [[.6, .4], [.6, .6], [.4, .6], [.4, .4]]) await page.mouse.move(b.x + b.width * x, b.y + b.height * y, { steps: 8 });
    await page.mouse.up();
    await page.click('.tool[data-mode=fill]');
    await page.click('#swatches .swatch >> nth=5');
    await page.mouse.click(b.x + b.width * .5, b.y + b.height * .5);
    check('kitöltés: belül zöld, kívül fehér', (await pixel(page, 600, 450)).join() === '47,168,79' && (await pixel(page, 100, 100)).join() === '255,255,255');
    await page.click('#undo-btn');
    check('kitöltés visszavonható', (await pixel(page, 600, 450)).join() === '255,255,255');
    await page.click('.tool[data-mode=eraser]');
    await page.mouse.move(b.x + b.width * .35, b.y + b.height * .5); await page.mouse.down();
    await page.mouse.move(b.x + b.width * .65, b.y + b.height * .5, { steps: 15 }); await page.mouse.up();
    check('radír', (await pixel(page, 480, 450)).join() === '255,255,255');
    await page.click('#clear-btn');
    check('lap törlése', await inked(page) === 0);
    await page.click('#undo-btn');
    check('törlés visszavonható', await inked(page) > 0);
    await page.click('.tool[data-mode=eraser]');
    await page.evaluate(() => {
      const c = document.getElementById('board'), r = c.getBoundingClientRect();
      const ev = (type, x) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: r.left + x, clientY: r.top + 40, buttons: 1 }));
      ev('pointerdown', 30); for (let x = 40; x < 200; x += 10) ev('pointermove', x); ev('pointerup', 200);
    });
    check('érintéses rajzolás', (await pixel(page, Math.round(120 * 1200 / b.width), Math.round(40 * 900 / b.height))).join() !== '255,255,255');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    check('ablakváltáskor automatikus szünet', await page.isVisible('#m-pause'));
    await page.click('#resume-btn');
    await page.click('#quit-btn'); await page.click('#mc-yes');

    // ---------------- rendezvény lezárása ----------------
    console.log('Rendezvény lezárása:');
    await page.click('#close-btn');
    check('végeredmény: dobogó (3 csapat), csapatok, top tippelők', await active(page) === 's-final' && await page.locator('#final-podium > div').count() === 3 && await page.locator('#final-teams li').count() === 5 && await page.locator('#final-people li').count() > 0);
    check('dobogó: középen az 1. hely', (await page.locator('#final-podium > div').nth(1).locator('.blk').textContent()) === '1.');
    await page.clock.runFor(3000);
    await shot(page, '08-vegeredmeny');
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#final-export')]);
    check('végeredmény mentése fájlba', /^picasso-eredmenyek_/.test(dl2.suggestedFilename()));
    await page.click('#final-wipe');
    await page.click('#mc-no');
    check('„Mégse” → semmi nem törlődik', (await stored(page)).teams.length === 5);
    await page.click('#final-wipe'); await page.click('#mc-yes');
    const wiped = await stored(page);
    check('minden adat törölve, a beállítások maradnak', await active(page) === 's-home' && wiped.teams.length === 0 && wiped.runs.length === 0 && wiped.used.length === 0 && wiped.cfg.time === 60 && !JSON.stringify(wiped).includes('Dénes'));
    await page.click('#close-btn');
    check('üres adatoknál a lezárás csak jelez', await active(page) === 's-home' && /Nincs mit lezárni/.test(await page.textContent('#toast')));

    const realErrors = errors.filter(e => !/example\.com/.test(e));
    check('nincs konzolhiba', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
    check('egyetlen hálózati kérés sem történt', net.length === 0, net.slice(0, 3).join(', '));
    await ctx.close();

    // ---------------- automatikus lejárat ----------------
    console.log('Automatikus lejárat:');
    {
      const o = await open(browser);
      const H = 3600e3, base = { teams: [{ id: 'a', num: 1, name: '', members: ['Anna', 'Béla'] }], runs: [{ id: 'r', team: 'a', at: Date.now(), time: 60, words: [{ w: 'alma', ok: true, by: 'Anna' }] }] };
      await seed(o.page, { ...base, cfg: { time: 120, keep: 24 }, last: Date.now() - 25 * H });
      await o.page.reload();
      let st = await stored(o.page);
      check('24 órás beállítás, 25 óra tétlenség → minden törölve megnyitáskor', st.teams.length === 0 && st.runs.length === 0 && st.cfg.time === 120 && st.cfg.keep === 24);
      await o.page.clock.runFor(500);
      check('értesítés a törlésről', /automatikusan törlődtek/.test(await o.page.textContent('#toast')));
      await seed(o.page, { ...base, cfg: { keep: 48 }, last: Date.now() - 25 * H });
      await o.page.reload();
      check('48 órás beállításnál 25 óra után még megvan', (await stored(o.page)).teams.length === 1);
      await o.page.click('.pills[data-opt=keep] [data-v="12"]');
      check('lejárat átállítható 12 órára', (await stored(o.page)).cfg.keep === 12);
      await o.page.clock.runFor(11 * H);
      check('nyitva hagyva: 11 óra után még megvan', (await stored(o.page)).teams.length === 1);
      await o.page.clock.runFor(2 * H);
      check('nyitva hagyva: 12 óra tétlenség után magától törlődik', (await stored(o.page)).teams.length === 0 && /automatikusan törlődtek/.test(await o.page.textContent('#toast')));
      // menet közben nem törlődik
      await seed(o.page, { ...base, cfg: { keep: 12, time: 1800 }, last: await o.page.evaluate(() => Date.now()) });   // a lap órája már előrébb jár
      await o.page.reload();
      await o.page.click('#go-pick'); await o.page.click('#pickgrid button'); await o.page.click('#rd-who button >> nth=0');
      await o.page.clock.runFor(25 * 60e3);
      const live = await stored(o.page);
      check('menet közben az adatok frissülnek, nem járnak le', live.teams.length === 1 && await active(o.page) === 's-play' && live.live && await o.page.evaluate(l => Date.now() - l < 10000, live.last));
      check('lejárat: nincs hiba', o.errors.length === 0, o.errors.join(' | '));
      await o.ctx.close();
    }

    // ---------------- kivetítő ----------------
    console.log('Kivetítő (közönség) ablak:');
    {
      const o = await open(browser);
      const m = o.page;
      await seed(m, { teams: [{ id: 'a', num: 1, name: 'Kék bálnák', members: ['Anna', 'Béla', 'Csaba'] }, { id: 'b', num: 2, name: '', members: ['Dóra', 'Ede'] }], cfg: { time: 120, diff: 'konnyu' }, last: Date.now() });
      await m.reload();
      const [proj] = await Promise.all([m.waitForEvent('popup'), m.click('#proj-btn')]);
      await proj.setViewportSize({ width: 1920, height: 1080 });
      const pnet = []; proj.on('request', r => { if (!/^(file|data|about|blob):/.test(r.url())) pnet.push(r.url()); });
      const ptext = () => proj.evaluate(() => document.body.innerText);
      await m.waitForTimeout(100);
      check('várakozó kép a csapatokkal', /hamarosan/.test(await ptext()) && (await ptext()).includes('1. csapat · Kék bálnák'));
      check('szürke skin a kivetítőn is', await proj.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(26, 26, 30)');
      await m.click('#go-pick'); await m.locator('#pickgrid button').first().click();
      check('indulásnál: „következik” + tagok', /1\. csapat · Kék bálnák következik/.test(await ptext()) && (await ptext()).includes('Csaba'));
      await m.click('#rd-who button:text-is("Anna")');
      let leaked = false, mirror = true;
      for (let i = 0; i < 4; i++) {
        const w = (await m.textContent('#peek-w')).trim();
        if (i === 0) check('kivetítővel a szó a laptopon végig látszik', !/tartsd/.test(w));
        await scribble(m, i);
        await m.waitForTimeout(60);
        const diff = await m.evaluate(() => {
          const a = document.getElementById('board').getContext('2d').getImageData(0, 0, 1200, 900).data;
          const b = window.open('', 'picasso-kivetito').document.getElementById('a-canvas').getContext('2d').getImageData(0, 0, 1200, 900).data;
          let n = 0; for (let j = 0; j < a.length; j += 4 * 13) if (a[j] !== b[j] || a[j + 1] !== b[j + 1] || a[j + 2] !== b[j + 2]) n++; return n;
        });
        if (diff) mirror = false;
        if ((await ptext()).includes(w)) leaked = true;
        if (i === 0) { await shot(proj, '09-kivetito-rajz'); await shot(m, '10-laptop-rajzolo'); }
        await m.clock.runFor(5000);
        if (i === 2) {
          await m.click('#pass-btn');
          check('passz után a kivetítőn felvillan a szó', /Passz/.test(await proj.textContent('#fx-big')) && (await proj.textContent('#fx-w')) === w);
        } else {
          const g = (await m.locator('#guessers [data-guesser]').allTextContents())[0];
          await guess(m, g);
          check(`(${i + 1}) kitalálás után: a szó és a kitaláló neve a kivetítőn („${w} — ${g}”)`, (await proj.textContent('#fx-w')) === `${w} — ${g}` && /\+1/.test(await proj.textContent('#fx-big')));
          if (i === 1) {
            await m.click('#pk-undo');
            check('javítás közben a kivetítő jelzi', /Javítás/.test(await ptext()));
            await m.click('#fix-who button:text-is("Senki — nincs pont")');
            check('javítás a kivetítőn is felvillan', /Javítva/.test(await proj.textContent('#fx-big')) && /nincs pont/.test(await proj.textContent('#fx-w')) && (await proj.textContent('#a-score')) === '⭐ 1');
          }
        }
        check(`(${i + 1}) rajzolóválasztásnál a kivetítő ezt mutatja`, /Ki rajzol következőnek/.test(await ptext()));
        if (i === 0) await shot(proj, '11-kivetito-valasztas');
        await pickDrawer(m, i % 2 ? 'Anna' : 'Béla');
      }
      check('a rajzolandó szó a kitalálás előtt soha nem látszik a kivetítőn', !leaked);
      check('a kivetítő pixelre pontosan tükrözi a rajzot', mirror);
      check('fejléc: csapat, rajzoló, pont, idő', /Kék bálnák/.test(await proj.textContent('#a-info')) && /rajzol: Anna/.test(await proj.textContent('#a-info')) && (await proj.textContent('#a-score')) === '⭐ 2' && /^\d:\d\d$/.test(await proj.textContent('#a-timer')));
      await m.click('#pause-btn');
      check('szünet a kivetítőn (rajz nélkül)', /Szünet/.test(await ptext()) && !(await proj.isVisible('#a-canvas')));
      await m.click('#resume-btn');
      const lastW = (await m.textContent('#peek-w')).trim();
      await m.clock.runFor(200000);
      check('lejárt idő a kivetítőn, a szó nélkül', /Lejárt az idő/.test(await ptext()) && !(await ptext()).includes(lastW));
      await m.click('#pk-who button:text-is("Csaba")');
      await m.clock.runFor(2000);
      check('eredmény a kivetítőn: pont, szavak a kitalálókkal, konfetti', (await proj.textContent('#a-rs-n')) === '3' && (await proj.locator('#a-rs-w li').count()) === 5 && (await proj.textContent('#a-rs-w')).includes('· Csaba') && (await proj.locator('canvas.confetti').count()) === 1);
      await shot(proj, '12-kivetito-eredmeny');
      await m.click('#rs-board');
      check('összesítő a kivetítőn: csapatok és top tippelők', await proj.locator('#a-board-list li').count() === 2 && (await proj.textContent('#a-board-list li:first-child .pt b')) === '3' && await proj.locator('#a-people li').count() >= 2);
      await m.clock.runFor(3000);
      await shot(proj, '13-kivetito-osszesito');
      await m.evaluate(() => document.querySelector('#s-board [data-home]').click());
      await m.click('#close-btn');
      check('lezárásnál a kivetítőn végeredmény dobogóval', /Végeredmény/.test(await proj.textContent('#a-board-h')) && await proj.locator('#a-pod .podium > div').count() === 1);
      await m.clock.runFor(3000);
      await shot(proj, '14-kivetito-vegeredmeny');
      // sok csapat: a kivetítő összesítője kicsinyít, hogy kiférjen
      await m.evaluate(k => { const d = JSON.parse(localStorage.getItem(k)); for (let i = 3; i <= 20; i++) { d.teams.push({ id: 't' + i, num: i, name: '', members: ['T' + i + 'a', 'T' + i + 'b'] }); d.runs.push({ id: 'r' + i, team: 't' + i, at: Date.now(), time: 60, points: i % 5, words: Array.from({ length: i % 5 }, () => ({ w: 'x', ok: true, by: 'T' + i + 'a' })) }); } localStorage.setItem(k, JSON.stringify(d)); }, KEY);
      await m.reload();
      const [proj2] = await Promise.all([m.waitForEvent('popup'), m.click('#proj-btn')]);
      await proj2.setViewportSize({ width: 1920, height: 1080 });
      await m.waitForTimeout(150);
      await m.click('#go-board');
      await m.waitForTimeout(150);
      const fits = await proj2.evaluate(() => {
        const bv = document.getElementById('a-boardview'), h = document.getElementById('a-board-h').getBoundingClientRect(), items = [...document.querySelectorAll('#a-board-list li')];
        const last = items[items.length - 1].getBoundingClientRect(), z = +bv.style.zoom || 1;
        return { zoom: z, top: h.top * z, bottom: last.bottom * z, h: innerHeight, n: items.length };
      });
      check('20 csapat: a kivetítőn tömör, olvasható összesítő, teljesen kifér', fits.zoom >= 0.6 && fits.top >= 0 && fits.bottom <= fits.h && fits.n === 20, JSON.stringify(fits));
      await shot(proj2, '15-kivetito-20-csapat');
      await proj2.close();
      await m.clock.runFor(1500);
      check('bezárás után a főablak visszaáll', /nincs megnyitva/.test(await m.textContent('#proj-state')));
      check('kivetítő: nincs hiba, nincs hálózat', o.errors.length === 0 && o.net.length === 0 && pnet.length === 0, o.errors.join(' | '));
      await o.ctx.close();
    }

    // ---------------- 10 fős csapat, felbontások ----------------
    console.log('Felbontások (10 fős csapattal):');
    const ten = ['Anna', 'Béla', 'Csilla', 'Dénes', 'Emese', 'Ferenc', 'Gábor', 'Hajni', 'István', 'Judit'];
    for (const vp of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1536, height: 864 }, { width: 1920, height: 1080 }, { width: 1024, height: 768 }]) {
      const o = await open(browser, { viewport: vp });
      await seed(o.page, { teams: [{ id: 'a', num: 12, name: 'Nagyon hosszú nevű csapat', members: ten }], cfg: { time: 180, diff: 'vegyes' }, last: Date.now() });
      await o.page.reload();
      await o.page.click('#go-pick'); await o.page.click('#pickgrid button'); await o.page.click('#rd-who button >> nth=0');
      await o.page.clock.runFor(100); await o.page.waitForTimeout(600);   // a belépő animáció (14 px) végéig
      const mtr = await o.page.evaluate(() => {
        const r = document.getElementById('board').getBoundingClientRect(), g = document.querySelector('.actionbar').getBoundingClientRect(), t = document.querySelector('.tools').getBoundingClientRect();
        const btns = [...document.querySelectorAll('#guessers button')].map(b => b.getBoundingClientRect());
        return { cw: Math.round(r.width), ch: Math.round(r.height), n: btns.length, ok: document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth && r.bottom <= g.top + 1 && t.right <= innerWidth && g.bottom <= innerHeight + 1 && btns.every(b => b.right <= innerWidth && b.bottom <= innerHeight && b.height >= 36) };
      });
      check(`${vp.width}×${vp.height}: rajzlap ${mtr.cw}×${mtr.ch}, 9 kitaláló gomb, minden kifér`, mtr.ok && mtr.n === 9 && mtr.cw >= 450);
      if (vp.width === 1366) await shot(o.page, '16-jatek-10-fo');
      await o.page.click('#guessers [data-guesser] >> nth=0');
      const pk = await o.page.evaluate(() => { const c = document.querySelector('#m-picker .card').getBoundingClientRect(); return c.bottom <= innerHeight && c.top >= 0 && document.querySelectorAll('#pk-who button').length === 10; });
      check(`${vp.width}×${vp.height}: 10 tagú választó kifér`, pk);
      check(`${vp.width}×${vp.height}: nincs hiba, nincs hálózat`, o.errors.length === 0 && o.net.length === 0, o.errors.join(' | '));
      await o.ctx.close();
    }
    {
      const o = await open(browser, { reducedMotion: 'reduce' });
      check('csökkentett mozgásnál nincs animáció', await o.page.evaluate(() => getComputedStyle(document.querySelector('.logo h1')).animationName === 'none'));
      await o.ctx.close();
    }
    {
      const o = await open(browser);
      await o.page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
      await o.page.reload();
      check('letiltott tárolónál figyelmeztet', await o.page.isVisible('#store-warn'));
      await o.page.click('#go-teams'); await o.page.click('#add-team');
      await o.page.locator('.addm input').fill('A'); await o.page.click('.addm button');
      await o.page.click('#s-teams [data-home]'); await o.page.click('#go-pick'); await o.page.click('#pickgrid button'); await o.page.click('#rd-who button');
      check('tároló nélkül is játszható', await active(o.page) === 's-play' && o.errors.length === 0, o.errors.join(' | '));
      await o.ctx.close();
    }
  } finally {
    await browser.close();
  }
  const bad = results.filter(r => !r).length;
  console.log(`\n${results.length - bad}/${results.length} ellenőrzés sikeres`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
