<script setup>
// Arbeitstag erfassen: sprechen → Vorschlag → bestätigen. Jede Speicherung ist eine neue Fassung in der Beweiskette.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import Recorder from '../components/Recorder.vue';
import { api } from '../services/api.js';
import { deleteDraft, loadDrafts, newDraft, queueEvidence, queueFile, saveDraft, settings, store, toast } from '../services/store.js';
import { webSpeech, webSpeechAvailable } from '../services/recorder.js';
import { dayRow, stampsToDay } from '../services/derived.js';
import { initiator, parseWorkTime } from '../../shared/timeparse.js';
import { ABSENCE_TYPES, dayResult, fmtDur } from '../../shared/worktime.js';
import { WEEKDAYS, de, deTime, today, fromB64 } from '../services/util.js';
import { addDays, weekday } from '../../shared/holidays.js';

const route = useRoute();
const router = useRouter();
const date = computed(() => route.params.date);
const existing = computed(() => store.data?.times?.[date.value]);
const stamps = computed(() => store.data?.stamps?.[date.value] || []);

const f = ref(null);
function load() {
  const e = existing.value;
  const st = stamps.value.length ? stampsToDay(stamps.value) : null;
  f.value = {
    segments: e ? e.segments.map((s) => ({ ...s })) : st?.segments.length ? st.segments.map((s) => ({ ...s })) : [{ start: '', end: '' }],
    breakMinutes: e ? e.breakMinutes : 0,
    note: e?.note || '', location: e?.location || '',
    overtime: { reason: '', orderedBy: '', how: 'angeordnet', witnesses: '', evidence: '', ...(e?.overtime || {}) },
    source: 'form', fileId: '', spoken: '',
  };
  if (!e && st?.segments.length > 1) f.value.breakMinutes = 0; // Lücken zwischen Abschnitten zählen als Pause
}
onMounted(() => {
  load();
  if (route.query.sprechen) listenHint.value = true;
  const sg = route.query.vorschlag && fromB64(route.query.vorschlag);
  if (sg) { // Vorschlag der KI-Ausfüllhilfe
    const before = f.value.segments.length;
    fill({ start: sg.start || '', end: sg.end || '', breaks: [], breakMinutes: sg.breakMinutes ? Number(sg.breakMinutes) : null, orderedBy: sg.orderedBy || '' }, sg.spoken || '');
    const added = f.value.segments.length > before;
    if (!added && sg.orderedBy) Object.assign(f.value.overtime, { orderedBy: sg.orderedBy, how: sg.how || 'angeordnet', reason: sg.reason || '' });
    f.value.source = 'voice'; f.value.spoken = sg.spoken || ''; f.value.fileId = sg.fileId || '';
    if (sg.spoken) audio.value = { id: sg.fileId, status: 'done', text: sg.spoken };
    toast('Vorschlag der KI übernommen – bitte prüfen');
  }
  if (route.query.text) { // vom Sprechen an einem anderen Tag hierher gewechselt
    f.value.fileId = String(route.query.file || '');
    f.value.source = String(route.query.quelle || 'voice');
    if (f.value.fileId) audio.value = { id: f.value.fileId, status: 'done' };
    apply(String(route.query.text));
  }
});

const listenHint = ref(false);
const audio = ref(null); // { id, status, text }
const parsed = ref(null);
let poll;
async function recorded({ blob, startedAt, durationSec }) {
  const file = await queueFile(blob, { purpose: 'time-audio', capturedAt: startedAt, durationSec });
  audio.value = { id: file.id, status: 'upload' };
  f.value.fileId = file.id;
  f.value.source = 'voice';
  clearInterval(poll);
  poll = setInterval(check, 2500);
}
async function check() {
  if (!audio.value) return;
  if (!store.data?.files?.[audio.value.id]) { audio.value.status = store.outbox.some((o) => o.id === audio.value.id) ? 'upload' : 'wait'; return; }
  try {
    const r = await api(`/files/${audio.value.id}/transcript`);
    audio.value.status = r.status; audio.value.error = r.error;
    if (r.status === 'done') { clearInterval(poll); apply(r.text); }
    if (r.status === 'error') clearInterval(poll);
  } catch { /* offline */ }
}
onBeforeUnmount(() => { clearInterval(poll); stopLive?.(); });

function apply(text) {
  audio.value && (audio.value.text = text);
  const p = parseWorkTime(text, today());
  parsed.value = p;
  f.value.spoken = text;
  if (p.dateGiven && p.date !== date.value) { // nur wechseln, wenn ein Datum genannt wurde (eine Korrektur ohne Datum bleibt beim Tag)
    toast(`Erkanntes Datum: ${de(p.date)} – Tag gewechselt`);
    router.replace({ path: `/zeit/tag/${p.date}`, query: { text, file: f.value.fileId || '', quelle: f.value.source } });
    return;
  }
  fill(p, text);
}
const ADD_WORDS = /angerufen|anruf|rief|nach feierabend|nach arbeitsende|wieder (?:angefangen|aufgenommen|eingestiegen)|noch ?mal|später|abends|zusätzlich|danach|nachträglich|hinterher/i;
function fill(p, text = '') {
  // Nachtrag zu einem schon erfassten Tag (z. B. Anruf nach Arbeitsende) → neuer Abschnitt statt Überschreiben
  const segs = f.value.segments.filter((x) => x.start && x.end);
  const lastEnd = segs.map((x) => x.end).sort().at(-1) || '';
  const correction = /korrektur|falsch|vertan|versprochen|stimmt nicht/i.test(text);
  if (segs.length && p.start && !correction && (p.start >= lastEnd || ADD_WORDS.test(text))) {
    const by = initiator(text) || p.orderedBy || '';
    f.value.segments.push({ start: p.start, end: p.end || '', note: text.trim().slice(0, 1000), by, after: p.start >= lastEnd });
    if (by && !f.value.overtime.orderedBy) Object.assign(f.value.overtime, { orderedBy: by, how: 'angeordnet', reason: f.value.overtime.reason || text.trim().slice(0, 300) });
    toast(`Als zusätzlicher Abschnitt ${p.start}–${p.end || '…'} eingetragen`);
    return;
  }
  if (p.start || p.end) f.value.segments = [{ start: p.start || f.value.segments[0]?.start || '', end: p.end || f.value.segments[0]?.end || '' }];
  if (p.breaks.length) f.value.segments = splitByBreaks(f.value.segments[0], p.breaks);
  if (p.breakMinutes != null && !p.breaks.length) f.value.breakMinutes = p.breakMinutes;
  if (p.orderedBy) { f.value.overtime.orderedBy = p.orderedBy; f.value.overtime.how = 'angeordnet'; }
}
function splitByBreaks(seg, breaks) {
  if (!seg?.start || !seg?.end) return [seg];
  const out = []; let cur = seg.start;
  for (const b of breaks) { out.push({ start: cur, end: b.start }); cur = b.end; }
  out.push({ start: cur, end: seg.end });
  return out;
}

let stopLive = null;
const liveText = ref('');
const living = ref(false);
function live() {
  living.value = true; liveText.value = '';
  stopLive = webSpeech((t) => { liveText.value = t; }, (final) => { living.value = false; stopLive = null; if (final) { f.value.source = 'voice-live'; apply(final); } });
}

const preview = computed(() => {
  if (!f.value) return null;
  const segs = f.value.segments.filter((s) => s.start && s.end);
  const prev = store.data ? dayRow(addDays(date.value, -1)) : null; // für die Ruhezeit (§ 5 ArbZG)
  return dayResult(date.value, settings(), { segments: segs, breakMinutes: Number(f.value.breakMinutes) || 0 }, Object.values(store.data?.absences || {}).filter((a) => !a.cancelled), prev?.last != null ? prev.last - 1440 : null);
});
const row = computed(() => (store.data ? dayRow(date.value) : null));
const overtime = computed(() => preview.value && preview.value.balance > 0);
const unsure = computed(() => parsed.value?.unsure || []);

function addAfter() { f.value.segments.push({ start: '', end: '', note: '', by: '', after: true }); }
function segBy(s) { if (s.by && !f.value.overtime.orderedBy) Object.assign(f.value.overtime, { orderedBy: s.by, how: 'angeordnet' }); }
const logOffer = ref(null); // nach dem Speichern: Bemerkungen als Logbuch-Eintrag anbieten
async function toLog(s) {
  const text = [s.note, s.after ? '(nach Arbeitsende, Arbeit wieder aufgenommen)' : ''].filter(Boolean).join(' ');
  try {
    const r = await api('/drafts/from-time', { method: 'POST', body: { date: date.value, start: s.start, end: s.end, text: text || 'Arbeit außerhalb der regulären Arbeitszeit', by: s.by } });
    await loadDrafts();
    router.push(`/diktat/${r.id}`);
  } catch { // offline: Entwurf lokal anlegen
    const d = newDraft('incident', { eventAt: `${date.value}T${s.start || '12:00'}`, eventAtAuto: false, eventEnd: s.end || '', category: 'Überstunden / Arbeitszeit', persons: s.by || '', facts: `${s.start}–${s.end} Uhr: ${text}${s.by ? ` (veranlasst von ${s.by})` : ''}` });
    await saveDraft(d);
    router.push(`/diktat/${d.id}`);
  }
}

async function save() {
  const segs = f.value.segments.filter((s) => s.start && s.end).map((s) => ({ start: s.start, end: s.end, ...(s.note ? { note: s.note } : {}), ...(s.by ? { by: s.by } : {}), ...(s.after ? { after: true } : {}) }));
  const payload = {
    date: date.value, segments: segs, breakMinutes: Number(f.value.breakMinutes) || 0, breaks: [], note: f.value.note, location: f.value.location,
    source: f.value.source, fileId: f.value.fileId || '', spoken: f.value.spoken,
    overtime: overtime.value || f.value.overtime.orderedBy ? f.value.overtime : {},
  };
  const old = new Set((existing.value?.segments || []).filter((x) => x.note || x.by || x.after).map((x) => `${x.start}|${x.note}|${x.by}`));
  await queueEvidence('time', payload, { label: 'Arbeitszeit' });
  if (route.query.entwurf) await deleteDraft(String(route.query.entwurf));
  toast('Arbeitszeit gespeichert');
  const offer = segs.filter((x) => (x.after || x.by) && !old.has(`${x.start}|${x.note}|${x.by}`));
  if (offer.length) logOffer.value = offer; else router.push('/zeit');
}
const stampLabel = { in: 'Beginn', out: 'Ende', 'break-start': 'Pause', 'break-end': 'weiter' };
</script>

<template>
  <div v-if="f" class="page">
    <h1>{{ WEEKDAYS[weekday(date)] }}, {{ de(date) }}</h1>
    <p v-if="row" class="muted">
      Soll {{ fmtDur(row.target) }}<template v-if="row.holiday"> · {{ row.holiday }}</template><template v-if="row.half"> · {{ row.half }} (halber Tag)</template>
      <template v-if="row.absence"> · {{ ABSENCE_TYPES[row.absence.type]?.label }}{{ row.absence.half ? ' (halber Tag)' : '' }}</template>
    </p>

    <div class="card">
      <Recorder :label="audio?.text ? 'Korrektur sprechen' : 'Arbeitszeit sprechen'" :max-sec="120" @recorded="recorded" />
      <small v-if="audio?.text" class="muted" style="display: block; margin-top: 6px">Etwas falsch erkannt oder versprochen? Einfach nochmal sprechen, z. B. „Korrektur: Arbeitsende war um 17 Uhr“ – nur die genannten Angaben werden ersetzt.</small>
      <small v-if="listenHint && !audio" class="muted" style="display: block; margin-top: 8px">Beispiel: „Heute um halb acht angefangen, 30 Minuten Pause, aufgehört um 16 Uhr 15. Herr Maier hat die Überstunden angeordnet.“</small>
      <button v-if="settings().webSpeech && webSpeechAvailable()" class="btn small" style="margin-top: 8px" @click="living ? stopLive() : live()">{{ living ? 'Beenden' : 'Live-Erkennung (Google)' }}</button>
      <p v-if="living" class="quote">{{ liveText || '…' }}</p>
      <div v-if="audio" style="margin-top: 10px">
        <p v-if="audio.text" class="quote">{{ audio.text }}</p>
        <small v-else-if="audio.status === 'error'" class="neg">Erkennung fehlgeschlagen: {{ audio.error }} – bitte von Hand eintragen.</small>
        <small v-else class="muted">{{ audio.status === 'upload' ? 'wird hochgeladen …' : audio.status === 'download' ? 'Sprachmodell wird geladen (einmalig) …' : 'Text wird erkannt …' }}</small>
      </div>
      <div v-if="unsure.length" class="alert warn" style="margin-top: 8px">Nicht sicher erkannt: {{ unsure.map((u) => ({ start: 'Beginn', end: 'Ende', break: 'Pause' })[u]).join(', ') }} – bitte prüfen.</div>
    </div>

    <div class="card">
      <h3>Arbeitszeit</h3>
      <div v-for="(s, i) in f.segments" :key="i" :class="{ 'seg-extra': s.after || s.note || s.by }" style="margin-bottom: 8px">
        <small v-if="s.after" class="badge warn" style="margin-bottom: 4px; display: inline-block">nach Arbeitsende wieder aufgenommen</small>
        <div class="row">
          <input v-model="s.start" type="time" class="grow" aria-label="Beginn" />
          <span>–</span>
          <input v-model="s.end" type="time" class="grow" aria-label="Ende" />
          <button v-if="f.segments.length > 1" class="btn small ghost" @click="f.segments.splice(i, 1)"><Icon name="trash" :size="18" /></button>
        </div>
        <template v-if="s.after || s.note || s.by || s.open">
          <input v-model="s.note" style="margin-top: 6px" placeholder="Wofür? z. B. Anruf Chef, Mail an Kunden geschrieben" />
          <input v-model="s.by" style="margin-top: 6px" placeholder="Veranlasst von (z. B. Chef Herr Maier)" @change="segBy(s)" />
          <label class="check" style="margin-top: 4px"><input v-model="s.after" type="checkbox" /> <span>nach Arbeitsende – Arbeit wieder aufgenommen</span></label>
        </template>
        <a v-else href="#" style="font-size: .82rem" @click.prevent="s.open = true">+ Bemerkung zu diesem Abschnitt</a>
      </div>
      <div class="row wrap">
        <button class="btn small" @click="f.segments.push({ start: '', end: '' })"><Icon name="plus" :size="16" /> Abschnitt</button>
        <button class="btn small" @click="addAfter"><Icon name="plus" :size="16" /> Arbeit wieder aufgenommen</button>
      </div>
      <small class="muted" style="display: block; margin-top: 4px">Schon aufgehört und dann noch ein Anruf oder eine Mail? Einfach sprechen, z. B. „Um 17 Uhr hat der Chef angerufen, bis 17:20 Mail an Kunden geschrieben“ – wird als eigener Abschnitt angehängt.</small>
      <label class="f">Pause (Minuten)<span class="hint">Lücken zwischen Abschnitten zählen automatisch als Pause</span></label>
      <input v-model.number="f.breakMinutes" type="number" min="0" step="5" inputmode="numeric" />
      <label class="f">Ort / Einsatz (optional)</label><input v-model="f.location" />
      <label class="f">Notiz</label><textarea v-model="f.note" rows="2" placeholder="z. B. Dienstreise, Schulung, Rufbereitschaft" />

      <div v-if="preview && preview.gross" class="kpis" style="margin-top: 12px">
        <div class="kpi"><b>{{ fmtDur(preview.worked) }}</b><span>Arbeitszeit</span></div>
        <div class="kpi"><b>{{ preview.breakTaken }}</b><span>Pause Min.</span></div>
        <div class="kpi"><b :class="preview.balance < 0 ? 'neg' : 'pos'">{{ fmtDur(preview.balance, true) }}</b><span>Saldo Tag</span></div>
      </div>
      <div v-for="x in preview?.violations || []" :key="x.code" class="alert" :class="x.severity === 'bad' ? 'bad' : 'warn'" style="margin-top: 8px">
        <b>{{ x.severity === 'bad' ? 'Verstoß' : 'Prüfen' }} ({{ x.law }}):</b> {{ x.text }}
        <router-link v-if="existing" to="/zeit/verstoesse" style="display: block; margin-top: 4px; font-size: .85rem">Festhalten, wer davon wusste →</router-link>
      </div>
    </div>

    <div v-if="overtime || f.overtime.orderedBy" class="card">
      <h3>Mehrarbeit – wer wusste davon?</h3>
      <p class="muted" style="font-size: .9rem">Vor Gericht zählt, ob die Mehrarbeit angeordnet, gebilligt oder geduldet wurde. Möglichst konkret: Name, wann, wie (mündlich, Mail, Dienstplan).</p>
      <label class="f">Von wem?</label><input v-model="f.overtime.orderedBy" placeholder="Name, Funktion" />
      <label class="f">Wie?</label>
      <select v-model="f.overtime.how"><option value="angeordnet">ausdrücklich angeordnet</option><option value="gebilligt">nachträglich gebilligt</option><option value="geduldet">bekannt und geduldet</option><option value="notwendig">zur Erledigung notwendig (Arbeitsmenge)</option></select>
      <label class="f">Grund / Arbeitsauftrag</label><input v-model="f.overtime.reason" />
      <label class="f">Zeugen</label><input v-model="f.overtime.witnesses" />
      <label class="f">Beleg</label><input v-model="f.overtime.evidence" placeholder="z. B. Mail vom …, Dienstplan, Chat" />
    </div>

    <div v-if="stamps.length || existing" class="card">
      <h3>Bisher</h3>
      <p v-if="stamps.length" class="muted">Stempelungen: <span v-for="s in stamps" :key="s.evidenceId" style="margin-right: 8px">{{ stampLabel[s.type] }} {{ s.at.slice(11, 16) }}</span></p>
      <p v-if="existing" class="muted">Gespeicherte Fassung vom {{ deTime(existing.receivedAt) }}: {{ existing.segments.map((s) => `${s.start}–${s.end}${s.note ? ` (${s.note})` : ''}`).join(', ') }}, Pause {{ existing.breakMinutes }} Min.<template v-if="existing.import"> · importiert aus {{ existing.import.file }} (Zeile {{ existing.import.line }})</template><template v-if="existing.history?.length"> · {{ existing.history.length }} frühere Fassung(en)</template></p>
      <small class="muted">Speichern legt eine neue Fassung an – die bisherigen bleiben in der Beweiskette erhalten.</small>
    </div>

    <button class="btn primary block" @click="save"><Icon name="check" :size="18" /> Speichern</button>
    <Modal v-if="logOffer" title="Auch ins Logbuch?" @close="router.push('/zeit')">
      <p>Arbeit, die nach deinem Arbeitsende wieder aufgenommen werden musste, ist ein wichtiger Nachweis (Erreichbarkeit, Druck, Ruhezeit) – auch bei Vertrauensarbeitszeit. Als Vorfall festhalten?</p>
      <div v-for="(x, i) in logOffer" :key="i" class="card flat" style="padding: 10px">
        <b>{{ x.start }}–{{ x.end }}</b><template v-if="x.by"> · {{ x.by }}</template><br /><small>{{ x.note || 'ohne Bemerkung' }}</small>
        <button class="btn small primary block" style="margin-top: 8px" @click="toLog(x)">Als Vorfall ins Logbuch</button>
      </div>
      <div class="actions"><button class="btn" @click="router.push('/zeit')">Nein, danke</button></div>
    </Modal>
  </div>
</template>
