// Gesprochene Arbeitszeit-Sätze verstehen, z. B.
//   „Heute um halb acht angefangen, 30 Minuten Pause, Feierabend um 16 Uhr 15“
//   „Gestern von 7:30 bis 17 Uhr, eine Stunde Pause, Überstunden angeordnet von Herrn Maier“
// Ergebnis ist nur ein Vorschlag – das Formular zeigt ihn zur Bestätigung an.
import { addDays, pad, weekday, ymd } from './holidays.js';

const UNITS = { null: 0, ein: 1, eins: 1, eine: 1, einer: 1, einem: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };
const TEENS = { zehn: 10, elf: 11, zwoelf: 12, dreizehn: 13, vierzehn: 14, fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19 };
const TENS = { zwanzig: 20, dreissig: 30, vierzig: 40, fuenfzig: 50, sechzig: 60 };
const WEEKDAYS = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];
const MONTHS = ['januar', 'februar', 'maerz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];

function wordNumber(w) {
  if (w in UNITS && w !== 'null') return UNITS[w];
  if (w === 'null') return 0;
  if (w in TEENS) return TEENS[w];
  if (w in TENS) return TENS[w];
  const m = w.match(/^(ein|zwei|drei|vier|fuenf|sechs|sieben|acht|neun)und(zwanzig|dreissig|vierzig|fuenfzig)$/);
  if (m) return UNITS[m[1]] + TENS[m[2]];
  return null;
}

/** Kleinschreibung, Umlaute, Zahlwörter → Ziffern. */
export function normalize(text) {
  let s = ` ${String(text || '').toLowerCase()} `
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[„“"!?;]/g, ' ')
    .replace(/(\d)\s*h\b/g, '$1 uhr')
    .replace(/(\d{1,2})\s*:\s*(\d{2})(?!\d)/g, '$1:$2').replace(/(\d{1,2})\.(\d{2})(?![\d.])/g, '$1:$2');
  s = s.replace(/[a-z]+/g, (w) => { const n = wordNumber(w); return n == null || ['ein', 'eine', 'einer', 'einem'].includes(w) ? w : String(n); });
  // „7 uhr 30“ → 7:30
  s = s.replace(/\b(\d{1,2}) uhr (\d{1,2})\b(?! (minuten|min|stunden))/g, (_, h, m) => `${h}:${pad(m)}`);
  return s.replace(/\s+/g, ' ');
}

const toMin = (h, m) => h * 60 + m;
export const fmt = (min) => (min == null ? '' : `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`);

/** Alle Uhrzeiten mit Position finden. Schwäbisch: „viertel acht“ = 7:15, „dreiviertel acht“ = 7:45. */
function findTimes(s) {
  const out = [];
  const push = (index, min, len) => { if (min >= 0 && min < 24 * 60) out.push({ index, end: index + len, min }); };
  const rules = [
    [/\bhalb (\d{1,2})\b/g, (m) => toMin(Number(m[1]) - 1, 30)],
    [/\bviertel nach (\d{1,2})\b/g, (m) => toMin(Number(m[1]), 15)],
    [/\bviertel vor (\d{1,2})\b/g, (m) => toMin(Number(m[1]) - 1, 45)],
    [/\bdreiviertel (\d{1,2})\b(?! (stunde|std))/g, (m) => toMin(Number(m[1]) - 1, 45)],
    [/\b(?<!drei)viertel (\d{1,2})\b(?! (stunde|std))/g, (m) => toMin(Number(m[1]) - 1, 15)],
    [/\b(\d{1,2}) nach (\d{1,2})\b/g, (m) => toMin(Number(m[2]), Number(m[1]))],
    [/\b(\d{1,2}) vor (\d{1,2})\b/g, (m) => toMin(Number(m[2]) - 1, 60 - Number(m[1]))],
    [/\b(\d{1,2}):(\d{2})\b/g, (m) => toMin(Number(m[1]), Number(m[2]))],
    [/\b(\d{1,2}) uhr\b/g, (m) => toMin(Number(m[1]), 0)],
    [/\b(?:um|ab|bis|von|gegen) (\d{1,2})\b(?![:.\d]| (minuten|min|stunden|std|tage?|uhr|\.))/g, (m) => toMin(Number(m[1]), 0), (m) => m[0].length - m[1].length],
  ];
  const taken = [];
  for (const [re, fn, off] of rules) {
    for (const m of s.matchAll(re)) {
      const start = m.index + (off ? off(m) : 0);
      const end = m.index + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      const min = fn(m);
      if (Number.isFinite(min)) { push(start, min, end - start); taken.push([start, end]); }
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function durationMinutes(str) {
  const s = ` ${str} `;
  if (/\b(eine )?halbe stunde\b/.test(s)) return 30;
  if (/\bdreiviertel ?stunde\b/.test(s)) return 45;
  if (/\bviertel ?stunde\b/.test(s)) return 15;
  if (/\banderthalb stunden\b/.test(s)) return 90;
  let m = s.match(/\b(\d+)(?:[,.](\d+))? (?:stunden|stunde|std)\b(?: (?:und )?(\d+) (?:minuten|min))?/);
  if (m) return Math.round(Number(`${m[1]}.${m[2] || 0}`) * 60) + Number(m[3] || 0);
  if (/\beine stunde\b/.test(s)) return 60;
  m = s.match(/\b(\d+) (?:minuten|min|minütige?)\b/);
  if (m) return Number(m[1]);
  return null;
}

function findDate(s, today) {
  if (/\bvorgestern\b/.test(s)) return addDays(today, -2);
  if (/\bgestern\b/.test(s)) return addDays(today, -1);
  let m = s.match(/\b(?:am )?(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/);
  if (m) {
    let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
    if (y < 100) y += 2000;
    const d = `${y}-${pad(m[2])}-${pad(m[1])}`;
    return !m[3] && d > today ? `${y - 1}-${pad(m[2])}-${pad(m[1])}` : d;
  }
  m = s.match(new RegExp(`\\b(\\d{1,2})\\.? (${MONTHS.join('|')})\\b`));
  if (m) {
    let y = Number(today.slice(0, 4));
    let d = `${y}-${pad(MONTHS.indexOf(m[2]) + 1)}-${pad(m[1])}`;
    if (d > today) d = `${y - 1}${d.slice(4)}`;
    return d;
  }
  m = s.match(new RegExp(`\\b(?:am |letzten |letzter )?(${WEEKDAYS.join('|')})\\b`));
  if (m) {
    const target = WEEKDAYS.indexOf(m[1]);
    let back = (weekday(today) - target + 7) % 7;
    if (/\bletzte[nr]? /.test(s) && back === 0) back = 7;
    return addDays(today, -back);
  }
  return today;
}

const START_WORDS = /(angefangen|anfang|beginn|begonnen|gekommen|eingestempelt|arbeitsbeginn|gestartet|start|los|ab|von|seit)/;
const END_WORDS = /(feierabend|schluss|ende|aufgehoert|gegangen|ausgestempelt|bis|nach hause|heim|fertig)/;
const PAUSE_WORDS = /(pause|mittag|mittagspause|unterbrechung)/;

/**
 * @returns {{date, start, end, breakMinutes, breaks:[{start,end}], orderedBy, overtime, unsure:string[], text}}
 * start/end als 'HH:MM' oder '' (nicht erkannt).
 */
export function parseWorkTime(text, today = ymd(new Date())) {
  const s = normalize(text);
  const unsure = [];
  const date = findDate(s, today);
  const times = findTimes(s);
  const breaks = [];
  let start = null, end = null;

  // Pausen „Pause von 12 bis 12:30“ zuerst herausnehmen
  for (const pm of s.matchAll(/\b(pause|mittagspause|mittag)\b/g)) {
    const after = times.filter((t) => t.index > pm.index && t.index - pm.index < 30 && !t.used);
    if (after.length >= 2 && /\bvon\b|\bbis\b|-/.test(s.slice(pm.index, after[1].index))) {
      breaks.push({ start: fmt(after[0].min), end: fmt(after[1].min) });
      after[0].used = after[1].used = true;
    }
  }
  let breakMinutes = null;
  // Dauer einer Pause im Umfeld des Wortes „Pause“
  for (const pm of s.matchAll(new RegExp(`\\b${PAUSE_WORDS.source}\\b`, 'g'))) {
    const around = s.slice(Math.max(0, pm.index - 30), pm.index + 40);
    const before = s.slice(Math.max(0, pm.index - 30), pm.index + pm[0].length);
    const d = durationMinutes(before) ?? durationMinutes(around);
    if (d != null && d < 300) { breakMinutes = (breakMinutes || 0) + d; break; }
  }
  if (/\b(keine|ohne) pause\b/.test(s)) breakMinutes = 0;
  if (breakMinutes == null && breaks.length) breakMinutes = breaks.reduce((n, b) => n + (toMinStr(b.end) - toMinStr(b.start)), 0);

  const free = times.filter((t) => !t.used);
  for (const t of free) {
    const ctx = s.slice(Math.max(0, t.index - 28), t.index);
    const ctxAfter = s.slice(t.end, t.end + 24);
    const lastWord = (re) => { const all = [...ctx.matchAll(new RegExp(`\\b${re.source}\\b`, 'g'))]; return all.length ? all[all.length - 1].index : -1; };
    const si = Math.max(lastWord(START_WORDS), /^ ?(angefangen|begonnen|gekommen|eingestempelt|los)/.test(ctxAfter) ? 99 : -1);
    const ei = Math.max(lastWord(END_WORDS), /^ ?(feierabend|schluss|aufgehoert|gegangen|ausgestempelt|heim)/.test(ctxAfter) ? 99 : -1);
    if (si > ei && start == null) start = t.min;
    else if (ei > si && end == null) end = t.min;
    else if (start == null) start = t.min;
    else if (end == null) end = t.min;
  }
  if (start != null && end != null && end <= start && end < 12 * 60) end += 12 * 60; // „bis 4“ = 16 Uhr
  if (start == null) unsure.push('start');
  if (end == null) unsure.push('end');
  if (breakMinutes == null) unsure.push('break');

  let orderedBy = '';
  const om = s.match(/\b(?:angeordnet|angewiesen|verlangt|gebilligt|geduldet|abgesprochen)(?: hat| wurde| worden)? (?:von|durch) ((?:herrn?|frau|dem|der|unserem|unserer|meinem|meiner)? ?[a-z]+(?: [a-z]+)?)/)
    || s.match(/\bauf (?:anweisung|anordnung|wunsch) (?:von|des|der) ((?:herrn?|frau)? ?[a-z]+(?: [a-z]+)?)/)
    || s.match(/\b((?:herr|frau) [a-z]+) hat (?:die )?(?:ueberstunden|mehrarbeit)? ?(?:angeordnet|verlangt|gebilligt)/);
  if (om) orderedBy = restoreName(text, om[1]);
  const overtime = /\b(ueberstunde|ueberstunden|mehrarbeit|laenger)\b/.test(s) || !!orderedBy;

  return { date, start: fmt(start), end: fmt(end), breakMinutes: breakMinutes ?? null, breaks, orderedBy, overtime, unsure, text: String(text || '') };
}

const toMinStr = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };

/** Namen in Originalschreibung aus dem Ursprungstext übernehmen (Groß-/Kleinschreibung, Umlaute). */
function restoreName(original, normalized) {
  const words = normalized.split(' ');
  const src = String(original).split(/\s+/);
  const norm = (w) => w.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z]/g, '');
  return words.map((w) => (src.find((o) => norm(o) === w) || w).replace(/[.,;:!?]+$/, '')).join(' ').trim();
}
