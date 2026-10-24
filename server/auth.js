// Anmeldung: Passwort (+ Code aus der Authenticator-App), Wiederherstellungscodes, Passkeys, Sitzungen.
import crypto from 'node:crypto';
import { db } from './db.js';

const SESSION_DAYS = 30;
export const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 32), Buffer.from(hashHex, 'hex'));
}
const DUMMY = hashPassword(crypto.randomBytes(12).toString('hex'));

export const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
export const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
export const publicUser = (u) => u && {
  id: u.id, username: u.username, totp: !!u.totp_enabled, mustChange: !!u.must_change,
  passkeys: db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').get(u.id).n,
  recoveryLeft: db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').get(u.id).n,
};

export function checkPassword(pw) {
  if (!pw || String(pw).length < 10) throw new Error('Passwort mit mindestens 10 Zeichen wählen');
}

export function createUser(username, password) {
  checkPassword(password);
  if (!/^[a-z0-9._-]{2,40}$/i.test(String(username || ''))) throw new Error('Benutzername: 2–40 Zeichen (Buchstaben, Ziffern, . _ -)');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, username, pw, created_at) VALUES (?, ?, ?, ?)').run(id, username.trim().toLowerCase(), hashPassword(password), new Date().toISOString());
  return getUser(id);
}

export function findByName(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim().toLowerCase());
}

/** Passwort prüfen (auch für unbekannte Namen rechnen → gleiche Antwortzeit). */
export function passwordOk(username, password) {
  const u = findByName(username);
  if (!u) { verifyPassword(String(password || ''), DUMMY); return null; }
  return verifyPassword(String(password || ''), u.pw) ? u : null;
}

export function setPassword(userId, password) {
  checkPassword(password);
  db.prepare('UPDATE users SET pw = ?, must_change = 0 WHERE id = ?').run(hashPassword(password), userId);
}

// ------------------------------------------------------------ Sitzungen
export function createSession(userId, ua = '') {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires, created_at, ua) VALUES (?, ?, ?, ?, ?)')
    .run(tokenHash(token), userId, Date.now() + SESSION_DAYS * 864e5, new Date().toISOString(), String(ua).slice(0, 160));
  return token;
}
export function sessionUser(token) {
  if (!token) return null;
  const h = tokenHash(token);
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(h);
  if (!s || s.expires < Date.now()) return null;
  if (s.expires - Date.now() < (SESSION_DAYS - 1) * 864e5) db.prepare('UPDATE sessions SET expires = ? WHERE token = ?').run(Date.now() + SESSION_DAYS * 864e5, h);
  return getUser(s.user_id) || null;
}
export const endSession = (token) => db.prepare('DELETE FROM sessions WHERE token = ?').run(tokenHash(token));
export const endAllSessions = (userId, exceptToken = '') => db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, tokenHash(exceptToken));
export const purgeSessions = () => db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
export const listSessions = (userId) => db.prepare('SELECT created_at, expires, ua FROM sessions WHERE user_id = ? ORDER BY created_at DESC').all(userId);

export function parseCookies(header = '') {
  const dec = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
  return Object.fromEntries(header.split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, dec(v.join('='))]));
}

// ------------------------------------------------------------ TOTP (RFC 6238, 30 s, 6 Ziffern, SHA-1)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(s) {
  let bits = 0, value = 0; const out = [];
  for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) { value = (value << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function totpCode(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
const usedTotp = new Map(); // Code nicht zweimal annehmen
export function totpOk(secret, code, userId = '') {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return false;
  const now = Math.floor(Date.now() / 30000);
  for (const w of [0, -1, 1]) {
    if (totpCode(secret, now + w) === c) {
      const key = `${userId}:${now + w}:${c}`;
      if (usedTotp.has(key)) return false;
      usedTotp.set(key, Date.now());
      for (const [k, t] of usedTotp) if (Date.now() - t > 120000) usedTotp.delete(k);
      return true;
    }
  }
  return false;
}
export function startTotp(userId) {
  const secret = base32(crypto.randomBytes(20));
  db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').run(secret, userId);
  const u = getUser(userId);
  return { secret, uri: `otpauth://totp/MLZ-Protokoll:${encodeURIComponent(u.username)}?secret=${secret}&issuer=MLZ-Protokoll&period=30&digits=6` };
}
export function confirmTotp(userId, code) {
  const u = getUser(userId);
  if (!totpOk(u.totp_secret, code, userId)) return false;
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(userId);
  return true;
}
export const disableTotp = (userId) => db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(userId);

// ------------------------------------------------------------ Wiederherstellungscodes
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = () => Array.from(crypto.randomBytes(12), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('').replace(/(.{4})(?!$)/g, '$1-');
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function newRecoveryCodes(userId) {
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
  const codes = Array.from({ length: 10 }, randomCode);
  for (const c of codes) db.prepare('INSERT INTO recovery_codes (hash, user_id) VALUES (?, ?)').run(tokenHash(normCode(c)), userId);
  return codes;
}
export function useRecoveryCode(userId, code) {
  const h = tokenHash(normCode(code));
  const r = db.prepare('SELECT * FROM recovery_codes WHERE hash = ? AND user_id = ? AND used_at IS NULL').get(h, userId);
  if (!r) return false;
  db.prepare('UPDATE recovery_codes SET used_at = ? WHERE hash = ?').run(new Date().toISOString(), h);
  return true;
}
