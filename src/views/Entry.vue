<script setup>
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import Icon from '../components/Icon.vue';
import Recorder from '../components/Recorder.vue';
import FileItem from '../components/FileItem.vue';
import Modal from '../components/Modal.vue';
import { queueEvidence, queueFile, store, toast } from '../services/store.js';
import { SECTION_LABEL } from '../services/categories.js';
import { deLocal, deTime, shortHash, uuid } from '../services/util.js';

const route = useRoute();
const e = computed(() => store.data?.entries?.[route.params.id]);
const pendingEntry = computed(() => store.outbox.find((o) => o.id === route.params.id));
const add = ref(null); // { text, reason, fileIds, files }
const retract = ref(null);
const showChain = ref(false);

function startAdd() { add.value = { text: '', reason: '', fileIds: [], files: {}, applied: [] }; }
async function recorded({ blob, startedAt, durationSec }) {
  const f = await queueFile(blob, { purpose: 'audio', capturedAt: startedAt, durationSec });
  add.value.fileIds.push(f.id);
  add.value.files[f.id] = { purpose: 'audio', mime: f.mime, size: f.size, capturedAt: f.capturedAt, durationSec };
}
async function pick(ev) {
  for (const file of ev.target.files || []) {
    const f = await queueFile(file, { purpose: file.type.startsWith('image/') ? 'photo' : 'attachment', name: file.name, capturedAt: new Date(file.lastModified || Date.now()).toISOString() });
    add.value.fileIds.push(f.id);
    add.value.files[f.id] = { purpose: 'photo', mime: f.mime, size: f.size, capturedAt: f.capturedAt };
  }
  ev.target.value = '';
}
function tr(fid, text) {
  if (add.value.applied.includes(fid)) return;
  add.value.applied.push(fid);
  add.value.text = add.value.text.trim() ? `${add.value.text.trim()}\n\n${text}` : text;
}
async function saveAdd() {
  await queueEvidence('addendum', { text: add.value.text, reason: add.value.reason, fileIds: add.value.fileIds }, { ref: e.value.id, id: uuid(), label: 'Nachtrag' });
  add.value = null;
  toast('Nachtrag festgeschrieben');
}
async function saveRetract() {
  await queueEvidence('retract', { reason: retract.value }, { ref: e.value.id, label: 'Zurückziehen' });
  retract.value = null;
}
const caseTitle = computed(() => e.value?.caseId && store.data.cases[e.value.caseId]?.title);
</script>

<template>
  <div class="page">
    <div v-if="!e" class="empty">
      <template v-if="pendingEntry">Der Eintrag ist festgeschrieben und wartet auf die Übertragung zum Server (offline).</template>
      <template v-else>Eintrag nicht gefunden.</template>
    </div>
    <template v-else-if="e.erased"><div class="alert">Inhalt nach Ablauf der Aufbewahrungsfrist gelöscht. Prüfwert bleibt erhalten: <span class="mono">{{ e.hash }}</span></div></template>
    <template v-else>
      <div class="card">
        <span class="badge" :class="e.section === 'br' ? 'br' : 'inc'">{{ SECTION_LABEL[e.section] }}</span>
        <span v-if="e.category" class="badge">{{ e.category }}</span>
        <span v-if="caseTitle" class="badge">{{ caseTitle }}</span>
        <h1 style="margin-top: 8px">{{ e.title || 'Eintrag' }}</h1>
        <p><b>{{ deLocal(e.eventAt) }}<template v-if="e.eventEnd"> – {{ e.eventEnd }}</template></b><template v-if="e.location"> · {{ e.location }}</template></p>
        <div v-if="e.retracted" class="alert warn">Zurückgezogen am {{ deTime(e.retracted.receivedAt) }}: {{ e.retracted.reason }}</div>
        <h3>Was ist passiert?</h3><p class="pre">{{ e.facts }}</p>
        <template v-if="e.quotes"><h3>Wörtliche Äußerungen</h3><p class="quote">{{ e.quotes }}</p></template>
        <template v-if="e.persons"><h3>Beteiligte</h3><p>{{ e.persons }}</p></template>
        <template v-if="e.witnesses"><h3>Zeugen</h3><p>{{ e.witnesses }}</p></template>
        <template v-if="e.consequences"><h3>Folgen</h3><p class="pre">{{ e.consequences }}</p></template>
        <template v-if="e.reaction"><h3>Reaktion / Meldung</h3><p class="pre">{{ e.reaction }}</p></template>
        <template v-if="e.assessment"><h3>Bewertung</h3><p class="pre muted">{{ e.assessment }}</p></template>
        <template v-if="e.delayReason"><h3>Spätere Erfassung</h3><p>{{ e.delayReason }}</p></template>
      </div>

      <FileItem v-for="fid in e.fileIds" :id="fid" :key="fid" show-hash />

      <div v-for="a in e.addenda" :key="a.evidenceId" class="card">
        <h3>Nachtrag vom {{ deTime(a.receivedAt) }}</h3>
        <p v-if="a.reason" class="muted">Grund: {{ a.reason }}</p>
        <p class="pre">{{ a.text }}</p>
        <FileItem v-for="fid in a.fileIds || []" :id="fid" :key="fid" show-hash />
      </div>

      <div class="card">
        <button class="row btn ghost small" style="padding: 0" @click="showChain = !showChain"><Icon name="hash" :size="18" /> Nachweis-Daten</button>
        <div v-if="showChain" style="margin-top: 8px; font-size: .88rem">
          <div>Nr. {{ e.seq }} in der Beweiskette</div>
          <div>Ereignis: {{ deLocal(e.eventAt) }}</div>
          <div>Erfasst am Handy: {{ deTime(e.capturedAt) }}</div>
          <div>Eingang Server: {{ deTime(e.receivedAt) }}</div>
          <div>Gerät: {{ e.device }}</div>
          <div class="mono">Prüfwert: {{ e.hash }}</div>
        </div>
      </div>

      <div class="row">
        <button class="btn primary grow" @click="startAdd"><Icon name="plus" :size="18" /> Nachtrag</button>
        <button v-if="!e.retracted" class="btn" @click="retract = ''">Zurückziehen</button>
      </div>
      <p class="muted" style="font-size: .85rem">Festgeschriebene Einträge sind unveränderbar. Fehler und Ergänzungen bitte als Nachtrag festhalten.</p>
    </template>

    <Modal v-if="add" title="Nachtrag" @close="add = null">
      <Recorder label="Nachtrag diktieren" @recorded="recorded" />
      <FileItem v-for="fid in add.fileIds" :id="fid" :key="fid" :meta="add.files[fid]" @transcript="tr(fid, $event)" />
      <label class="btn small" style="margin-top: 8px"><Icon name="camera" :size="18" /> Foto / Datei<input type="file" accept="image/*,application/pdf" hidden @change="pick" /></label>
      <label class="f">Grund<span class="hint">z. B. Korrektur, neue Information, Zeuge bestätigt</span></label>
      <input v-model="add.reason" />
      <label class="f">Text</label>
      <textarea v-model="add.text" rows="5" />
      <div class="actions"><button class="btn" @click="add = null">Abbrechen</button><button class="btn primary" :disabled="!add.text.trim() && !add.fileIds.length" @click="saveAdd">Festschreiben</button></div>
    </Modal>
    <Modal v-if="retract !== null" title="Eintrag zurückziehen" @close="retract = null">
      <p>Der Eintrag bleibt erhalten, wird aber als zurückgezogen gekennzeichnet (z. B. irrtümlich erfasst). Bitte den Grund angeben.</p>
      <textarea v-model="retract" rows="3" />
      <div class="actions"><button class="btn" @click="retract = null">Abbrechen</button><button class="btn danger" :disabled="!retract.trim()" @click="saveRetract">Zurückziehen</button></div>
    </Modal>
  </div>
</template>
