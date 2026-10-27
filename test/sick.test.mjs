import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSick } from '../shared/sickparse.js';
import { dayResult, defaultSettings } from '../shared/worktime.js';

const T = '2026-10-27'; // Dienstag

test('Krankmeldung aus Sprache', () => {
  let p = parseSick('Ich bin krank, ab Montag fange ich wieder an', T);
  assert.deepEqual([p.sick, p.from, p.back, p.to, p.openEnd], [true, T, '2026-11-02', '2026-11-01', false]);
  p = parseSick('Bin um 11 Uhr während der Arbeit krank geworden und nach Hause gefahren, habe dem Chef Bescheid gesagt', T);
  assert.deepEqual([p.fromTime, p.openEnd, p.reportedTo], ['11:00', true, 'Chef']);
  p = parseSick('Ich bin seit gestern krank und krankgeschrieben bis einschließlich Freitag, war heute beim Arzt', T);
  assert.deepEqual([p.from, p.to, p.doctorAt], ['2026-10-26', '2026-10-30', T]);
  p = parseSick('Heute Arbeit um halb elf abgebrochen, mir ging es schlecht, krank. Am 3.11. wieder arbeiten', T);
  assert.deepEqual([p.fromTime, p.back], ['10:30', '2026-11-03']);
  assert.equal(parseSick('heute um 8 angefangen, Pause 30 Minuten', T).sick, false);
});

test('Während der Arbeit krank: Gearbeitetes zählt, Rest wird angerechnet', () => {
  const s = defaultSettings();
  const abs = [{ type: 'krank', from: T, to: T, fromTime: '11:00' }];
  const r = dayResult(T, s, { segments: [{ start: '07:00', end: '11:00' }], breakMinutes: 0 }, abs);
  assert.equal(r.worked, 240);
  assert.equal(r.credit, 240);
  assert.equal(r.balance, 0);
  // Folgetag voll angerechnet
  const r2 = dayResult('2026-10-28', s, undefined, [{ ...abs[0], to: '2026-10-28' }]);
  assert.equal(r2.credit, 480);
});
