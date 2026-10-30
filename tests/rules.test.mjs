// PIC-ASS-O — a játékszabályok egységtesztjei (js/rules.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  squash, guessVerdict, editDistance, nameKey, cleanName, cleanText, clampNum,
  sanitizeStrokes, MAX_STROKES, MAX_TOTAL_POINTS, isPlainObject
} from '../js/rules.js';

test('squash: ékezet, kisbetű, írásjel nem számít', () => {
  assert.equal(squash('Hó-Ember!'), 'hoember');
  assert.equal(squash('  Árvíztűrő tükörfúrógép '), 'arvizturotukorfurogep');
  assert.equal(squash(null), '');
});

test('guessVerdict: pontos találat', () => {
  assert.equal(guessVerdict('hóember', 'hóember'), 'correct');
  assert.equal(guessVerdict('HOEMBER', 'hóember'), 'correct');
  assert.equal(guessVerdict('hó-ember', 'hóember'), 'correct');
  assert.equal(guessVerdict('ho ember', 'hóember'), 'correct');
});

test('guessVerdict: majdnem jó (rag, elütés) csak "close"', () => {
  assert.equal(guessVerdict('hóemberek', 'hóember'), 'close');     // rövid rag
  assert.equal(guessVerdict('biciklit', 'bicikli'), 'close');
  assert.equal(guessVerdict('elefnt', 'elefánt'), 'close');        // elütés
  assert.equal(guessVerdict('zsiráfok', 'zsiráf'), 'close');
});

test('guessVerdict: rossz tipp', () => {
  assert.equal(guessVerdict('macska', 'kutya'), 'wrong');
  assert.equal(guessVerdict('', 'kutya'), 'wrong');
  assert.equal(guessVerdict('   ', 'kutya'), 'wrong');
  // rövid szónál nincs "majdnem"
  assert.equal(guessVerdict('kad', 'kar'), 'wrong');
});

test('guessVerdict: csak írásjelből álló szó', () => {
  assert.equal(guessVerdict('?!', '?!'), 'correct');
  assert.equal(guessVerdict('x', '?!'), 'wrong');
});

test('editDistance a korláttal', () => {
  assert.equal(editDistance('kitten', 'sitting', 5), 3);
  assert.equal(editDistance('abc', 'abcdefgh', 2), 3);  // korlát + 1
  assert.equal(editDistance('abc', 'abc', 2), 0);
});

test('nameKey és cleanName', () => {
  assert.equal(nameKey(' Ádám  Béla '), 'adam bela');
  assert.equal(nameKey('ADAM'), nameKey('ádám'));
  assert.equal(cleanName(''), 'Valaki');
  assert.equal(cleanName('   '), 'Valaki');
  assert.equal(cleanName('x'.repeat(40)).length, 16);
  assert.equal(cleanText(undefined, 5), '');
  assert.equal(cleanText(12345678, 4), '1234');
});

test('clampNum és isPlainObject', () => {
  assert.equal(clampNum('5', 0, 10, -1), 5);
  assert.equal(clampNum(50, 0, 10, -1), 10);
  assert.equal(clampNum('x', 0, 10, -1), -1);
  assert.equal(clampNum(Infinity, 0, 10, -1), -1);
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
});

test('sanitizeStrokes: hibás és ellenséges adatok', () => {
  assert.deepEqual(sanitizeStrokes('nem tömb'), []);
  const out = sanitizeStrokes([
    { color: '#ff0000', sizeFrac: 0.01, points: [{ x: 0.1, y: 0.2 }, { x: 'x', y: 1 }, { x: 9, y: -9 }] },
    { color: 'javascript:alert(1)', sizeFrac: 99, points: [{ x: 0.5, y: 0.5 }] },
    { t: 'fill', color: '#00ff00', points: [{ x: 0.3, y: 0.3 }, { x: 0.4, y: 0.4 }] },
    { t: 'rect', color: '#0000ff', points: [{ x: 0, y: 0 }, { x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] },
    { points: 'nem tömb' },
    null,
  ]);
  assert.equal(out.length, 4);
  assert.deepEqual(out[0].points, [{ x: 0.1, y: 0.2 }, { x: 1.5, y: -0.5 }]);   // levágva, a hibás pont kimarad
  assert.equal(out[1].color, '#222222');                                        // ismeretlen szín helyett alap
  assert.equal(out[1].sizeFrac, 0.3);                                           // méret korlátozva
  assert.equal(out[2].points.length, 1);                                        // kitöltésnél egy pont
  assert.deepEqual(out[3].points, [{ x: 0, y: 0 }, { x: 0.2, y: 0.2 }]);         // alakzatnál két végpont
});

test('sanitizeStrokes: méretkorlátok', () => {
  const many = Array.from({ length: MAX_STROKES + 50 }, () => ({ points: [{ x: 0, y: 0 }] }));
  assert.equal(sanitizeStrokes(many).length, MAX_STROKES);
  const huge = [{ points: Array.from({ length: 5000 }, () => ({ x: 0.5, y: 0.5 })) }];
  assert.ok(sanitizeStrokes(huge)[0].points.length <= 1500);
  const total = sanitizeStrokes(Array.from({ length: 60 }, () => ({ points: Array.from({ length: 1500 }, () => ({ x: 0, y: 0 })) })))
    .reduce((n, s) => n + s.points.length, 0);
  assert.ok(total <= MAX_TOTAL_POINTS);
});
