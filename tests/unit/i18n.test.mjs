// Translations and units (Phase 8 Step 4; docs/TRANSLATIONS.md): ICU messages (arguments, plurals with each
// language's rules, ordinals, selects, numbers, dates, quotes), languages falling back to English, the pseudo-
// translations, American spellings, units by region and setting, and every message the game has parsing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createI18n, parseMessage, pseudoMessages, pseudoText, resolveLanguage, setLanguage, i18n, t } from '../../ui/i18n.js';
import { units, systemFor } from '../../ui/units.js';
import { americanize, check, hardCoded, usedKeys } from '../../tools/i18n.mjs';

test('ICU messages: arguments, plurals (=0, one, other, #), ordinals, selects, numbers and quotes', () => {
  const I = createI18n({ locale: 'en', messages: {
    hi: 'Welcome back, {name}',
    parts: '{count, plural, =0 {No parts} one {# part} other {# parts}}',
    place: 'You finished {place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}',
    road: '{surface, select, wet {Wet road} other {Dry road}}',
    money: 'Paid {n, number}',
    pct: '{p, number, percent} done',
    quote: "It''s '{'braces'}' and {who}",
    nested: '{n, plural, one {{who} has # car} other {{who} has # cars}}',
  } });
  assert.equal(I.t('hi', { name: 'Ana' }), 'Welcome back, Ana');
  assert.equal(I.t('parts', { count: 0 }), 'No parts');
  assert.equal(I.t('parts', { count: 1 }), '1 part');
  assert.equal(I.t('parts', { count: 1234 }), '1,234 parts');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(p => I.t('place', { place: p }).split(' ').at(-1)), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd']);
  assert.equal(I.t('road', { surface: 'wet' }), 'Wet road');
  assert.equal(I.t('road', { surface: 'snow' }), 'Dry road');
  assert.equal(I.t('money', { n: 12500 }), 'Paid 12,500');
  assert.equal(I.t('pct', { p: 0.5 }), '50% done');
  assert.equal(I.t('quote', { who: 'me' }), "It's {braces} and me");
  assert.equal(I.t('nested', { n: 2, who: 'Ben' }), 'Ben has 2 cars');
  assert.equal(I.t('nope'), 'nope', 'a missing message shows its key');
  assert.throws(() => parseMessage('{n, plural, one {x}}'), /other/);
  assert.throws(() => parseMessage('{n, plural, one {x} other {y}'), /expected/);
});

test('plurals follow each language\'s own rules (Polish few/many, Arabic zero/two), and formats are the language\'s', () => {
  const pl = createI18n({ locale: 'pl', messages: { m: '{n, plural, one {# minuta} few {# minuty} many {# minut} other {# minuty}}' } });
  assert.deepEqual([1, 2, 5, 22, 25].map(n => pl.t('m', { n })), ['1 minuta', '2 minuty', '5 minut', '22 minuty', '25 minut']);
  const ar = createI18n({ locale: 'ar', messages: { m: '{n, plural, zero {zero} one {one} two {two} few {few} many {many} other {other}}' } });
  assert.deepEqual([0, 1, 2, 3, 11, 100].map(n => ar.t('m', { n })), ['zero', 'one', 'two', 'few', 'many', 'other']);
  assert.equal(ar.dir, 'rtl');
  const de = createI18n({ locale: 'de' });
  assert.equal(de.number(1234.5), '1.234,5');
  assert.equal(de.money(12500), '$12.500', 'the game\'s money: its own symbol, the language\'s grouping');
  const us = createI18n({ locale: 'en-US' }), au = createI18n({ locale: 'en-AU' });
  const d = new Date(Date.UTC(2026, 9, 12, 12));
  assert.match(us.date(d, 'short'), /^10\/12\/26$/);
  assert.match(au.date(d, 'short'), /^12\/10\/26$/);
});

test('languages: the browser\'s chosen when the game has it; English regions; a missing message falls back to English', async () => {
  const L = JSON.parse(fs.readFileSync('data/languages.json', 'utf8'));
  assert.equal(resolveLanguage('auto', L, ['en-US']), 'en-US');
  assert.equal(resolveLanguage('auto', L, ['en-AU', 'en']), 'en-AU');
  assert.equal(resolveLanguage('auto', L, ['en-NZ']), 'en-GB');
  assert.equal(resolveLanguage('auto', L, ['fr-FR', 'en-GB']), 'en-GB');
  assert.equal(resolveLanguage('auto', L, ['fr-FR']), 'en');
  assert.equal(resolveLanguage('en-XA', L, []), 'en-XA');
  const en = JSON.parse(fs.readFileSync('locales/en.json', 'utf8'));
  globalThis.fetch = async url => ({ ok: true, json: async () => url.includes('languages') ? L : url.endsWith('en-US.json') ? JSON.parse(fs.readFileSync('locales/en-US.json', 'utf8')) : url.endsWith('/en.json') ? en : {} });
  assert.equal(await setLanguage('en-US'), 'en-US');
  assert.equal(t('a11y.colours'), 'Colors');
  assert.equal(t('settings.title'), 'Settings', 'not in en-US: English');
  await setLanguage('en-XA');
  assert.match(t('settings.title'), /^\[Šéţţíñĝš ~+\]$/, 'pseudo: accented, longer, bracketed');
  assert.equal(t('controls.button', { n: 3 }).includes('3'), true, 'arguments still work in the pseudo-translation');
  await setLanguage('ar-XB');
  assert.equal(i18n.dir, 'rtl');
  await setLanguage('en');
});

test('pseudo-translations and American spellings', () => {
  assert.equal(pseudoText('Tyre grip'), 'Ţýŕé ĝŕíþ');
  const p = pseudoMessages({ a: 'Brake', b: '{n, plural, one {# lap} other {# laps}}' });
  assert.match(p.a, /^\[Brake ~+\]$/);
  assert.doesNotThrow(() => parseMessage(p.b), 'plurals stay valid');
  assert.equal(americanize('Tyre colour on the kerb, centre of {colour}'), 'Tire color on the curb, center of {colour}');
  assert.equal(americanize('{count, plural, one {# tyre} other {# tyres}}'), '{count, plural, one {# tire} other {# tires}}');
});

test('units: by region (the US imperial, the UK miles on the road) and by setting; the car itself stays metric', () => {
  assert.deepEqual(systemFor('en-US'), { distance: 'imperial', other: 'imperial' });
  assert.deepEqual(systemFor('en-GB'), { distance: 'imperial', other: 'metric' });
  assert.deepEqual(systemFor('en-AU'), { distance: 'metric', other: 'metric' });
  assert.deepEqual(systemFor('en-US', 'metric'), { distance: 'metric', other: 'metric' });
  const us = units({ locale: 'en-US' }), au = units({ locale: 'en-AU' }), gb = units({ locale: 'en-GB' });
  assert.equal(us.speedKmh(100).text, '62 mph');
  assert.equal(au.speedKmh(100).text, '100 km/h');
  assert.equal(gb.speed(27.78).text, '62 mph');
  assert.equal(us.distance(1609.344).text, '1.0 mi');
  assert.equal(us.distance(30).text, '98 ft');
  assert.equal(au.distance(1500).text, '1.5 km');
  assert.equal(au.distance(400).text, '400 m');
  assert.equal(us.temperature(100).text, '212 °F');
  assert.equal(gb.temperature(90).text, '90 °C', 'the UK: metric off the road');
  assert.equal(us.mass(1000).text, '2,205 lb');
  assert.equal(us.pressure(2.2).text, '32 psi');
  assert.equal(au.power(100).text, '100 kW');
  assert.equal(us.power(100).text, '134 hp');
  assert.ok(Math.abs(us.toKmh(62.137) - 100) < 0.01);
});

test('every message the game has parses; every t() key used exists; no screen has gained hard-coded words', () => {
  const r = check();
  assert.deepEqual(r.problems, []);
  assert.ok(r.messages > 300);
  // the detector itself: words in markup and textContent count, code doesn't
  assert.deepEqual(hardCoded("el.innerHTML = `<b>Start race</b>`; x.textContent = 'Paused'; if (a > b && c < d) f();"), ['Start race', 'Paused']);
  assert.deepEqual([...usedKeys("t('a.b'); t(`c.${x}.d`)").exact], ['a.b']);
});
