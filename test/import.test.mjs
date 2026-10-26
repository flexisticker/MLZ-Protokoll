import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildImport, decodeCsv, parseDur, parseTimeCsv } from '../shared/importcsv.js';
import { defaultSettings, range, vacationDays } from '../shared/worktime.js';

const HEAD = 'Tag;Datum;Kommen;Gehen;Projekt;Stunden;Überstunden;Pause;Pausenzeit;Verdienst;Ausgaben;Notizen;Arbeitsort;Urlaub;Krankheit;Feiertag;Abwesenheit;Freizeitausgleich;Jahresurlaub';
const CSV = [HEAD,
  'Donnerstag;01.01.2026;;;Michael Zatti; 8 Std 00 Min;;0 Std 00 Min;;0,00 €;0,00 €;;;;;1.0;;;',
  'Freitag;02.01.2026;;;Michael Zatti; 8 Std 00 Min;;0 Std 00 Min;;0,00 €;0,00 €;;;1.0;;;;;',
  'Samstag;03.01.2026;;;Michael Zatti; ;;;;;;;;;;;;;',
  'Sonntag;04.01.2026;;;Michael Zatti; ;;;;;;;;;;;;;',
  'Montag;05.01.2026;;;Michael Zatti; 8 Std 00 Min;;0 Std 00 Min;;0,00 €;0,00 €;;;1.0;;;;;',
  'Dienstag;06.01.2026;;;Michael Zatti; 8 Std 00 Min;;0 Std 00 Min;;0,00 €;0,00 €;;;;;1.0;;;',
  'Mittwoch;07.01.2026;07:00Uhr;17:20Uhr;Michael Zatti; 9 Std 20 Min;+ 1 Std 20 Min;1 Std 00 Min;;0,00 €;0,00 €;;;;;;;;',
  'Donnerstag;08.01.2026;05:45Uhr;15:53Uhr;Michael Zatti; 9 Std 18 Min;+ 1 Std 18 Min;0 Std 50 Min;;0,00 €;0,00 €;;;;;;;;',
  'Montag;12.01.2026;08:00Uhr;17:30Uhr;Michael Zatti; 8 Std 30 Min;+ 0 Std 30 Min;1 Std 00 Min;;0,00 €;0,00 €;KickOff Tag1;;;;;;;',
  'Dienstag;13.01.2026;;;Michael Zatti; 8 Std 00 Min;;0 Std 00 Min;;0,00 €;0,00 €;BR Schulung Arbeitsrecht 1+2 in LB;;;;;;;',
  'Mittwoch;14.01.2026;;;Michael Zatti; 8 Std 00 Min;;0 Std 00 Min;;0,00 €;0,00 €;BR Schulung Arbeitsrecht 1+2 in LB;;;;;;;',
  'Montag;21.09.2026;06:15Uhr;17:05Uhr;Michael Zatti; 9 Std 20 Min;+ 1 Std 20 Min;0 Std 45 Min;;0,00 €;0,00 €;Vorbereiten W30 Liste in Excel für anstehenden Termin um 8:00 mit RVL. ich hatte vorher keine Zeit;;;;;;;',
  'Donnerstag;24.12.2026;;;Michael Zatti; 4 Std 00 Min;- 4 Std 00 Min;0 Std 00 Min;;0,00 €;0,00 €;;;0.5;;;;;',
  'Freitag;25.12.2026;;;Michael Zatti; 8 Std 00 Min;;0 Std 00 Min;;0,00 €;0,00 €;;;;;1.0;;;',
  'Samstag;26.12.2026;;;Michael Zatti; ;;;;;;;;;;;;;',
  'Sonntag;27.12.2026;;;Michael Zatti; ;;;;;;;;;;;;;',
  'Montag;28.12.2026;;;Michael Zatti; 8 Std 00 Min;;0 Std 00 Min;;0,00 €;0,00 €;;;1.0;;;;;',
  'Dienstag;29.12.2026;;;Michael Zatti; 8 Std 00 Min;;0 Std 00 Min;;0,00 €;0,00 €;;;1.0;;;;;',
  'Mittwoch;30.12.2026;;;Michael Zatti; 8 Std 00 Min;;0 Std 00 Min;;0,00 €;0,00 €;;;1.0;;;;;',
  'Donnerstag;31.12.2026;;;Michael Zatti; 4 Std 00 Min;- 4 Std 00 Min;0 Std 00 Min;;0,00 €;0,00 €;;;0.5;;;;;',
  ';;;;;;;;;;;;;;;;;;',
  'Summe;;;;; 1853 Std 39 Min;- 234 Std 21 Min;157 Std 23 Min;;0,00 €;0,00 €;;;29;4;8;0;0;',
  ';;;;;;;;;;;;;;;;;;',
  'Gesamt;;;;; ;+ 165 Std 52 Min;;;;;;;;;;;;29 / 30',
].join('\r\n');

test('Dauer „X Std Y Min“', () => {
  assert.equal(parseDur(' 9 Std 20 Min'), 560);
  assert.equal(parseDur('- 234 Std 21 Min'), -14061);
  assert.equal(parseDur('+ 0 Std 30 Min'), 30);
  assert.equal(parseDur(''), null);
});

test('ibuchron-CSV einlesen inkl. Summen', () => {
  const p = parseTimeCsv(decodeCsv(new TextEncoder().encode(CSV)));
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows.length, 20);
  const d = p.rows.find((r) => r.date === '2026-01-07');
  assert.deepEqual([d.start, d.end, d.breakMin], ['07:00', '17:20', 60]);
  assert.equal(p.totals.summe.overtimeMin, -14061);
  assert.equal(p.totals.gesamt.overtimeMin, 165 * 60 + 52);
  assert.equal(p.totals.summe.urlaub, 29);
  assert.deepEqual(p.totals.gesamt.vacationQuota, { taken: 29, of: 30 });
});

test('Arbeitstage, Urlaub, BR-Schulung, Heiligabend/Silvester', () => {
  const s = defaultSettings();
  const { rows } = parseTimeCsv(CSV);
  const b = buildImport(rows, { settings: s, file: 'x.csv' });
  assert.equal(b.times.length, 4);
  assert.equal(b.times[0].payload.source, 'import');
  // 02.01. + 05.01. = ein Urlaub (Wochenende dazwischen), BR-Schulung 13.–14.01., Urlaub 24.–31.12.
  const a = b.absences.map((x) => [x.payload.type, x.payload.from, x.payload.to, x.payload.half]);
  assert.deepEqual(a, [
    ['urlaub', '2026-01-02', '2026-01-05', false],
    ['schulung', '2026-01-13', '2026-01-14', false],
    ['urlaub', '2026-12-24', '2026-12-31', false],
  ]);
  assert.match(b.absences[1].payload.note, /^Betriebsrat: BR Schulung/);
  // Urlaubstage wie in ibuchron: 24.12. und 31.12. je ½ + 3 ganze = 4
  assert.equal(vacationDays(b.absences[2].payload, s), 4);
  assert.equal(b.holidays, 3);
  // Heiligabend: halber Tag frei + Urlaub = Saldo 0
  const days = new Map();
  const r = range('2026-12-24', '2026-12-31', s, days, b.absences.map((x) => x.payload), { start: '2026-12-24' });
  assert.equal(r.reduce((n, x) => n + x.balance, 0), 0);
  // vorhandene Tage bleiben
  const again = buildImport(rows, { settings: s, times: { '2026-01-07': {} }, absences: [b.absences[0].payload] });
  assert.equal(again.times.length, 3);
  assert.ok(again.skipped.some((x) => x.date === '2026-01-02'));
});
