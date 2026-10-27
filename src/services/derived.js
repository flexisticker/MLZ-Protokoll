// Aus dem Serverstand abgeleitete Arbeitszeit-Daten (gleiche Regeln wie im PDF-Bericht).
import { store, settings } from './store.js';
import { today } from './util.js';
import { addDays, weekday } from '../../shared/holidays.js';
import { brWeeks } from '../../shared/rules.js';
import { balanceUntil, brAccount, claimDeadlines, range, trackingStart, vacationAccount, lawViolations } from '../../shared/worktime.js';

export function stampsToDay(stamps) {
  const segs = [];
  let open = null;
  for (const s of [...stamps].sort((a, b) => a.at.localeCompare(b.at))) {
    const t = s.at.slice(11, 16);
    if (s.type === 'in' || s.type === 'break-end') { if (!open) open = { start: t }; }
    else if (open) { segs.push({ ...open, end: t }); open = null; }
  }
  return { segments: segs, open: open?.start || null, breakMinutes: 0, source: 'stamp' };
}

export function workDays() {
  const d = store.data || {};
  const days = new Map();
  for (const [date, list] of Object.entries(d.stamps || {})) days.set(date, stampsToDay(list));
  for (const [date, t] of Object.entries(d.times || {})) days.set(date, { segments: t.segments || [], breakMinutes: t.breakMinutes, breaks: t.breaks || [], source: t.source || 'form' });
  return days;
}
/** Gültige Abwesenheiten; eine Krankmeldung mit offenem Ende läuft bis heute. */
export const activeAbsences = () => Object.values(store.data?.absences || {}).filter((a) => !a.cancelled)
  .map((a) => (a.openEnd ? { ...a, to: a.from > today() ? a.from : today() } : a)).sort((a, b) => a.from.localeCompare(b.from));
export const activeBr = () => Object.values(store.data?.br || {}).filter((b) => !b.cancelled).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
export const startDate = () => trackingStart(settings(), store.data?.firstDate);

export function monthRows(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = new Date(year, month, 0, 12);
  const toS = `${year}-${String(month).padStart(2, '0')}-${String(to.getDate()).padStart(2, '0')}`;
  return range(from, toS, settings(), workDays(), activeAbsences(), { start: startDate(), today: today() });
}
export function dayRow(date) {
  return range(date, date, settings(), workDays(), activeAbsences(), { start: startDate(), today: today() })[0];
}
export const totalBalance = () => balanceUntil(today(), settings(), workDays(), activeAbsences(), store.data?.firstDate);
export const vacation = (year = Number(today().slice(0, 4))) => vacationAccount(year, settings(), activeAbsences(), today());
export const brAcc = () => brAccount(activeBr(), activeAbsences(), settings(), workDays(), today());
export const claims = () => claimDeadlines(settings(), workDays(), activeAbsences(), store.data?.claims || [], today(), store.data?.firstDate);

/** Verstöße gegen das Arbeitszeitgesetz im Zeitraum (nur erfasste Tage bis heute). */
export function violations(from, to) {
  const t = today();
  const until = to > t ? t : to;
  if (until < from) return [];
  return lawViolations(range(from, until, settings(), workDays(), activeAbsences(), { start: startDate(), today: t }), settings());
}

/** BR-Zeit, verfügbare Arbeitszeit und Zeitbedarf der Vorgaben je Woche (letzte n Wochen bis heute). */
export function brWeeksRecent(n = 12) {
  const t = today();
  const from = addDays(addDays(t, -weekday(t)), -7 * (n - 1));
  const rows = range(from, t, settings(), workDays(), activeAbsences(), { start: startDate(), today: t });
  return brWeeks(rows, { brItems: activeBr(), absences: activeAbsences(), rules: store.data?.rules || {}, settings: settings() }).filter((w) => w.target || w.br || w.worked).reverse();
}
