// Export für Anwalt / Gericht: ZIP mit PDF-Bericht, Originaldaten, Originaldateien, Zeitstempeln,
// Prüfsummenliste und Prüfskripten. Alles lässt sich ohne dieses Programm nachprüfen.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { ANCHOR_DIR } from './db.js';
import { allRows, head, verifyChain } from './evidence.js';
import { storedPath } from './files.js';
import { anchorFor, caFor, listAnchors } from './anchors.js';
import { activeAbsences, activeBr, build, workDays } from './state.js';
import { STATES, addDays, parseYmd, weekday } from '../shared/holidays.js';
import { ABSENCE_TYPES, brAccount, claimDeadlines, fmtDur, monthBounds, range, trackingStart, vacationAccount } from '../shared/worktime.js';

const localToday = () => new Date().toLocaleString('sv-SE', { timeZone: process.env.TZ || 'Europe/Berlin' }).slice(0, 10);

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const de = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');
const deTime = (iso) => {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('de-DE', { timeZone: process.env.TZ || 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'medium' });
};
const deLocal = (s) => (s ? `${de(s.slice(0, 10))}${s.length > 10 ? ` ${s.slice(11, 16)}` : ''}` : '–');

// Standardschriften des PDF kennen nur Windows-1252 → Zeichen ersetzen, die dort fehlen
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const pdfText = (s) => String(s ?? '').replace(/[−‐‑]/g, '-').replace(/[≥]/g, '>=').replace(/[≤]/g, '<=').replace(/[→]/g, '->').replace(/§/g, '§')
  .replace(/[^\n\t\x20-\x7e\xa0-\xff]/g, (c) => (CP1252_EXTRA.includes(c) ? c : '?'));

export const SECTION_LABEL = { incident: 'Auffälligkeit / Vorfall', br: 'Betriebsrat' };

/** Auswahl bestimmen. */
function select({ from, to, parts, caseId }) {
  const st = build();
  const rows = allRows();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const chosen = new Set();
  const inRange = (d) => d && d >= from && d <= to;
  const entries = Object.values(st.entries).filter((e) => !e.erased && (caseId ? e.caseId === caseId : parts.includes('log') && inRange(String(e.eventAt || '').slice(0, 10))))
    .sort((a, b) => String(a.eventAt).localeCompare(String(b.eventAt)));
  for (const e of entries) {
    chosen.add(e.evidenceId);
    for (const fid of e.fileIds || []) { chosen.add(fid); if (st.transcripts[fid]) chosen.add(st.transcripts[fid].evidenceId); }
    for (const a of e.addenda) { chosen.add(a.evidenceId); for (const fid of a.fileIds || []) { chosen.add(fid); if (st.transcripts[fid]) chosen.add(st.transcripts[fid].evidenceId); } }
    if (e.retracted) chosen.add(e.retracted.evidenceId);
  }
  const times = [];
  if (parts.includes('time') && !caseId) {
    for (const r of rows) {
      if (r.kind === 'time' && r.payload && inRange(JSON.parse(r.payload).date)) { chosen.add(r.id); const p = JSON.parse(r.payload); if (p.fileId) { chosen.add(p.fileId); if (st.transcripts[p.fileId]) chosen.add(st.transcripts[p.fileId].evidenceId); } }
      if (r.kind === 'stamp' && r.payload && inRange(JSON.parse(r.payload).at.slice(0, 10))) chosen.add(r.id);
      if (r.kind === 'claim' && r.payload) chosen.add(r.id);
      if (r.kind === 'settings' && r.payload) chosen.add(r.id);
    }
    times.push(true);
  }
  const absences = parts.includes('absence') && !caseId ? activeAbsences(st).filter((a) => a.to >= from && a.from <= to) : [];
  for (const a of Object.values(st.absences)) if (absences.some((x) => x.id === a.id) || (a.cancelled && parts.includes('absence') && a.to >= from && a.from <= to)) { chosen.add(a.evidenceId); if (a.cancelled) chosen.add(a.cancelled.evidenceId); }
  const br = parts.includes('br') && !caseId ? activeBr(st).filter((b) => inRange(b.date)) : [];
  for (const b of br) chosen.add(b.evidenceId);
  if (caseId && st.cases[caseId]) { chosen.add(st.cases[caseId].evidenceId); for (const h of st.cases[caseId].history) chosen.add(h.evidenceId); }
  const selRows = rows.filter((r) => chosen.has(r.id));
  return { st, rows, byId, entries, times: times.length > 0, absences, br, selRows };
}

/** PDF-Bericht als Buffer. */
function buildPdf(sel, opts, info) {
  const { st } = sel;
  const s = st.settings;
  const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 }, info: { Title: 'MLZ-Protokoll – Bericht', Author: s.name || '' }, bufferPages: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => doc.on('end', () => r(Buffer.concat(chunks))));
  const W = doc.page.width - 112;
  const t = (txt, o = {}) => doc.text(pdfText(txt), o);
  const h1 = (txt) => { doc.moveDown(0.6).font('Helvetica-Bold').fontSize(15).fillColor('#1d3557'); t(txt); doc.font('Helvetica').fontSize(10).fillColor('black').moveDown(0.3); };
  const h2 = (txt) => { doc.moveDown(0.5).font('Helvetica-Bold').fontSize(11.5).fillColor('#1d3557'); t(txt); doc.font('Helvetica').fontSize(10).fillColor('black'); };
  const field = (label, value) => {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#555'); t(label);
    doc.font('Helvetica').fontSize(10).fillColor('black'); t(Array.isArray(value) ? value.join(', ') : value, { width: W });
    doc.moveDown(0.15);
  };
  const small = (txt) => { doc.font('Helvetica').fontSize(7.5).fillColor('#666'); t(txt, { width: W }); doc.fontSize(10).fillColor('black'); };
  const ensure = (h) => { if (doc.y + h > doc.page.height - 60) doc.addPage(); };

  // ---------------------------------------------------------------- Deckblatt
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#1d3557'); t('MLZ-Protokoll');
  doc.fontSize(14).fillColor('black'); t(opts.caseId ? `Vorgang: ${st.cases[opts.caseId]?.title || ''}` : 'Bericht über Aufzeichnungen');
  doc.moveDown(1).font('Helvetica').fontSize(10.5);
  field('Verfasser', [s.name, s.position].filter(Boolean).join(', ') || '–');
  field('Arbeitgeber', s.employer || '–');
  if (!opts.caseId) field('Zeitraum', `${de(opts.from)} – ${de(opts.to)}`);
  field('Inhalt', [sel.entries.length && `${sel.entries.length} Logbuch-Einträge`, sel.times && 'Arbeitszeiten', sel.absences.length && 'Abwesenheiten', sel.br.length && 'Betriebsratstätigkeit'].filter(Boolean).join(', ') || '–');
  field('Erstellt', deTime(new Date().toISOString()));
  doc.moveDown(0.5);
  h2('Prüfwerte');
  field('Beweiskette', `${info.chain.ok ? 'Vollständig geprüft – unverändert' : `FEHLER: ${info.chain.reason}`} (${info.chain.entries} Einträge insgesamt)`);
  field('Prüfwert des letzten Eintrags (Nr. ' + info.head.seq + ')', info.head.hash);
  field('SHA-256 der Datei daten.json in diesem Paket', info.dataSha);
  field('SHA-256 der Datei kette.json in diesem Paket', info.chainSha);
  doc.moveDown(0.5);
  h2('Wie diese Aufzeichnungen entstanden sind');
  t([
    'Die Einträge wurden mit dem Programm „MLZ-Protokoll“ auf einem privaten Server erfasst, überwiegend per Sprachaufnahme am privaten Handy. ',
    'Jeder Eintrag erhält drei Zeitpunkte: Zeitpunkt des Geschehens (vom Verfasser angegeben), Zeitpunkt der Erfassung am Handy und Zeitpunkt des Eingangs beim Server (Serveruhr). ',
    'Einträge werden nie geändert oder gelöscht. Korrekturen und Ergänzungen sind nur als eigene, datierte Nachträge möglich; der ursprüngliche Text bleibt erhalten. ',
    'Alle Einträge sind über SHA-256-Prüfwerte miteinander verkettet (jeder Prüfwert enthält den des vorherigen Eintrags). Eine nachträgliche Änderung würde die Kette brechen. ',
    'Der Prüfwert des jeweils letzten Eintrags wird täglich von unabhängigen Zeitstempeldiensten (RFC 3161) signiert. ',
    'Sprachaufnahmen und Fotos liegen unverändert im Original bei; automatisch erstellte Transkripte sind als solche gekennzeichnet. ',
    'Bewertungen des Verfassers stehen getrennt von den geschilderten Tatsachen.',
  ].join(''), { width: W, align: 'justify' });
  doc.moveDown(0.5);
  small('Prüfanleitung: siehe Datei PRUEFUNG.txt in diesem Paket (Skripte verify.py und verify.sh).');

  const anchorText = (seq) => {
    const a = anchorFor(seq);
    if (!a) return 'noch kein Zeitstempel';
    return a.results.map((r) => `${r.tsa}: ${r.time}`).join(' · ');
  };

  // ---------------------------------------------------------------- Logbuch
  if (sel.entries.length) {
    doc.addPage();
    h1('Logbuch');
    for (const e of sel.entries) {
      ensure(140);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('black');
      t(`${deLocal(e.eventAt)}${e.eventEnd ? ` – ${e.eventEnd}` : ''}  ·  ${e.title || SECTION_LABEL[e.section] || 'Eintrag'}`);
      doc.font('Helvetica').fontSize(8.5).fillColor('#444');
      t(`Nr. ${e.seq} · ${SECTION_LABEL[e.section] || ''}${e.category ? ` · ${e.category}` : ''}${e.caseId && st.cases[e.caseId] ? ` · Vorgang: ${st.cases[e.caseId].title}` : ''}`);
      doc.fillColor('black').fontSize(10).moveDown(0.2);
      if (e.retracted) { doc.fillColor('#b00020'); t(`Zurückgezogen am ${deTime(e.retracted.receivedAt)}: ${e.retracted.reason || ''}`); doc.fillColor('black'); }
      field('Ort', e.location);
      field('Beteiligte Personen', e.persons);
      field('Zeugen / anwesend', e.witnesses);
      field('Sachverhalt (Tatsachen)', e.facts);
      field('Wörtliche Äußerungen', e.quotes);
      field('Folgen', e.consequences);
      field('Eigene Reaktion / Meldung', e.reaction);
      field('Bewertung des Verfassers (keine Tatsachenangabe)', e.assessment);
      field('Grund für spätere Erfassung', e.delayReason);
      for (const fid of e.fileIds || []) fileBlock(doc, st, fid, W, field, small, ensure, t);
      small(`Ereignis: ${deLocal(e.eventAt)} · Erfasst am Handy: ${deTime(e.capturedAt)} · Eingang Server: ${deTime(e.receivedAt)} · Prüfwert: ${e.hash}`);
      small(`Zeitstempel: ${anchorText(e.seq)}`);
      for (const a of e.addenda) {
        ensure(60);
        doc.moveDown(0.3).font('Helvetica-Bold').fontSize(10).fillColor('#1d3557'); t(`Nachtrag vom ${deTime(a.receivedAt)} (Nr. ${a.seq})`);
        doc.font('Helvetica').fillColor('black');
        if (a.erased) t('(Inhalt nach Ablauf der Aufbewahrungsfrist gelöscht)');
        field('Grund', a.reason);
        field('Text', a.text);
        for (const fid of a.fileIds || []) fileBlock(doc, st, fid, W, field, small, ensure, t);
        small(`Prüfwert: ${a.hash} · Zeitstempel: ${anchorText(a.seq)}`);
      }
      doc.moveDown(0.4).moveTo(56, doc.y).lineTo(56 + W, doc.y).strokeColor('#ccc').stroke().moveDown(0.6);
    }
  }

  // ---------------------------------------------------------------- Arbeitszeit
  if (sel.times) {
    const days = workDays(st);
    const abs = activeAbsences(st);
    doc.addPage();
    h1('Arbeitszeit');
    small(`Modell: ${s.workModel || '–'} · Bundesland: ${STATES[s.state] || s.state} · Soll je Wochentag (Mo–So): ${s.weekTarget.map((m) => fmtDur(m)).join(' / ')} · Pausenregel: ${s.breakRules.map((r) => `ab ${fmtDur(r.afterMin)} → ${r.breakMin} Min.`).join(', ')} (${s.breakMode === 'auto' ? 'fehlende Pause wird abgezogen' : 'nur Hinweis'})`);
    const halfs = s.halfDays.filter((h) => h.active);
    if (halfs.length) small(`Halbe freie Tage: ${halfs.map((h) => `${h.name} (${h.md.slice(3)}.${h.md.slice(0, 2)}.) – Grundlage: ${h.basis || 'nicht angegeben'}`).join('; ')}`);
    let y = Number(opts.from.slice(0, 4)), m = Number(opts.from.slice(5, 7));
    let total = 0;
    while (`${y}-${String(m).padStart(2, '0')}` <= opts.to.slice(0, 7)) {
      const b = monthBounds(y, m);
      const from = b.from < opts.from ? opts.from : b.from;
      const to = b.to > opts.to ? opts.to : b.to;
      const rows = range(from, to, s, days, abs, { start: trackingStart(s, st.firstDate), today: localToday() });
      const sum = rows.reduce((a, r) => ({ w: a.w + r.worked, t: a.t + r.target, c: a.c + r.credit, b: a.b + r.balance }), { w: 0, t: 0, c: 0, b: 0 });
      total += sum.b;
      ensure(80);
      h2(`${parseYmd(from).toLocaleString('de-DE', { month: 'long', year: 'numeric' })}`);
      const cols = [52, 24, 92, 40, 44, 44, 46, W - 342];
      const head2 = ['Datum', 'Tag', 'Zeiten', 'Pause', 'Ist', 'Soll', 'Saldo', 'Hinweis'];
      const rowOut = (vals, bold) => {
        ensure(14);
        let x = 56; const y0 = doc.y;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        let hmax = 0;
        vals.forEach((v, i) => { const hh = doc.heightOfString(pdfText(v), { width: cols[i] - 4 }); hmax = Math.max(hmax, hh); });
        if (y0 + hmax > doc.page.height - 60) { doc.addPage(); }
        const yy = doc.y;
        vals.forEach((v, i) => { doc.text(pdfText(v), x, yy, { width: cols[i] - 4 }); x += cols[i]; });
        doc.x = 56; doc.y = yy + hmax + 2;
      };
      rowOut(head2, true);
      for (const r of rows) {
        const d = days.get(r.date);
        const tm = st.times[r.date];
        const hint = [r.holiday, r.half && `${r.half} (halber Tag)`, r.absence && `${ABSENCE_TYPES[r.absence.type]?.label || r.absence.type}${r.absence.half ? ' (halber Tag)' : ''}`,
          tm?.overtime?.orderedBy && `Mehrarbeit ${tm.overtime.how || 'angeordnet'} von ${tm.overtime.orderedBy}`, tm?.note, d?.open && `offen seit ${d.open}`, ...r.warnings].filter(Boolean).join('; ');
        if (r.untracked || (!d?.segments?.length && !r.target && !r.credit && !hint)) continue;
        rowOut([de(r.date), WD[weekday(r.date)], (d?.segments || []).map((x) => `${x.start}–${x.end}`).join(', '), r.gross ? `${r.breakTaken}` : '', r.worked ? fmtDur(r.worked) : '', fmtDur(r.target), fmtDur(r.balance, true), hint]);
      }
      rowOut(['Summe', '', '', '', fmtDur(sum.w), fmtDur(sum.t), fmtDur(sum.b, true), sum.c ? `davon Anrechnung Abwesenheit ${fmtDur(sum.c)}` : ''], true);
      m++; if (m > 12) { m = 1; y++; }
    }
    doc.moveDown(0.5).font('Helvetica-Bold'); t(`Saldo im Zeitraum: ${fmtDur(total, true)} Std.`); doc.font('Helvetica');
    const claims = claimDeadlines(s, days, abs, st.claims, localToday(), st.firstDate).filter((c) => c.month >= opts.from.slice(0, 7) && c.month <= opts.to.slice(0, 7));
    if (claims.length) {
      h2('Mehrarbeit und Geltendmachung');
      for (const c of claims) t(`${c.month}: Mehrarbeit ${fmtDur(c.overtime)} Std. · Frist ${de(c.deadline)} · ${c.claimed ? `geltend gemacht am ${de(c.claimed.date)} (${c.claimed.how || ''}${c.claimed.to ? ` bei ${c.claimed.to}` : ''})` : 'nicht geltend gemacht'}`);
    }
  }

  // ---------------------------------------------------------------- Abwesenheiten / Urlaub
  if (sel.absences.length) {
    doc.addPage();
    h1('Abwesenheiten und Urlaub');
    for (const a of sel.absences) t(`${de(a.from)}${a.to && a.to !== a.from ? ` – ${de(a.to)}` : ''}: ${ABSENCE_TYPES[a.type]?.label || a.type}${a.half ? ' (halber Tag)' : ''}${a.approvedBy ? ` · genehmigt von ${a.approvedBy}${a.approvedAt ? ` am ${de(a.approvedAt)}` : ''}` : ''}${a.note ? ` · ${a.note}` : ''}`);
    const abs = activeAbsences(st);
    for (let y = Number(opts.from.slice(0, 4)); y <= Number(opts.to.slice(0, 4)); y++) {
      const v = vacationAccount(y, s, abs, localToday());
      h2(`Urlaubskonto ${y}`);
      t(`Anspruch ${v.entitlement} · Übertrag ${v.carry}${v.carryLost ? ` (verfallen ${v.carryLost} am ${de(v.expiry)})` : ''} · Korrektur ${v.adjust} · genommen ${v.taken} · geplant ${v.planned} · Rest ${v.remaining} Tage`);
    }
  }

  // ---------------------------------------------------------------- Betriebsrat
  if (sel.br.length) {
    doc.addPage();
    h1('Betriebsratstätigkeit');
    for (const b of sel.br) {
      ensure(50);
      doc.font('Helvetica-Bold'); t(`${de(b.date)} ${b.start}–${b.end}${b.outside ? ' · außerhalb der Arbeitszeit (§ 37 Abs. 3 BetrVG)' : ''}`); doc.font('Helvetica');
      t([b.topic, b.place && `Ort: ${b.place}`, b.abmeldungTo && `abgemeldet bei ${b.abmeldungTo}${b.abmeldungAt ? ` um ${b.abmeldungAt}` : ''}`, b.rueckmeldungAt && `zurückgemeldet ${b.rueckmeldungAt}`, b.reasonOutside && `Grund außerhalb: ${b.reasonOutside}`, b.note].filter(Boolean).join(' · '), { width: W });
      small(`Nr. ${b.seq} · Eingang ${deTime(b.receivedAt)} · Prüfwert ${b.hash}`);
    }
    const acc = brAccount(activeBr(st), activeAbsences(st), s, workDays(st));
    h2('Ausgleichskonto § 37 Abs. 3 BetrVG');
    t(`Erworben ${fmtDur(acc.earned)} · ausgeglichen ${fmtDur(acc.used)} · offen ${fmtDur(acc.balance)} Std.`);
  }

  // ---------------------------------------------------------------- Zeitstempel
  doc.addPage();
  h1('Zeitstempel der Beweiskette');
  const minSeq = Math.min(...sel.selRows.map((r) => r.seq), Infinity);
  const anchors = listAnchors().filter((a) => a.seq >= (Number.isFinite(minSeq) ? minSeq : 0)).reverse();
  if (!anchors.length) t('Noch keine Zeitstempel vorhanden.');
  for (const a of anchors.slice(0, 400)) {
    ensure(30);
    t(`${de(a.day)} · bis Eintrag Nr. ${a.seq}`);
    small(`${a.head_hash} · ${a.results.map((r) => (r.ok ? `${r.tsa}: ${r.time}` : `${r.tsa}: fehlgeschlagen`)).join(' · ')}`);
  }

  // Seitenzahlen
  const range2 = doc.bufferedPageRange();
  for (let i = 0; i < range2.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // sonst legt pdfkit beim Schreiben in den Rand eine neue Seite an
    doc.font('Helvetica').fontSize(7.5).fillColor('#777');
    doc.text(pdfText(`MLZ-Protokoll · Seite ${i + 1} von ${range2.count} · Stand Nr. ${info.head.seq}`), 56, doc.page.height - 40, { width: W, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}

function fileBlock(doc, st, fid, W, field, small, ensure, t) {
  const f = st.files[fid];
  if (!f) return;
  if (f.erased) { small('Anlage gelöscht (Aufbewahrungsfrist abgelaufen)'); return; }
  const tr = st.transcripts[fid];
  const label = f.purpose === 'photo' ? 'Foto' : f.purpose.includes('audio') ? 'Sprachaufnahme' : 'Anlage';
  if (f.purpose === 'photo' && /jpeg|png/.test(f.mime)) {
    try {
      ensure(200);
      doc.image(fs.readFileSync(storedPath(f)), { fit: [W * 0.6, 190] });
      doc.moveDown(0.2);
    } catch { /* Bild nicht lesbar */ }
  }
  small(`${label}: dateien/${path.basename(f.path)} · ${Math.round(f.size / 1024)} KB · aufgenommen ${deTime(f.capturedAt)} · SHA-256 ${f.sha256}`);
  if (tr) field(`Automatisches Transkript (${tr.engine || 'Whisper'}, ungeprüft)`, tr.text);
}

const PRUEFUNG = (head2) => `PRÜFANLEITUNG – MLZ-Protokoll
==============================

Dieses Paket enthält:
  bericht.pdf        lesbarer Bericht
  daten.json         die ausgewählten Einträge im Originalformat (Feld "payload" = exakt gespeicherter Inhalt)
  kette.json         Prüfwerte ALLER Einträge der Beweiskette (ohne Inhalte), damit die Verkettung lückenlos
                     nachgerechnet werden kann
  dateien/           Original-Sprachaufnahmen, Fotos und Anlagen (unverändert)
  zeitstempel/       RFC-3161-Zeitstempel (.tsr) unabhängiger Dienste und deren Zertifikate
  zeitstempel.json   welcher Zeitstempel welchen Prüfwert bestätigt
  MANIFEST.sha256    SHA-256 aller Dateien dieses Pakets
  verify.py          Prüfprogramm (Python 3, ohne Zusatzpakete)
  verify.sh          Prüfung mit Bordmitteln (sha256sum, openssl)

1) Unversehrtheit des Pakets
     sha256sum -c MANIFEST.sha256

2) Beweiskette, Inhalte und Dateien nachrechnen
     python3 verify.py
   Geprüft wird:
     - jeder Eintrag: hash = SHA-256(prev_hash|seq|id|kind|ref|event_at|captured_at|received_at|payload_hash|device)
     - lückenlose Nummerierung und Verkettung ab dem ersten Eintrag ("GENESIS")
     - payload_hash = SHA-256(payload) für alle mitgelieferten Inhalte
     - SHA-256 jeder Originaldatei = im Eintrag gespeicherter Wert
     - Zeitstempel: bestätigter Prüfwert = Prüfwert des Eintrags in kette.json (und openssl ts -verify)

3) Zeitstempel einzeln prüfen (Beispiel)
     openssl ts -reply -in zeitstempel/<datei>.tsr -text
     openssl ts -verify -digest <prüfwert> -in zeitstempel/<datei>.tsr -CAfile zeitstempel/<ca-datei>.pem

Bedeutung: Ein gültiger Zeitstempel belegt, dass der Stand der Kette bis zu diesem Eintrag zu der angegebenen
Zeit bereits existierte. Wegen der Verkettung gilt das auch für alle früheren Einträge.

Hinweis: kette.json enthält von Einträgen außerhalb dieser Auswahl nur Nummer, Art, Zeitpunkte und Prüfwerte –
keine Inhalte.

Letzter Eintrag beim Export: Nr. ${head2.seq}, Prüfwert ${head2.hash}
`;

const VERIFY_PY = `#!/usr/bin/env python3
"""Prüft ein MLZ-Protokoll-Exportpaket. Aufruf im entpackten Ordner: python3 verify.py"""
import hashlib, json, os, shutil, subprocess, sys

def sha(b): return hashlib.sha256(b).hexdigest()
def fsha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for c in iter(lambda: f.read(1 << 20), b''): h.update(c)
    return h.hexdigest()

ok = True
def bad(msg):
    global ok; ok = False; print('FEHLER:', msg)

here = os.path.dirname(os.path.abspath(__file__))
os.chdir(here)

# 1) Manifest
for line in open('MANIFEST.sha256', encoding='utf-8'):
    h, name = line.rstrip('\\n').split('  ', 1)
    if not os.path.exists(name): bad('fehlt: ' + name); continue
    if fsha(name) != h: bad('verändert: ' + name)
print('Manifest geprüft')

# 2) Kette
chain = json.load(open('kette.json', encoding='utf-8'))
prev = 'GENESIS'
by_seq = {}
for i, r in enumerate(chain, 1):
    if r['seq'] != i: bad('Lücke vor Nr. %s' % r['seq'])
    if r['prev_hash'] != prev: bad('Verkettung bei Nr. %s' % r['seq'])
    parts = [r['prev_hash'], str(r['seq']), r['id'], r['kind'], r.get('ref') or '', r.get('event_at') or '', r.get('captured_at') or '', r['received_at'], r['payload_hash'], r.get('device') or '']
    if sha('|'.join(parts).encode('utf-8')) != r['hash']: bad('Prüfwert Nr. %s' % r['seq'])
    prev = r['hash']; by_seq[r['seq']] = r
print('Kette: %d Einträge geprüft, letzter Prüfwert %s' % (len(chain), prev))

# 3) Inhalte
data = json.load(open('daten.json', encoding='utf-8'))
for r in data['eintraege']:
    c = by_seq.get(r['seq'])
    if not c or c['hash'] != r['hash']: bad('Eintrag Nr. %s passt nicht zur Kette' % r['seq']); continue
    if r.get('payload') is not None and sha(r['payload'].encode('utf-8')) != c['payload_hash']: bad('Inhalt Nr. %s verändert' % r['seq'])
    if r['kind'] == 'file' and r.get('payload'):
        p = json.loads(r['payload'])
        f = os.path.join('dateien', os.path.basename(p['path']))
        if not os.path.exists(f): bad('Datei fehlt: ' + f)
        elif fsha(f) != p['sha256']: bad('Datei verändert: ' + f)
print('Inhalte: %d Einträge geprüft' % len(data['eintraege']))

# 4) Zeitstempel
anchors = json.load(open('zeitstempel.json', encoding='utf-8'))
have_openssl = shutil.which('openssl') is not None
for a in anchors:
    c = by_seq.get(a['seq'])
    if not c or c['hash'] != a['head_hash']: bad('Zeitstempel %s: Prüfwert passt nicht zur Kette' % a['day']); continue
    for t in a['results']:
        if not t.get('ok') or not t.get('file'): continue
        f = os.path.join('zeitstempel', t['file'])
        if not os.path.exists(f): bad('fehlt: ' + f); continue
        if have_openssl and t.get('ca'):
            r = subprocess.run(['openssl', 'ts', '-verify', '-digest', a['head_hash'], '-in', f, '-CAfile', os.path.join('zeitstempel', t['ca'])], capture_output=True, text=True)
            print('  %s %s: %s' % (a['day'], t['tsa'], 'gültig' if r.returncode == 0 else 'NICHT bestätigt'))
            if r.returncode != 0: bad('Zeitstempel ungültig: ' + f)
print('Zeitstempel: %d geprüft' % len(anchors))
print()
print('ERGEBNIS: ' + ('alles in Ordnung' if ok else 'ES GIBT FEHLER (siehe oben)'))
sys.exit(0 if ok else 1)
`;

/** Paket erzeugen und in den Antwortstrom schreiben. */
export async function writeExport(res, { from, to, parts = ['log', 'time', 'absence', 'br'], caseId = '' }) {
  if (!caseId && (!/^\d{4}-\d\d-\d\d$/.test(from) || !/^\d{4}-\d\d-\d\d$/.test(to) || from > to)) throw Object.assign(new Error('Zeitraum ungültig'), { status: 400 });
  if (caseId && !from) { from = '2000-01-01'; to = addDays(new Date().toISOString().slice(0, 10), 0); }
  const sel = select({ from, to, parts, caseId });
  const chain = verifyChain();
  const h = head();
  const kette = Buffer.from(JSON.stringify(sel.rows.map(({ payload, ...r }) => r), null, 1));
  const daten = Buffer.from(JSON.stringify({ erstellt: new Date().toISOString(), auswahl: { from, to, parts, caseId }, eintraege: sel.selRows }, null, 1));
  const pdf = await buildPdf(sel, { from, to, caseId }, { chain, head: h, dataSha: sha(daten), chainSha: sha(kette) });

  // Zeitstempel ab dem ersten ausgewählten Eintrag
  const minSeq = sel.selRows.length ? Math.min(...sel.selRows.map((r) => r.seq)) : h.seq;
  const anchors = listAnchors().filter((a) => a.seq >= minSeq).reverse();
  const caFiles = new Map();
  for (const a of anchors) for (const r of a.results) if (r.ok) { const ca = await caFor(r.tsa); if (ca) { r.ca = `${r.tsa}-ca.pem`; caFiles.set(r.ca, ca); } }

  const manifest = [];
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="MLZ-Protokoll-${caseId ? 'Vorgang' : `${from}_${to}`}-${stamp}.zip"`);
  const zip = new Zip((err, chunk, final) => { if (err) { res.destroy(err); return; } res.write(chunk); if (final) res.end(); });
  const addText = (name, buf) => { manifest.push(`${sha(buf)}  ${name}`); const f = new ZipDeflate(name, { level: 6 }); zip.add(f); f.push(buf, true); };
  const addFile = async (name, full) => {
    const hsh = crypto.createHash('sha256');
    const f = new ZipPassThrough(name); zip.add(f);
    await new Promise((resolve, reject) => {
      const s = fs.createReadStream(full);
      s.on('data', (c) => { hsh.update(c); f.push(c, false); });
      s.on('end', () => { f.push(new Uint8Array(0), true); resolve(); });
      s.on('error', reject);
    });
    manifest.push(`${hsh.digest('hex')}  ${name}`);
  };
  addText('bericht.pdf', pdf);
  addText('daten.json', daten);
  addText('kette.json', kette);
  addText('zeitstempel.json', Buffer.from(JSON.stringify(anchors.map((a) => ({ day: a.day, seq: a.seq, head_hash: a.head_hash, created_at: a.created_at, results: a.results })), null, 1)));
  for (const r of sel.selRows) {
    if (r.kind !== 'file' || !r.payload) continue;
    const p = JSON.parse(r.payload);
    try { await addFile(`dateien/${path.basename(p.path)}`, storedPath(p)); } catch { /* fehlt – verify.py meldet das */ }
  }
  for (const a of anchors) for (const r of a.results) if (r.ok && r.file && fs.existsSync(path.join(ANCHOR_DIR, r.file))) await addFile(`zeitstempel/${r.file}`, path.join(ANCHOR_DIR, r.file));
  for (const [name, full] of caFiles) await addFile(`zeitstempel/${name}`, full);
  addText('PRUEFUNG.txt', Buffer.from(PRUEFUNG(h)));
  addText('verify.py', Buffer.from(VERIFY_PY));
  addText('verify.sh', Buffer.from('#!/bin/sh\n# Prüfung mit Bordmitteln\ncd "$(dirname "$0")" && sha256sum -c MANIFEST.sha256 && command -v python3 >/dev/null && python3 verify.py\n'));
  const man = Buffer.from(`${manifest.join('\n')}\n`);
  const mf = new ZipDeflate('MANIFEST.sha256'); zip.add(mf); mf.push(man, true);
  zip.end();
}

export { buildPdf, select };
