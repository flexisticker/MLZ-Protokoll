<script setup>
import { computed, ref } from 'vue';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import { api } from '../services/api.js';
import { queueEvidence, refresh, settings, store, toast } from '../services/store.js';
import { de, today, uuid } from '../services/util.js';

const list = computed(() => Object.values(store.data?.cases || {}).sort((a, b) => (a.closed ? 1 : 0) - (b.closed ? 1 : 0) || b.receivedAt.localeCompare(a.receivedAt)));
const count = (id) => Object.values(store.data?.entries || {}).filter((e) => e.caseId === id && !e.erased).length;
const form = ref(null);
const close = ref(null);
const erase = ref(null);
const until = (c) => (c.closed ? `${Number(c.closed.date.slice(0, 4)) + Number(settings().retentionYears || 5)}${c.closed.date.slice(4)}` : '');
async function add() {
  const id = uuid();
  await queueEvidence('case', { id, title: form.value.title, description: form.value.description }, { id, label: 'Vorgang' });
  form.value = null;
}
async function doClose() {
  await queueEvidence('case-close', { date: close.value.date, note: close.value.note }, { ref: close.value.id, label: 'Vorgang abgeschlossen' });
  close.value = null;
}
async function reopen(c) { await queueEvidence('case-reopen', { date: today(), note: '' }, { ref: c.id, label: 'Vorgang wieder geöffnet' }); }
async function doErase() {
  try {
    const r = await api('/erase', { method: 'POST', body: { caseId: erase.value.id, password: erase.value.password } });
    toast(`${r.erased} Inhalte gelöscht`);
    erase.value = null;
    await refresh();
  } catch (e) { toast(e.message); }
}
</script>

<template>
  <div class="page">
    <p class="muted">Vorgänge bündeln zusammengehörige Einträge (z. B. „Überstunden 2026“, „Konflikt mit Abteilungsleitung“) für den Export an Anwalt oder Gericht.</p>
    <button class="btn primary block" style="margin-bottom: 12px" @click="form = { title: '', description: '' }"><Icon name="plus" :size="18" /> Neuer Vorgang</button>
    <div v-if="!list.length" class="empty">Noch keine Vorgänge.</div>
    <div v-for="c in list" :key="c.id" class="card">
      <div class="row between"><h3 style="margin: 0">{{ c.title }}</h3><span class="badge" :class="c.closed ? '' : 'ok'">{{ c.closed ? 'abgeschlossen' : 'offen' }}</span></div>
      <p v-if="c.description" class="muted">{{ c.description }}</p>
      <p><small>{{ count(c.id) }} Einträge<template v-if="c.closed"> · abgeschlossen am {{ de(c.closed.date) }} · aufbewahren bis {{ de(until(c)) }}</template></small></p>
      <div class="row wrap">
        <router-link class="btn small" :to="`/export?vorgang=${c.id}`"><Icon name="download" :size="16" /> Export</router-link>
        <button v-if="!c.closed" class="btn small" @click="close = { id: c.id, date: today(), note: '' }">Abschließen</button>
        <button v-else class="btn small" @click="reopen(c)">Wieder öffnen</button>
        <button v-if="c.closed && until(c) <= today()" class="btn small danger" @click="erase = { id: c.id, title: c.title, password: '' }">Inhalte löschen</button>
      </div>
    </div>

    <Modal v-if="form" title="Neuer Vorgang" @close="form = null">
      <label class="f">Bezeichnung</label><input v-model="form.title" />
      <label class="f">Beschreibung</label><textarea v-model="form.description" rows="3" />
      <div class="actions"><button class="btn" @click="form = null">Abbrechen</button><button class="btn primary" :disabled="!form.title.trim()" @click="add">Anlegen</button></div>
    </Modal>
    <Modal v-if="close" title="Vorgang abschließen" @close="close = null">
      <p class="muted">Ab dem Abschluss läuft die Aufbewahrungsfrist ({{ settings().retentionYears }} Jahre). Danach schlägt das Programm das Löschen vor.</p>
      <label class="f">Abgeschlossen am</label><input v-model="close.date" type="date" />
      <label class="f">Ergebnis / Notiz</label><textarea v-model="close.note" rows="2" placeholder="z. B. Vergleich vor dem Arbeitsgericht am …" />
      <div class="actions"><button class="btn" @click="close = null">Abbrechen</button><button class="btn primary" @click="doClose">Abschließen</button></div>
    </Modal>
    <Modal v-if="erase" title="Inhalte endgültig löschen" @close="erase = null">
      <p>Alle Texte, Sprachaufnahmen und Fotos des Vorgangs „{{ erase.title }}“ werden gelöscht. In der Beweiskette bleiben nur die Prüfwerte und ein Löschvermerk.</p>
      <label class="f">Zur Bestätigung Passwort eingeben</label><input v-model="erase.password" type="password" autocomplete="current-password" />
      <div class="actions"><button class="btn" @click="erase = null">Abbrechen</button><button class="btn danger" :disabled="!erase.password" @click="doErase">Endgültig löschen</button></div>
    </Modal>
  </div>
</template>
