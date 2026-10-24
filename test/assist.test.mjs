import assert from 'node:assert/strict';
import test from 'node:test';
import { aiSummary, mergeAssist, normalize, SCHEMA } from '../shared/assist.js';

test('Schema: alle Felder Pflicht, keine Zusatzfelder (für Ollama und Claude)', () => {
  assert.equal(SCHEMA.additionalProperties, false);
  assert.deepEqual(SCHEMA.required.sort(), Object.keys(SCHEMA.properties).sort());
  for (const k of ['time', 'absence', 'brtime']) assert.equal(SCHEMA.properties[k].additionalProperties, false);
});

test('normalize: ungültige Werte werden verworfen, Zeitpunkt gebildet', () => {
  const n = normalize({ kind: 'quatsch', eventDate: '2026-10-23', eventTime: '7:05', title: '  Titel ', persons: '', time: { breakMinutes: 9999 } }, '2026-10-24T09:00');
  assert.equal(n.kind, 'incident');
  assert.equal(n.fields.eventAt, '2026-10-23T07:05');
  assert.equal(n.fields.title, 'Titel');
  assert.ok(!('persons' in n.fields));
  assert.equal(n.time.breakMinutes, 600);
});

test('mergeAssist: eigene Änderungen bleiben, KI füllt Leeres und eigene alte KI-Werte', () => {
  const mine = { fileIds: ['a'], facts: 'selbst geschrieben', title: 'alter KI-Titel', location: '', aiFields: { title: 'alter KI-Titel' }, assist: { updatedAt: '1' }, eventAt: '2026-10-24T09:00', eventAtAuto: true };
  const theirs = { fileIds: ['a', 'b'], aiFields: { facts: 'KI-Text', title: 'neuer KI-Titel', location: 'Halle 2', eventAt: '2026-10-24T10:00' }, assist: { updatedAt: '2', status: 'done' }, section: 'br' };
  const m = mergeAssist(mine, theirs);
  assert.equal(m.facts, 'selbst geschrieben');
  assert.equal(m.title, 'neuer KI-Titel');
  assert.equal(m.location, 'Halle 2');
  assert.equal(m.eventAt, '2026-10-24T10:00');
  assert.equal(m.section, 'br');
  assert.deepEqual(m.fileIds, ['a', 'b']);
  assert.equal(mergeAssist({ ...mine, sectionChosen: true, section: 'incident' }, theirs).section, 'incident');
  assert.equal(mergeAssist(mine, { ...theirs, assist: { updatedAt: '0' } }).title, 'alter KI-Titel'); // älterer Stand ändert nichts
  assert.deepEqual(aiSummary({ ...m }), { kept: ['title', 'location', 'eventAt'], edited: ['facts'] });
});

test('Korrektur: mehrere Aufnahmen werden nummeriert, die spätere gilt', async () => {
  const { combineSpoken } = await import('../shared/assist.js');
  assert.equal(combineSpoken(['Eins.']), 'Eins.');
  const two = combineSpoken(['Von 10 bis 12.', '(keine Sprache erkannt)', 'Korrektur: bis 13 Uhr.']);
  assert.match(two, /^Aufnahme 1:\nVon 10 bis 12\./);
  assert.match(two, /Aufnahme 2 \(später gesprochen – Ergänzung oder Korrektur\):\nKorrektur: bis 13 Uhr\./);
});

test('Korrektur ohne Datum lässt den Tag stehen', async () => {
  const { parseWorkTime } = await import('../shared/timeparse.js');
  const c = parseWorkTime('Korrektur: Feierabend war um 17 Uhr', '2026-10-24');
  assert.equal(c.end, '17:00');
  assert.equal(c.start, '');
  assert.equal(c.dateGiven, false);
  assert.equal(parseWorkTime('gestern bis 17 Uhr', '2026-10-24').dateGiven, true);
  assert.equal(parseWorkTime('heute bis 17 Uhr', '2026-10-24').dateGiven, true);
});

test('Zeitpunkt ohne KI aus dem Text: Ende nur bei „von … bis …“', async () => {
  const { extractWhen, titleFrom } = await import('../shared/assist.js');
  assert.deepEqual(extractWhen('Heute um zehn hat er mich angeschrien, ich soll bis 19 Uhr bleiben.', '2026-10-24'), { date: '2026-10-24', time: '10:00', end: '' });
  assert.deepEqual(extractWhen('Gestern von 14 bis halb drei war die Sitzung.', '2026-10-24'), { date: '2026-10-23', time: '14:00', end: '14:30' });
  assert.deepEqual(extractWhen('Der Chef war unfreundlich.', '2026-10-24'), { date: '', time: '', end: '' });
  assert.equal(titleFrom('Der Chef war heute sehr unfreundlich zu mir und den anderen. Danach …'), 'Der Chef war heute sehr unfreundlich zu …');
});
