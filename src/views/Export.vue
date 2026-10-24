<script setup>
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import Icon from '../components/Icon.vue';
import { store } from '../services/store.js';
import { today } from '../services/util.js';

const route = useRoute();
const t = today();
const from = ref(`${t.slice(0, 7)}-01`);
const to = ref(t);
const caseId = ref(String(route.query.vorgang || ''));
const parts = ref({ log: true, time: true, absence: true, br: true });
const cases = computed(() => Object.values(store.data?.cases || {}));
function preset(p) {
  const d = new Date();
  if (p === 'month') { from.value = `${t.slice(0, 7)}-01`; to.value = t; }
  if (p === 'last') { const a = new Date(d.getFullYear(), d.getMonth() - 1, 1, 12); const b = new Date(d.getFullYear(), d.getMonth(), 0, 12); from.value = a.toISOString().slice(0, 10); to.value = b.toISOString().slice(0, 10); }
  if (p === 'year') { from.value = `${t.slice(0, 4)}-01-01`; to.value = t; }
  if (p === 'all') { from.value = '2000-01-01'; to.value = t; }
}
const href = computed(() => {
  const q = new URLSearchParams({ from: from.value, to: to.value, parts: Object.entries(parts.value).filter(([, v]) => v).map(([k]) => k).join(',') });
  if (caseId.value) q.set('case', caseId.value);
  return `/api/export?${q}`;
});
</script>

<template>
  <div class="page">
    <div class="card">
      <p>Erzeugt ein ZIP-Paket für Anwalt, Gewerkschaft oder Gericht:</p>
      <ul style="margin: 4px 0 0 18px; padding: 0; font-size: .92rem">
        <li><b>bericht.pdf</b> – lesbarer Bericht mit allen Angaben und Prüfwerten</li>
        <li>Original-Sprachaufnahmen und Fotos (unverändert)</li>
        <li>Daten, Beweiskette, Zeitstempel und ein Prüfprogramm, mit dem jeder die Unversehrtheit nachrechnen kann</li>
      </ul>
    </div>
    <div class="card">
      <label class="f">Vorgang</label>
      <select v-model="caseId"><option value="">– Zeitraum statt Vorgang –</option><option v-for="c in cases" :key="c.id" :value="c.id">{{ c.title }}</option></select>
      <template v-if="!caseId">
        <div class="row wrap" style="margin-top: 10px">
          <button class="btn small" @click="preset('month')">Dieser Monat</button>
          <button class="btn small" @click="preset('last')">Letzter Monat</button>
          <button class="btn small" @click="preset('year')">Dieses Jahr</button>
          <button class="btn small" @click="preset('all')">Alles</button>
        </div>
        <div class="grid2">
          <div><label class="f">von</label><input v-model="from" type="date" /></div>
          <div><label class="f">bis</label><input v-model="to" type="date" /></div>
        </div>
        <label class="check"><input v-model="parts.log" type="checkbox" /> <span>Logbuch (Auffälligkeiten &amp; Betriebsrat)</span></label>
        <label class="check"><input v-model="parts.time" type="checkbox" /> <span>Arbeitszeiten, Mehrarbeit, Geltendmachungen</span></label>
        <label class="check"><input v-model="parts.absence" type="checkbox" /> <span>Urlaub &amp; Abwesenheiten</span></label>
        <label class="check"><input v-model="parts.br" type="checkbox" /> <span>BR-Zeiten</span></label>
      </template>
      <a class="btn primary block" style="margin-top: 12px" :href="href" download><Icon name="download" :size="18" /> ZIP herunterladen</a>
      <p class="muted" style="font-size: .85rem; margin-top: 8px">Das Paket enthält sensible Daten – nur verschlüsselt oder persönlich weitergeben.</p>
    </div>
  </div>
</template>
