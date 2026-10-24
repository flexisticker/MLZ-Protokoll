<script setup>
import { onMounted, ref } from 'vue';
import Icon from '../components/Icon.vue';
import { api } from '../services/api.js';
import { removeOutboxItem, store, sync, toast } from '../services/store.js';
import { de, deTime, shortHash } from '../services/util.js';

const check = ref(null);
const anchors = ref([]);
const status = ref(null);
const busy = ref('');
const wcfg = ref({ model: 'small', modelFast: 'small', threads: 4 });
async function saveWhisper() {
  try { status.value.whisper = await api('/transcribe/config', { method: 'PUT', body: wcfg.value }); toast('Übernommen – fehlende Modelle werden geladen'); } catch (e) { toast(e.message); }
}
async function load() {
  try {
    [check.value, anchors.value, status.value] = await Promise.all([api('/verify'), api('/anchors'), api('/status')]);
    const w = status.value.whisper;
    wcfg.value = { model: w.model, modelFast: w.modelFast, threads: w.threads };
  } catch (e) { toast(e.message); }
}
onMounted(load);
async function run(what) {
  busy.value = what;
  try {
    if (what === 'check') check.value = await api('/verify?run=1');
    if (what === 'anchor') { const r = await api('/anchors/now', { method: 'POST', body: {} }); toast(r.skipped || 'Zeitstempel geholt'); anchors.value = await api('/anchors'); }
    if (what === 'backup') { const r = await api('/backup/now', { method: 'POST', body: {} }); toast(`Sicherung ${r.file} erstellt`); status.value = await api('/status'); }
  } catch (e) { toast(e.message); } finally { busy.value = ''; }
}
async function drop(o) { if (confirm('Diesen Eintrag aus der Warteschlange löschen? Er wird dann nicht mehr übertragen.')) await removeOutboxItem(o.id); }
</script>

<template>
  <div class="page">
    <div class="card">
      <h2>Beweiskette</h2>
      <template v-if="check">
        <div class="alert" :class="check.ok ? 'ok' : 'bad'">
          <b>{{ check.ok ? 'Unverändert' : 'FEHLER gefunden' }}</b> – geprüft {{ deTime(check.at) }}<br />
          {{ check.chain.entries }} Einträge<template v-if="check.chain.erased"> ({{ check.chain.erased }} nach Frist gelöscht)</template>, {{ check.files.files }} Originaldateien
          <template v-if="!check.chain.ok"><br />{{ check.chain.reason }}</template>
          <div v-for="p in check.files.problems" :key="p.id">Datei Nr. {{ p.seq }}: {{ p.problem }}</div>
        </div>
        <p class="mono">Letzter Prüfwert: {{ check.chain.head }}</p>
      </template>
      <button class="btn" :disabled="!!busy" @click="run('check')"><Icon name="shield" :size="18" /> Jetzt prüfen</button>
    </div>

    <div class="card">
      <h2>Zeitstempel</h2>
      <p class="muted" style="font-size: .9rem">Unabhängige Zeitstempeldienste bestätigen täglich (und kurz nach neuen Einträgen) den aktuellen Stand der Kette. Damit lässt sich belegen, dass Einträge nicht nachträglich erzeugt wurden.</p>
      <p v-if="status?.lastAnchorRun?.error" class="alert bad">Letzter Versuch fehlgeschlagen: {{ status.lastAnchorRun.error }}</p>
      <button class="btn" :disabled="!!busy" @click="run('anchor')"><Icon name="clock" :size="18" /> Jetzt Zeitstempel holen</button>
      <ul class="list" style="margin-top: 8px">
        <li v-for="a in anchors.slice(0, 30)" :key="a.id">
          <b>{{ de(a.day) }}</b> · bis Nr. {{ a.seq }} <span class="mono muted">{{ shortHash(a.head_hash) }}</span><br />
          <small v-for="r in a.results" :key="r.tsa" :class="r.ok ? '' : 'neg'" style="display: block">
            {{ r.tsa }}: {{ r.ok ? r.time : `fehlgeschlagen (${r.error})` }}<template v-if="r.ok"> · {{ r.verified ? 'Signatur geprüft' : `nicht geprüft: ${r.verifyError}` }}</template>
            <a v-if="r.file" :href="`/api/anchors/file/${r.file}`"> .tsr</a>
          </small>
          <small v-if="a.mailed_at" class="muted">per Mail gesendet {{ deTime(a.mailed_at) }}</small>
        </li>
      </ul>
    </div>

    <div class="card">
      <h2>Sicherung</h2>
      <p v-if="status?.lastBackup">Letzte Datenbanksicherung: {{ deTime(status.lastBackup.at) }} ({{ status.lastBackup.file }})</p>
      <p v-else class="muted">Noch keine Sicherung – sie läuft jede Nacht automatisch.</p>
      <p class="muted" style="font-size: .9rem">Die Sicherungen liegen im Datenordner unter <span class="mono">sicherungen/</span>. Für den Schutz vor Brand/Diebstahl den ganzen Datenordner verschlüsselt nach Google Drive sichern (Anleitung im Projekt: docs/SICHERUNG-GOOGLE-DRIVE.md).</p>
      <button class="btn" :disabled="!!busy" @click="run('backup')"><Icon name="download" :size="18" /> Jetzt sichern</button>
    </div>

    <div id="warteschlange" class="card">
      <h2>Warteschlange auf diesem Handy</h2>
      <div v-if="!store.outbox.length" class="empty">Alles übertragen.</div>
      <ul class="list">
        <li v-for="o in store.outbox" :key="o.id" class="row">
          <div class="grow"><b>{{ o.label }}</b><br /><small>{{ deTime(o.createdAt) }}</small><small v-if="o.error" class="neg"><br />{{ o.error }}</small></div>
          <button v-if="o.error" class="btn small ghost" @click="drop(o)"><Icon name="trash" :size="18" /></button>
        </li>
      </ul>
      <button v-if="store.outbox.length" class="btn" @click="sync()"><Icon name="sync" :size="18" /> Jetzt senden</button>
    </div>

    <div v-if="status" class="card">
      <h2>Spracherkennung</h2>
      <p :class="status.whisper.ready ? 'pos' : 'neg'">whisper.cpp {{ status.whisper.ready ? 'bereit' : 'nicht gefunden' }}<template v-if="status.whisper.sharedDir"> · Modelle der Video-Zentrale eingebunden</template></p>
      <label class="f">Modell für Diktate</label>
      <select v-model="wcfg.model"><option v-for="(m, k) in status.whisper.models" :key="k" :value="k">{{ k }} – {{ m.info }} ({{ m.installed ? (m.shared ? 'aus Video-Zentrale' : 'vorhanden') : `wird geladen, ${m.size}` }})</option></select>
      <label class="f">Modell für Arbeitszeit-Sätze<span class="hint">kurze Sätze – das schnelle Modell reicht meist</span></label>
      <select v-model="wcfg.modelFast"><option v-for="(m, k) in status.whisper.models" :key="k" :value="k">{{ k }}</option></select>
      <label class="f">Prozessorkerne</label>
      <input v-model.number="wcfg.threads" type="number" min="1" max="16" />
      <button class="btn" style="margin-top: 10px" @click="saveWhisper">Übernehmen</button>
      <p v-if="status.whisper.download" class="alert" :class="status.whisper.download.error ? 'bad' : ''" style="margin-top: 10px">
        <template v-if="status.whisper.download.error">{{ status.whisper.download.error }}</template>
        <template v-else>Lade Modell {{ status.whisper.download.model }} … {{ status.whisper.download.total ? Math.round(status.whisper.download.done / status.whisper.download.total * 100) : '?' }} %</template>
      </p>
      <p class="muted" style="font-size: .9rem; margin-top: 8px">Warteschlange: {{ status.whisper.queue }}<template v-if="status.whisper.last?.ok"> · zuletzt {{ status.whisper.last.seconds }} s Rechenzeit für {{ status.whisper.last.audioSec || '?' }} s Ton ({{ status.whisper.last.model }})</template><template v-if="status.whisper.last && !status.whisper.last.ok"> · letzter Fehler: {{ status.whisper.last.error }}</template></p>
      <p class="muted" style="font-size: .85rem">Version {{ status.version }}</p>
    </div>
  </div>
</template>
