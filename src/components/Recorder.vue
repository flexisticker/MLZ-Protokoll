<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import Icon from './Icon.vue';
import { recordingSupported, secureOk, startRecording } from '../services/recorder.js';

const props = defineProps({ label: { type: String, default: 'Aufnahme starten' }, maxSec: { type: Number, default: 900 }, autostart: Boolean });
const emit = defineEmits(['recorded']);
const rec = ref(null);
const level = ref(0);
const secs = ref(0);
const err = ref('');
let timer;

async function toggle() {
  err.value = '';
  if (rec.value) return stop();
  try {
    rec.value = await startRecording({ onLevel: (l) => { level.value = l; } });
    secs.value = 0;
    timer = setInterval(() => { secs.value++; if (secs.value >= props.maxSec) stop(); }, 1000);
  } catch (e) {
    err.value = e.name === 'NotAllowedError' ? 'Mikrofon nicht freigegeben – in den Browser-Einstellungen für diese Seite erlauben.' : `Aufnahme nicht möglich: ${e.message}`;
  }
}
async function stop() {
  clearInterval(timer);
  const r = rec.value; rec.value = null;
  const res = await r.stop();
  if (res.blob.size) emit('recorded', res);
}
onBeforeUnmount(() => { clearInterval(timer); if (rec.value) stop(); });
onMounted(() => { if (props.autostart && secureOk() && recordingSupported()) toggle(); }); // Sprechen-Knopf: Aufnahme läuft sofort
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
</script>

<template>
  <div>
    <div v-if="!secureOk()" class="alert warn">Mikrofon und Kamera funktionieren nur über eine sichere Verbindung (https). Bitte die https-Adresse benutzen.</div>
    <div v-else-if="!recordingSupported()" class="alert warn">Dieser Browser kann keine Tonaufnahmen machen. Bitte Chrome verwenden.</div>
    <div v-else class="recorder">
      <button class="recbtn" :class="{ on: rec }" type="button" :aria-label="rec ? 'Aufnahme beenden' : props.label" @click="toggle">
        <Icon :name="rec ? 'stop' : 'mic'" :size="30" />
      </button>
      <div class="grow">
        <template v-if="rec">
          <b>Aufnahme läuft · {{ mmss(secs) }}</b>
          <div class="level" style="margin-top: 6px"><i :style="{ width: `${Math.min(100, level * 160)}%` }" /></div>
          <small>Zum Beenden nochmal tippen</small>
        </template>
        <template v-else>
          <b>{{ props.label }}</b><br />
          <small>Nur die eigenen Notizen sprechen – keine Gespräche mitschneiden.</small>
        </template>
      </div>
    </div>
    <p v-if="err" class="alert bad" style="margin-top: 8px">{{ err }}</p>
  </div>
</template>
