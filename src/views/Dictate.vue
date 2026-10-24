<script setup>
// Entwurf eines Logbuch-Eintrags: diktieren, Fotos, Leitfragen – dann festschreiben.
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import Recorder from '../components/Recorder.vue';
import FileItem from '../components/FileItem.vue';
import Modal from '../components/Modal.vue';
import { deleteDraft, finalizeDraft, newDraft, queueEvidence, queueFile, saveDraft, settings, store, toast } from '../services/store.js';
import { webSpeech, webSpeechAvailable } from '../services/recorder.js';
import { CATEGORIES } from '../services/categories.js';
import { debounce, localNow, uuid } from '../services/util.js';

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
    draft = newDraft(route.query.bereich === 'br' ? 'br' : 'incident');
    await saveDraft(draft);
    router.replace(`/diktat/${draft.id}${route.query.foto ? '?foto=1' : ''}`);
  }
  d.value = JSON.parse(JSON.stringify(draft));
  if (route.query.foto) setTimeout(() => document.getElementById('photo-input')?.click(), 300);
});
const save = debounce(() => { if (d.value) saveDraft(d.value); }, 600);
watch(d, save, { deep: true });
onBeforeUnmount(() => { if (d.value && store.drafts.some((x) => x.id === d.value.id)) saveDraft(d.value); live.value?.(); });

const cats = computed(() => CATEGORIES[d.value?.section] || []);
const late = computed(() => d.value && d.value.eventAt && (Date.now() - new Date(d.value.eventAt).getTime()) > 36 * 3600e3);
const cases = computed(() => Object.values(store.data?.cases || {}).filter((c) => !c.closed));

async function recorded({ blob, startedAt, durationSec }) {
  const f = await queueFile(blob, { purpose: 'audio', draftId: d.value.id, capturedAt: startedAt, durationSec });
  d.value.fileIds.push(f.id);
  d.value.files[f.id] = { purpose: 'audio', mime: f.mime, size: f.size, capturedAt: f.capturedAt, durationSec, sha256: f.sha256 };
  saveDraft(d.value);
  toast('Aufnahme gespeichert – Text wird erkannt');
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
function onTranscript(fid, text) {
  if (!d.value || d.value.applied.includes(fid) || !text || text === '(keine Sprache erkannt)') return;
  d.value.applied.push(fid);
  d.value.facts = d.value.facts.trim() ? `${d.value.facts.trim()}\n\n${text}` : text;
  toast('Erkannter Text in „Was ist passiert?“ übernommen – bitte prüfen');
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
const setNow = () => { d.value.eventAt = localNow(); };
</script>

<template>
  <div v-if="d" class="page">
    <div class="seg" style="margin-bottom: 12px">
      <button :class="{ on: d.section === 'incident' }" @click="d.section = 'incident'">Auffälligkeit</button>
      <button :class="{ on: d.section === 'br' }" @click="d.section = 'br'">Betriebsrat</button>
    </div>

    <div class="card">
      <Recorder label="Diktieren" @recorded="recorded" />
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

    <FileItem v-for="fid in d.fileIds" :id="fid" :key="fid" :meta="d.files[fid]" removable @remove="removeFile(fid)" @transcript="onTranscript(fid, $event)" />

    <div class="card">
      <h3>Wann?</h3>
      <div class="row">
        <input v-model="d.eventAt" type="datetime-local" class="grow" />
        <button class="btn small" type="button" @click="setNow">Jetzt</button>
      </div>
      <label class="f">bis (Uhrzeit, optional)</label>
      <input v-model="d.eventEnd" type="time" />
      <template v-if="late">
        <label class="f">Warum erst jetzt erfasst?<span class="hint">Liegt das Geschehen länger zurück, das offen angeben (z. B. „erst abends Zeit“).</span></label>
        <input v-model="d.delayReason" />
      </template>

      <label class="f">Kurztitel</label>
      <input v-model="d.title" placeholder="z. B. Anweisung Mehrarbeit ohne Ankündigung" />
      <label class="f">Art</label>
      <select v-model="d.category"><option value="">– wählen –</option><option v-for="c in cats" :key="c">{{ c }}</option></select>
      <label class="f">Wo?</label>
      <input v-model="d.location" placeholder="Ort, Abteilung, Raum, Telefon, Mail …" />
    </div>

    <div class="card">
      <h3>Was ist passiert? <small>(nur Tatsachen)</small></h3>
      <textarea v-model="d.facts" rows="7" placeholder="Wer hat was getan oder gesagt? Reihenfolge, Uhrzeiten, Umstände. Keine Bewertungen – die kommen unten." />
      <label class="f">Wörtliche Äußerungen<span class="hint">möglichst genau, in Anführungszeichen, mit wer hat es gesagt</span></label>
      <textarea v-model="d.quotes" rows="3" placeholder="Herr X: „…“" />
      <label class="f">Beteiligte Personen<span class="hint">Name und Funktion – nur so viel wie nötig</span></label>
      <input v-model="d.persons" />
      <label class="f">Zeugen / wer war dabei?</label>
      <input v-model="d.witnesses" />
      <label class="f">Folgen<span class="hint">für Arbeit, Arbeitszeit, Gesundheit, BR-Arbeit</span></label>
      <textarea v-model="d.consequences" rows="2" />
      <label class="f">Meine Reaktion / Meldung<span class="hint">was ich gesagt/getan habe, wem gemeldet (wann, wie)</span></label>
      <textarea v-model="d.reaction" rows="2" />
      <label class="f">Meine Bewertung<span class="hint">getrennt von den Tatsachen – wie habe ich es empfunden?</span></label>
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
