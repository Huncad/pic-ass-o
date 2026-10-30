// PIC-ASS-O — kiszámított stílusok összevetése két futás között (v4.31)
// Használat: node tests/visual/style-diff.cjs <régi mappa> <új mappa> [-v] [--json kimenet.json]
// A mappákban a *.styles.json.gz fájlokat a menus.cjs / game.cjs készíti (STYLES=1).
// Kimenet: állapotonként hány elem hány tulajdonsága változott; -v: a részletek.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const [a, b] = process.argv.slice(2).filter(x => !x.startsWith('-'));
const verbose = process.argv.includes('-v');
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
// futásonként természetesen változó elemek: a helyes tipp utáni villanás (időzítés),
// és a (játék közben rejtett) szobalista, ami a hálózati frissítés pillanatától függ
const IGNORE = [/^#flash($|::)/, /^#room-list(>|$)/];
const load = f => JSON.parse(zlib.gunzipSync(fs.readFileSync(f)));
let total = 0;
const changes = [];
for (const f of fs.readdirSync(a).filter(x => x.endsWith('.styles.json.gz')).sort()) {
  const fb = path.join(b, f);
  if (!fs.existsSync(fb)) { console.log('HIÁNYZIK', f); total++; continue; }
  const A = load(path.join(a, f)), B = load(fb);
  let n = 0;
  for (const el of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (IGNORE.some(re => re.test(el))) continue;
    if (!A[el] || !B[el]) { n++; changes.push({ state: f, el, prop: '(elem)', old: !!A[el], new: !!B[el] }); continue; }
    for (const p of Object.keys(A[el])) if (p[0] !== '_' && A[el][p] !== B[el][p]) { n++; changes.push({ state: f, el, prop: p, old: A[el][p], new: B[el][p], tag: A[el]._tag, id: A[el]._id, cls: A[el]._cls }); }
  }
  if (n) console.log(`ELTÉR  ${f.replace('.styles.json.gz', '')}: ${n} érték`);
  total += n;
}
if (verbose) for (const c of changes.slice(0, 400)) console.log(`  ${c.state.replace('.styles.json.gz', '')} | ${c.el} | ${c.prop}: ${c.old} → ${c.new}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(changes));
console.log(`— összesen ${total} eltérő érték`);
process.exitCode = total ? 1 : 0;
