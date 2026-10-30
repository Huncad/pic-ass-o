// PIC-ASS-O — CSS-elemző (v4.31)
// Bizonyíthatóan felesleges deklarációkat keres a css/picasso.css-ben:
//  1. HALOTT: ugyanaz a szelektor, ugyanabban a @media/@supports környezetben,
//     ugyanaz a tulajdonság később újra szerepel (és legalább olyan "erős"),
//     így a korábbi soha nem érvényesül. A tartalék értékeket (pl. rgba után
//     color-mix, vh után dvh) megtartja, mert régebbi böngészőnek kellenek.
//  2. FÖLÖSLEGES !important: a tulajdonság (és a rokonai, pl. padding /
//     padding-left) az egész stíluslapban csak ezen az egy helyen szerepel,
//     és a JS / HTML sem állítja soron belül (inline style) — nincs mit legyőznie.
// Használat:
//   node tests/tools/css-audit.mjs            (jelentés)
//   node tests/tools/css-audit.mjs --fix      (javítás a fájlban)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSS = path.join(ROOT, 'css', 'picasso.css');
const FIX = process.argv.includes('--fix');

const src = fs.readFileSync(CSS, 'utf8');
const root = postcss.parse(src, { from: CSS });

// régebbi böngészőben esetleg ismeretlen érték: az előtte álló ugyanilyen deklaráció tartalék lehet
const MODERN = /color-mix\(|\b\d*\.?\d+(dvh|svh|lvh|dvw|svw|lvw)\b|clamp\(|\bmin\(|\bmax\(|env\(|light-dark\(|oklch\(|lab\(|:has\(/i;

const ctxOf = (node) => {
  const parts = [];
  for (let p = node.parent; p && p.type !== 'root'; p = p.parent) if (p.type === 'atrule') parts.unshift('@' + p.name + ' ' + p.params.replace(/\s+/g, ' ').trim());
  return parts.join(' » ');
};
const normSel = s => s.split(',').map(x => x.replace(/\s+/g, ' ').trim()).join(', ');

// ---- 1. halott deklarációk ----
const decls = [];
root.walkRules(rule => {
  if (rule.parent && rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
  const key = ctxOf(rule) + ' ¦ ' + normSel(rule.selector);
  rule.each(d => { if (d.type === 'decl') decls.push({ d, key, prop: d.prop.toLowerCase(), imp: !!d.important, rule }); });
});
const dead = new Set();
const byKeyProp = new Map();
for (const x of decls) {
  const k = x.key + ' ¦ ' + x.prop;
  if (!byKeyProp.has(k)) byKeyProp.set(k, []);
  byKeyProp.get(k).push(x);
}
for (const list of byKeyProp.values()) {
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i];
    // van-e később ugyanilyen, legalább olyan erős, NEM modern értékű deklaráció?
    const killer = list.slice(i + 1).find(b => (b.imp || !a.imp) && !MODERN.test(b.d.value));
    if (killer) dead.add(a);
  }
}

// ---- 2. fölösleges !important ----
const FAMILY = p => {
  if (/^(top|right|bottom|left|inset)/.test(p)) return 'inset';
  const m = /^(-webkit-|-moz-)?(background|padding|margin|border|font|outline|grid|flex|transition|animation|overflow|text-decoration|list-style|columns|gap|row-gap|column-gap|place|align|justify|mask|inset|scroll|transform|width|height|min-width|min-height|max-width|max-height)/.exec(p);
  if (!m) return p.replace(/^-(webkit|moz)-/, '');
  const f = m[2];
  if (/gap$/.test(f)) return 'gap';
  return f;
};
const famCount = new Map();
for (const x of decls) if (!dead.has(x)) famCount.set(FAMILY(x.prop), (famCount.get(FAMILY(x.prop)) || 0) + 1);
// soron belüli stílusok a JS-ben és a HTML-ben
const jsHtml = ['js/picasso.js', 'index.html'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const camel = p => p.replace(/^-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const inlineFamilies = new Set();
for (const m of jsHtml.matchAll(/\.style\.([a-zA-Z]+)\s*=/g)) inlineFamilies.add(FAMILY(m[1].replace(/[A-Z]/g, c => '-' + c.toLowerCase())));
for (const m of jsHtml.matchAll(/style\s*=\s*["'`]([^"'`]*)/g)) for (const part of m[1].split(';')) { const p = part.split(':')[0].trim().toLowerCase(); if (p) inlineFamilies.add(FAMILY(p)); }
for (const m of jsHtml.matchAll(/style\.setProperty\(\s*['"]([a-z-]+)/g)) inlineFamilies.add(FAMILY(m[1]));
for (const m of jsHtml.matchAll(/style\.cssText\s*[+]?=/g)) void m;   // cssText: nem tudjuk, mit állít — lent óvatosan kezeljük
const hasCssText = /style\.cssText/.test(jsHtml);
const uselessImp = decls.filter(x => !dead.has(x) && x.imp && famCount.get(FAMILY(x.prop)) === 1 && !inlineFamilies.has(FAMILY(x.prop)) && !hasCssText);
void camel;

// ---- jelentés ----
const line = x => `  ${String(x.d.source.start.line).padStart(5)}: ${x.rule.selector.replace(/\s+/g, ' ').slice(0, 70)} { ${x.prop}: ${x.d.value}${x.imp ? ' !important' : ''} }  [${ctxOf(x.rule) || '—'}]`;
const impTotal = decls.filter(x => x.imp).length;
console.log(`Deklarációk: ${decls.length}, ebből !important: ${impTotal}`);
console.log(`Halott (később ugyanott felülírt) deklaráció: ${dead.size}`);
if (process.argv.includes('-v')) [...dead].forEach(x => console.log(line(x)));
console.log(`Fölösleges !important: ${uselessImp.length}`);
if (process.argv.includes('-v')) uselessImp.forEach(x => console.log(line(x)));

if (FIX) {
  for (const x of dead) x.d.remove();
  for (const x of uselessImp) x.d.important = false;
  // kiürült szabályok és @media-blokkok törlése
  let removedRules = 0;
  root.walkRules(r => { if (!r.nodes || !r.nodes.some(n => n.type === 'decl' || n.type === 'rule' || n.type === 'atrule')) { r.remove(); removedRules++; } });
  root.walkAtRules(a => { if (/^(media|supports)$/i.test(a.name) && (!a.nodes || !a.nodes.some(n => n.type !== 'comment'))) a.remove(); });
  fs.writeFileSync(CSS, root.toString());
  console.log(`Javítva: ${dead.size} halott deklaráció törölve, ${uselessImp.length} !important levéve, ${removedRules} üres szabály törölve.`);
}
