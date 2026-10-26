// Import alter Arbeitszeiten aus einer CSV (Export einer Zeiterfassungs-App), z. B.
// Tag;Datum;Kommen;Gehen;Projekt;Stunden;Überstunden;Pause;Pausenzeit;Verdienst;Ausgaben;Notizen;Arbeitsort;Urlaub;Krankheit;Feiertag;Abwesenheit;Freizeitausgleich;Jahresurlaub
// Kommen/Gehen/Pause → Arbeitstag, Urlaub/Krankheit/Abwesenheit/Freizeitausgleich → Abwesenheit. Feiertage rechnet MLZ selbst.
import { addDays } from './holidays.js';
import { baseTarget, halfFree } from './worktime.js';

const norm = (s) => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z]/g, '');
const COLS = {
  date: ['datum', 'date', 'tag'], start: ['kommen', 'beginn', 'start', 'von'], end: ['gehen', 'ende', 'end', 'bis'],
  hours: ['stunden', 'arbeitszeit', 'dauer'], overtime: ['ueberstunden', 'mehrarbeit'], pause: ['pause'], note: ['notizen', 'notiz', 'bemerkung', 'kommentar'],
  location: ['arbeitsort', 'ort'], urlaub: ['urlaub'], krank: ['krankheit', 'krank'], feiertag: ['feiertag'], abwesenheit: ['abwesenheit'],
  ausgleich: ['freizeitausgleich', 'ausgleich', 'ueberstundenabbau'],
};
export const ABSENCE_FROM = { urlaub: 'urlaub', krank: 'krank', abwesenheit: 'sonder', ausgleich: 'abbau' };

/** Text der Datei: UTF-8, sonst Windows-1252 (Excel unter Windows). */
export function decodeCsv(buf) {
  const u = new TextDecoder('utf-8').decode(buf);
  return u.includes('�') ? new TextDecoder('windows-1252').decode(buf) : u.replace(/^﻿/, '');
}

function splitLine(line, sep) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (c === sep && !q) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** „8 Std 20 Min“, „+ 1 Std 20 Min“, „- 0 Std 30 Min“, „1:20“, „45“ → Minuten (null = leer). */
export function parseDur(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  const neg = /^-/.test(t) ? -1 : 1;
  let m = t.match(/(\d+)\s*std\.?\s*(\d+)?\s*(min)?/i);
  if (m) return neg * (Number(m[1]) * 60 + Number(m[2] || 0));
  m = t.match(/(\d+)\s*min/i);
  if (m) return neg * Number(m[1]);
  m = t.match(/^[+-]?\s*(\d{1,2}):(\d{2})$/);
  if (m) return neg * (Number(m[1]) * 60 + Number(m[2]));
  m = t.match(/^\d+$/);
  return m ? Number(t) : null;
}
const parseTime = (s) => { const m = String(s || '').match(/(\d{1,2})[:.](\d{2})/); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };
const parseDate = (s) => { const m = String(s || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/); if (!m) return ''; const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; };
const parseFlag = (s) => { const n = Number(String(s || '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0; };

/** CSV einlesen → Zeilen mit Datum, Zeiten, Pause, Kennzeichen. */
export function parseTimeCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], errors: ['Datei ist leer'] };
  const count = (ch) => lines[0].split(ch).length;
  const sep = ['\t', ';', ','].sort((a, b) => count(b) - count(a))[0];
  const head = splitLine(lines[0], sep).map(norm);
  const idx = {};
  for (const [k, names] of Object.entries(COLS)) {
    // „Datum“ vor „Tag“ (Tag = Wochentag), „Pause“ nicht „Pausenzeit“
    for (const n of names) { const i = head.indexOf(n); if (i >= 0 && idx[k] == null) idx[k] = i; }
  }
  const errors = [];
  if (idx.date == null) errors.push('Spalte „Datum“ nicht gefunden');
  if (idx.start == null || idx.end == null) errors.push('Spalten „Kommen“/„Gehen“ nicht gefunden');
  const rows = [];
  const totals = {};
  for (let i = 1; i < lines.length; i++) {
    const c = splitLine(lines[i], sep);
    if (!c.some(Boolean)) continue;
    const get = (k) => (idx[k] == null ? '' : c[idx[k]] || '');
    const date = parseDate(get('date'));
    const label = norm(c[0]);
    if (!date && (label === 'summe' || label === 'gesamt')) {
      // Summenzeilen der App: nur zum Vergleich
      const t = (totals[label] = { hoursMin: parseDur(get('hours')), overtimeMin: parseDur(get('overtime')), pauseMin: parseDur(get('pause')) });
      for (const k of ['urlaub', 'krank', 'feiertag', 'abwesenheit', 'ausgleich']) t[k] = parseFlag(get(k));
      const quota = c.map((x) => x.match(/^(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)$/)).find(Boolean);
      if (quota) t.vacationQuota = { taken: Number(quota[1].replace(',', '.')), of: Number(quota[2].replace(',', '.')) };
      continue;
    }
    if (!date) { if (c.filter(Boolean).length > 1) errors.push(`Zeile ${i + 1}: kein gültiges Datum`); continue; }
    rows.push({
      line: i + 1, date, start: parseTime(get('start')), end: parseTime(get('end')), breakMin: parseDur(get('pause')) ?? 0,
      hoursMin: parseDur(get('hours')), overtimeMin: parseDur(get('overtime')), note: get('note'), location: get('location'),
      flags: { urlaub: parseFlag(get('urlaub')), krank: parseFlag(get('krank')), feiertag: parseFlag(get('feiertag')), abwesenheit: parseFlag(get('abwesenheit')), ausgleich: parseFlag(get('ausgleich')) },
    });
  }
  return { rows, errors, totals };
}

/**
 * Daraus Arbeitszeit- und Abwesenheitseinträge bauen. Vorhandene Tage/Abwesenheiten werden übersprungen.
 * Aufeinanderfolgende ganze Abwesenheitstage gleicher Art werden zu einem Zeitraum zusammengefasst
 * (Wochenenden/Feiertage dazwischen erlaubt).
 */
export function buildImport(rows, { times = {}, absences = [], settings, file = '', fileId = '' }) {
  const out = { times: [], absences: [], skipped: [], holidays: 0, oldOvertime: 0 };
  const absentOn = (d) => absences.some((a) => !a.cancelled && d >= a.from && d <= (a.to || a.from));
  const singles = [];
  const isBr = (n) => /\bBR\b/.test(n || '') || /betriebsrat/i.test(n || '');
  for (const r of rows) {
    if (r.flags.feiertag) out.holidays++;
    if (r.overtimeMin) out.oldOvertime += r.overtimeMin;
    if (r.start && r.end) {
      if (times[r.date]) out.skipped.push({ line: r.line, date: r.date, why: 'Arbeitszeit für diesen Tag schon vorhanden' });
      else {
        out.times.push({
          id: `imp-t-${r.date.replace(/-/g, '')}-${r.start.replace(':', '')}`,
          payload: { date: r.date, segments: [{ start: r.start, end: r.end }], breakMinutes: Math.max(0, r.breakMin || 0), breaks: [], note: r.note, location: r.location, source: 'import', import: { file, fileId, line: r.line } },
        });
      }
    }
    let absent = false;
    for (const [flag, type] of Object.entries(ABSENCE_FROM)) {
      const v = r.flags[flag];
      if (!v) continue;
      absent = true;
      if (absentOn(r.date)) { out.skipped.push({ line: r.line, date: r.date, why: 'Abwesenheit schon vorhanden' }); continue; }
      // halber Tag an Heiligabend/Silvester: die andere Hälfte ist ohnehin frei → deckt den Rest des Tages
      singles.push({ date: r.date, type, half: v < 1 && !halfFree(r.date, settings), line: r.line, note: r.note });
    }
    if (r.start && r.end) continue;
    if (!absent && isBr(r.note) && (r.hoursMin > 0 || baseTarget(r.date, settings) > 0)) {
      // ganztägige Betriebsrats-Schulung/-Tätigkeit ohne Kommen/Gehen (BR = Betriebsrat)
      if (absentOn(r.date)) out.skipped.push({ line: r.line, date: r.date, why: 'Abwesenheit schon vorhanden' });
      else singles.push({ date: r.date, type: /schulung|seminar|fortbildung|lehrgang/i.test(r.note) ? 'schulung' : 'sonder', half: false, line: r.line, note: r.note, br: true });
    } else if (!absent && !r.flags.feiertag && r.hoursMin > 0) {
      out.skipped.push({ line: r.line, date: r.date, why: `nur Stunden (${Math.floor(r.hoursMin / 60)}:${String(r.hoursMin % 60).padStart(2, '0')}) ohne Kommen/Gehen${r.note ? ` – „${r.note}“` : ''}` });
    }
  }
  // zusammenfassen
  singles.sort((a, b) => a.date.localeCompare(b.date));
  let cur = null;
  const flush = () => { if (cur) out.absences.push(cur); cur = null; };
  for (const s of singles) {
    const contiguous = cur && !cur.half && !s.half && cur.type === s.type && (cur.note || '') === (s.note || '') && (() => {
      for (let d = addDays(cur.to, 1); d < s.date; d = addDays(d, 1)) if (baseTarget(d, settings) > 0) return false;
      return true;
    })();
    if (contiguous) { cur.to = s.date; cur.lines.push(s.line); continue; }
    flush();
    cur = { from: s.date, to: s.date, type: s.type, half: s.half, lines: [s.line], note: s.note, br: s.br };
  }
  flush();
  out.absences = out.absences.map((a) => {
    const id = `imp-a-${a.type}-${a.from.replace(/-/g, '')}-${a.to.replace(/-/g, '')}${a.half ? '-h' : ''}`;
    const lines = `Zeile ${a.lines[0]}${a.lines.length > 1 ? `–${a.lines[a.lines.length - 1]}` : ''}`;
    const note = [a.br ? `Betriebsrat: ${a.note}` : a.note, `importiert aus ${file || 'CSV'} (${lines})`].filter(Boolean).join(' – ');
    return { id, payload: { id, type: a.type, from: a.from, to: a.to, half: a.half, note, import: { file, fileId, line: a.lines[0] } } };
  });
  return out;
}
