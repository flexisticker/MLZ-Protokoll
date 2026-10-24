<script setup>
// Arbeitstag erfassen: sprechen → Vorschlag → bestätigen. Jede Speicherung ist eine neue Fassung in der Beweiskette.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import Recorder from '../components/Recorder.vue';
import { api } from '../services/api.js';
import { deleteDraft, queueEvidence, queueFile, settings, store, toast } from '../services/store.js';
import { webSpeech, webSpeechAvailable } from '../services/recorder.js';
import { dayRow, stampsToDay } from '../services/derived.js';
import { parseWorkTime } from '../../shared/timeparse.js';
import { ABSENCE_TYPES, dayResult, fmtDur } from '../../shared/worktime.js';
import { WEEKDAYS, de, deTime, today, fromB64 } from '../services/util.js';
import { weekday } from '../../shared/holidays.js';

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
    if (sg.start || sg.end) f.value.segments = [{ start: sg.start || '', end: sg.end || '' }];
    f.value.breakMinutes = Number(sg.breakMinutes) || 0;
    if (sg.orderedBy) Object.assign(f.value.overtime, { orderedBy: sg.orderedBy, how: sg.how || 'angeordnet', reason: sg.reason || '' });
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
  fill(p);
}
function fill(p) {
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
  return dayResult(date.value, settings(), { segments: segs, breakMinutes: Number(f.value.breakMinutes) || 0 }, Object.values(store.data?.absences || {}).filter((a) => !a.cancelled));
});
const row = computed(() => (store.data ? dayRow(date.value) : null));
const overtime = computed(() => preview.value && preview.value.balance > 0);
const unsure = computed(() => parsed.value?.unsure || []);

async function save() {
  const segs = f.value.segments.filter((s) => s.start && s.end);
  const payload = {
    date: date.value, segments: segs, breakMinutes: Number(f.value.breakMinutes) || 0, breaks: [], note: f.value.note, location: f.value.location,
    source: f.value.source, fileId: f.value.fileId || '', spoken: f.value.spoken,
    overtime: overtime.value || f.value.overtime.orderedBy ? f.value.overtime : {},
  };
  await queueEvidence('time', payload, { label: 'Arbeitszeit' });
  if (route.query.entwurf) await deleteDraft(String(route.query.entwurf));
  toast('Arbeitszeit gespeichert');
  router.push('/zeit');
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
      <small v-if="audio?.text" class="muted" style="display: block; margin-top: 6px">Etwas falsch erkannt oder versprochen? Einfach nochmal sprechen, z. B. „Korrektur: Feierabend war um 17 Uhr“ – nur die genannten Angaben werden ersetzt.</small>
      <small v-if="listenHint && !audio" class="muted" style="display: block; margin-top: 8px">Beispiel: „Heute um halb acht angefangen, 30 Minuten Pause, Feierabend um 16 Uhr 15. Herr Maier hat die Überstunden angeordnet.“</small>
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
      <div v-for="(s, i) in f.segments" :key="i" class="row" style="margin-bottom: 8px">
        <input v-model="s.start" type="time" class="grow" aria-label="Beginn" />
        <span>–</span>
        <input v-model="s.end" type="time" class="grow" aria-label="Ende" />
        <button v-if="f.segments.length > 1" class="btn small ghost" @click="f.segments.splice(i, 1)"><Icon name="trash" :size="18" /></button>
      </div>
      <button class="btn small" @click="f.segments.push({ start: '', end: '' })"><Icon name="plus" :size="16" /> Abschnitt</button>
      <label class="f">Pause (Minuten)<span class="hint">Lücken zwischen Abschnitten zählen automatisch als Pause</span></label>
      <input v-model.number="f.breakMinutes" type="number" min="0" step="5" inputmode="numeric" />
      <label class="f">Ort / Einsatz (optional)</label><input v-model="f.location" />
      <label class="f">Notiz</label><textarea v-model="f.note" rows="2" placeholder="z. B. Dienstreise, Schulung, Rufbereitschaft" />

      <div v-if="preview && preview.gross" class="kpis" style="margin-top: 12px">
        <div class="kpi"><b>{{ fmtDur(preview.worked) }}</b><span>Arbeitszeit</span></div>
        <div class="kpi"><b>{{ preview.breakTaken }}</b><span>Pause Min.</span></div>
        <div class="kpi"><b :class="preview.balance < 0 ? 'neg' : 'pos'">{{ fmtDur(preview.balance, true) }}</b><span>Saldo Tag</span></div>
      </div>
      <div v-for="w in preview?.warnings || []" :key="w" class="alert warn" style="margin-top: 8px">{{ w }}</div>
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
      <p v-if="existing" class="muted">Gespeicherte Fassung vom {{ deTime(existing.receivedAt) }}: {{ existing.segments.map((s) => `${s.start}–${s.end}`).join(', ') }}, Pause {{ existing.breakMinutes }} Min.<template v-if="existing.history?.length"> · {{ existing.history.length }} frühere Fassung(en)</template></p>
      <small class="muted">Speichern legt eine neue Fassung an – die bisherigen bleiben in der Beweiskette erhalten.</small>
    </div>

    <button class="btn primary block" @click="save"><Icon name="check" :size="18" /> Speichern</button>
  </div>
</template>
