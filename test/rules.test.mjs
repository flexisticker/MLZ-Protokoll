import assert from 'node:assert/strict';
import test from 'node:test';
import { brWeeks, needOn, ruleMinutes } from '../shared/rules.js';
import { defaultSettings, range } from '../shared/worktime.js';

test('Zeitbedarf einer Vorgabe', () => {
  const r = { effort: [{ count: 8, minutes: 40, per: 'day' }, { count: 8, minutes: 25, per: 'day' }, { count: 1, minutes: 60, per: 'week' }] };
  assert.equal(ruleMinutes(r), 8 * 40 + 8 * 25 + 12);
  const rules = { a: { ...r, since: '2026-03-01' }, b: { effort: [{ count: 1, minutes: 30, per: 'day' }], since: '2026-01-01', ended: { date: '2026-03-04' } } };
  assert.equal(needOn(rules, '2026-02-15'), 30); // nur b
  assert.equal(needOn(rules, '2026-03-03'), 532 + 30);
  assert.equal(needOn(rules, '2026-03-04'), 532); // b ab 04.03. aufgehoben
});

test('BR-Zeit je Woche', () => {
  const s = defaultSettings();
  const days = new Map([['2026-03-02', { segments: [{ start: '07:00', end: '17:00' }], breakMinutes: 45 }]]);
  const absences = [{ type: 'schulung', from: '2026-03-04', to: '2026-03-04' }, { type: 'urlaub', from: '2026-03-06', to: '2026-03-06' }];
  const brItems = [{ date: '2026-03-03', start: '09:00', end: '12:00' }];
  const rules = { a: { effort: [{ count: 1, minutes: 540, per: 'day' }] } };
  const [w] = brWeeks(range('2026-03-02', '2026-03-08', s, days, absences), { brItems, absences, rules, settings: s });
  assert.equal(w.target, 5 * 480);
  assert.equal(w.away, 480); // Urlaub Freitag
  assert.equal(w.br, 180 + 480); // 3 Std. BR + Schulungstag
  assert.equal(w.available, 5 * 480 - 480 - 660);
  assert.equal(w.need, 3 * 540); // Mittwoch Schulung + Freitag Urlaub → kein Bedarf
  assert.equal(w.worked, 555);
});
