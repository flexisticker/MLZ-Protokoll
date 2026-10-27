// Vorgaben & Pflichten (oft nur mündlich, z. B. „7+1 Besuche am Tag“) mit geschätztem Zeitbedarf,
// und die Gegenüberstellung BR-Zeit ↔ verfügbare Arbeitszeit je Woche.
import { addDays, weekday } from './holidays.js';
import { absenceOn, baseTarget, hm } from './worktime.js';

/** Zeitbedarf einer Vorgabe je Arbeitstag in Minuten (Wochenangaben auf 5 Tage verteilt). */
export function ruleMinutes(rule) {
  let n = 0;
  for (const it of rule?.effort || []) {
    const m = (Number(it.count) || 0) * (Number(it.minutes) || 0);
    n += it.per === 'week' ? m / 5 : m;
  }
  return Math.round(n);
}

/** Galt die Vorgabe an diesem Tag? */
export const ruleActiveOn = (rule, date) => (!rule.since || rule.since <= date) && (!rule.ended || rule.ended.date > date);

export function activeRules(rules, date) {
  return Object.values(rules || {}).filter((r) => ruleActiveOn(r, date));
}

/** Zeitbedarf aller an einem Tag geltenden Vorgaben (Minuten). */
export const needOn = (rules, date) => activeRules(rules, date).reduce((n, r) => n + ruleMinutes(r), 0);

/** BR-Zeit eines Tages: eingetragene BR-Tätigkeit + Schulung/BR-Seminar (Sollzeit des Tages). */
export function brMinutesOn(date, brItems, absences, settings) {
  let n = 0;
  for (const b of brItems) if (b.date === date) n += Math.max(0, (hm(b.end) ?? 0) - (hm(b.start) ?? 0));
  const a = absenceOn(date, absences);
  if (a?.type === 'schulung') n += Math.round(baseTarget(date, settings) * (a.half ? 0.5 : 1));
  return n;
}

/**
 * Wochenübersicht: Soll, Abwesenheit (ohne BR), BR-Zeit, verfügbare Zeit für die eigentliche Arbeit,
 * Zeitbedarf der Vorgaben, tatsächlich gearbeitet.
 * rows = range(...) Ergebnisse (für worked), Montag als Wochenbeginn.
 */
export function brWeeks(rows, { brItems = [], absences = [], rules = {}, settings }) {
  const weeks = new Map();
  for (const r of rows) {
    if (r.untracked || r.future) continue; // vor Beginn der Aufzeichnung bzw. Zukunft: nichts zu vergleichen
    const mon = addDays(r.date, -weekday(r.date));
    if (!weeks.has(mon)) weeks.set(mon, { week: mon, target: 0, away: 0, br: 0, need: 0, worked: 0, workdays: 0 });
    const w = weeks.get(mon);
    const base = baseTarget(r.date, settings);
    const a = absenceOn(r.date, absences);
    const br = brMinutesOn(r.date, brItems, absences, settings);
    w.target += base;
    w.br += br;
    w.worked += r.worked || 0;
    if (a && a.type !== 'schulung') w.away += Math.round(base * (a.half ? 0.5 : 1));
    const presentShare = base ? Math.max(0, 1 - (a ? (a.half ? 0.5 : 1) : 0)) : 0;
    if (presentShare > 0) { w.workdays += presentShare; w.need += Math.round(needOn(rules, r.date) * presentShare); }
  }
  return [...weeks.values()].map((w) => ({ ...w, available: Math.max(0, w.target - w.away - w.br), brShare: w.target ? w.br / w.target : 0 }));
}
