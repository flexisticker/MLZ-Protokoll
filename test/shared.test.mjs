import assert from 'node:assert/strict';
import test from 'node:test';
import { easter, holidays } from '../shared/holidays.js';
import { parseWorkTime } from '../shared/timeparse.js';
import { dayResult, defaultSettings, range, vacationAccount, vacationDays } from '../shared/worktime.js';

test('Ostern und Feiertage Baden-Württemberg 2026', () => {
  assert.equal(easter(2026), '2026-04-05');
  assert.equal(easter(2027), '2027-03-28');
  const h = holidays(2026, 'BW');
  assert.equal(h.size, 12);
  for (const d of ['2026-01-06', '2026-04-03', '2026-04-06', '2026-05-14', '2026-05-25', '2026-06-04', '2026-11-01']) assert.ok(h.has(d), d);
  assert.ok(!h.has('2026-10-31'), 'Reformationstag nicht in BW');
  assert.ok(!h.has('2026-12-24'));
});

const T = '2026-10-23';
const cases = [
  ['Heute um halb acht angefangen, 30 Minuten Pause, bis 16 Uhr', { date: T, start: '07:30', end: '16:00', breakMinutes: 30 }],
  ['Gestern von 7:30 bis 17 Uhr, eine Stunde Pause, Überstunden angeordnet von Herrn Maier.', { date: '2026-10-22', start: '07:30', end: '17:00', breakMinutes: 60, orderedBy: 'Herrn Maier' }],
  ['Arbeitsbeginn sieben Uhr dreißig, Mittagspause von 12 bis 12:30, Feierabend um viertel nach fünf', { start: '07:30', end: '17:15', breakMinutes: 30 }],
  ['viertel acht gekommen und um 16:30 gegangen, Pause 30 Minuten', { start: '07:15', end: '16:30' }],
  ['Angefangen um dreiviertel acht, Feierabend halb fünf, eine halbe Stunde Pause', { start: '07:45', end: '16:30', breakMinutes: 30 }],
  ['Von 8 bis 4, 45 Minuten Pause', { start: '08:00', end: '16:00', breakMinutes: 45 }],
  ['Am 20.10. von 7 bis 19 Uhr, Frau Schulz hat Überstunden angeordnet', { date: '2026-10-20', start: '07:00', end: '19:00', orderedBy: 'Frau Schulz' }],
  ['am Montag 6 Uhr bis 14:15 keine Pause', { date: '2026-10-19', start: '06:00', end: '14:15', breakMinutes: 0 }],
];
for (const [text, want] of cases) {
  test(`Sprache: ${text}`, () => {
    const r = parseWorkTime(text, T);
    for (const [k, v] of Object.entries(want)) assert.equal(r[k], v, `${k}: ${JSON.stringify(r)}`);
  });
}

test('Pausenregel § 4 ArbZG wird angewendet', () => {
  const s = defaultSettings();
  const r = dayResult('2026-10-23', s, { segments: [{ start: '07:00', end: '17:00' }], breakMinutes: 30 });
  assert.equal(r.breakNeeded, 45);
  assert.equal(r.worked, 555); // 10 Std. − 45 Min.
  assert.equal(r.balance, 75);
  s.breakMode = 'warn';
  assert.equal(dayResult('2026-10-23', s, { segments: [{ start: '07:00', end: '17:00' }], breakMinutes: 30 }).worked, 570);
});

test('Heiligabend halber Tag, Feiertag ohne Soll', () => {
  const s = defaultSettings();
  assert.equal(dayResult('2026-12-24', s).target, 240);
  assert.equal(dayResult('2026-12-25', s).target, 0);
  s.halfDays[0].active = false;
  assert.equal(dayResult('2026-12-24', s).target, 480);
});

test('Urlaub: halbe Tage, Heiligabend zählt halb, Feiertage nicht', () => {
  const s = defaultSettings();
  assert.equal(vacationDays({ type: 'urlaub', from: '2026-12-21', to: '2027-01-08' }, s), 3.5 + 3.5 + 4); // 24./31.12. halb, 25.12./1.1./6.1. Feiertag
  assert.equal(vacationDays({ type: 'urlaub', from: '2026-11-03', to: '2026-11-03', half: true }, s), 0.5);
  const acc = vacationAccount(2026, s, [{ type: 'urlaub', from: '2026-08-03', to: '2026-08-14' }], '2026-10-24');
  assert.equal(acc.taken, 10);
  assert.equal(acc.remaining, 20);
});

test('Urlaubstag wird als Soll angerechnet', () => {
  const s = defaultSettings();
  const rows = range('2026-08-03', '2026-08-07', s, new Map(), [{ type: 'urlaub', from: '2026-08-03', to: '2026-08-07' }]);
  assert.equal(rows.reduce((n, r) => n + r.balance, 0), 0);
  const abbau = range('2026-08-03', '2026-08-03', s, new Map(), [{ type: 'abbau', from: '2026-08-03' }]);
  assert.equal(abbau[0].balance, -480);
});

test('Verstöße gegen das Arbeitszeitgesetz', async () => {
  const { lawViolations } = await import('../shared/worktime.js');
  const s = defaultSettings();
  const days = new Map([
    ['2026-03-02', { segments: [{ start: '06:00', end: '18:00' }], breakMinutes: 45 }], // 11:15 Std. > 10
    ['2026-03-03', { segments: [{ start: '04:00', end: '12:00' }], breakMinutes: 0 }], // Ruhezeit 10 Std., Pause fehlt
    ['2026-03-08', { segments: [{ start: '09:00', end: '12:00' }], breakMinutes: 0 }], // Sonntag
  ]);
  const rows = range('2026-03-02', '2026-03-08', s, days, []);
  const v = lawViolations(rows, s);
  const codes = v.map((x) => `${x.date} ${x.code}`);
  assert.ok(codes.includes('2026-03-02 max10'));
  assert.ok(codes.includes('2026-03-03 rest'));
  assert.ok(codes.includes('2026-03-03 break'));
  assert.ok(codes.includes('2026-03-08 sunday'));
  assert.equal(v.find((x) => x.code === 'sunday').severity, 'check');
  // Woche über 60 Std.
  const long = new Map(['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14'].map((d) => [d, { segments: [{ start: '07:00', end: '18:15' }], breakMinutes: 45 }]));
  const w = lawViolations(range('2026-03-09', '2026-03-15', s, long, []), s);
  assert.ok(w.some((x) => x.code === 'week60'));
});

test('Wer hat die Nacharbeit veranlasst?', async () => {
  const { initiator } = await import('../shared/timeparse.js');
  assert.equal(initiator('Um 17 Uhr hat mich der Chef angerufen, danach Mail an den Kunden'), 'Chef');
  assert.equal(initiator('mein Chef Herr Maier hat angerufen'), 'Chef Herr Maier');
  assert.equal(initiator('Frau Schulz rief um 18 Uhr an'), 'Frau Schulz');
  assert.equal(initiator('ich habe noch Mails geschrieben'), '');
});

test('Diktierte Arbeitszeit wird als Arbeitszeit erkannt', async () => {
  const { workTimeIntent } = await import('../shared/timeparse.js');
  let w = workTimeIntent('Erfasse folgende Arbeitszeit: Beginn 7:30, Ende 16:30, Pause 45 Minuten', '2026-10-29');
  assert.deepEqual([w.level, w.time.start, w.time.end, w.time.breakMinutes], ['strong', '07:30', '16:30', 45]);
  w = workTimeIntent('erfasse folgende Arbeitszeit. Beginn 7 Uhr 30. Ende 16 Uhr 30. Pause in Minuten 45.', '2026-10-29');
  assert.equal(w.time.breakMinutes, 45);
  assert.equal(workTimeIntent('Heute um 10 Uhr hat mich Maier in Halle 2 angeschrien, ich soll bis 19 Uhr bleiben', '2026-10-29').level, '');
  assert.equal(workTimeIntent('Heute um halb acht angefangen und um 17 Uhr aufgehört', '2026-10-29').level, 'weak');
});
