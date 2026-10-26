// Arbeitszeit, Soll/Ist, Urlaubskonto, BR-Ausgleich, Ausschlussfristen.
// Rechnet nur mit bereits bestätigten Daten (abgeleitet aus der Beweiskette).
import { addDays, holidayName, parseYmd, weekday, ymd } from './holidays.js';

export const ABSENCE_TYPES = {
  urlaub: { label: 'Urlaub', credit: true, vacation: true },
  krank: { label: 'Arbeitsunfähig (krank)', credit: true },
  kindkrank: { label: 'Kind krank', credit: true },
  schulung: { label: 'Schulung / BR-Seminar', credit: true },
  brcomp: { label: 'Freizeitausgleich BR-Arbeit (§ 37 Abs. 3)', credit: true, br: true },
  sonder: { label: 'Sonderurlaub / Freistellung', credit: true },
  abbau: { label: 'Überstundenabbau / Gleittag', credit: false },
  unbezahlt: { label: 'Unbezahlt frei', credit: false, noTarget: true },
};

export function defaultSettings() {
  return {
    name: '',
    employer: '',
    position: '',
    state: 'BW',
    extraHolidays: [],
    workModel: 'Vertrauensarbeitszeit, 40 Std./Woche',
    weekTarget: [480, 480, 480, 480, 480, 0, 0],
    breakMode: 'auto',
    breakRules: [{ afterMin: 360, breakMin: 30 }, { afterMin: 540, breakMin: 45 }],
    vacation: { daysPerYear: 30, carryExpiry: '03-31', opening: {} },
    halfDays: [
      { md: '12-24', name: 'Heiligabend', active: true, basis: '' },
      { md: '12-31', name: 'Silvester', active: true, basis: '' },
    ],
    balanceStart: { date: '', minutes: 0 },
    exclusionMonths: 3,
    brCompMonths: 1,
    retentionYears: 5,
    webSpeech: false,
    hashMail: { enabled: false, to: '' },
  };
}

/** Gespeicherte Einstellungen mit den Vorgaben auffüllen (neue Felder bei Updates). */
export function withDefaults(s) {
  const d = defaultSettings();
  const out = { ...d, ...(s || {}) };
  out.vacation = { ...d.vacation, ...(s?.vacation || {}) };
  out.hashMail = { ...d.hashMail, ...(s?.hashMail || {}) };
  out.balanceStart = { ...d.balanceStart, ...(s?.balanceStart || {}) };
  if (!Array.isArray(out.weekTarget) || out.weekTarget.length !== 7) out.weekTarget = d.weekTarget;
  if (!Array.isArray(out.breakRules)) out.breakRules = d.breakRules;
  if (!Array.isArray(out.halfDays)) out.halfDays = d.halfDays;
  return out;
}

export const hm = (t) => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
export const fmtDur = (min, sign = false) => {
  if (min == null || Number.isNaN(min)) return '–';
  const neg = min < 0; const a = Math.abs(Math.round(min));
  return `${neg ? '−' : sign ? '+' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
};

export function requiredBreak(grossMin, rules) {
  let need = 0;
  for (const r of rules || []) if (grossMin > Number(r.afterMin)) need = Math.max(need, Number(r.breakMin) || 0);
  return need;
}

/** Halber freier Tag (z. B. Heiligabend) laut Einstellungen. */
export function halfFree(date, settings) {
  const md = date.slice(5);
  return (settings.halfDays || []).find((h) => h.active && h.md === md) || null;
}

/** Sollzeit des Tages ohne Abwesenheiten. */
export function baseTarget(date, settings) {
  if (holidayName(date, settings.state, settings.extraHolidays)) return 0;
  let t = Number(settings.weekTarget[weekday(date)]) || 0;
  if (t && halfFree(date, settings)) t = Math.round(t / 2);
  return t;
}

/** Abwesenheit, die einen Tag betrifft (letzte gültige). */
export function absenceOn(date, absences) {
  let hit = null;
  for (const a of absences || []) if (date >= a.from && date <= (a.to || a.from)) hit = a;
  return hit;
}

/**
 * Ein Arbeitstag.
 * day = { segments:[{start,end}], breakMinutes, breaks:[{start,end}] } (oder undefined)
 */
export function dayResult(date, settings, day, absences = [], prevEnd = null) {
  const holiday = holidayName(date, settings.state, settings.extraHolidays);
  const half = halfFree(date, settings);
  const base = baseTarget(date, settings);
  const abs = absenceOn(date, absences);
  const type = abs ? ABSENCE_TYPES[abs.type] || ABSENCE_TYPES.sonder : null;
  const absFactor = abs ? (abs.half ? 0.5 : 1) : 0;
  let target = base;
  if (type?.noTarget) target = Math.round(base * (1 - absFactor));
  const credit = type?.credit ? Math.round(base * absFactor) : 0;

  const violations = [];
  const v = (code, law, text, severity = 'bad') => violations.push({ code, law, text, severity });
  let gross = 0, breakTaken = 0, breakNeeded = 0, worked = 0, first = null, last = null;
  const segs = (day?.segments || []).map((s) => ({ a: hm(s.start), b: hm(s.end) })).filter((s) => s.a != null && s.b != null)
    .map((s) => (s.b <= s.a ? { a: s.a, b: s.b + 1440 } : s)).sort((x, y) => x.a - y.a);
  if (segs.length) {
    first = segs[0].a; last = segs[segs.length - 1].b;
    gross = segs.reduce((n, s) => n + (s.b - s.a), 0);
    const gaps = segs.slice(1).reduce((n, s, i) => n + Math.max(0, s.a - segs[i].b), 0);
    const explicit = (day.breaks || []).reduce((n, b) => n + Math.max(0, (hm(b.end) ?? 0) - (hm(b.start) ?? 0)), 0);
    breakTaken = gaps + Math.max(Number(day.breakMinutes) || 0, explicit);
    const inner = breakTaken - gaps; // Pausen innerhalb der Abschnitte
    worked = gross - inner;
    breakNeeded = requiredBreak(worked, settings.breakRules);
    if (breakTaken < breakNeeded) {
      v('break', '§ 4 ArbZG', `Pause zu kurz: ${breakTaken} statt mindestens ${breakNeeded} Min.`);
      if (settings.breakMode === 'auto') worked = gross - inner - (breakNeeded - breakTaken);
    }
    if (worked > 600) v('max10', '§ 3 ArbZG', `${fmtDur(worked)} Std. gearbeitet – höchstens 10 Std. am Tag erlaubt`);
    if (prevEnd != null && first - prevEnd < 660) v('rest', '§ 5 ArbZG', `Ruhezeit nur ${fmtDur(first - prevEnd)} Std. – mindestens 11 Std. vorgeschrieben`);
    if (weekday(date) === 6 || holiday) v(holiday ? 'holiday' : 'sunday', '§ 9 ArbZG', holiday ? `Arbeit am Feiertag (${holiday}) – nur mit Ausnahme nach § 10 ArbZG erlaubt` : 'Sonntagsarbeit – nur mit Ausnahme nach § 10 ArbZG erlaubt', 'check');
  }
  const warnings = violations.map((x) => `${x.text} (${x.law})`);
  const balance = worked + credit - target;
  return { date, holiday, half: half?.name || '', base, target, credit, absence: abs, gross, breakTaken, breakNeeded, worked, balance, warnings, violations, first, last };
}

/** Alle Tage eines Zeitraums [from, to] inklusive. */
export function range(from, to, settings, days, absences, opts = {}) {
  const out = [];
  let prevEnd = null;
  const start = opts.start || '';
  const today = opts.today || '9999-12-31';
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = dayResult(d, settings, days.get(d), absences, prevEnd);
    // vor Beginn der Aufzeichnung bzw. in der Zukunft: kein Soll (nur Eingetragenes zählt)
    if ((start && d < start) || d > today) { r.untracked = d < start; r.future = d > today; r.target = 0; r.credit = r.worked ? r.credit : 0; r.balance = r.worked + r.credit; if (d > today && r.absence) { r.balance = 0; } }
    prevEnd = r.last != null ? r.last - 1440 : null; // relativ zum nächsten Tag
    out.push(r);
  }
  return out;
}

/** Verstöße gegen das Arbeitszeitgesetz in einem Zeitraum (Tageswerte aus range()). Zusätzlich Wochen über 60 Std. (§ 3: 6 × 10 Std.)
 *  und Halbjahre mit mehr als 8 Std. je Werktag im Schnitt (§ 3: Ausgleich auf 48 Std./Woche). */
export function lawViolations(rows, settings) {
  const out = [];
  for (const r of rows) for (const x of r.violations || []) out.push({ date: r.date, ...x });
  const weeks = new Map();
  for (const r of rows) {
    if (!r.worked) continue;
    const mon = addDays(r.date, -weekday(r.date));
    weeks.set(mon, (weeks.get(mon) || 0) + r.worked);
  }
  for (const [mon, min] of weeks) if (min > 3600) out.push({ date: mon, code: 'week60', law: '§ 3 ArbZG', severity: 'bad', week: true, text: `Woche ab ${mon.split('-').reverse().join('.')}: ${fmtDur(min)} Std. – mehr als 60 Std. sind nie zulässig` });
  const halves = new Map();
  for (const r of rows) {
    const key = `${r.date.slice(0, 4)}-${Number(r.date.slice(5, 7)) <= 6 ? 'H1' : 'H2'}`;
    const h = halves.get(key) || { worked: 0, werktage: 0, last: r.date, first: r.date };
    h.worked += r.worked || 0;
    if (weekday(r.date) < 6 && !r.holiday && !r.untracked && !r.future) h.werktage++;
    h.last = r.date;
    halves.set(key, h);
  }
  for (const [key, h] of halves) {
    if (h.werktage < 20 || h.worked / h.werktage <= 480) continue;
    out.push({ date: h.last, code: 'avg48', law: '§ 3 ArbZG', severity: 'check', period: key, text: `${key.endsWith('H1') ? '1.' : '2.'} Halbjahr ${key.slice(0, 4)}: im Schnitt ${fmtDur(Math.round(h.worked / h.werktage))} Std. je Werktag (Mo–Sa) – über 8 Std. (48-Std.-Woche); Ausgleich nötig` });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
export const LAW_LABEL = {
  max10: 'Über 10 Std. am Tag', break: 'Pause zu kurz', rest: 'Ruhezeit unter 11 Std.', sunday: 'Sonntagsarbeit', holiday: 'Feiertagsarbeit',
  week60: 'Woche über 60 Std.', avg48: 'Schnitt über 48 Std./Woche',
};

export function monthBounds(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = new Date(year, month, 0, 12);
  return { from, to: ymd(last) };
}

/** Beginn der Zeitaufzeichnung: Einstellung „Saldo ab“ oder erster erfasster Tag. */
export const trackingStart = (settings, firstDate) => settings.balanceStart?.date || firstDate || '';

/** Saldo von balanceStart bis einschließlich „bis“. */
export function balanceUntil(until, settings, days, absences, firstDate) {
  const start = settings.balanceStart?.date || firstDate;
  if (!start || start > until) return Number(settings.balanceStart?.minutes) || 0;
  return range(start, until, settings, days, absences, { start }).reduce((n, r) => n + r.balance, Number(settings.balanceStart?.minutes) || 0);
}

/** Urlaubstage eines Abwesenheitseintrags in einem Jahr (nur Tage mit Soll, halbe Tage zählen 0,5). */
export function vacationDays(a, settings, year = null) {
  if (!ABSENCE_TYPES[a.type]?.vacation) return 0;
  let n = 0;
  for (let d = a.from; d <= (a.to || a.from); d = addDays(d, 1)) {
    if (year && Number(d.slice(0, 4)) !== year) continue;
    const base = baseTarget(d, settings);
    if (!base) continue;
    const full = Number(settings.weekTarget[weekday(d)]) || 0;
    let v = base < full ? 0.5 : 1; // halber freier Tag → nur ein halber Urlaubstag
    if (a.half) v = Math.min(v, 0.5);
    n += v;
  }
  return n;
}

/** Urlaubskonto eines Jahres. Übertrag = Rest des Vorjahres (bis carryExpiry), ohne Vorjahr: Eröffnungswert. */
export function vacationAccount(year, settings, absences, today = ymd(new Date()), depth = 0) {
  const op = settings.vacation.opening?.[year] || {};
  const entitlement = Number(op.entitlement ?? settings.vacation.daysPerYear) || 0;
  let carry = Number(op.carry) || 0;
  if (op.carry == null && depth < 5 && Object.keys(settings.vacation.opening || {}).some((y) => Number(y) < year)) {
    carry = Math.max(0, vacationAccount(year - 1, settings, absences, today, depth + 1).remaining);
  }
  const adjust = Number(op.adjust) || 0;
  let taken = 0, planned = 0, takenBeforeExpiry = 0;
  const expiry = `${year}-${settings.vacation.carryExpiry || '03-31'}`;
  for (const a of absences) {
    if (!ABSENCE_TYPES[a.type]?.vacation) continue;
    for (let d = a.from; d <= (a.to || a.from); d = addDays(d, 1)) {
      if (Number(d.slice(0, 4)) !== year) continue;
      const v = vacationDays({ ...a, from: d, to: d }, settings);
      if (d <= today) taken += v; else planned += v;
      if (d <= expiry) takenBeforeExpiry += v;
    }
  }
  const carryLost = today > expiry ? Math.max(0, carry - takenBeforeExpiry) : 0;
  const total = entitlement + carry + adjust - carryLost;
  return { year, entitlement, carry, adjust, carryLost, expiry, taken, planned, remaining: total - taken - planned, total };
}

/** BR-Arbeit außerhalb der Arbeitszeit (§ 37 Abs. 3 BetrVG) → Ausgleichskonto. */
export function brAccount(brItems, absences, settings, days, today = ymd(new Date())) {
  const outside = brItems.filter((b) => b.outside);
  const earned = outside.reduce((n, b) => n + Math.max(0, (hm(b.end) ?? 0) - (hm(b.start) ?? 0)), 0);
  let used = 0;
  for (const a of absences) {
    if (a.type !== 'brcomp') continue;
    for (let d = a.from; d <= (a.to || a.from); d = addDays(d, 1)) used += Math.round(baseTarget(d, settings) * (a.half ? 0.5 : 1));
  }
  const months = Number(settings.brCompMonths) || 1;
  // offene Posten nach Reihenfolge abtragen (älteste zuerst)
  let rest = used;
  const open = [];
  for (const b of [...outside].sort((x, y) => x.date.localeCompare(y.date))) {
    const min = Math.max(0, (hm(b.end) ?? 0) - (hm(b.start) ?? 0));
    const take = Math.min(rest, min); rest -= take;
    if (min - take > 0 && !b.paid) {
      const dl = parseYmd(b.date); dl.setMonth(dl.getMonth() + months);
      open.push({ ...b, minutes: min - take, deadline: ymd(dl), overdue: ymd(dl) < today });
    }
  }
  return { earned, used, balance: earned - used, open };
}

/** Monate mit Mehrarbeit und deren Frist für die Geltendmachung (Ausschlussfrist). */
export function claimDeadlines(settings, days, absences, claims, today = ymd(new Date()), firstDate) {
  if (!firstDate) return [];
  const out = [];
  const months = Number(settings.exclusionMonths) || 3;
  let [y, m] = firstDate.split('-').map(Number);
  const [ty, tm] = today.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    const { from, to } = monthBounds(y, m);
    const rows = range(from, to < today ? to : today, settings, days, absences, { start: settings.balanceStart?.date || firstDate, today });
    const plus = rows.reduce((n, r) => n + Math.max(0, r.balance), 0);
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (plus > 0) {
      const dl = parseYmd(to); dl.setMonth(dl.getMonth() + months);
      const claim = claims.find((c) => c.month === key);
      out.push({ month: key, overtime: plus, deadline: ymd(dl), claimed: claim || null, overdue: !claim && ymd(dl) < today });
    }
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
