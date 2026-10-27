// MLZ-Protokoll – Server
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { db, kvGet } from './db.js';
import { append, erasePayload, getRow, head, onAppend, parsePayload } from './evidence.js';
import * as auth from './auth.js';
import * as pk from './passkeys.js';
import { csrfCheck, loginFailed, loginSucceeded, loginWait, securityEvents, securityHeaders, securityLog } from './security.js';
import { fileInfo, receiveUpload, removeStored, storedPath } from './files.js';
import * as tr from './transcribe.js';
import { build, clientState, invalidate } from './state.js';
import { anchorFile, anchorNow, listAnchors } from './anchors.js';
import { writeExport } from './export.js';
import { anchorSoon, backupNow, fullCheck, localDay, startScheduler } from './scheduler.js';
import { sendMail, setSmtp, smtpPublic } from './mail.js';
import { withDefaults } from '../shared/worktime.js';
import { mergeAssist } from '../shared/assist.js';
import { buildImport, decodeCsv, parseTimeCsv } from '../shared/importcsv.js';
import * as assist from './assist.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 8090);
const VERSION = process.env.APP_VERSION || JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const COOKIE = 'mlz_s';

onAppend((r) => {
  invalidate();
  if (r.kind === 'transcript') { tr.resetCache(); setImmediate(() => assist.onTranscript(r.ref)); }
  if (['entry', 'addendum', 'time', 'br', 'absence', 'claim', 'stamp'].includes(r.kind)) anchorSoon();
});
tr.setPromptWords(build().settings.promptWords);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');
app.use(securityHeaders);

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { next(e); } };
const ip = (req) => req.ip || '';
const device = (req) => {
  const ua = String(req.get('user-agent') || '');
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unbekannt';
  const br = ua.match(/(Edg|Chrome|Firefox|Version)\/(\d+)/);
  const name = br ? `${{ Edg: 'Edge', Version: 'Safari' }[br[1]] || br[1]} ${br[2]}` : '';
  return `${os}${name ? ` · ${name}` : ''}`;
};
function setCookie(req, res, token) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 30 * 864e5, path: '/' });
}

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'mlz-protokoll', version: VERSION }));

// ------------------------------------------------------------ Sitzung
app.use('/api', express.json({ limit: '2mb' }), csrfCheck);
app.use('/api', (req, res, next) => {
  const token = auth.parseCookies(req.headers.cookie)[COOKIE];
  req.token = token;
  req.user = auth.sessionUser(token);
  next();
});

app.get('/api/session', (req, res) => res.json({ setup: auth.userCount() === 0, user: auth.publicUser(req.user), version: VERSION }));

app.post('/api/setup', wrap(async (req, res) => {
  if (auth.userCount() > 0) return res.status(409).json({ error: 'Bereits eingerichtet' });
  const u = auth.createUser(req.body.username, req.body.password);
  append({ kind: 'settings', device: device(req), payload: withDefaults({ name: String(req.body.name || '').slice(0, 120) }) });
  securityLog('Einrichtung', ip(req), u.username);
  setCookie(req, res, auth.createSession(u.id, req.get('user-agent')));
  res.json({ user: auth.publicUser(u) });
}));

app.post('/api/login', wrap(async (req, res) => {
  const wait = loginWait(ip(req));
  if (wait) return res.status(429).json({ error: `Zu viele Fehlversuche. Bitte in ${Math.ceil(wait / 60)} Min. erneut versuchen.` });
  const u = auth.passwordOk(req.body.username, req.body.password);
  if (!u) { loginFailed(ip(req), req.body.username); return res.status(401).json({ error: 'Benutzername oder Passwort falsch' }); }
  if (u.totp_enabled) {
    const code = String(req.body.code || '');
    if (!code) return res.json({ needCode: true });
    const ok = /^\d{6}$/.test(code.replace(/\s/g, '')) ? auth.totpOk(u.totp_secret, code, u.id) : auth.useRecoveryCode(u.id, code);
    if (!ok) { loginFailed(ip(req), u.username); return res.status(401).json({ error: 'Code falsch', needCode: true }); }
    if (!/^\d{6}$/.test(code.replace(/\s/g, ''))) securityLog('Wiederherstellungscode benutzt', ip(req), u.username);
  }
  loginSucceeded(ip(req), u.username, u.totp_enabled ? 'Passwort + Code' : 'Passwort');
  setCookie(req, res, auth.createSession(u.id, req.get('user-agent')));
  res.json({ user: auth.publicUser(u) });
}));

app.post('/api/passkey/login/options', wrap(async (req, res) => {
  if (loginWait(ip(req))) return res.status(429).json({ error: 'Zu viele Fehlversuche' });
  res.json(await pk.loginOptions(req));
}));
app.post('/api/passkey/login/verify', wrap(async (req, res) => {
  let userId = null;
  try { userId = await pk.loginVerify(req, String(req.body.key || ''), req.body.response); } catch { userId = null; }
  const u = userId && auth.getUser(userId);
  if (!u) { loginFailed(ip(req), 'passkey'); return res.status(401).json({ error: 'Passkey nicht erkannt' }); }
  loginSucceeded(ip(req), u.username, 'Passkey');
  setCookie(req, res, auth.createSession(u.id, req.get('user-agent')));
  res.json({ user: auth.publicUser(u) });
}));

app.post('/api/logout', (req, res) => { if (req.token) auth.endSession(req.token); res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });

// ab hier nur angemeldet
app.use('/api', (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Bitte anmelden' });
  if (req.user.must_change && !['/me/password', '/session'].includes(req.path)) return res.status(403).json({ error: 'Bitte zuerst ein neues Passwort vergeben', mustChange: true });
  next();
});

// ------------------------------------------------------------ Konto & Sicherheit
const needPassword = (req) => { if (!auth.verifyPassword(String(req.body.password || ''), req.user.pw)) throw Object.assign(new Error('Passwort falsch'), { status: 403 }); };
app.post('/api/me/password', wrap(async (req, res) => {
  if (!req.user.must_change) needPassword(req);
  auth.setPassword(req.user.id, req.body.newPassword);
  auth.endAllSessions(req.user.id, req.token);
  securityLog('Passwort geändert', ip(req), req.user.username);
  res.json({ user: auth.publicUser(auth.getUser(req.user.id)) });
}));
app.post('/api/me/totp/start', wrap(async (req, res) => { needPassword(req); res.json(auth.startTotp(req.user.id)); }));
app.post('/api/me/totp/confirm', wrap(async (req, res) => {
  if (!auth.confirmTotp(req.user.id, req.body.code)) return res.status(400).json({ error: 'Code passt nicht – Uhrzeit am Handy prüfen und neuen Code eingeben' });
  securityLog('Zwei-Faktor eingeschaltet', ip(req), req.user.username);
  const codes = auth.publicUser(auth.getUser(req.user.id)).recoveryLeft ? null : auth.newRecoveryCodes(req.user.id);
  res.json({ user: auth.publicUser(auth.getUser(req.user.id)), codes });
}));
app.post('/api/me/totp/disable', wrap(async (req, res) => {
  needPassword(req); auth.disableTotp(req.user.id); securityLog('Zwei-Faktor ausgeschaltet', ip(req), req.user.username);
  res.json({ user: auth.publicUser(auth.getUser(req.user.id)) });
}));
app.post('/api/me/recovery', wrap(async (req, res) => { needPassword(req); securityLog('Neue Wiederherstellungscodes', ip(req), req.user.username); res.json({ codes: auth.newRecoveryCodes(req.user.id) }); }));
app.get('/api/me/security', (req, res) => res.json({ user: auth.publicUser(req.user), passkeys: pk.listPasskeys(req.user.id), sessions: auth.listSessions(req.user.id), log: securityEvents() }));
app.post('/api/me/logout-all', (req, res) => { auth.endAllSessions(req.user.id, req.token); securityLog('Alle anderen Geräte abgemeldet', ip(req), req.user.username); res.json({ ok: true }); });
app.post('/api/passkey/register/options', wrap(async (req, res) => res.json(await pk.registrationOptions(req, req.user))));
app.post('/api/passkey/register/verify', wrap(async (req, res) => {
  await pk.registrationVerify(req, req.user, req.body.response, req.body.name);
  securityLog('Passkey hinzugefügt', ip(req), req.user.username, String(req.body.name || ''));
  res.json({ passkeys: pk.listPasskeys(req.user.id) });
}));
app.delete('/api/me/passkeys/:id', (req, res) => { pk.removePasskey(req.user.id, req.params.id); securityLog('Passkey entfernt', ip(req), req.user.username); res.json({ passkeys: pk.listPasskeys(req.user.id) }); });

// ------------------------------------------------------------ Daten
app.get('/api/state', (req, res) => res.json({ ...clientState(), head: head(), today: localDay() }));

const CLIENT_KINDS = ['entry', 'addendum', 'retract', 'time', 'stamp', 'absence', 'absence-cancel', 'br', 'br-cancel', 'claim', 'case', 'case-close', 'case-reopen', 'settings', 'assessment', 'assessment-cancel'];
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const DATE_RE = /^\d{4}-\d\d-\d\d$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

/** Inhalt prüfen und bereinigen – der Server nimmt nur Erwartetes an. */
function validate(kind, ref, p) {
  const st = build();
  const str = (v, n = 4000) => (v == null ? '' : String(v).slice(0, n));
  const fileIds = (list) => (Array.isArray(list) ? list : []).map(String).filter((id) => {
    const r = getRow(id); if (!r || r.kind !== 'file') throw bad('Unbekannte Datei'); return true;
  }).slice(0, 60);
  switch (kind) {
    case 'entry': {
      if (!ID_RE.test(p.id || '')) throw bad('Kennung fehlt');
      if (!['incident', 'br'].includes(p.section)) throw bad('Bereich fehlt');
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(p.eventAt || '')) throw bad('Zeitpunkt des Geschehens fehlt');
      return {
        id: p.id, section: p.section, eventAt: p.eventAt, eventEnd: TIME_RE.test(p.eventEnd || '') ? p.eventEnd : '', title: str(p.title, 200), category: str(p.category, 80),
        location: str(p.location, 300), persons: str(p.persons, 1000), witnesses: str(p.witnesses, 1000), facts: str(p.facts, 20000), quotes: str(p.quotes, 8000),
        consequences: str(p.consequences, 4000), reaction: str(p.reaction, 4000), assessment: str(p.assessment, 8000), delayReason: str(p.delayReason, 1000),
        caseId: p.caseId && st.cases[p.caseId] ? p.caseId : '', fileIds: fileIds(p.fileIds), draftId: str(p.draftId, 64), draftCreatedAt: str(p.draftCreatedAt, 40),
        ...(p.ai?.evidenceId && getRow(String(p.ai.evidenceId))?.kind === 'assist' ? { ai: {
          evidenceId: String(p.ai.evidenceId), engine: str(p.ai.engine, 60), model: str(p.ai.model, 80),
          kept: (Array.isArray(p.ai.kept) ? p.ai.kept : []).map(String).slice(0, 20), edited: (Array.isArray(p.ai.edited) ? p.ai.edited : []).map(String).slice(0, 20),
        } } : {}),
      };
    }
    case 'addendum': case 'retract':
      if (!st.entries[ref]) throw bad('Eintrag nicht gefunden');
      return kind === 'addendum'
        ? { text: str(p.text, 20000), reason: str(p.reason, 500), fileIds: fileIds(p.fileIds) }
        : { reason: str(p.reason, 2000) };
    case 'time': {
      if (!DATE_RE.test(p.date || '')) throw bad('Datum fehlt');
      const segments = (Array.isArray(p.segments) ? p.segments : []).filter((s) => TIME_RE.test(s.start) && TIME_RE.test(s.end))
        .map((s) => ({ start: s.start, end: s.end, ...(s.note ? { note: str(s.note, 1000) } : {}), ...(s.by ? { by: str(s.by, 200) } : {}), ...(s.after ? { after: true } : {}) })).slice(0, 12);
      const breaks = (Array.isArray(p.breaks) ? p.breaks : []).filter((s) => TIME_RE.test(s.start) && TIME_RE.test(s.end)).map((s) => ({ start: s.start, end: s.end })).slice(0, 12);
      const o = p.overtime || {};
      return {
        date: p.date, segments, breaks, breakMinutes: Math.max(0, Math.min(600, Number(p.breakMinutes) || 0)), note: str(p.note, 2000), source: str(p.source, 20),
        location: str(p.location, 200), fileId: p.fileId ? fileIds([p.fileId])[0] : '', spoken: str(p.spoken, 4000),
        overtime: { reason: str(o.reason, 1000), orderedBy: str(o.orderedBy, 200), how: str(o.how, 40), witnesses: str(o.witnesses, 500), evidence: str(o.evidence, 500) },
      };
    }
    case 'stamp':
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(p.at || '') || !['in', 'out', 'break-start', 'break-end'].includes(p.type)) throw bad('Stempelung ungültig');
      return { at: p.at.slice(0, 16), type: p.type, note: str(p.note, 500), late: !!p.late };
    case 'absence':
      if (!ID_RE.test(p.id || '') || !DATE_RE.test(p.from || '') || (p.to && !DATE_RE.test(p.to))) throw bad('Abwesenheit unvollständig');
      return { id: p.id, type: str(p.type, 20), from: p.from, to: p.to && p.to >= p.from ? p.to : p.from, half: !!p.half && (!p.to || p.to === p.from), note: str(p.note, 1000), approvedBy: str(p.approvedBy, 200), approvedAt: DATE_RE.test(p.approvedAt || '') ? p.approvedAt : '', requestedAt: DATE_RE.test(p.requestedAt || '') ? p.requestedAt : '' };
    case 'absence-cancel': if (!st.absences[ref]) throw bad('Abwesenheit nicht gefunden'); return { reason: str(p.reason, 1000) };
    case 'br':
      if (!ID_RE.test(p.id || '') || !DATE_RE.test(p.date || '') || !TIME_RE.test(p.start || '') || !TIME_RE.test(p.end || '')) throw bad('BR-Tätigkeit unvollständig');
      return { id: p.id, date: p.date, start: p.start, end: p.end, outside: !!p.outside, topic: str(p.topic, 1000), place: str(p.place, 300), abmeldungTo: str(p.abmeldungTo, 200), abmeldungAt: TIME_RE.test(p.abmeldungAt || '') ? p.abmeldungAt : '', rueckmeldungAt: TIME_RE.test(p.rueckmeldungAt || '') ? p.rueckmeldungAt : '', reasonOutside: str(p.reasonOutside, 1000), note: str(p.note, 2000), paid: !!p.paid };
    case 'br-cancel': if (!st.br[ref]) throw bad('Eintrag nicht gefunden'); return { reason: str(p.reason, 1000) };
    case 'claim':
      if (!/^\d{4}-\d\d$/.test(p.month || '') || !DATE_RE.test(p.date || '')) throw bad('Geltendmachung unvollständig');
      return { month: p.month, date: p.date, how: str(p.how, 200), to: str(p.to, 200), note: str(p.note, 2000), minutes: Number(p.minutes) || 0 };
    case 'case':
      if (!ID_RE.test(p.id || '') || !str(p.title).trim()) throw bad('Titel fehlt');
      return { id: p.id, title: str(p.title, 200), description: str(p.description, 4000), category: str(p.category, 80) };
    case 'assessment': {
      // eigene Einschätzung zu Verstößen (z. B. „Vorgesetzter hat es billigend in Kauf genommen“) – als Aussage mit Begründung
      if (!ID_RE.test(p.id || '')) throw bad('Kennung fehlt');
      const dates = [...new Set((Array.isArray(p.dates) ? p.dates : []).filter((d) => DATE_RE.test(d)))].sort().slice(0, 4000);
      if (!dates.length) throw bad('Keine Tage ausgewählt');
      if (!str(p.basis).trim()) throw bad('Bitte begründen, woran man das erkennt');
      return {
        id: p.id, dates, codes: (Array.isArray(p.codes) ? p.codes : []).map((c) => str(c, 20)).slice(0, 20), scope: str(p.scope, 20),
        how: ['gebilligt', 'geduldet', 'angeordnet', 'notwendig', 'bekannt'].includes(p.how) ? p.how : 'gebilligt', person: str(p.person, 200),
        text: str(p.text, 4000), basis: str(p.basis, 4000), evidence: str(p.evidence, 2000),
      };
    }
    case 'assessment-cancel': if (!st.assessments?.[ref]) throw bad('Einschätzung nicht gefunden'); return { reason: str(p.reason, 1000) };
    case 'case-close': case 'case-reopen':
      if (!st.cases[ref]) throw bad('Vorgang nicht gefunden');
      return { date: DATE_RE.test(p.date || '') ? p.date : localDay(), note: str(p.note, 2000) };
    case 'settings': {
      const s = withDefaults(p);
      s.name = str(s.name, 120); s.employer = str(s.employer, 200); s.position = str(s.position, 200); s.workModel = str(s.workModel, 200);
      s.weekTarget = s.weekTarget.map((m) => Math.max(0, Math.min(1440, Number(m) || 0)));
      s.breakRules = s.breakRules.slice(0, 6).map((r) => ({ afterMin: Number(r.afterMin) || 0, breakMin: Number(r.breakMin) || 0 }));
      s.halfDays = s.halfDays.slice(0, 20).filter((h) => /^\d\d-\d\d$/.test(h.md)).map((h) => ({ md: h.md, name: str(h.name, 80), active: !!h.active, basis: str(h.basis, 300) }));
      s.extraHolidays = (s.extraHolidays || []).slice(0, 20).filter((h) => /^\d\d-\d\d$/.test(h.md)).map((h) => ({ md: h.md, name: str(h.name, 80) }));
      s.promptWords = str(s.promptWords, 600);
      return s;
    }
    default: throw bad('Unbekannte Art');
  }
}

app.post('/api/evidence', wrap(async (req, res) => {
  const { id, kind, ref = null, capturedAt = null } = req.body || {};
  if (!CLIENT_KINDS.includes(kind)) throw bad('Unbekannte Art');
  if (id && !ID_RE.test(String(id))) throw bad('Ungültige Kennung');
  if (JSON.stringify(req.body.payload || {}).length > 200000) throw bad('Eintrag zu groß');
  const existing = id && getRow(id);
  if (existing) return res.json({ row: existing, duplicate: true });
  const payload = validate(kind, ref, req.body.payload || {});
  const eventAt = kind === 'entry' ? payload.eventAt : kind === 'time' ? payload.date : kind === 'stamp' ? payload.at : kind === 'br' ? `${payload.date}T${payload.start}` : kind === 'absence' ? payload.from : kind === 'assessment' ? payload.dates[0] : null;
  const objId = ['entry', 'absence', 'br', 'case', 'assessment'].includes(kind) ? payload.id : id || crypto.randomUUID();
  if (['entry', 'absence', 'br', 'case', 'assessment'].includes(kind) && getRow(objId)) return res.json({ row: getRow(objId), duplicate: true });
  const { row } = append({ id: objId, kind, ref, eventAt, capturedAt: capturedAt ? String(capturedAt).slice(0, 40) : null, device: device(req), payload });
  if (kind === 'entry' && payload.draftId) db.prepare('DELETE FROM drafts WHERE id = ?').run(payload.draftId);
  if (kind === 'settings') tr.setPromptWords(payload.promptWords);
  res.json({ row });
}));

// ------------------------------------------------------------ Import alter Arbeitszeiten (CSV, z. B. aus ibuchron)
// Die CSV liegt vorher als Datei in der Beweiskette (purpose „import“); der Server liest genau diese Datei.
function importFile(fileId) {
  const f = fileInfo(String(fileId || ''));
  if (!f || f.erased || f.purpose !== 'import') throw bad('Importdatei nicht gefunden');
  const text = decodeCsv(fs.readFileSync(storedPath(f)));
  return { f, ...parseTimeCsv(text) };
}
app.post('/api/import/times', wrap(async (req, res) => {
  const { f, rows, errors } = importFile(req.body?.fileId);
  if (!rows.length) throw bad(errors[0] || 'Keine Tage in der Datei gefunden');
  const st = build();
  const plan = buildImport(rows, { times: st.times, absences: Object.values(st.absences), settings: withDefaults(st.settings), file: f.name, fileId: f.id });
  const dev = device(req);
  let times = 0, absences = 0;
  for (const t of plan.times) {
    const payload = { ...validate('time', null, t.payload), import: { fileId: f.id, file: f.name, line: t.payload.import.line } };
    if (getRow(t.id)) continue;
    append({ id: t.id, kind: 'time', eventAt: payload.date, device: dev, payload });
    times++;
  }
  for (const a of plan.absences) {
    const payload = { ...validate('absence', null, a.payload), import: { fileId: f.id, file: f.name, line: a.payload.import.line } };
    if (getRow(a.id)) continue;
    append({ id: a.id, kind: 'absence', eventAt: payload.from, device: dev, payload });
    absences++;
  }
  res.json({ times, absences, skipped: plan.skipped, errors });
}));
app.post('/api/import/notes/classify', wrap(async (req, res) => res.json(assist.classifyNotes(req.body?.items))));
app.get('/api/import/notes/classify', (req, res) => res.json(assist.noteJobStatus()));
app.post('/api/import/notes/drafts', wrap(async (req, res) => {
  const f = req.body?.fileId ? fileInfo(String(req.body.fileId)) : null;
  if (req.body?.fileId && (!f || f.purpose !== 'import')) throw bad('Importdatei nicht gefunden');
  const ids = assist.draftsFromNotes(req.body?.items, f ? { fileId: f.id, fileName: f.name, fileMeta: { purpose: 'import', mime: f.mime, size: f.size, name: f.name, sha256: f.sha256 } } : {});
  res.json({ ids });
}));

// ------------------------------------------------------------ Dateien
app.post('/api/files', wrap(async (req, res) => {
  const { row, duplicate } = await receiveUpload(req, device(req));
  const p = parsePayload(row);
  if (req.get('x-assist') === '1' && p?.draftId) {
    assist.draftForUpload(p.draftId, row.id, { purpose: p.purpose, mime: p.mime, size: p.size, capturedAt: row.captured_at, durationSec: p.durationSec, sha256: p.sha256 });
    if (tr.transcriptOf(row.id)) assist.onTranscript(row.id);
  }
  if (p?.purpose?.includes('audio')) tr.enqueue(row.id, { fast: p.purpose === 'time-audio', front: p.purpose === 'time-audio' });
  res.json({ row: { ...row, payload: undefined }, file: fileInfo(row.id), duplicate });
}));
app.get('/api/files/:id', (req, res) => {
  const f = fileInfo(req.params.id);
  if (!f || f.erased) return res.status(404).json({ error: 'Datei nicht vorhanden' });
  const inline = /^(image\/(jpeg|png|webp|gif)|audio\/|application\/pdf)/.test(f.mime);
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Content-Disposition', `${inline && req.query.download !== '1' ? 'inline' : 'attachment'}; filename="${path.basename(f.path)}"`);
  res.type(f.mime);
  res.sendFile(storedPath(f), { dotfiles: 'deny', acceptRanges: true, cacheControl: false, headers: { 'Cache-Control': 'private, max-age=86400' } });
});
app.get('/api/files/:id/transcript', (req, res) => res.json(tr.status(req.params.id)));
app.post('/api/files/:id/retry', (req, res) => { tr.retry(req.params.id); res.json(tr.status(req.params.id)); });
app.get('/api/transcribe/status', wrap(async (req, res) => res.json(await tr.serviceStatus())));
app.post('/api/transcribe/preload', (req, res) => { tr.preloadModels(); res.json({ ok: true }); });
app.put('/api/transcribe/config', wrap(async (req, res) => {
  tr.setConfig(req.body || {});
  tr.preloadModels(); // gewähltes Modell gleich herunterladen, falls es noch fehlt
  res.json(await tr.serviceStatus());
}));

// ------------------------------------------------------------ Entwürfe (änderbar, noch nicht festgeschrieben)
app.get('/api/drafts', (req, res) => res.json(db.prepare('SELECT * FROM drafts ORDER BY updated_at DESC').all().map((d) => ({ ...JSON.parse(d.data), id: d.id, updatedAt: d.updated_at }))));
app.get('/api/drafts/:id', (req, res) => {
  const d = assist.getDraft(req.params.id);
  if (!d) return res.status(404).json({ error: 'Entwurf nicht gefunden' });
  res.json(d);
});
app.put('/api/drafts/:id', (req, res) => {
  if (!ID_RE.test(req.params.id)) throw bad('Ungültige Kennung');
  if (getRow(req.body?.entryId || '-')) { db.prepare('DELETE FROM drafts WHERE id = ?').run(req.params.id); return res.json({ finalized: true }); }
  // KI-Ergebnisse, die der Server inzwischen eingetragen hat, nicht mit einem älteren Stand vom Handy überschreiben
  const server = assist.getDraft(req.params.id);
  const merged = server ? mergeAssist({ ...(req.body || {}) }, server) : (req.body || {});
  const data = JSON.stringify(merged);
  if (data.length > 200000) throw bad('Entwurf zu groß');
  const now = new Date().toISOString();
  const old = db.prepare('SELECT updated_at FROM drafts WHERE id = ?').get(req.params.id);
  if (old && req.body.updatedAt && old.updated_at > req.body.updatedAt && req.query.force !== '1') return res.status(409).json({ error: 'Neuerer Stand vorhanden' });
  db.prepare('INSERT INTO drafts (id, data, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .run(req.params.id, data, now, req.body.updatedAt || now);
  res.json({ ok: true });
});
app.delete('/api/drafts/:id', (req, res) => { db.prepare('DELETE FROM drafts WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

// ------------------------------------------------------------ KI-Ausfüllhilfe
app.get('/api/assist/status', (req, res) => res.json(assist.status()));
app.put('/api/assist/config', (req, res) => res.json(assist.setConfig(req.body || {})));
app.post('/api/assist/test', wrap(async (req, res) => {
  try { res.json(await assist.testConnection()); } catch (e) { res.json({ ok: false, error: e.message }); }
}));
app.post('/api/assist/pull', wrap(async (req, res) => res.json(await assist.pullModel())));
// Bemerkung zu einer Arbeitszeit (z. B. Anruf nach Arbeitsende) als Logbuch-Entwurf
app.post('/api/drafts/from-time', wrap(async (req, res) => {
  const b = req.body || {};
  if (!DATE_RE.test(b.date || '') || !String(b.text || '').trim()) throw bad('Datum oder Text fehlt');
  const id = assist.draftFromTimeNote({ date: b.date, start: TIME_RE.test(b.start || '') ? b.start : '', end: TIME_RE.test(b.end || '') ? b.end : '', text: String(b.text).slice(0, 4000), by: String(b.by || '').slice(0, 200) }, localDay());
  res.json({ id });
}));
app.post('/api/assist/draft/:id', (req, res) => {
  const d = assist.getDraft(req.params.id);
  if (!d) return res.status(404).json({ error: 'Entwurf noch nicht beim Server – kurz warten' });
  if (assist.config().engine === 'off') return res.status(400).json({ error: 'KI-Ausfüllhilfe ist aus (Einstellungen)' });
  d.assistWanted = true;
  d.assist = { ...(d.assist || {}), status: 'queued', error: '', updatedAt: new Date().toISOString() };
  assist.putDraft(d);
  assist.enqueue(d.id);
  res.json(d);
});

// ------------------------------------------------------------ Prüfung, Zeitstempel, Export, Sicherung
app.get('/api/verify', (req, res) => res.json(req.query.run === '1' ? fullCheck() : kvGet('lastCheck') || fullCheck()));
app.get('/api/anchors', (req, res) => res.json(listAnchors(500)));
app.post('/api/anchors/now', wrap(async (req, res) => res.json(await anchorNow(localDay()))));
app.get('/api/anchors/file/:name', (req, res) => {
  const f = anchorFile(req.params.name);
  if (!f) return res.status(404).end();
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(f)}"`);
  res.sendFile(f);
});
app.get('/api/export', wrap(async (req, res) => {
  const parts = String(req.query.parts || 'log,time,absence,br').split(',').filter((p) => ['log', 'time', 'absence', 'br'].includes(p));
  securityLog('Export', ip(req), req.user.username, `${req.query.from || ''}–${req.query.to || ''} ${req.query.case || ''}`);
  await writeExport(res, { from: String(req.query.from || ''), to: String(req.query.to || ''), parts, caseId: String(req.query.case || '') });
}));
app.post('/api/backup/now', wrap(async (req, res) => res.json(backupNow())));
app.get('/api/status', wrap(async (req, res) => res.json({
  version: VERSION, head: head(), lastCheck: kvGet('lastCheck'), lastBackup: kvGet('lastBackup'), lastAnchorRun: kvGet('lastAnchorRun'),
  lastMailError: kvGet('lastMailError'), whisper: await tr.serviceStatus(), smtp: smtpPublic(), dataDir: process.env.DATA_DIR || './data',
})));
app.put('/api/smtp', (req, res) => { setSmtp(req.body || {}); res.json(smtpPublic()); });
app.post('/api/smtp/test', wrap(async (req, res) => {
  await sendMail(String(req.body.to || ''), 'MLZ-Protokoll – Testmail', 'Der Mailversand funktioniert.');
  res.json({ ok: true });
}));

// ------------------------------------------------------------ Löschen nach Ablauf der Aufbewahrungsfrist
function erasableCase(st, c, today) {
  if (!c?.closed) return false;
  const years = Number(st.settings.retentionYears) || 5;
  const until = `${Number(c.closed.date.slice(0, 4)) + years}${c.closed.date.slice(4)}`;
  return { ok: until <= today, until };
}
app.post('/api/erase', wrap(async (req, res) => {
  needPassword(req);
  const st = build();
  const today = localDay();
  const c = st.cases[String(req.body.caseId || '')];
  const chk = erasableCase(st, c, today);
  if (!chk || !chk.ok) throw bad(chk ? `Aufbewahrungsfrist läuft bis ${chk.until}` : 'Vorgang ist nicht abgeschlossen');
  const reason = `Aufbewahrungsfrist (${st.settings.retentionYears} Jahre nach Abschluss) abgelaufen – Vorgang „${c.title}“`;
  let n = 0;
  for (const e of Object.values(st.entries).filter((x) => x.caseId === c.id && !x.erased)) {
    const fids = [...(e.fileIds || []), ...e.addenda.flatMap((a) => a.fileIds || [])];
    for (const fid of fids) {
      const f = st.files[fid];
      if (f && !f.erased) { removeStored(f); erasePayload(fid, reason, device(req)); n++; }
      const t = st.transcripts[fid];
      if (t) { erasePayload(t.evidenceId, reason, device(req)); n++; }
    }
    for (const a of e.addenda) if (!a.erased) { erasePayload(a.evidenceId, reason, device(req)); n++; }
    if (e.retracted) erasePayload(e.retracted.evidenceId, reason, device(req));
    erasePayload(e.evidenceId, reason, device(req)); n++;
  }
  securityLog('Inhalte gelöscht', ip(req), req.user.username, reason);
  invalidate();
  res.json({ erased: n });
}));

// ------------------------------------------------------------ Fehler & Oberfläche
app.use('/api', (req, res) => res.status(404).json({ error: 'Unbekannte Adresse' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  if (res.headersSent) { res.destroy(); return; }
  res.status(status).json({ error: status >= 500 ? 'Interner Fehler' : err.message });
});

if (fs.existsSync(DIST)) {
  app.use('/assets', express.static(path.join(DIST, 'assets'), { immutable: true, maxAge: '1y', index: false }));
  app.use(express.static(DIST, { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
  app.get(/^\/(?!api\/).*/, (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(DIST, 'index.html')); });
}

app.listen(PORT, () => {
  console.log(`MLZ-Protokoll ${VERSION} läuft auf Port ${PORT} (Daten: ${process.env.DATA_DIR || './data'})`);
  tr.resumePending();
  startScheduler();
  if (process.env.WHISPER_PRELOAD !== 'off') setTimeout(() => tr.preloadModels(), 15000).unref();
});
