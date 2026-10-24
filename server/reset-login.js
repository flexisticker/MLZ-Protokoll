// Notfall-Zugang über die Unraid-Konsole des Containers:
//   node server/reset-login.js            → Benutzer anzeigen
//   node server/reset-login.js <name>     → Einmal-Passwort setzen, Zwei-Faktor aus, alle Sitzungen beenden
// Wer die Konsole bedienen kann, hat ohnehin Zugriff auf alle Daten – darum ist das kein zusätzliches Risiko.
import crypto from 'node:crypto';
import { db } from './db.js';
import { hashPassword } from './auth.js';
import { securityLog } from './security.js';

const name = (process.argv[2] || '').trim().toLowerCase();
const users = db.prepare('SELECT username, totp_enabled FROM users').all();
if (!name) {
  console.log(users.length ? `Benutzer: ${users.map((u) => u.username).join(', ')}` : 'Noch kein Benutzer angelegt – einfach im Browser einrichten.');
  console.log('Zurücksetzen: node server/reset-login.js <benutzername>');
  process.exit(0);
}
const u = db.prepare('SELECT * FROM users WHERE username = ?').get(name);
if (!u) { console.error(`Benutzer „${name}“ nicht gefunden.`); process.exit(1); }
const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
const pw = Array.from({ length: 3 }, () => Array.from(crypto.randomBytes(4), (b) => chars[b % chars.length]).join('')).join('-');
db.prepare('UPDATE users SET pw = ?, must_change = 1, totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(hashPassword(pw), u.id);
db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
securityLog('Zugang über Konsole zurückgesetzt', 'Unraid-Konsole', u.username);
console.log(`Einmal-Passwort für ${u.username}: ${pw}`);
console.log('Zwei-Faktor wurde ausgeschaltet. Nach der Anmeldung neues Passwort vergeben und Zwei-Faktor wieder einschalten.');
