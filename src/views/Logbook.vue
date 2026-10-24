<script setup>
import { computed, ref } from 'vue';
import Icon from '../components/Icon.vue';
import { store } from '../services/store.js';
import { SECTION_LABEL } from '../services/categories.js';
import { deLocal } from '../services/util.js';

const q = ref('');
const section = ref('');
const caseId = ref('');
const entries = computed(() => {
  const s = q.value.trim().toLowerCase();
  return Object.values(store.data?.entries || {})
    .filter((e) => !e.erased)
    .filter((e) => !section.value || e.section === section.value)
    .filter((e) => !caseId.value || e.caseId === caseId.value)
    .filter((e) => !s || [e.title, e.facts, e.quotes, e.persons, e.witnesses, e.location, e.category, e.assessment, ...e.addenda.map((a) => a.text)].join(' ').toLowerCase().includes(s))
    .sort((a, b) => String(b.eventAt).localeCompare(String(a.eventAt)));
});
const cases = computed(() => Object.values(store.data?.cases || {}));
</script>

<template>
  <div class="page">
    <div class="tiles">
      <router-link class="tile red" to="/diktat?bereich=incident"><span class="ico"><Icon name="mic" /></span>Auffälligkeit diktieren</router-link>
      <router-link class="tile" to="/diktat?bereich=br"><span class="ico"><Icon name="users" /></span>Betriebsrat diktieren</router-link>
    </div>

    <div v-if="store.drafts.length" class="card">
      <h2>Entwürfe <small>(noch nicht festgeschrieben)</small></h2>
      <ul class="list">
        <li v-for="d in store.drafts" :key="d.id">
          <router-link class="item" :to="`/diktat/${d.id}`">
            <Icon name="edit" />
            <div class="grow"><b>{{ d.title || d.facts?.slice(0, 50) || (d.assistWanted ? 'Gesprochene Notiz' : 'ohne Titel') }}</b>
              <span v-if="d.assistWanted && d.assist?.status === 'done'" class="badge ai">KI fertig – prüfen</span>
              <span v-else-if="d.assistWanted && ['upload', 'transcribing', 'queued', 'running'].includes(d.assist?.status)" class="badge">wird ausgefüllt …</span>
              <span v-else-if="d.assist?.status === 'error'" class="badge inc">KI-Fehler</span>
              <br /><small>{{ deLocal(d.eventAt) }} · {{ d.fileIds.length }} Anlage(n)</small></div>
            <Icon name="right" />
          </router-link>
        </li>
      </ul>
    </div>

    <div class="card">
      <input v-model="q" type="search" placeholder="Suchen (Name, Stichwort …)" />
      <div class="row" style="margin-top: 8px">
        <select v-model="section" class="grow"><option value="">Alle Bereiche</option><option value="incident">Auffälligkeiten</option><option value="br">Betriebsrat</option></select>
        <select v-if="cases.length" v-model="caseId" class="grow"><option value="">Alle Vorgänge</option><option v-for="c in cases" :key="c.id" :value="c.id">{{ c.title }}</option></select>
      </div>
    </div>

    <div v-if="!entries.length" class="empty">Noch keine festgeschriebenen Einträge.</div>
    <div v-else class="card">
      <ul class="list">
        <li v-for="e in entries" :key="e.id">
          <router-link class="item" :to="`/eintrag/${e.id}`">
            <div class="grow">
              <span class="badge" :class="e.section === 'br' ? 'br' : 'inc'">{{ SECTION_LABEL[e.section] }}</span>
              <span v-if="e.retracted" class="badge warn">zurückgezogen</span>
              <span v-if="e.addenda.length" class="badge">{{ e.addenda.length }} Nachtrag</span>
              <br /><b>{{ e.title || e.category || e.facts.slice(0, 60) }}</b>
              <br /><small>{{ deLocal(e.eventAt) }}<template v-if="e.location"> · {{ e.location }}</template></small>
            </div>
            <Icon name="right" />
          </router-link>
        </li>
      </ul>
    </div>
  </div>
</template>
