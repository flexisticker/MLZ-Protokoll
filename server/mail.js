// Tägliche Prüfsummen-Mail an die eigene (private) Adresse: ein zweiter, fremder Nachweis,
// dass der Stand der Kette an diesem Tag existierte. Zugangsdaten nur im Programm (kv), nie in der Kette.
import nodemailer from 'nodemailer';
import { db, kvGet, kvSet } from './db.js';

export const smtpConfig = () => kvGet('smtp', { host: '', port: 465, secure: true, user: '', from: '' });
export function setSmtp(cfg) {
  const old = kvGet('smtp', {});
  const next = {
    host: String(cfg.host || '').trim().slice(0, 120), port: Number(cfg.port) || 465, secure: cfg.secure !== false,
    user: String(cfg.user || '').trim().slice(0, 120), from: String(cfg.from || '').trim().slice(0, 120),
    pass: cfg.pass ? String(cfg.pass) : old.pass || '',
  };
  kvSet('smtp', next);
}
export const smtpPublic = () => { const c = smtpConfig(); return { ...c, pass: undefined, hasPass: !!c.pass }; };

const clean = (s) => String(s || '').replace(/[\r\n]/g, ' ').trim();
export async function sendMail(to, subject, text) {
  const c = smtpConfig();
  if (!c.host || !c.user || !c.pass) throw new Error('Mailversand nicht eingerichtet');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(to))) throw new Error('Empfängeradresse ungültig');
  const t = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: c.pass } });
  await t.sendMail({ from: clean(c.from || c.user), to: clean(to), subject: clean(subject), text });
}

export async function mailAnchor(anchor, settings) {
  if (!settings.hashMail?.enabled || !settings.hashMail.to || !anchor || anchor.mailed_at) return false;
  const res = JSON.parse(anchor.results);
  const text = [
    'MLZ-Protokoll – Tagesprüfwert der Beweiskette',
    '',
    `Stand: Eintrag Nr. ${anchor.seq}`,
    `Prüfwert (SHA-256): ${anchor.head_hash}`,
    `Erstellt: ${anchor.created_at}`,
    '',
    ...res.map((r) => (r.ok ? `Zeitstempel ${r.tsa}: ${r.time}` : `Zeitstempel ${r.tsa}: fehlgeschlagen (${r.error})`)),
    '',
    'Diese Mail bitte aufbewahren. Sie belegt unabhängig vom Server, dass dieser Stand an diesem Tag existierte.',
  ].join('\n');
  await sendMail(settings.hashMail.to, `MLZ-Prüfwert ${anchor.day} – Nr. ${anchor.seq}`, text);
  db.prepare('UPDATE anchors SET mailed_at = ? WHERE id = ?').run(new Date().toISOString(), anchor.id);
  return true;
}
