// Passkeys (Fingerabdruck / Gesichtserkennung am Handy) über WebAuthn.
import crypto from 'node:crypto';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { db } from './db.js';

const challenges = new Map(); // Schlüssel → { challenge, at, userId }
const keep = (key, data) => {
  challenges.set(key, { ...data, at: Date.now() });
  for (const [k, v] of challenges) if (Date.now() - v.at > 5 * 60000) challenges.delete(k);
};
const take = (key) => { const c = challenges.get(key); challenges.delete(key); return c && Date.now() - c.at < 5 * 60000 ? c : null; };

/** RP-ID/Origin aus der Anfrage (hinter dem Proxy: Host-Kopf), überschreibbar per RP_ID / ORIGIN. */
export function rp(req) {
  const host = (req.get('x-forwarded-host') || req.get('host') || 'localhost').split(',')[0].trim();
  const rpID = process.env.RP_ID || host.replace(/:\d+$/, '');
  const origin = process.env.ORIGIN || `${req.protocol}://${host}`;
  return { rpID, origin };
}

export async function registrationOptions(req, user) {
  const { rpID } = rp(req);
  const existing = db.prepare('SELECT id, transports FROM passkeys WHERE user_id = ?').all(user.id);
  const opts = await generateRegistrationOptions({
    rpName: 'MLZ-Protokoll', rpID, userName: user.username, userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  keep(`reg:${user.id}`, { challenge: opts.challenge });
  return opts;
}

export async function registrationVerify(req, user, response, name) {
  const c = take(`reg:${user.id}`);
  if (!c) throw new Error('Zeit abgelaufen – bitte erneut versuchen');
  const { rpID, origin } = rp(req);
  const v = await verifyRegistrationResponse({ response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  if (!v.verified) throw new Error('Passkey konnte nicht geprüft werden');
  const cred = v.registrationInfo.credential;
  db.prepare('INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(cred.id, user.id, Buffer.from(cred.publicKey), cred.counter || 0, JSON.stringify(cred.transports || []), String(name || 'Passkey').slice(0, 60), new Date().toISOString());
}

export async function loginOptions(req) {
  const { rpID } = rp(req);
  const opts = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
  const key = crypto.randomBytes(16).toString('hex');
  keep(`auth:${key}`, { challenge: opts.challenge });
  return { key, options: opts };
}

/** @returns userId oder null */
export async function loginVerify(req, key, response) {
  const c = take(`auth:${key}`);
  if (!c) return null;
  const row = db.prepare('SELECT * FROM passkeys WHERE id = ?').get(String(response?.id || ''));
  if (!row) return null;
  const { rpID, origin } = rp(req);
  const v = await verifyAuthenticationResponse({
    response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
    credential: { id: row.id, publicKey: new Uint8Array(row.public_key), counter: row.counter, transports: row.transports ? JSON.parse(row.transports) : undefined },
  });
  if (!v.verified) return null;
  db.prepare('UPDATE passkeys SET counter = ?, last_used = ? WHERE id = ?').run(v.authenticationInfo.newCounter, new Date().toISOString(), row.id);
  return row.user_id;
}

export const listPasskeys = (userId) => db.prepare('SELECT id, name, created_at, last_used FROM passkeys WHERE user_id = ? ORDER BY created_at').all(userId);
export const removePasskey = (userId, id) => db.prepare('DELETE FROM passkeys WHERE user_id = ? AND id = ?').run(userId, id);
