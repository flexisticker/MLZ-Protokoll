<script setup>
// Eine Anlage: Ton (mit Transkript-Status), Foto oder Datei. Noch nicht gesendete Dateien kommen aus der Warteschlange.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icon from './Icon.vue';
import { api } from '../services/api.js';
import { pendingBlob, store } from '../services/store.js';
import { bytes, deTime, shortHash } from '../services/util.js';

const props = defineProps({ id: String, meta: Object, removable: Boolean, showHash: Boolean });
const emit = defineEmits(['remove', 'transcript']);
const local = ref('');
const tr = ref(null);
let poll;

const server = computed(() => store.data?.files?.[props.id]);
const info = computed(() => server.value || props.meta || {});
const pending = computed(() => store.outbox.some((o) => o.id === props.id));
const isAudio = computed(() => String(info.value.purpose || info.value.mime || '').includes('audio'));
const isImage = computed(() => String(info.value.mime || '').startsWith('image/'));
const src = computed(() => local.value || (server.value && !server.value.erased ? `/api/files/${props.id}` : ''));

async function loadLocal() {
  if (server.value || local.value) return;
  const b = await pendingBlob(props.id).catch(() => null);
  if (b) local.value = URL.createObjectURL(b);
}
async function check() {
  if (!isAudio.value) return;
  const known = store.data?.transcripts?.[props.id];
  if (known) { tr.value = { status: 'done', ...known }; emit('transcript', known.text); return; }
  if (!server.value) { tr.value = { status: pending.value ? 'upload' : 'none' }; return; }
  try {
    tr.value = await api(`/files/${props.id}/transcript`);
    if (tr.value.status === 'done') emit('transcript', tr.value.text);
  } catch { /* offline */ }
}
async function retry() { tr.value = await api(`/files/${props.id}/retry`, { method: 'POST', body: {} }); }
onMounted(() => { loadLocal(); check(); poll = setInterval(() => { if (tr.value?.status !== 'done' && tr.value?.status !== 'error') check(); }, 4000); });
watch(server, () => { loadLocal(); check(); });
onBeforeUnmount(() => { clearInterval(poll); if (local.value) URL.revokeObjectURL(local.value); });
const label = { queued: 'wartet auf Erkennung', running: 'wird erkannt …', upload: 'wird hochgeladen …', none: 'noch nicht gesendet', error: 'Erkennung fehlgeschlagen' };
</script>

<template>
  <div class="card flat" style="padding: 10px; margin-bottom: 8px">
    <div class="row">
      <Icon :name="isAudio ? 'mic' : isImage ? 'camera' : 'paperclip'" />
      <div class="grow">
        <b>{{ isAudio ? 'Sprachaufnahme' : isImage ? 'Foto' : info.name || 'Datei' }}</b>
        <span v-if="info.durationSec" class="muted"> · {{ Math.floor(info.durationSec / 60) }}:{{ String(info.durationSec % 60).padStart(2, '0') }}</span>
        <span v-if="info.size" class="muted"> · {{ bytes(info.size) }}</span>
        <br /><small>{{ deTime(info.capturedAt) }}<template v-if="pending"> · <b>noch auf dem Handy</b></template></small>
      </div>
      <button v-if="props.removable" class="btn small ghost" type="button" title="Aus dem Entwurf nehmen (Datei bleibt in der Beweiskette)" @click="emit('remove')"><Icon name="trash" :size="18" /></button>
    </div>
    <audio v-if="isAudio && src" :src="src" controls preload="none" style="margin-top: 8px" />
    <a v-if="isImage && src" :href="src" target="_blank"><img :src="src" alt="Foto" style="max-width: 100%; max-height: 260px; border-radius: 10px; margin-top: 8px" /></a>
    <a v-if="!isAudio && !isImage && src" :href="src" target="_blank" class="btn small" style="margin-top: 8px">Öffnen</a>
    <div v-if="isAudio && tr" style="margin-top: 8px">
      <div v-if="tr.status === 'done'" class="quote">{{ tr.text }}</div>
      <small v-else-if="tr.status === 'error'" class="neg">{{ label.error }}: {{ tr.error }} <button class="btn small" type="button" @click="retry">Erneut</button></small>
      <small v-else class="muted">{{ label[tr.status] || '' }}<template v-if="tr.position > 1"> (Platz {{ tr.position }})</template></small>
    </div>
    <small v-if="props.showHash && info.sha256" class="mono muted" style="display: block; margin-top: 6px">SHA-256 {{ shortHash(info.sha256) }}</small>
  </div>
</template>
