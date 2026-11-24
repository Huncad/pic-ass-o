// Picasso offline változat (offline/Picasso-offline.html) — teljes böngészős ellenőrzés
// file:// alól, webszerver nélkül: semmilyen hálózati kérés, 10 fős teljes játék
// gyorsított órával, pontozás, rajzeszközök, szünet, lejárt idő, mentés, laptop-felbontások.
// Futtatás: node offline/build.mjs && node tests/e2e/offline.cjs   (SHOTS=mappa: képernyőképek)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const FILE = path.join(__dirname, '..', '..', 'offline', 'Picasso-offline.html');
const URL = pathToFileURL(FILE).href;
const SHOTS = process.env.SHOTS || '';
const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`  ${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`); };
const PLAYERS = ['Anna', 'Béla', 'Csilla', 'Dénes', 'Emese', 'Ferenc', 'Gábor', 'Hajni', 'István', 'Judit'];
const points = (left, time) => 50 + Math.round(50 * (time ? left / time : 1) / 5) * 5;

async function open(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, ...opts });
  const page = await ctx.newPage();
  const net = [], errors = [];
  page.on('request', r => { if (!/^(file|data):/.test(r.url())) net.push(r.url()); });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.install();
  await page.goto(URL);
  return { ctx, page, net, errors };
}
const active = p => p.evaluate(() => document.querySelector('.screen.active').id);
const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
async function addPlayers(page, names) {
  for (const n of names) { await page.fill('#name-in', n); await page.click('#add-form button[type=submit]'); }
}
async function scribble(page, color) {
  if (color !== undefined) await page.click(`#swatches .swatch >> nth=${color}`);
  const b = await page.locator('#board').boundingBox();
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.3);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(b.x + b.width * (0.2 + i * 0.03), b.y + b.height * (0.3 + Math.sin(i / 3) * 0.1));
  await page.mouse.up();
}
// nem fehér pixelek száma (ritkított mintavétellel)
const inked = p => p.evaluate(() => {
  const c = document.getElementById('board'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 0; i < d.length; i += 4 * 7) if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) n++; return n;
});
const pixel = (p, x, y) => p.evaluate(([x, y]) => Array.from(document.getElementById('board').getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3)), [x, y]);
const scoreMap = p => p.evaluate(sel => Object.fromEntries([...document.querySelectorAll(sel + ' li')].map(li => [li.querySelector('.nm').textContent, parseInt(li.querySelector('.pt').textContent)])), '#rv-scores');

(async () => {
  if (!fs.existsSync(FILE)) { console.error('Előbb: node offline/build.mjs'); process.exit(1); }
  const browser = await chromium.launch();
  try {
    // ---------------- betöltés, hálózat, tartalom ----------------
    console.log('Betöltés file:// alól:');
    const { ctx, page, net, errors } = await open(browser);
    check('kezdőképernyő látszik', await active(page) === 's-setup');
    check('cím: „Picasso”', (await page.title()) === 'Picasso offline' && (await page.textContent('h1')) === 'Picasso');
    check('sehol nem szerepel a „PIC-ASS-O” név', !/pic-ass-o/i.test(await page.content()));
    const html = fs.readFileSync(FILE, 'utf8');
    check('nincs külső URL a fájlban', !/(https?:)?\/\/[a-z0-9-]+\.[a-z]{2,}\//i.test(html.replace(/base64,[A-Za-z0-9+/=]+/g, '')));
    check('nincs <audio>/<video>/hangfájl', !/<audio|<video|new Audio|AudioContext|\.mp3|\.ogg/i.test(html));
    const blocked = await page.evaluate(async () => { try { await fetch('https://example.com/'); return false; } catch (e) { return true; } });
    check('a CSP minden hálózati kérést tilt (fetch elbukik)', blocked);
    const fontsOk = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('700 20px Kalam') && document.fonts.check('800 16px Nunito'); });
    check('beágyazott betűtípusok betöltődtek', fontsOk);
    const wc = (html.match(/const WORDS = (\{.*?\});/) || [])[1];
    const words = JSON.parse(wc);
    const total = words.konnyu.length + words.kozepes.length + words.nehez.length;
    check('a teljes szótár benne van', total > 12000, `${words.konnyu.length} / ${words.kozepes.length} / ${words.nehez.length}`);
    check('szavak üresek / ismétlődők nélkül', ['konnyu', 'kozepes', 'nehez'].every(k => words[k].every(w => w.trim() === w && w) && new Set(words[k].map(w => w.toLowerCase())).size === words[k].length));

    // ---------------- kezdőképernyő ----------------
    console.log('Beállítások:');
    await page.click('#start-btn');
    check('játékos nélkül nem indul', await active(page) === 's-setup' && /két játékos/.test(await page.textContent('#setup-err')));
    await addPlayers(page, PLAYERS);
    check('10 játékos felvéve', await page.locator('#players li').count() === 10);
    await addPlayers(page, ['ANNA']);
    check('azonos név (kis/nagybetű) elutasítva', /már szerepel/.test(await page.textContent('#setup-err')) && await page.locator('#players li').count() === 10);
    await addPlayers(page, ['Kata', 'Laci', 'Marci']);
    check('legfeljebb 12 játékos', await page.locator('#players li').count() === 12 && /Legfeljebb 12/.test(await page.textContent('#setup-err')));
    await page.click('#players li:nth-child(12) button'); await page.click('#players li:nth-child(11) button');
    check('játékos törlése', await page.locator('#players li').count() === 10);
    await page.fill('#name-in', '<img src=x onerror=alert(1)>');
    await page.click('#add-form button[type=submit]');
    check('HTML a névben szövegként jelenik meg', await page.locator('#players img').count() === 0);
    await page.click('#players li:nth-child(11) button');
    await page.click('.pills[data-opt=diff] [data-v=kozepes]');
    await page.click('.pills[data-opt=time] [data-v="60"]');
    await page.click('.pills[data-opt=rounds] [data-v="1"]');
    await page.reload();
    check('újratöltés után megmaradnak a nevek és beállítások',
      await page.locator('#players li').count() === 10 &&
      await page.getAttribute('.pills[data-opt=diff] [data-v=kozepes]', 'aria-pressed') === 'true' &&
      await page.getAttribute('.pills[data-opt=rounds] [data-v="1"]', 'aria-pressed') === 'true');
    check('nincs vízszintes görgetés (1366×768)', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await shot(page, '01-beallitas');

    // ---------------- teljes 10 fős játék ----------------
    console.log('Teljes játék, 10 játékos, 60 mp, 1 kör:');
    await page.click('#start-btn');
    const expected = Object.fromEntries(PLAYERS.map(n => [n, 0]));
    const usedWords = new Set(), drawers = [];
    const middleWords = new Set(words.kozepes.map(w => w.toLowerCase()));
    let allOk = { handover: true, words: true, scores: true, peek: true, fit: true };
    for (let t = 0; t < 10; t++) {
      check(`(${t + 1}) átadó képernyő`, await active(page) === 's-handover', await page.textContent('#ho-round'));
      const drawer = await page.textContent('#ho-name');
      drawers.push(drawer);
      await page.click('#ho-go');
      const choices = await page.locator('#word-choices button').allTextContents();
      if (choices.length !== 3 || new Set(choices).size !== 3 || !choices.every(w => middleWords.has(w.toLowerCase()))) allOk.words = false;
      if (t === 0) {
        await page.click('#reroll');
        const again = await page.locator('#word-choices button').allTextContents();
        check('új szavak kérhetők, de csak egyszer', again.join() !== choices.join() && await page.isDisabled('#reroll'));
        await shot(page, '02-szovalasztas');
      }
      const word = await page.locator('#word-choices button').first().textContent();
      if (usedWords.has(word)) allOk.words = false;
      usedWords.add(word);
      await page.locator('#word-choices button').first().click();
      check(`(${t + 1}) ${drawer} rajzol: „${word}”`, await active(page) === 's-draw');

      // a szó csak lenyomva tartva látszik
      const hidden = !(await page.textContent('#peek')).includes(word);
      await page.locator('#peek').hover(); await page.mouse.down();
      const shown = (await page.textContent('#peek')).includes(word);
      await page.mouse.up();
      if (!(hidden && shown && !(await page.textContent('#peek')).includes(word))) allOk.peek = false;
      if (await page.locator('#guessers button').count() !== 9 || (await page.locator('#guessers button').allTextContents()).includes(drawer)) allOk.handover = false;

      await scribble(page, t % 11);
      const fit = await page.evaluate(() => { const r = document.getElementById('board').getBoundingClientRect(), g = document.querySelector('.guessbar').getBoundingClientRect(); return r.bottom <= g.top + 1 && r.right <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1; });
      if (!fit) allOk.fit = false;
      if (t === 0) await shot(page, '03-rajzolas');

      const others = PLAYERS.filter(n => n !== drawer);
      if (t === 3) {   // senki nem találja ki (feladják)
        await page.clock.runFor(20000);
        await page.click('#giveup-btn'); await page.click('#mc-yes');
        check('feladás: senki nem kap pontot', await active(page) === 's-reveal' && /senki/.test(await page.textContent('#rv-title')));
      } else if (t === 5) {   // lejár az idő, senki
        await page.clock.runFor(61000);
        check('lejárt idő: kérdés jelenik meg', await page.isVisible('#m-confirm') && /Lejárt/.test(await page.textContent('#mc-text')));
        const ink = await inked(page); await scribble(page);
        check('lejárt idő után már nem lehet rajzolni', await inked(page) === ink);
        await page.click('#mc-no');
        check('„Nem, senki” → kör vége', await active(page) === 's-reveal');
      } else if (t === 6) {   // lejár az idő, utolsó pillanatban kitalálta
        await page.clock.runFor(61000);
        await page.click('#mc-yes');
        const g = others[2];
        await page.click(`#guessers button:text-is("${g}")`);
        expected[g] += 50; expected[drawer] += 50;
        check('lejárt idő után is megadható a kitaláló (50 pont)', await active(page) === 's-reveal' && (await page.textContent('#rv-title')).includes(g));
      } else if (t === 7) {   // szünet: az óra áll, a rajz el van takarva
        await page.clock.runFor(10000);
        await page.click('#pause-btn');
        const before = await page.textContent('#timer');
        await page.clock.runFor(30000);
        const hiddenCanvas = await page.evaluate(() => getComputedStyle(document.getElementById('board')).visibility === 'hidden');
        check('szünetben áll az óra és takarva a rajz', before === await page.textContent('#timer') && hiddenCanvas, `${before} mp`);
        await page.click('#resume-btn');
        await page.clock.runFor(5000);
        const left = parseInt(await page.textContent('#timer'));
        check('folytatás után megy tovább', left === 45, `${left} mp`);
        const g = others[0];
        await page.click(`#guessers button:text-is("${g}")`);
        await page.click('#mc-yes');
        expected[g] += points(left, 60); expected[drawer] += 50;
      } else {
        const wait = [3, 12, 25, 0, 40, 0, 0, 0, 55, 33][t];
        await page.clock.runFor(wait * 1000);
        const left = parseInt(await page.textContent('#timer'));
        const g = others[t % others.length];
        await page.click(`#guessers button:text-is("${g}")`);
        check(`  megerősítés kérdés: ${g}`, (await page.textContent('#mc-text')).includes(word));
        if (t === 1) { await page.click('#mc-no'); check('„Mégse” → marad a rajzolás', await active(page) === 's-draw'); await page.click(`#guessers button:text-is("${g}")`); }
        await page.click('#mc-yes');
        expected[g] += points(left, 60); expected[drawer] += 50;
      }
      const shown2 = await page.textContent('#rv-word');
      if (shown2 !== word) allOk.words = false;
      const sm = await scoreMap(page);
      if (JSON.stringify(sm, Object.keys(expected).sort()) !== JSON.stringify(expected, Object.keys(expected).sort())) { allOk.scores = false; console.log('    pont eltérés', sm, expected); }
      if (t === 0) await shot(page, '04-kor-vege');
      await page.click('#rv-next');
    }
    check('mindenki pontosan egyszer rajzolt', new Set(drawers).size === 10);
    check('rajzolónként 9 tippelő gomb, a rajzoló nélkül', allOk.handover);
    check('szavak: 3 különböző, közepes, ismétlés nélkül, a végén felfedve', allOk.words);
    check('a szó csak lenyomva tartva látszik', allOk.peek);
    check('pontszámok minden kör után helyesek', allOk.scores);
    check('a rajzlap és a gombok kiférnek (1366×768)', allOk.fit);
    check('eredményhirdetés', await active(page) === 's-end');
    const final = await page.evaluate(() => [...document.querySelectorAll('#end-scores li')].map(li => [li.querySelector('.nm').textContent, parseInt(li.querySelector('.pt').textContent)]));
    const sorted = Object.entries(expected).sort((a, b) => b[1] - a[1]);
    check('végeredmény sorrendje és pontjai helyesek', final.every((r, i) => r[1] === sorted[i][1]) && final.every(([n, s]) => expected[n] === s));
    const podium = await page.locator('#podium .nm').allTextContents();
    check('dobogó: 2–1–3 elrendezés', podium.length === 3 && podium[1] === final[0][0] && podium[0] === final[1][0] && podium[2] === final[2][0]);
    await shot(page, '05-vege');
    await page.click('#again-btn');
    check('„Új játék ugyanezekkel” → újra indul, nullázott pontok', await active(page) === 's-handover');
    await page.click('#ho-scores');
    check('állás megtekinthető, mindenki 0 ponton', (await page.locator('#ms-list .pt').allTextContents()).every(t => t === '0 p'));
    await page.keyboard.press('Escape');
    check('Esc bezárja az állás ablakot', !(await page.isVisible('#m-scores')));

    // ---------------- rajzeszközök ----------------
    console.log('Rajzeszközök:');
    await page.click('#ho-go'); await page.locator('#word-choices button').first().click();
    check('új körnél üres a lap', await inked(page) === 0);
    await scribble(page, 2);
    const ink1 = await inked(page);
    check('rajzolás egérrel', ink1 > 20, `${ink1} minta`);
    await page.click('#undo-btn');
    check('visszavonás', await inked(page) === 0);
    // zárt keret, majd kitöltés belül
    const b = await page.locator('#board').boundingBox();
    await page.click('.tool[data-size="12"]');
    await page.mouse.move(b.x + b.width * .4, b.y + b.height * .4); await page.mouse.down();
    for (const [x, y] of [[.6, .4], [.6, .6], [.4, .6], [.4, .4]]) await page.mouse.move(b.x + b.width * x, b.y + b.height * y, { steps: 8 });
    await page.mouse.up();
    await page.click('.tool[data-mode=fill]');
    await page.click('#swatches .swatch >> nth=5');
    check('színválasztás nem kapcsolja ki a kitöltést', await page.evaluate(() => document.querySelector('.tool[data-mode=fill]').classList.contains('sel')));
    await page.mouse.click(b.x + b.width * .5, b.y + b.height * .5);
    const inside = await pixel(page, 600, 450), outside = await pixel(page, 100, 100);
    check('kitöltés: belül zöld, kívül fehér marad', inside.join() === '47,168,79' && outside.join() === '255,255,255', `${inside} / ${outside}`);
    await page.click('#undo-btn');
    check('kitöltés visszavonható', (await pixel(page, 600, 450)).join() === '255,255,255');
    await page.click('.tool[data-mode=eraser]');
    await page.mouse.move(b.x + b.width * .35, b.y + b.height * .5); await page.mouse.down();
    await page.mouse.move(b.x + b.width * .65, b.y + b.height * .5, { steps: 15 }); await page.mouse.up();
    check('radír törli a vonalat', (await pixel(page, Math.round(1200 * .4), 450)).join() === '255,255,255');
    await page.click('#clear-btn');
    check('lap törlése', await inked(page) === 0);
    await page.click('#undo-btn');
    check('törlés is visszavonható', await inked(page) > 0);
    // érintés (tablet / érintőképernyős laptop)
    await page.click('.tool[data-mode=eraser]');
    await page.evaluate(() => {
      const c = document.getElementById('board'), r = c.getBoundingClientRect();
      const ev = (type, x) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: r.left + x, clientY: r.top + 40, buttons: 1 }));
      ev('pointerdown', 30); for (let x = 40; x < 200; x += 10) ev('pointermove', x); ev('pointerup', 200);
    });
    const tp = await pixel(page, Math.round(120 * 1200 / b.width), Math.round(40 * 900 / b.height));
    check('érintéses rajzolás', tp.join() !== '255,255,255', tp.join());

    // ---------------- kilépés, időkorlát nélkül ----------------
    console.log('Kilépés és egyéb módok:');
    await page.click('#quit-btn');
    const tBefore = await page.textContent('#timer');
    await page.clock.runFor(5000);
    check('kilépés kérdésénél áll az óra', await page.textContent('#timer') === tBefore);
    await page.click('#mc-no');
    await page.clock.runFor(3000);
    check('„Maradok” → megy tovább az óra', parseInt(await page.textContent('#timer')) === parseInt(tBefore) - 3);
    await page.click('#quit-btn'); await page.click('#mc-yes');
    check('kilépés → beállítások', await active(page) === 's-setup');
    await page.clock.runFor(70000);
    check('kilépés után nem ugrik fel a lejárt idő ablak', !(await page.isVisible('#m-confirm')));

    await page.click('.pills[data-opt=time] [data-v="0"]');
    await page.click('.pills[data-opt=diff] [data-v=vegyes]');
    await page.click('#start-btn'); await page.click('#ho-go'); await page.locator('#word-choices button').first().click();
    await page.clock.runFor(600000);
    check('időkorlát nélkül: ∞, nincs szünet gomb, nem jár le', await page.textContent('#timer') === '∞' && !(await page.isVisible('#pause-btn')) && !(await page.isVisible('#m-confirm')));
    const drawer = await page.textContent('#d-name');
    const g = await page.locator('#guessers button').first().textContent();
    await page.locator('#guessers button').first().click(); await page.click('#mc-yes');
    const sm = await scoreMap(page);
    check('időkorlát nélkül 100 + 50 pont', sm[g] === 100 && sm[drawer] === 50);

    // háttérbe kerülés: megáll az óra
    await page.click('#home-btn').catch(() => {});
    const realErrors = errors.filter(e => !/example\.com/.test(e));   // a fenti szándékos, tiltott fetch üzenete
    check('nincs konzolhiba', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
    check('egyetlen hálózati kérés sem történt', net.length === 0, net.slice(0, 3).join(', '));
    await ctx.close();

    // ---------------- kivetítő ablak ----------------
    console.log('Kivetítő (közönség) ablak:');
    {
      const o = await open(browser);
      const { page: m } = o;
      await addPlayers(m, PLAYERS.slice(0, 4));
      const [proj] = await Promise.all([m.waitForEvent('popup'), m.click('#proj-btn')]);
      await proj.setViewportSize({ width: 1920, height: 1080 });
      const pnet = []; proj.on('request', r => { if (!/^(file|data|about):/.test(r.url())) pnet.push(r.url()); });
      await m.waitForTimeout(100);
      const ptext = () => proj.evaluate(() => document.body.innerText);
      check('megnyílik, a főablak jelzi', /megnyitva/.test(await m.textContent('#proj-state')) && await m.evaluate(() => document.body.classList.contains('has-aud')));
      check('várakozó képernyő a játékosokkal', /hamarosan/.test(await ptext()) && (await ptext()).includes('Dénes'));
      check('a kivetítőn is a beágyazott betűk', await proj.evaluate(async () => { await document.fonts.ready; return document.fonts.check('700 20px Kalam'); }));
      await addPlayers(m, ['Emese']);
      check('új játékos azonnal megjelenik', (await ptext()).includes('Emese'));
      await shot(proj, '07-kivetito-varakozas');
      await m.click('.pills[data-opt=rounds] [data-v="1"]');
      await m.click('#start-btn');
      let leaked = false, mirrorOk = true, revealOk = true;
      for (let t = 0; t < 5; t++) {
        const drawer = await m.textContent('#ho-name');
        if (!(await ptext()).includes(drawer + ' következik')) revealOk = false;
        await m.click('#ho-go');
        const choices = await m.locator('#word-choices button').allTextContents();
        const pt1 = await ptext();
        if (choices.some(w => pt1.includes(w)) || !pt1.includes('szót választ')) leaked = true;
        await m.locator('#word-choices button').first().click();
        const word = choices[0];
        if (t === 0) check('kivetítővel a szó a laptopon végig látszik (nem kell nyomva tartani)', (await m.textContent('#peek')).includes(word));
        await scribble(m, t);
        await m.waitForTimeout(60);
        const same = await m.evaluate(() => {
          const a = document.getElementById('board').getContext('2d').getImageData(0, 0, 1200, 900).data;
          const w = window.open('', 'picasso-kivetito'), b = w.document.getElementById('a-canvas').getContext('2d').getImageData(0, 0, 1200, 900).data;
          let diff = 0; for (let i = 0; i < a.length; i += 4 * 13) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++; return diff;
        });
        if (same !== 0) mirrorOk = false;
        const pt2 = await ptext();
        if (pt2.includes(word)) leaked = true;
        if (!pt2.includes(drawer + ' rajzol') || !/\d+/.test(await proj.textContent('#a-timer'))) mirrorOk = false;
        if (t === 0) { await shot(proj, '08-kivetito-rajz'); await shot(m, '09-laptop-rajzolo-nezet'); }
        if (t === 1) {
          await m.click('#pause-btn');
          check('szünetben a kivetítőn sincs rajz', /Szünet/.test(await ptext()) && !(await proj.isVisible('#a-canvas')));
          await m.click('#resume-btn');
          check('folytatás után visszajön a rajz', await proj.isVisible('#a-canvas'));
        }
        if (t === 2) {
          await m.clock.runFor(61000);
          check('lejárt idő a kivetítőn is', /Lejárt az idő/.test(await ptext()) && !(await ptext()).includes(word));
          await m.click('#mc-yes');
          check('utólagos kiválasztásnál újra a rajz látszik', await proj.isVisible('#a-canvas'));
          await m.click('#guessers button >> nth=0');
        } else if (t === 3) {
          await m.click('#giveup-btn'); await m.click('#mc-yes');
        } else {
          await m.clock.runFor(10000);
          await m.click('#guessers button >> nth=0');
          if ((await ptext()).includes(word)) leaked = true;   // a megerősítő kérdés csak a laptopon
          await m.click('#mc-yes');
        }
        const pt3 = await ptext();
        if (!pt3.includes(word) || !(await proj.isVisible('#a-rv-s li'))) revealOk = false;
        if (t === 0) await shot(proj, '10-kivetito-kor-vege');
        await m.click('#rv-next');
      }
      check('a szó a kör vége előtt soha nem jelenik meg a kivetítőn', !leaked);
      check('a kivetítő pixelre pontosan tükrözi a rajzot, rajzolónévvel és órával', mirrorOk);
      check('kör végén a kivetítőn: szó + állás; következő rajzoló kiírva', revealOk);
      check('eredményhirdetés a kivetítőn (dobogó + lista)', await proj.locator('#a-pod .nm').count() === 3 && await proj.locator('#a-end-s li').count() === 5);
      await shot(proj, '11-kivetito-vege');
      await proj.close();
      await m.clock.runFor(1500);
      check('kivetítő bezárása után a főablak visszaáll (nyomva tartott szó)', /nincs megnyitva/.test(await m.textContent('#proj-state')) && !(await m.evaluate(() => document.body.classList.contains('has-aud'))));
      await m.click('#again-btn');
      check('kivetítő nélkül megjelenik a megnyitó gomb az átadásnál', await m.isVisible('#ho-proj'));
      const [proj2] = await Promise.all([m.waitForEvent('popup'), m.click('#ho-proj')]);
      check('megnyitás után a gomb eltűnik', !(await m.isVisible('#ho-proj')));
      check('játék közben újranyitva azonnal a helyes állapotot mutatja', /következik/.test(await proj2.evaluate(() => document.body.innerText)));
      check('kivetítő: nincs hiba, nincs hálózat', o.errors.length === 0 && o.net.length === 0 && pnet.length === 0, o.errors.join(' | '));
      await o.ctx.close();
    }

    // ---------------- laptop-felbontások ----------------
    console.log('Felbontások:');
    for (const vp of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1536, height: 864 }, { width: 1920, height: 1080 }, { width: 1024, height: 768 }]) {
      const o = await open(browser, { viewport: vp });
      await addPlayers(o.page, PLAYERS);
      await o.page.click('#start-btn'); await o.page.click('#ho-go'); await o.page.locator('#word-choices button').first().click();
      const m = await o.page.evaluate(() => {
        const r = document.getElementById('board').getBoundingClientRect(), g = document.querySelector('.guessbar').getBoundingClientRect(), t = document.getElementById('tools').getBoundingClientRect();
        const btns = [...document.querySelectorAll('#guessers button')].map(b => b.getBoundingClientRect());
        return { cw: Math.round(r.width), ch: Math.round(r.height), noScroll: document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth,
          fits: r.bottom <= g.top + 1 && t.right <= innerWidth && g.bottom <= innerHeight + 1, btnsVisible: btns.every(b => b.bottom <= innerHeight && b.right <= innerWidth && b.height >= 32) };
      });
      check(`${vp.width}×${vp.height}: rajzlap ${m.cw}×${m.ch}, minden kifér`, m.noScroll && m.fits && m.btnsVisible && m.cw >= 500);
      await shot(o.page, `06-rajz-${vp.width}x${vp.height}`);
      // háttérbe kerülés → automatikus szünet
      await o.page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      if (vp.width === 1366) check('ablakváltáskor automatikus szünet', await o.page.isVisible('#m-pause'));
      check(`${vp.width}×${vp.height}: nincs hiba, nincs hálózat`, o.errors.length === 0 && o.net.length === 0);
      await o.ctx.close();
    }
    // tárolás nélkül (pl. szigorú böngészőbeállítás) is működik
    const o = await open(browser);
    await o.page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
    await o.page.reload();
    await addPlayers(o.page, ['A', 'B']);
    await o.page.click('#start-btn');
    check('letiltott helyi tárolóval is elindul', await active(o.page) === 's-handover' && o.errors.length === 0);
    await o.ctx.close();
  } finally {
    await browser.close();
  }
  const bad = results.filter(r => !r).length;
  console.log(`\n${results.length - bad}/${results.length} ellenőrzés sikeres`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
