// Schutz vor Passwort-Raten, Sicherheits-Header, Schutz vor Cross-Site-Anfragen, Sicherheitsprotokoll.
import { kvGet, kvSet } from './db.js';

const attempts = new Map();
const LOCK_MS = 15 * 60000;
function check(key) {
  const a = attempts.get(key);
  if (!a?.until) return 0;
  if (a.until > Date.now()) return Math.ceil((a.until - Date.now()) / 1000);
  attempts.delete(key);
  return 0;
}
function bump(key, max) {
  const a = attempts.get(key) || { n: 0, until: 0, first: Date.now() };
  if (Date.now() - a.first > 3600000) { a.n = 0; a.first = Date.now(); }
  if (++a.n >= max) a.until = Date.now() + LOCK_MS;
  attempts.set(key, a);
  if (attempts.size > 5000) for (const [k, v] of attempts) if (!(v.until > Date.now())) attempts.delete(k);
}
/** Sekunden bis zur nächsten erlaubten Anmeldung (0 = erlaubt). Sperre je Benutzername unabhängig von der IP. */
export const loginWait = (ip) => Math.max(check(`ip:${ip}`), check('name'));
export function loginFailed(ip, user) {
  bump(`ip:${ip}`, 10);
  bump('name', 8); // Einzelbenutzer: 8 Fehlversuche/Stunde insgesamt → 15 Min. Sperre
  securityLog('Anmeldung fehlgeschlagen', ip, user);
}
export function loginSucceeded(ip, user, how) {
  attempts.delete(`ip:${ip}`);
  attempts.delete('name');
  securityLog(`Anmeldung (${how})`, ip, user);
}

export function securityLog(type, ip, user = '', detail = '') {
  kvSet('securityLog', [{ at: new Date().toISOString(), type, ip: String(ip || ''), user: String(user || '').slice(0, 60), detail }, ...kvGet('securityLog', [])].slice(0, 500));
}
export const securityEvents = () => kvGet('securityLog', []).slice(0, 200);

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), serial=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "media-src 'self' blob:", "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'", "font-src 'self'",
    "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
  ].join('; '));
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}

/** Schreibende Aufrufe müssen den Kopf „X-MLZ: 1“ tragen (fremde Seiten können ihn ohne CORS nicht setzen). */
export function csrfCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-mlz') === '1') return next();
  return res.status(403).json({ error: 'Anfrage abgelehnt (Sicherheitsprüfung). Bitte Seite neu laden.' });
}
