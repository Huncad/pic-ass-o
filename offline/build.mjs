// Picasso offline változat összeállítása: egyetlen, önálló HTML-fájl
// (betűtípusok base64-ben, a teljes szótár beágyazva, semmi külső hivatkozás).
//   node offline/build.mjs   →   offline/Picasso-offline.html
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const FONTS = [['Kalam', 'kalam', 700], ['Nunito', 'nunito', 400], ['Nunito', 'nunito', 700], ['Nunito', 'nunito', 800]];

const fontCss = FONTS.flatMap(([family, file, weight]) => [['latin-ext', LATIN_EXT], ['latin', LATIN]].map(([subset, range]) => {
  const b64 = readFileSync(join(root, 'fonts', `${file}-${subset}-${weight}-normal.woff2`)).toString('base64');
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${range};}`;
})).join('\n');

export function readWords(level){
  const seen = new Set(), out = [];
  for(const raw of readFileSync(join(root, `szavak-${level}.txt`), 'utf8').split(/\r?\n/)){
    const w = raw.trim();
    if(!w || w.startsWith('#')) continue;
    const k = w.toLowerCase();
    if(seen.has(k)) continue;
    seen.add(k); out.push(w);
  }
  return out;
}
const words = { konnyu: readWords('konnyu'), kozepes: readWords('kozepes'), nehez: readWords('nehez') };

let html = readFileSync(join(here, 'src', 'offline.html'), 'utf8');
const wordsRe = /\/\*__WORDS__\*\/\{[^\n]*\};/;
if(!html.includes('/*__FONTS__*/') || !wordsRe.test(html)) throw new Error('hiányzó helyőrző a sablonban');
// a szólista JSON-ja nem tartalmazhat "</script"-et (szavak, nem kód — de biztosra megyünk)
const wordsJson = JSON.stringify(words).replace(/</g, '\\u003c');
if(!html.includes('/*__OFL__*/')) throw new Error('hiányzó licenc-helyőrző a sablonban');
// a betűtípusok licence (SIL OFL 1.1) a fájlban is olvasható legyen
const ofl = readFileSync(join(here, 'OFL.txt'), 'utf8').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
html = html.replace('/*__FONTS__*/', () => fontCss).replace(wordsRe, () => `${wordsJson};`).replace('/*__OFL__*/', () => ofl);

const out = join(here, 'Picasso-offline.html');
writeFileSync(out, html);
console.log(`kész: ${out} (${Math.round(html.length / 1024)} kB; szavak: ${words.konnyu.length} könnyű, ${words.kozepes.length} közepes, ${words.nehez.length} nehéz)`);
