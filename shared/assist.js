// KI-Ausfüllhilfe – gemeinsamer Teil für Server und Browser:
// Antwortformat (JSON-Schema), Anweisung an die KI und das Zusammenführen von KI-Vorschlägen mit eigenen Änderungen.

/** Felder eines Logbuch-Entwurfs, die die KI ausfüllen darf. */
export const ENTRY_FIELDS = ['title', 'category', 'eventAt', 'eventEnd', 'location', 'persons', 'witnesses', 'facts', 'quotes', 'consequences', 'reaction', 'assessment'];
export const KINDS = { incident: 'Auffälligkeit', br: 'Betriebsrat', time: 'Arbeitszeit', absence: 'Urlaub / Abwesenheit', brtime: 'BR-Zeit' };
export const ABSENCE_KEYS = ['urlaub', 'krank', 'kindkrank', 'schulung', 'brcomp', 'sonder', 'abbau', 'unbezahlt'];

const str = { type: 'string' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

/** Antwortformat – alle Felder Pflicht (leer = unbekannt), damit auch kleine lokale Modelle zuverlässig antworten. */
export const SCHEMA = obj({
  kind: { type: 'string', enum: Object.keys(KINDS) },
  title: str, category: str, eventDate: str, eventTime: str, eventEnd: str, location: str,
  persons: str, witnesses: str, facts: str, quotes: str, consequences: str, reaction: str, assessment: str,
  time: obj({ date: str, start: str, end: str, breakMinutes: { type: 'integer' }, orderedBy: str, how: str, reason: str }),
  absence: obj({ type: { type: 'string', enum: [...ABSENCE_KEYS, ''] }, from: str, to: str, half: { type: 'boolean' }, approvedBy: str }),
  brtime: obj({ date: str, start: str, end: str, outside: { type: 'boolean' }, topic: str, place: str, abmeldungTo: str }),
  missing: { type: 'array', items: str },
});

const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/** Anweisung an die KI. Bewusst streng: nichts erfinden, Tatsachen und Bewertung trennen. */
export function systemPrompt(categories) {
  return [
    'Du hilfst einem Arbeitnehmer, der auch Betriebsratsmitglied ist, gesprochene Notizen in ein Protokoll zu übertragen.',
    'Das Protokoll kann später vor dem Arbeitsgericht verwendet werden. Darum gilt streng:',
    '- Erfinde nichts. Übernimm nur, was gesagt wurde. Unbekanntes bleibt ein leerer Text "".',
    '- Fülle ALLE Felder aus, zu denen etwas gesagt wurde – nicht nur "facts". Ort, Personen, Zeugen, Zitate, Folgen, Reaktion und Bewertung',
    '  stehen oft beiläufig im Text („in der Halle“, „vor dem Kollegen X“, „ich hab gesagt …“, „das fand ich unmöglich“).',
    '- Mehrere Aufnahmen: Spätere Aufnahmen ergänzen oder KORRIGIEREN frühere. Bei Widerspruch gilt immer die spätere Aussage',
    '  (z. B. „Korrektur: …“, „nein, es war …“, „ich hab mich vertan …“). Übernimm in alle Felder nur die korrigierte Fassung.',
    '- "facts": nur Tatsachen in sachlicher Ich-Form und zeitlicher Reihenfolge, nah am Gesagten, ohne Bewertungen und ohne Füllwörter.',
    '- "quotes": nur wörtliche Rede, die als wörtlich erkennbar ist, je Zeile im Format Name: „Zitat“.',
    '- "assessment": nur Gefühle, Meinungen und Bewertungen des Sprechers (z. B. „ich fand das schikanös“).',
    '- "persons": Beteiligte mit Funktion, wenn genannt. "witnesses": nur Personen, die dabei waren oder es mitbekommen haben.',
    '- "reaction": was der Sprecher selbst gesagt/getan oder wem er es gemeldet hat. "consequences": Folgen für Arbeit, Zeit, Gesundheit.',
    '- "title": kurzer sachlicher Titel (max. 8 Wörter). "category": eine passende Art aus der Liste, sonst "".',
    '- Datum und Uhrzeiten aus relativen Angaben ("heute", "gestern", "vorhin um zehn", "halb acht" = 07:30) berechnen; Format JJJJ-MM-TT und HH:MM.',
    '- "kind": incident = Auffälligkeit/Vorfall im Beruf; br = Betriebsratsangelegenheit (Behinderung, Mitbestimmung, Gespräch als BR);',
    '  time = es geht nur um die eigene Arbeitszeit (Beginn, Ende, Pause, Überstunden); absence = Urlaub, Krankheit, freier Tag;',
    '  brtime = nur Zeiten eigener BR-Tätigkeit (Sitzung, Abmeldung). Bei Mischformen den Hauptinhalt wählen.',
    '- Nur das Objekt zur gewählten Art ausfüllen ("time", "absence" oder "brtime"); die anderen mit leeren Werten (Zahl 0, false).',
    '- "time.how": angeordnet | gebilligt | geduldet | notwendig oder "". "time.breakMinutes": Pause in Minuten, 0 wenn nicht genannt.',
    '- "missing": höchstens 4 kurze Fragen nach wichtigen fehlenden Angaben (z. B. „Wer war dabei?“, „Um wie viel Uhr?“). Keine Fragen nach Unwichtigem.',
    `Arten für Auffälligkeiten: ${categories.incident.join('; ')}.`,
    `Arten für Betriebsrat: ${categories.br.join('; ')}.`,
  ].join('\n');
}

/** Mehrere Aufnahmen eines Entwurfs als ein Text – nummeriert, damit die KI Korrekturen erkennt. */
export function combineSpoken(texts) {
  const list = texts.map((t) => String(t || '').trim()).filter((t) => t && t !== '(keine Sprache erkannt)');
  if (list.length <= 1) return list[0] || '';
  return list.map((t, i) => (i === 0 ? `Aufnahme 1:\n${t}` : `Aufnahme ${i + 1} (später gesprochen – Ergänzung oder Korrektur):\n${t}`)).join('\n\n');
}

export function userPrompt(text, now, extra = '') {
  const d = new Date(`${now.slice(0, 10)}T12:00:00`);
  return [
    `Heute ist ${WD[d.getDay()]}, der ${now.slice(0, 10)}, aktuelle Uhrzeit ${now.slice(11, 16)}.`,
    extra,
    'Gesprochene Notiz (automatisch erkannt, kann Hörfehler enthalten; bei mehreren Aufnahmen gilt die spätere):',
    '"""',
    String(text || '').trim(),
    '"""',
  ].filter(Boolean).join('\n');
}

const DATE = /^\d{4}-\d\d-\d\d$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const clean = (v, n = 4000) => String(v ?? '').trim().slice(0, n);
const okTime = (t) => (TIME.test(String(t || '').padStart(5, '0')) ? String(t).padStart(5, '0') : '');

/** KI-Antwort prüfen und in Entwurfsfelder umsetzen. */
export function normalize(r, now) {
  const kind = KINDS[r?.kind] ? r.kind : 'incident';
  const date = DATE.test(r?.eventDate || '') ? r.eventDate : '';
  const time = okTime(r?.eventTime);
  const fields = {
    title: clean(r?.title, 200), category: clean(r?.category, 80),
    eventAt: date || time ? `${date || now.slice(0, 10)}T${time || now.slice(11, 16)}` : '',
    eventEnd: okTime(r?.eventEnd), location: clean(r?.location, 300), persons: clean(r?.persons, 1000), witnesses: clean(r?.witnesses, 1000),
    facts: clean(r?.facts, 20000), quotes: clean(r?.quotes, 8000), consequences: clean(r?.consequences), reaction: clean(r?.reaction), assessment: clean(r?.assessment, 8000),
  };
  const t = r?.time || {};
  const a = r?.absence || {};
  const b = r?.brtime || {};
  return {
    kind,
    fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v)),
    time: { date: DATE.test(t.date || '') ? t.date : now.slice(0, 10), start: okTime(t.start), end: okTime(t.end), breakMinutes: Math.max(0, Math.min(600, Number(t.breakMinutes) || 0)), orderedBy: clean(t.orderedBy, 200), how: ['angeordnet', 'gebilligt', 'geduldet', 'notwendig'].includes(t.how) ? t.how : '', reason: clean(t.reason, 1000) },
    absence: { type: ABSENCE_KEYS.includes(a.type) ? a.type : 'urlaub', from: DATE.test(a.from || '') ? a.from : '', to: DATE.test(a.to || '') ? a.to : '', half: !!a.half, approvedBy: clean(a.approvedBy, 200) },
    brtime: { date: DATE.test(b.date || '') ? b.date : now.slice(0, 10), start: okTime(b.start), end: okTime(b.end), outside: !!b.outside, topic: clean(b.topic, 1000), place: clean(b.place, 300), abmeldungTo: clean(b.abmeldungTo, 200) },
    missing: (Array.isArray(r?.missing) ? r.missing : []).map((q) => clean(q, 200)).filter(Boolean).slice(0, 4),
  };
}

/**
 * Neueren KI-Stand (theirs, z. B. vom Server) mit dem eigenen Entwurf (mine) zusammenführen.
 * Ein Feld übernimmt den KI-Wert nur, wenn es leer ist oder noch den vorigen KI-Wert enthält –
 * eigene Änderungen werden nie überschrieben.
 */
export function mergeAssist(mine, theirs) {
  if (!theirs) return mine;
  const out = { ...mine };
  out.fileIds = [...new Set([...(mine.fileIds || []), ...(theirs.fileIds || [])])];
  out.files = { ...(theirs.files || {}), ...(mine.files || {}) };
  const newer = (theirs.assist?.updatedAt || '') > (mine.assist?.updatedAt || '');
  if (!newer) return out;
  out.assist = theirs.assist;
  out.suggestion = theirs.suggestion || null;
  if (theirs.section && !mine.sectionChosen) out.section = theirs.section; // Bereich nur, solange ihn niemand selbst gewählt hat
  const prevAi = mine.aiFields || {};
  for (const [f, v] of Object.entries(theirs.aiFields || {})) {
    const cur = mine[f];
    if (!cur || cur === prevAi[f] || (f === 'eventAt' && mine.eventAtAuto)) out[f] = v;
  }
  if (out.eventAt !== mine.eventAt) out.eventAtAuto = false;
  out.aiFields = theirs.aiFields || {};
  return out;
}

/** Welche Felder des fertigen Eintrags von der KI stammen (unverändert) bzw. von ihr vorgeschlagen und geändert wurden. */
export function aiSummary(d) {
  const ai = d.aiFields || {};
  const kept = [], edited = [];
  for (const f of Object.keys(ai)) (d[f] === ai[f] ? kept : edited).push(f);
  return { kept, edited };
}
