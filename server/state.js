// Lesesicht: aus der Beweiskette den aktuellen Stand ableiten (Einträge, Arbeitszeit, Urlaub …).
// Wird bei jedem neuen Eintrag verworfen und beim nächsten Zugriff neu gebaut.
import { allRows, onAppend, parsePayload } from './evidence.js';
import { withDefaults } from '../shared/worktime.js';

let cache = null;
onAppend(() => { cache = null; });
export const invalidate = () => { cache = null; };

const meta = (r) => ({ seq: r.seq, evidenceId: r.id, receivedAt: r.received_at, capturedAt: r.captured_at, hash: r.hash, device: r.device });

/** Stempelungen eines Tages → Arbeitsabschnitte. */
export function stampsToDay(stamps) {
  const segs = [];
  let open = null;
  for (const s of [...stamps].sort((a, b) => a.at.localeCompare(b.at))) {
    const t = s.at.slice(11, 16);
    if (s.type === 'in' || s.type === 'break-end') { if (!open) open = { start: t }; }
    else if (s.type === 'out' || s.type === 'break-start') { if (open) { segs.push({ ...open, end: t }); open = null; } }
  }
  return { segments: segs, open: open?.start || null, breakMinutes: 0, source: 'stamp' };
}

export function build() {
  if (cache) return cache;
  const rows = allRows();
  const out = {
    settings: withDefaults({}), settingsHistory: [], files: {}, transcripts: {}, entries: {}, times: {}, stamps: {},
    absences: {}, br: {}, claims: [], cases: {}, assessments: {}, erased: new Set(), firstDate: null, count: rows.length,
  };
  for (const r of rows) {
    if (r.kind === 'erase') out.erased.add(r.ref);
  }
  for (const r of rows) {
    const p = parsePayload(r);
    const m = meta(r);
    switch (r.kind) {
      case 'settings': if (p) { out.settings = withDefaults(p); out.settingsHistory.push({ ...m, at: r.received_at }); } break;
      case 'file': out.files[r.id] = p ? { ...p, id: r.id, ...m } : { id: r.id, erased: true, ...m }; break;
      case 'transcript': if (p) out.transcripts[r.ref] = { ...p, ...m }; break;
      case 'entry': if (p) out.entries[p.id] = { ...p, ...m, addenda: [], retracted: null, eventAt: r.event_at || p.eventAt }; else out.entries[r.id] = { id: r.id, erased: true, ...m, addenda: [] }; break;
      case 'addendum': { const e = out.entries[r.ref]; if (e) e.addenda.push(p ? { ...p, ...m } : { erased: true, ...m }); break; }
      case 'retract': { const e = out.entries[r.ref]; if (e && p) e.retracted = { ...p, ...m }; break; }
      case 'time': if (p?.date) { out.times[p.date] = { ...p, ...m, history: [...(out.times[p.date]?.history || []), ...(out.times[p.date] ? [omitHistory(out.times[p.date])] : [])] }; noteDate(out, p.date); } break;
      case 'stamp': if (p?.at) { const d = p.at.slice(0, 10); (out.stamps[d] ||= []).push({ ...p, ...m }); noteDate(out, d); } break;
      case 'absence': if (p?.id) { out.absences[p.id] = { ...p, ...m, cancelled: null }; } break;
      case 'absence-cancel': if (out.absences[r.ref] && p) out.absences[r.ref].cancelled = { ...p, ...m }; break;
      case 'br': if (p?.id) { out.br[p.id] = { ...p, ...m, cancelled: null }; noteDate(out, p.date); } break;
      case 'br-cancel': if (out.br[r.ref] && p) out.br[r.ref].cancelled = { ...p, ...m }; break;
      case 'claim': if (p) out.claims.push({ ...p, ...m }); break;
      case 'assessment': if (p?.id) out.assessments[p.id] = { ...p, ...m, cancelled: null }; break;
      case 'assessment-cancel': if (out.assessments[r.ref] && p) out.assessments[r.ref].cancelled = { ...p, ...m }; break;
      case 'case': if (p?.id) out.cases[p.id] = { ...p, ...m, closed: null, history: [] }; break;
      case 'case-close': if (out.cases[r.ref] && p) { out.cases[r.ref].closed = { ...p, ...m }; out.cases[r.ref].history.push({ action: 'close', ...p, ...m }); } break;
      case 'case-reopen': if (out.cases[r.ref] && p) { out.cases[r.ref].closed = null; out.cases[r.ref].history.push({ action: 'reopen', ...p, ...m }); } break;
      default: break;
    }
  }
  cache = out;
  return out;
}

const omitHistory = (t) => { const { history, ...rest } = t; return rest; };
function noteDate(out, d) { if (d && (!out.firstDate || d < out.firstDate)) out.firstDate = d; }

/** Arbeitstage (Map Datum → Abschnitte) aus Zeiteinträgen und Stempelungen. Ein Zeiteintrag ersetzt die Stempelungen. */
export function workDays(st = build()) {
  const days = new Map();
  for (const [d, list] of Object.entries(st.stamps)) days.set(d, stampsToDay(list));
  for (const [d, t] of Object.entries(st.times)) days.set(d, { segments: t.segments || [], breakMinutes: t.breakMinutes, breaks: t.breaks || [], source: t.source || 'form' });
  return days;
}
export const activeAbsences = (st = build()) => Object.values(st.absences).filter((a) => !a.cancelled).sort((a, b) => a.from.localeCompare(b.from));
export const activeBr = (st = build()) => Object.values(st.br).filter((b) => !b.cancelled).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

/** Für den Browser: alles als einfaches JSON. */
export function clientState() {
  const st = build();
  return {
    settings: st.settings, settingsHistory: st.settingsHistory.slice(-30), files: st.files, transcripts: st.transcripts, entries: st.entries,
    times: st.times, stamps: st.stamps, absences: st.absences, br: st.br, claims: st.claims, cases: st.cases, assessments: st.assessments,
    firstDate: st.firstDate, count: st.count,
  };
}
