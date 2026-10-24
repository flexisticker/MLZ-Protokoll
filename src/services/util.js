// Kleine Helfer
export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const pad = (n) => String(n).padStart(2, '0');
/** Lokale Zeit als 'JJJJ-MM-TTTHH:MM'. */
export const localNow = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const today = () => localNow().slice(0, 10);
export const nowTime = () => localNow().slice(11, 16);
export const de = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');
export const deShort = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.` : '');
export const deLocal = (s) => (s ? `${de(s.slice(0, 10))}${s.length > 10 ? ` ${s.slice(11, 16)}` : ''}` : '');
export const deTime = (iso) => {
  if (!iso) return '–';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
};
export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const shortHash = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : '');
export const bytes = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const minutesBetween = (a, b) => { if (!a || !b) return 0; const [h1, m1] = a.split(':').map(Number); const [h2, m2] = b.split(':').map(Number); let d = h2 * 60 + m2 - (h1 * 60 + m1); if (d < 0) d += 1440; return d; };
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
