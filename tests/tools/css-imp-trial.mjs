// PIC-ASS-O — !important-ok kísérleti levétele, kiszámított stílusokkal ellenőrizve (v4.31)
//
// Az !important-ok statikusan nem bizonyíthatók feleslegesnek (versengő
// szabályok ellen állnak), ezért ez az eszköz méréssel dönt:
//   1. leveszi az összes (még nem védett) !important-ot,
//   2. lefuttatja a menüs és a játékos képsorozatot (STYLES=1),
//   3. összeveti az alap kiszámított stílusaival,
//   4. ahol bármely elem bármely tulajdonsága változott, a hozzá illő
//      deklaráció(k) !important-ját visszateszi (védetté teszi),
//   5. addig ismétli, amíg semmi nem változik.
// A végén a css/picasso.css-ben csak azok az !important-ok maradnak, amelyek
// a lefedett állapotokban (6 kijelző × 12 menü, 2 × 26 játékállapot) számítanak.
//
// Használat: node tests/tools/css-imp-trial.mjs <alap-menü mappa> <alap-játék mappa> <munkamappa>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSS = path.join(ROOT, 'css', 'picasso.css');
const [baseMenus, baseGame, work] = process.argv.slice(2);
if (!work) { console.error('Használat: node tests/tools/css-imp-trial.mjs <alap-menü> <alap-játék> <munkamappa>'); process.exit(2); }
fs.mkdirSync(work, { recursive: true });
const KEEP_FILE = path.join(work, 'keep.json');
const original = fs.readFileSync(CSS, 'utf8');

const ctxOf = (node) => {
  const parts = [];
  for (let p = node.parent; p && p.type !== 'root'; p = p.parent) if (p.type === 'atrule') parts.unshift('@' + p.name + ' ' + p.params.replace(/\s+/g, ' ').trim());
  return parts.join(' » ');
};
const keyOf = d => ctxOf(d.parent) + ' ¦ ' + d.parent.selector.replace(/\s+/g, ' ').trim() + ' ¦ ' + d.prop + ' ¦ ' + d.value;

// tulajdonságcsaládok: egy kiszámított hosszú alak (pl. border-top-color) melyik deklarációkból jöhet
const FAMILY = p => {
  p = p.replace(/^-(webkit|moz)-/, '');
  if (p === 'line-height') return 'font';
  if (/^(top|right|bottom|left|inset)/.test(p)) return 'inset';
  if (/gap$/.test(p)) return 'gap';
  const m = /^(background|padding|margin|border|font|outline|grid|flex|transition|animation|overflow|text-decoration|list-style|columns|place|align|justify|mask|scroll|transform|min-width|min-height|max-width|max-height|width|height)/.exec(p);
  return m ? m[1] : p;
};
const relatedFamilies = f => f === 'gap' ? ['gap', 'grid'] : (f === 'align' || f === 'justify') ? [f, 'place'] : [f];
const DERIVED = new Set(['width', 'height', 'transform-origin', 'top', 'right', 'bottom', 'left', 'inset']);

// a szelektor utolsó összetett része illik-e az elemre (id / osztályok / tag; ál-elem)
function lastCompoundMatches(selector, ch) {
  return selector.split(',').some(sel => {
    sel = sel.trim();
    const pseudoEl = /::?(before|after)\b/.exec(sel);
    const elIsPseudo = /::(before|after)$/.exec(ch.el);
    if (!!pseudoEl !== !!elIsPseudo) return false;
    if (pseudoEl && elIsPseudo && pseudoEl[1] !== elIsPseudo[1]) return false;
    const last = sel.split(/[\s>+~]+/).filter(Boolean).pop() || '';
    const bare = last.replace(/::?[a-z-]+(\([^)]*\))?/gi, '').replace(/\[[^\]]*\]/g, '');
    const tag = /^[a-z][a-z0-9-]*/i.exec(bare);
    if (tag && tag[0] !== '*' && tag[0].toLowerCase() !== ch.tag) return false;
    const ids = [...bare.matchAll(/#([\w-]+)/g)].map(m => m[1]);
    if (ids.some(i => i !== ch.id)) return false;
    const cls = new Set(String(ch.cls || '').split(/\s+/).filter(Boolean));
    const need = [...bare.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
    // állapotosztályok (hidden, active…) futás közben változhatnak: a hiányuk nem zárja ki az illeszkedést
    return need.every(c => cls.has(c) || /^(hidden|active|open|on|go|show|collapsed|selected|done|warn|urgent)$/.test(c));
  });
}

function buildCss(keep) {
  const root = postcss.parse(original, { from: CSS });
  let removed = 0, kept = 0;
  root.walkDecls(d => {
    if (!d.important) return;
    if (d.parent.parent && d.parent.parent.type === 'atrule' && /keyframes$/i.test(d.parent.parent.name)) return;
    if (keep.has(keyOf(d))) { kept++; return; }
    d.important = false; removed++;
  });
  return { css: root.toString(), removed, kept };
}

function run(cmd, args, env) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('exit', code => (code === 0 ? res(out) : rej(new Error(out.slice(-2000)))));
  });
}

const keep = new Set(fs.existsSync(KEEP_FILE) ? JSON.parse(fs.readFileSync(KEEP_FILE, 'utf8')) : []);
// a szerkezeti tulajdonságok (elrejtés, rétegek, kattinthatóság) eleve védettek: nélkülük a
// felület kezelhetetlen lesz, és a képsorozat le sem fut
const STRUCTURAL = /^(display|visibility|pointer-events|position|z-index)$/;
postcss.parse(original, { from: CSS }).walkDecls(d => { if (d.important && STRUCTURAL.test(d.prop)) keep.add(keyOf(d)); });
let iteration = 0;
try {
  for (;;) {
    iteration++;
    const { css, removed, kept } = buildCss(keep);
    fs.writeFileSync(CSS, css);
    console.log(`\n== ${iteration}. kör: ${removed} !important levéve, ${kept} védett`);
    const dm = path.join(work, `it${iteration}-menus`), dg = path.join(work, `it${iteration}-game`);
    fs.rmSync(dm, { recursive: true, force: true }); fs.rmSync(dg, { recursive: true, force: true });
    try {
      await Promise.all([
        run(process.execPath, ['tests/visual/menus.cjs', dm], { STYLES: '1' }),
        run(process.execPath, ['tests/visual/game.cjs', dg], { STYLES: '1' }),
      ]);
    } catch (e) {
      // a felület annyira megváltozott, hogy a képsorozat elakadt: a maradék levett
      // jelölők felét visszavédjük, és újra próbáljuk (konzervatív lépés)
      const rest = [];
      postcss.parse(original, { from: CSS }).walkDecls(d => { if (d.important && !keep.has(keyOf(d))) rest.push(keyOf(d)); });
      const half = rest.slice(0, Math.ceil(rest.length / 2));
      half.forEach(k => keep.add(k));
      fs.writeFileSync(KEEP_FILE, JSON.stringify([...keep], null, 1));
      console.log(`   a képsorozat elakadt (${String(e.message).split('\n').find(l => /❌|Error|rror/.test(l)) || '?'}) — ${half.length} jelölő visszavédve`);
      if (!rest.length) throw e;
      continue;
    }
    const changes = [];
    for (const [b, n] of [[baseMenus, dm], [baseGame, dg]]) {
      const jf = path.join(work, `it${iteration}-${path.basename(n)}.json`);
      try { execFileSync(process.execPath, ['tests/visual/style-diff.cjs', b, n, '--json', jf], { cwd: ROOT, stdio: 'ignore' }); } catch (e) { /* eltérésnél 1-gyel lép ki */ }
      changes.push(...JSON.parse(fs.readFileSync(jf, 'utf8')));
    }
    console.log(`   ${changes.length} eltérő érték`);
    if (!changes.length) break;
    // a levett deklarációk listája, hogy a változásokhoz illőket visszavédjük
    const root = postcss.parse(original, { from: CSS });
    const candidates = [];
    root.walkDecls(d => { if (d.important && !keep.has(keyOf(d))) candidates.push(d); });
    const direct = changes.filter(c => c.prop !== '(elem)' && !DERIVED.has(c.prop));
    const pool = direct.length ? direct : changes;   // először az okok, a származtatott (méret, hely) értékek csak utánuk
    let added = 0;
    for (const ch of pool) {
      const fams = ch.prop === '(elem)' ? null : relatedFamilies(FAMILY(ch.prop));
      let hit = candidates.filter(d => (!fams || fams.includes(FAMILY(d.prop))) && lastCompoundMatches(d.parent.selector, ch));
      if (!hit.length) hit = candidates.filter(d => lastCompoundMatches(d.parent.selector, ch));   // bármely tulajdonsága lehet az ok
      if (!hit.length && fams) hit = candidates.filter(d => fams.includes(FAMILY(d.prop)));       // végső tartalék: a család összes tagja
      for (const d of hit) { const k = keyOf(d); if (!keep.has(k)) { keep.add(k); added++; } }
    }
    console.log(`   +${added} !important visszavédve`);
    fs.writeFileSync(KEEP_FILE, JSON.stringify([...keep], null, 1));
    if (!added) { console.log('   Nem találtam illő deklarációt — megállok, a CSS visszaáll.'); fs.writeFileSync(CSS, original); process.exit(1); }
  }
  console.log(`\nKész: a végleges CSS-ben ${keep.size} !important maradt.`);
} catch (e) {
  fs.writeFileSync(CSS, original);
  console.error('Hiba, a CSS visszaállítva:', e.message);
  process.exit(1);
}
