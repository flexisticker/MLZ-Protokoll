// Datenbank (eingebautes node:sqlite) und Ablageorte.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const FILES_DIR = path.join(DATA_DIR, 'dateien'); // Originale (Ton, Fotos) – nie verändert
export const WORK_DIR = path.join(DATA_DIR, 'arbeit'); // abgeleitete Arbeitskopien (z. B. WAV für die Erkennung)
export const ANCHOR_DIR = path.join(DATA_DIR, 'zeitstempel');
export const BACKUP_DIR = path.join(DATA_DIR, 'sicherungen');
for (const d of [DATA_DIR, FILES_DIR, WORK_DIR, ANCHOR_DIR, BACKUP_DIR]) fs.mkdirSync(d, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'mlz.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, pw TEXT NOT NULL,
  totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, must_change INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL, created_at TEXT, ua TEXT);
CREATE TABLE IF NOT EXISTS recovery_codes (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, used_at TEXT);
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, public_key BLOB NOT NULL, counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT, name TEXT, created_at TEXT NOT NULL, last_used TEXT
);
CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS anchors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, seq INTEGER NOT NULL, head_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, results TEXT NOT NULL, mailed_at TEXT
);
`);

export function kvGet(k, fallback = null) {
  const r = db.prepare('SELECT v FROM kv WHERE k = ?').get(k);
  if (!r) return fallback;
  try { return JSON.parse(r.v); } catch { return fallback; }
}
export function kvSet(k, v) {
  db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v));
}
