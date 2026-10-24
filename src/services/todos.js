// Hinweise „Zu erledigen“ auf der Startseite.
import { store, settings } from './store.js';
import { addDays } from '../../shared/holidays.js';
import { fmtDur } from '../../shared/worktime.js';
import { brAcc, claims } from './derived.js';
import { de, today } from './util.js';

export function todos() {
  const out = [];
  const t = today();
  const s = settings();
  const d = store.data;
  if (!d) return out;
  for (const dr of store.drafts) {
    const name = dr.title || dr.facts?.slice(0, 40) || 'ohne Titel';
    const st = dr.assistWanted ? dr.assist?.status : '';
    const text = st === 'done' ? `Von der KI ausgefüllt – prüfen und festschreiben: ${name}`
      : st === 'error' ? `KI-Ausfüllen fehlgeschlagen: ${name}`
        : ['upload', 'transcribing', 'queued', 'running'].includes(st) ? `Wird gerade ausgefüllt: ${name}` : `Entwurf noch nicht festgeschrieben: ${name}`;
    out.push({ level: st === 'error' ? 'bad' : 'warn', icon: st === 'done' ? 'check' : 'edit', text, to: `/diktat/${dr.id}` });
  }
  for (const c of claims()) {
    if (c.claimed) continue;
    const soon = addDays(t, 30);
    if (c.deadline <= soon) out.push({ level: c.overdue ? 'bad' : 'warn', icon: 'alert', text: `Mehrarbeit ${c.month} (${fmtDur(c.overtime)} Std.): Frist ${c.overdue ? 'abgelaufen' : 'bis'} ${de(c.deadline)} – schriftlich geltend machen`, to: '/zeit#fristen' });
  }
  for (const o of brAcc().open) {
    if (o.deadline <= addDays(t, 10)) out.push({ level: o.overdue ? 'bad' : 'warn', icon: 'users', text: `BR-Arbeit ${de(o.date)} außerhalb der Arbeitszeit: Freizeitausgleich bis ${de(o.deadline)} (${fmtDur(o.minutes)} Std.)`, to: '/betriebsrat' });
  }
  if (s.halfDays.some((h) => h.active && !h.basis)) out.push({ level: 'info', icon: 'info', text: 'Halbe freie Tage (24.12./31.12.): Grundlage eintragen (Vertrag, Tarifvertrag, Betriebsvereinbarung, Übung)', to: '/einstellungen#halbetage' });
  if (!s.name) out.push({ level: 'info', icon: 'settings', text: 'Einstellungen: Name und Arbeitgeber eintragen (erscheinen im Bericht)', to: '/einstellungen' });
  if (store.outbox.some((o) => o.error)) out.push({ level: 'bad', icon: 'sync', text: `Übertragung fehlgeschlagen: ${store.outbox.find((o) => o.error).error}`, to: '/pruefung#warteschlange' });
  return out;
}
