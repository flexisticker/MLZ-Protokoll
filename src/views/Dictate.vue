<script setup>
// Entwurf eines Logbuch-Eintrags: diktieren, Fotos, Leitfragen – dann festschreiben.
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import Recorder from '../components/Recorder.vue';
import FileItem from '../components/FileItem.vue';
import Modal from '../components/Modal.vue';
import { deleteDraft, draftHasContent, finalizeDraft, newDraft, queueEvidence, queueFile, saveDraft, settings, store, toast } from '../services/store.js';
import { api } from '../services/api.js';
import { KINDS, extractWhen, mergeAssist, titleFrom } from '../../shared/assist.js';
import { webSpeech, webSpeechAvailable } from '../services/recorder.js';
import { CATEGORIES } from '../services/categories.js';
import { debounce, deTime, localNow, uuid, toB64 } from '../services/util.js';

const route = useRoute();
const router = useRouter();
const d = ref(null);
const confirm = ref(false);
const askDelete = ref(false);
const newCase = reactive({ open: false, title: '' });
const live = ref(null);
const liveText = ref('');
const busy = ref(false);

onMounted(async () => {
  const id = route.params.id;
  let draft = id && store.drafts.find((x) => x.id === id);
  if (!draft) {
    // erst nur im Speicher – gespeichert wird der Entwurf, sobald etwas aufgenommen, fotografiert oder geschrieben ist
    draft = newDraft(route.query.bereich === 'br' ? 'br' : 'incident', { sectionChosen: route.query.bereich === 'br' });
  }
  d.value = JSON.parse(JSON.stringify(draft));
  if (route.query.foto) setTimeout(() => document.getElementById('photo-input')?.click(), 300);
});
const stored = () => d.value && store.drafts.some((x) => x.id === d.value.id);
const save = debounce(() => { if (d.value && (stored() || draftHasContent(d.value))) saveDraft(d.value); }, 600);
watch(d, save, { deep: true });
onBeforeUnmount(() => {
  clearInterval(poll); live.value?.();
  if (!d.value) return;
  if (draftHasContent(d.value)) saveDraft(d.value);
  else if (stored()) deleteDraft(d.value.id); // alles wieder geleert → kein leerer Entwurf zurücklassen
});

// ------------------------------------------------------------ KI-Ausfüllhilfe
const assistOn = computed(() => store.assist?.engine && store.assist.engine !== 'off');
const st = computed(() => d.value?.assist?.status || '');
const waiting = computed(() => d.value?.assistWanted && ['upload', 'transcribing', 'queued', 'running'].includes(st.value));
// Markierung: Feld stammt unverändert von der KI bzw. aus der Regel-Erkennung („aus Text“)
const mark = (f) => {
  const v = d.value?.[f];
  if (!v) return '';
  if (d.value.aiFields?.[f] === v) return 'KI';
  if (d.value.autoFields?.[f] === v) return 'aus Text';
  return '';
};
let poll = setInterval(async () => {
  if (!d.value?.assistWanted || !['upload', 'transcribing', 'queued', 'running', ''].includes(st.value) || !store.online) return;
  try {
    const server = await api(`/drafts/${d.value.id}`);
    const before = d.value.assist?.status;
    d.value = mergeAssist(d.value, server);
    if (before !== 'done' && d.value.assist?.status === 'done') toast('Von der KI ausgefüllt – bitte prüfen');
    if (d.value.assist?.status === 'off') pasteTranscripts();
  } catch { /* noch nicht beim Server */ }
}, 4000);
async function runAssist() {
  try { d.value = mergeAssist(d.value, await api(`/assist/draft/${d.value.id}`, { method: 'POST', body: {} })); d.value.assistWanted = true; } catch (e) { toast(e.message); }
}
function pasteTranscripts() {
  for (const fid of d.value.fileIds) {
    const t = store.data?.transcripts?.[fid]?.text;
    if (t && !d.value.applied.includes(fid)) onTranscript(fid, t, true);
  }
}
const suggestionKind = computed(() => { const k = d.value?.assist?.status === 'done' && d.value.suggestion?.kind; return ['time', 'absence', 'brtime'].includes(k) && !d.value.keepEntry ? k : ''; });
function useSuggestion() {
  const sg = d.value.suggestion;
  const q = { entwurf: d.value.id };
  if (sg.kind === 'time') router.push({ path: `/zeit/tag/${sg.time.date}`, query: { ...q, vorschlag: toB64({ ...sg.time, spoken: sg.spoken, fileId: d.value.fileIds.find((f) => d.value.files[f]?.purpose === 'audio') || '' }) } });
  if (sg.kind === 'absence') router.push({ path: '/abwesenheit', query: { ...q, vorschlag: toB64(sg.absence) } });
  if (sg.kind === 'brtime') router.push({ path: '/betriebsrat', query: { ...q, vorschlag: toB64(sg.brtime) } });
}
function keepAsEntry() {
  d.value.keepEntry = true;
  if (!d.value.facts && d.value.suggestion?.spoken) d.value.facts = d.value.suggestion.spoken;
}

const cats = computed(() => CATEGORIES[d.value?.section] || []);
// Zeitpunkte: Geschehen (Angabe) ↔ Aufnahme am Handy ↔ Eingang beim Server (beide automatisch, unveränderbar)
const firstAudio = computed(() => (d.value?.fileIds || []).map((f) => ({ id: f, ...(d.value.files?.[f] || {}) })).filter((f) => f.capturedAt)
  .sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)))[0] || null);
const captured = computed(() => firstAudio.value?.capturedAt || '');
const received = computed(() => (firstAudio.value && store.data?.files?.[firstAudio.value.id]?.receivedAt) || '');
const gapText = computed(() => {
  if (!d.value?.eventAt || !captured.value) return '';
  const min = Math.round((new Date(captured.value) - new Date(d.value.eventAt)) / 60000);
  if (min < 0) return 'Geschehen liegt nach der Aufnahme – bitte Zeitpunkt prüfen';
  if (min < 60) return `${min} Min. nach dem Geschehen aufgenommen`;
  if (min < 48 * 60) return `${Math.round(min / 60)} Std. nach dem Geschehen aufgenommen`;
  return `${Math.round(min / 1440)} Tage nach dem Geschehen aufgenommen`;
});
const late = computed(() => d.value && d.value.eventAt && ((captured.value ? new Date(captured.value) : Date.now()) - new Date(d.value.eventAt).getTime()) > 36 * 3600e3);
const cases = computed(() => Object.values(store.data?.cases || {}).filter((c) => !c.closed));

async function recorded({ blob, startedAt, durationSec }) {
  const withAi = assistOn.value;
  if (withAi) { d.value.assistWanted = true; d.value.assist = { ...(d.value.assist || {}), status: 'upload' }; }
  const f = await queueFile(blob, { purpose: 'audio', draftId: d.value.id, capturedAt: startedAt, durationSec, assist: withAi });
  d.value.fileIds.push(f.id);
  d.value.files[f.id] = { purpose: 'audio', mime: f.mime, size: f.size, capturedAt: f.capturedAt, durationSec, sha256: f.sha256 };
  saveDraft(d.value);
  toast(withAi ? 'Aufnahme gespeichert – die App erkennt den Text und füllt aus' : 'Aufnahme gespeichert – Text wird erkannt');
}
async function pick(e, purpose) {
  for (const file of e.target.files || []) {
    const f = await queueFile(file, { purpose, name: file.name, draftId: d.value.id, capturedAt: new Date(file.lastModified || Date.now()).toISOString() });
    d.value.fileIds.push(f.id);
    d.value.files[f.id] = { purpose, mime: f.mime, size: f.size, capturedAt: f.capturedAt, name: file.name, sha256: f.sha256 };
  }
  e.target.value = '';
  saveDraft(d.value);
}
function onTranscript(fid, text, force = false) {
  if (!d.value || d.value.applied.includes(fid) || !text || text === '(keine Sprache erkannt)') return;
  if (!force && d.value.assistWanted && st.value !== 'off') return; // die KI füllt die Felder aus
  d.value.applied.push(fid);
  d.value.facts = d.value.facts.trim() ? `${d.value.facts.trim()}\n\n${text}` : text;
  // ohne KI: Zeitpunkt und Kurztitel mit festen Regeln aus dem Text lesen
  const auto = { ...(d.value.autoFields || {}) };
  const w = extractWhen(text, localNow().slice(0, 10));
  if ((w.time || w.date) && (d.value.eventAtAuto || d.value.eventAt === auto.eventAt)) {
    d.value.eventAt = `${w.date || (d.value.eventAt || localNow()).slice(0, 10)}T${w.time || (d.value.eventAt || localNow()).slice(11, 16)}`;
    auto.eventAt = d.value.eventAt; d.value.eventAtAuto = false;
  }
  if (w.end && (!d.value.eventEnd || d.value.eventEnd === auto.eventEnd)) { d.value.eventEnd = w.end; auto.eventEnd = w.end; }
  if (!d.value.title) { d.value.title = titleFrom(text); auto.title = d.value.title; }
  d.value.autoFields = auto;
  toast('Erkannter Text übernommen – Zeitpunkt und Titel bitte prüfen');
}
function removeFile(fid) {
  d.value.fileIds = d.value.fileIds.filter((x) => x !== fid);
}
function startLive() {
  liveText.value = '';
  live.value = webSpeech((t) => { liveText.value = t; }, (final) => {
    live.value = null;
    if (final) d.value.facts = d.value.facts.trim() ? `${d.value.facts.trim()}\n${final}` : final;
  });
}
async function addCase() {
  if (!newCase.title.trim()) return;
  const id = uuid();
  await queueEvidence('case', { id, title: newCase.title.trim() }, { id, label: 'Vorgang' });
  d.value.caseId = id;
  newCase.open = false; newCase.title = '';
}
const problems = computed(() => {
  const p = [];
  if (!d.value) return p;
  if (!d.value.eventAt) p.push('Zeitpunkt des Geschehens fehlt');
  if (!d.value.facts.trim()) p.push('„Was ist passiert?“ ist leer');
  if (late.value && !d.value.delayReason.trim()) p.push('Bitte angeben, warum erst später erfasst wird');
  if (d.value.fileIds.some((f) => store.data?.files?.[f] === undefined && !store.outbox.some((o) => o.id === f))) p.push('Eine Datei fehlt – bitte aus dem Entwurf nehmen');
  return p;
});
async function finalize() {
  busy.value = true;
  try {
    const id = await finalizeDraft(d.value);
    d.value = null;
    toast('Eintrag festgeschrieben');
    router.replace(`/eintrag/${id}`);
  } finally { busy.value = false; confirm.value = false; }
}
async function remove() {
  await deleteDraft(d.value.id);
  d.value = null;
  router.replace('/logbuch');
}
const setNow = () => { d.value.eventAt = localNow(); d.value.eventAtAuto = false; };
</script>

<template>
  <div v-if="d" class="page">
    <div class="seg" style="margin-bottom: 12px">
      <button :class="{ on: d.section === 'incident' }" @click="d.section = 'incident'; d.sectionChosen = true">Auffälligkeit</button>
      <button :class="{ on: d.section === 'br' }" @click="d.section = 'br'; d.sectionChosen = true">Betriebsrat</button>
    </div>

    <div class="card">
      <Recorder :label="d.fileIds.some((f) => d.files[f]?.purpose === 'audio') ? 'Ergänzen oder korrigieren' : 'Diktieren'" @recorded="recorded" />
      <div v-if="settings().webSpeech && webSpeechAvailable()" style="margin-top: 10px">
        <button v-if="!live" class="btn small" type="button" @click="startLive">Live-Diktat (Google)</button>
        <button v-else class="btn small rec" type="button" @click="live()">Live-Diktat beenden</button>
        <p v-if="live" class="quote" style="margin-top: 6px">{{ liveText || '…' }}</p>
      </div>
      <div class="row wrap" style="margin-top: 12px">
        <label class="btn small"><Icon name="camera" :size="18" /> Foto<input id="photo-input" type="file" accept="image/*" capture="environment" hidden @change="pick($event, 'photo')" /></label>
        <label class="btn small"><Icon name="paperclip" :size="18" /> Bild/PDF<input type="file" accept="image/*,application/pdf" multiple hidden @change="pick($event, 'attachment')" /></label>
      </div>
      <small class="muted" style="display: block; margin-top: 6px">Zustände fotografieren (Aushang, Mangel, Dienstplan), keine Personen. Keine vertraulichen Firmenunterlagen abfotografieren.</small>
    </div>

    <div v-if="d.source?.text" class="alert">
      <small class="muted">{{ d.source.kind === 'time-note' ? 'Bemerkung zur Arbeitszeit' : 'Notiz aus der früheren Zeiterfassung (ibuchron)' }} vom {{ d.source.date.split('-').reverse().join('.') }}<template v-if="d.source.start">, Arbeitszeit {{ d.source.start }}–{{ d.source.end }}</template>:</small><br />
      „{{ d.source.text }}“
      <div v-if="!String(d.facts || '').includes(d.source.text)" style="margin-top: 6px"><button class="btn small" @click="d.facts = [d.facts, d.source.text].filter(Boolean).join('\n')">In „Was ist passiert“ übernehmen</button></div>
    </div>

    <div v-if="d.assistWanted && st" class="alert" :class="{ ok: st === 'done', bad: st === 'error', warn: suggestionKind }">
      <template v-if="st === 'upload'">⏳ Aufnahme wird hochgeladen …</template>
      <template v-else-if="st === 'transcribing'">⏳ Sprache wird erkannt …</template>
      <template v-else-if="st === 'queued' || st === 'running'">✨ Die KI füllt die Felder aus … <small>(lokal 1–3 Min. – du kannst die App schließen, der Entwurf wartet unter „Logbuch → Entwürfe“)</small></template>
      <template v-else-if="st === 'error'">
        KI-Ausfüllen fehlgeschlagen: {{ d.assist.error }}
        <div class="row wrap" style="margin-top: 6px"><button class="btn small" @click="runAssist">Erneut</button><button class="btn small" @click="pasteTranscripts">Text selbst übernehmen</button></div>
      </template>
      <template v-else-if="st === 'done' && suggestionKind">
        Das klingt nach <b>{{ KINDS[suggestionKind] }}</b>, nicht nach einem Logbuch-Eintrag.
        <div class="row wrap" style="margin-top: 6px"><button class="btn small primary" @click="useSuggestion">Als {{ KINDS[suggestionKind] }} erfassen</button><button class="btn small" @click="keepAsEntry">Doch als Logbuch-Eintrag</button></div>
      </template>
      <template v-else-if="st === 'done'">
        ✨ Von der KI ausgefüllt ({{ d.assist.engine }}, {{ d.assist.seconds }} s). <b>Bitte jedes Feld prüfen</b> – mit „KI“ markierte Felder stammen unverändert von ihr.
        <div v-if="d.assist.missing?.length" style="margin-top: 6px"><b>Es fehlt noch:</b><div v-for="q in d.assist.missing" :key="q">• {{ q }}</div></div>
        <small style="display: block; margin-top: 6px">Etwas fehlt oder ist falsch? Oben auf „Ergänzen oder korrigieren“ und einfach sprechen, z. B. „Korrektur: Es war nicht 10 bis 12, sondern 10 bis 13 Uhr“. Was du selbst geändert hast, bleibt so.</small>
      </template>
    </div>
    <button v-if="assistOn && !d.assistWanted && d.fileIds.some((f) => store.data?.transcripts?.[f])" class="btn block" style="margin-bottom: 12px" @click="runAssist">✨ Von der KI ausfüllen lassen</button>

    <FileItem v-for="fid in d.fileIds" :id="fid" :key="fid" :meta="d.files[fid]" removable @remove="removeFile(fid)" @transcript="onTranscript(fid, $event)" />

    <div class="card">
      <h3>Wann? <span v-if="mark('eventAt')" class="badge ai">{{ mark('eventAt') }}</span></h3>
      <div class="row">
        <input v-model="d.eventAt" type="datetime-local" class="grow" @input="d.eventAtAuto = false" />
        <button class="btn small" type="button" @click="setNow">Jetzt</button>
      </div>
      <div v-if="captured" class="muted" style="font-size: .85rem; margin-top: 8px; line-height: 1.5">
        🎙 aufgenommen am Handy: <b>{{ deTime(captured) }}</b><br />
        🖥 beim Server eingegangen: <b>{{ received ? deTime(received) : 'noch nicht (wird gesendet)' }}</b><br />
        <span :class="gapText.startsWith('Geschehen') ? 'neg' : ''">{{ gapText }}</span>
        <small style="display: block">Diese Zeiten setzt die App automatisch und unveränderbar.</small>
      </div>
      <label class="f">bis (Uhrzeit, optional) <span v-if="mark('eventEnd')" class="badge ai">{{ mark('eventEnd') }}</span></label>
      <input v-model="d.eventEnd" type="time" />
      <template v-if="late">
        <label class="f">Warum erst jetzt erfasst?<span class="hint">Liegt das Geschehen länger zurück, das offen angeben (z. B. „erst abends Zeit“).</span></label>
        <input v-model="d.delayReason" />
      </template>

      <label class="f">Kurztitel <span v-if="mark('title')" class="badge ai">{{ mark('title') }}</span></label>
      <input v-model="d.title" placeholder="z. B. Anweisung Mehrarbeit ohne Ankündigung" />
      <label class="f">Art <span v-if="mark('category')" class="badge ai">{{ mark('category') }}</span></label>
      <select v-model="d.category"><option value="">– wählen –</option><option v-for="c in cats" :key="c">{{ c }}</option></select>
      <label class="f">Wo? <span v-if="mark('location')" class="badge ai">{{ mark('location') }}</span></label>
      <input v-model="d.location" placeholder="Ort, Abteilung, Raum, Telefon, Mail …" />
    </div>

    <div class="card">
      <h3>Was ist passiert? <small>(nur Tatsachen)</small> <span v-if="mark('facts')" class="badge ai">{{ mark('facts') }}</span></h3>
      <textarea v-model="d.facts" rows="7" placeholder="Wer hat was getan oder gesagt? Reihenfolge, Uhrzeiten, Umstände. Keine Bewertungen – die kommen unten." />
      <label class="f">Wörtliche Äußerungen <span v-if="mark('quotes')" class="badge ai">{{ mark('quotes') }}</span><span class="hint">möglichst genau, in Anführungszeichen, mit wer hat es gesagt</span></label>
      <textarea v-model="d.quotes" rows="3" placeholder="Herr X: „…“" />
      <label class="f">Beteiligte Personen <span v-if="mark('persons')" class="badge ai">{{ mark('persons') }}</span><span class="hint">Name und Funktion – nur so viel wie nötig</span></label>
      <input v-model="d.persons" />
      <label class="f">Zeugen / wer war dabei? <span v-if="mark('witnesses')" class="badge ai">{{ mark('witnesses') }}</span></label>
      <input v-model="d.witnesses" />
      <label class="f">Folgen <span v-if="mark('consequences')" class="badge ai">{{ mark('consequences') }}</span><span class="hint">für Arbeit, Arbeitszeit, Gesundheit, BR-Arbeit</span></label>
      <textarea v-model="d.consequences" rows="2" />
      <label class="f">Meine Reaktion / Meldung <span v-if="mark('reaction')" class="badge ai">{{ mark('reaction') }}</span><span class="hint">was ich gesagt/getan habe, wem gemeldet (wann, wie)</span></label>
      <textarea v-model="d.reaction" rows="2" />
      <label class="f">Meine Bewertung <span v-if="mark('assessment')" class="badge ai">{{ mark('assessment') }}</span><span class="hint">getrennt von den Tatsachen – wie habe ich es empfunden?</span></label>
      <textarea v-model="d.assessment" rows="2" />
    </div>

    <div class="card">
      <h3>Vorgang</h3>
      <div class="row">
        <select v-model="d.caseId" class="grow"><option value="">– keiner –</option><option v-for="c in cases" :key="c.id" :value="c.id">{{ c.title }}</option></select>
        <button class="btn small" type="button" @click="newCase.open = true"><Icon name="plus" :size="18" /></button>
      </div>
      <small class="muted">Zusammengehörige Einträge (z. B. „Überstunden 2026“) lassen sich gemeinsam exportieren.</small>
    </div>

    <div v-if="problems.length" class="alert warn"><div v-for="p in problems" :key="p">• {{ p }}</div></div>
    <div class="row">
      <button class="btn danger" type="button" @click="askDelete = true"><Icon name="trash" :size="18" /></button>
      <button class="btn primary grow" type="button" :disabled="problems.length > 0 || busy" @click="confirm = true"><Icon name="lock" :size="18" /> Festschreiben</button>
    </div>
    <p class="muted" style="font-size: .85rem">Der Entwurf wird automatisch gespeichert (auch ohne Netz). Erst „Festschreiben“ trägt ihn unveränderbar in die Beweiskette ein.</p>

    <Modal v-if="confirm" title="Eintrag festschreiben?" @close="confirm = false">
      <p>Danach ist der Eintrag <b>nicht mehr änderbar</b>. Korrekturen und Ergänzungen sind nur noch als datierter Nachtrag möglich – so bleibt erkennbar, was wann notiert wurde.</p>
      <p class="muted">Bitte kurz prüfen: Stimmen Zeitpunkt, Namen und Zitate? Ist der erkannte Text korrigiert?</p>
      <div class="actions"><button class="btn" @click="confirm = false">Weiter bearbeiten</button><button class="btn primary" :disabled="busy" @click="finalize">Festschreiben</button></div>
    </Modal>
    <Modal v-if="askDelete" title="Entwurf verwerfen?" @close="askDelete = false">
      <p>Der Entwurf wird gelöscht. Bereits gesendete Sprachaufnahmen und Fotos bleiben in der Beweiskette erhalten (sie sind dort schon unveränderbar eingetragen).</p>
      <div class="actions"><button class="btn" @click="askDelete = false">Abbrechen</button><button class="btn danger" @click="remove">Verwerfen</button></div>
    </Modal>
    <Modal v-if="newCase.open" title="Neuer Vorgang" @close="newCase.open = false">
      <label class="f">Bezeichnung</label><input v-model="newCase.title" placeholder="z. B. Überstunden Lager 2026" />
      <div class="actions"><button class="btn" @click="newCase.open = false">Abbrechen</button><button class="btn primary" @click="addCase">Anlegen</button></div>
    </Modal>
  </div>
</template>
