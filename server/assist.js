// KI-Ausfüllhilfe: aus dem gesprochenen Text einen ausgefüllten Entwurf machen.
// Standard: lokal über Ollama (nichts verlässt den Server). Optional: Claude (Anthropic) – nur nach ausdrücklichem Einschalten.
// Der Vorschlag der KI wird als eigener Eintrag „assist“ in die Beweiskette geschrieben; festgeschrieben wird erst nach Prüfung.
import Anthropic from '@anthropic-ai/sdk';
import { db, kvGet, kvSet } from './db.js';
import { append, getRow, parsePayload } from './evidence.js';
import { transcriptOf } from './transcribe.js';
import { CATEGORIES } from '../shared/categories.js';
import { ENTRY_FIELDS, SCHEMA, combineSpoken, extractWhen, normalize, systemPrompt, userPrompt } from '../shared/assist.js';
import { parseWorkTime } from '../shared/timeparse.js';

const CLAUDE_MODEL = 'claude-opus-5-5';
const localNow = () => new Date().toLocaleString('sv-SE', { timeZone: process.env.TZ || 'Europe/Berlin' }).replace(' ', 'T').slice(0, 16);

// ------------------------------------------------------------ Einstellungen (nicht in der Beweiskette – enthält ggf. den Schlüssel)
export function config() {
  return { engine: 'off', ollamaUrl: process.env.OLLAMA_URL || '', ollamaModel: 'qwen2.5:7b-instruct', claudeKey: '', ...kvGet('assist', {}) };
}
export function publicConfig() {
  const c = config();
  return { engine: c.engine, ollamaUrl: c.ollamaUrl, ollamaModel: c.ollamaModel, claudeModel: CLAUDE_MODEL, hasClaudeKey: !!c.claudeKey };
}
export function setConfig(b) {
  const c = config();
  const url = String(b.ollamaUrl ?? c.ollamaUrl).trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\/[\w.-]+(:\d+)?$/.test(url)) throw Object.assign(new Error('Ollama-Adresse z. B. http://192.168.1.10:11434'), { status: 400 });
  kvSet('assist', {
    engine: ['off', 'ollama', 'claude'].includes(b.engine) ? b.engine : c.engine,
    ollamaUrl: url,
    ollamaModel: String(b.ollamaModel ?? c.ollamaModel).trim().slice(0, 80) || 'qwen2.5:7b-instruct',
    claudeKey: b.removeKey ? '' : b.claudeKey ? String(b.claudeKey).trim() : c.claudeKey,
  });
  return publicConfig();
}

// ------------------------------------------------------------ Ollama
async function ollama(path, body, timeoutMs = 20 * 60000) {
  const c = config();
  if (!c.ollamaUrl) throw new Error('Ollama-Adresse fehlt (Einstellungen → KI-Ausfüllhilfe)');
  let r;
  try {
    r = await fetch(`${c.ollamaUrl}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? 'Ollama antwortet nicht (Zeitüberschreitung)' : `Ollama nicht erreichbar (${c.ollamaUrl})`);
  }
  return r;
}

let pull = null; // { model, status, completed, total, error }
export async function pullModel() {
  const c = config();
  if (pull && !pull.error && !pull.done) return pull;
  pull = { model: c.ollamaModel, status: 'startet', completed: 0, total: 0, error: '', done: false };
  (async () => {
    try {
      const r = await ollama('/api/pull', { model: c.ollamaModel, stream: true }, 6 * 3600000);
      if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
      let buf = '';
      for await (const chunk of r.body) {
        buf += Buffer.from(chunk).toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          const j = JSON.parse(line);
          if (j.error) throw new Error(j.error);
          pull.status = j.status || pull.status;
          if (j.total) { pull.total = j.total; pull.completed = j.completed || 0; }
        }
      }
      pull.done = true; pull.status = 'fertig';
    } catch (e) { pull.error = e.message; }
  })();
  return pull;
}

async function runOllama(text, now) {
  const c = config();
  const r = await ollama('/api/chat', {
    model: c.ollamaModel, stream: false, format: SCHEMA,
    options: { temperature: 0, num_ctx: 8192 },
    messages: [{ role: 'system', content: systemPrompt(CATEGORIES) }, { role: 'user', content: userPrompt(text, now) }],
  });
  const body = await r.text();
  if (r.status === 404 && /not found/i.test(body)) { pullModel(); throw new Error(`Modell ${c.ollamaModel} fehlt in Ollama – wird jetzt geladen, danach „Erneut“`); }
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${body.slice(0, 200)}`);
  const j = JSON.parse(body);
  return { result: JSON.parse(j.message?.content || '{}'), model: c.ollamaModel, engine: 'Ollama (lokal)' };
}

// ------------------------------------------------------------ Claude (optional)
async function runClaude(text, now) {
  const c = config();
  if (!c.claudeKey) throw new Error('Claude-Schlüssel fehlt (Einstellungen → KI-Ausfüllhilfe)');
  const client = new Anthropic({ apiKey: c.claudeKey, baseURL: process.env.CLAUDE_BASE_URL || undefined, timeout: 5 * 60000 });
  let res;
  try {
    res = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: systemPrompt(CATEGORIES),
      messages: [{ role: 'user', content: userPrompt(text, now) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Claude-Schlüssel ungültig');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Claude ist gerade ausgelastet – später „Erneut“');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude-Fehler ${e.status ?? ''}: ${e.message}`.slice(0, 300));
    throw new Error(`Claude nicht erreichbar: ${e.message}`);
  }
  if (res.stop_reason === 'refusal') throw new Error('Claude hat die Bearbeitung abgelehnt – bitte von Hand ausfüllen');
  const block = res.content.find((b) => b.type === 'text');
  if (!block) throw new Error('Claude hat keine Antwort geliefert');
  return { result: JSON.parse(block.text), model: res.model || CLAUDE_MODEL, engine: 'Claude (Anthropic)' };
}

export async function testConnection() {
  const c = config();
  if (c.engine === 'ollama') {
    const r = await ollama('/api/tags', null, 8000);
    if (!r.ok) throw new Error(`Ollama ${r.status}`);
    const models = ((await r.json()).models || []).map((m) => m.name);
    return { ok: true, models, hasModel: models.some((m) => m === c.ollamaModel || m.startsWith(`${c.ollamaModel}:`) || `${m}`.split(':')[0] === c.ollamaModel) };
  }
  if (c.engine === 'claude') { await runClaude('Heute um 8 Uhr angefangen.', localNow()); return { ok: true }; }
  return { ok: false, error: 'KI-Ausfüllhilfe ist aus' };
}

// ------------------------------------------------------------ Entwürfe
export const getDraft = (id) => { const r = db.prepare('SELECT * FROM drafts WHERE id = ?').get(id); return r ? { ...JSON.parse(r.data), id: r.id, updatedAt: r.updated_at } : null; };
export function putDraft(d) {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO drafts (id, data, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .run(d.id, JSON.stringify(d), d.createdAt || now, now);
}
function setStatus(id, assist) {
  const d = getDraft(id);
  if (!d) return null;
  d.assist = { ...(d.assist || {}), ...assist, updatedAt: new Date().toISOString() };
  putDraft(d);
  return d;
}

/** Beim Hochladen einer Aufnahme über „Sprechen“: Entwurf anlegen bzw. die Aufnahme ergänzen. */
export function draftForUpload(draftId, fileId, meta) {
  if (!draftId) return;
  let d = getDraft(draftId);
  if (!d) d = { id: draftId, entryId: crypto.randomUUID(), section: 'incident', createdAt: new Date().toISOString(), eventAt: localNow(), eventAtAuto: true, eventEnd: '', title: '', category: '', location: '', persons: '', witnesses: '', facts: '', quotes: '', consequences: '', reaction: '', assessment: '', delayReason: '', caseId: '', fileIds: [], files: {}, applied: [] };
  if (!d.fileIds.includes(fileId)) d.fileIds.push(fileId);
  d.files = { ...(d.files || {}), [fileId]: meta };
  d.assistWanted = true;
  d.assist = { ...(d.assist || {}), status: 'transcribing', updatedAt: new Date().toISOString() };
  putDraft(d);
}

// ------------------------------------------------------------ Warteschlange
const queue = [];
let busy = false;
export function enqueue(draftId) {
  if (!queue.includes(draftId)) queue.push(draftId);
  setImmediate(work);
}

/** Nach jedem Transkript: gehört die Aufnahme zu einem Entwurf, der ausgefüllt werden soll? */
export function onTranscript(fileId) {
  const off = config().engine === 'off';
  for (const r of db.prepare('SELECT id, data FROM drafts').all()) {
    const d = JSON.parse(r.data);
    if (!d.assistWanted || !(d.fileIds || []).includes(fileId)) continue;
    if (off) setStatus(r.id, { status: 'off' }); // ohne KI: Browser übernimmt den Text wie bisher
    else enqueue(r.id);
  }
}

async function work() {
  if (busy) return;
  const id = queue.shift();
  if (!id) return;
  busy = true;
  try { await runFor(id); } catch (e) { setStatus(id, { status: 'error', error: e.message }); } finally { busy = false; setImmediate(work); }
}

async function runFor(id) {
  const d = getDraft(id);
  if (!d) return;
  const c = config();
  if (c.engine === 'off') { setStatus(id, { status: 'off' }); return; }
  // alle Aufnahmen des Entwurfs müssen erkannt sein
  const audio = (d.fileIds || []).filter((f) => { const r = getRow(f); return r && r.kind === 'file' && parsePayload(r)?.purpose?.includes('audio'); });
  const texts = audio.map((f) => transcriptOf(f)?.text);
  if (texts.some((t) => t == null)) { setStatus(id, { status: 'transcribing' }); return; }
  const spoken = combineSpoken(texts);
  if (!spoken.trim()) { setStatus(id, { status: 'error', error: 'Keine Sprache erkannt – bitte nochmal sprechen' }); return; }
  setStatus(id, { status: 'running', engine: c.engine, startedAt: new Date().toISOString() });
  const now = localNow();
  const t0 = Date.now();
  const out = c.engine === 'claude' ? await runClaude(spoken, now) : await runOllama(spoken, now);
  const n = normalize(out.result, now);
  // Zeitpunkt nicht erkannt? Feste Regeln (letzte Aufnahme mit Zeitangabe gewinnt)
  if ((n.kind === 'incident' || n.kind === 'br') && !n.fields.eventAt) {
    let w = null;
    for (const t of texts.filter(Boolean)) { const x = extractWhen(t, now.slice(0, 10)); if (x.time || x.date) w = x; }
    if (w) { n.fields.eventAt = `${w.date || now.slice(0, 10)}T${w.time || now.slice(11, 16)}`; if (w.end && !n.fields.eventEnd) n.fields.eventEnd = w.end; }
  }
  // Arbeitszeit: feste Regeln für Uhrzeiten sind zuverlässiger als die KI
  // Mehrere Aufnahmen der Reihe nach auswerten: eine spätere Angabe (Korrektur) ersetzt die frühere.
  if (n.kind === 'time') {
    for (const t of texts.filter((x) => x && x !== '(keine Sprache erkannt)')) {
      const p = parseWorkTime(t, now.slice(0, 10));
      if (p.start) n.time.start = p.start;
      if (p.end) n.time.end = p.end;
      if (p.breakMinutes != null) n.time.breakMinutes = p.breakMinutes;
      if (p.dateGiven) n.time.date = p.date;
      if (p.orderedBy) n.time.orderedBy = p.orderedBy;
    }
  }
  const seconds = Math.round((Date.now() - t0) / 1000);
  const { row } = append({ kind: 'assist', ref: id, device: 'Server', payload: { draftId: id, fileIds: audio, engine: out.engine, model: out.model, seconds, kind: n.kind, result: n } });
  // Ergebnis in den Entwurf (nur Felder, die noch leer sind oder noch vom vorigen KI-Vorschlag stammen)
  const cur = getDraft(id);
  if (!cur) return;
  const prev = cur.aiFields || {};
  const aiFields = n.kind === 'incident' || n.kind === 'br' ? n.fields : {};
  for (const [f, v] of Object.entries(aiFields)) {
    if (!ENTRY_FIELDS.includes(f)) continue;
    if (!cur[f] || cur[f] === prev[f] || (f === 'eventAt' && cur.eventAtAuto)) cur[f] = v;
  }
  if ((n.kind === 'incident' || n.kind === 'br') && !cur.sectionChosen) cur.section = n.kind;
  cur.aiFields = aiFields;
  cur.suggestion = { kind: n.kind, time: n.time, absence: n.absence, brtime: n.brtime, spoken };
  cur.assist = { status: 'done', engine: out.engine, model: out.model, kind: n.kind, missing: n.missing, evidenceId: row.id, seconds, updatedAt: new Date().toISOString() };
  putDraft(cur);
}

export const status = () => ({ ...publicConfig(), queue: queue.length, busy, pull: pull && { ...pull } });
