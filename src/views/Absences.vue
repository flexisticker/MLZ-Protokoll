<script setup>
import { computed, ref } from 'vue';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import { queueEvidence, settings, store, toast } from '../services/store.js';
import { vacation } from '../services/derived.js';
import { ABSENCE_TYPES, vacationDays } from '../../shared/worktime.js';
import { de, today, uuid } from '../services/util.js';

const year = ref(Number(today().slice(0, 4)));
const acc = computed(() => (store.data ? vacation(year.value) : null));
const list = computed(() => Object.values(store.data?.absences || {}).filter((a) => a.from.slice(0, 4) <= String(year.value) && (a.to || a.from).slice(0, 4) >= String(year.value)).sort((a, b) => b.from.localeCompare(a.from)));
const form = ref(null);
const cancel = ref(null);
function open() { form.value = { id: uuid(), type: 'urlaub', from: today(), to: today(), half: false, approvedBy: '', approvedAt: '', requestedAt: '', note: '' }; }
const days = computed(() => (form.value ? vacationDays(form.value, settings()) : 0));
async function save() {
  const p = { ...form.value, to: form.value.to || form.value.from };
  if (p.to < p.from) return toast('Ende liegt vor dem Beginn');
  await queueEvidence('absence', p, { id: p.id, label: 'Abwesenheit' });
  form.value = null;
  toast('Gespeichert');
}
async function doCancel() {
  await queueEvidence('absence-cancel', { reason: cancel.value.reason }, { ref: cancel.value.id, label: 'Storno Abwesenheit' });
  cancel.value = null;
}
</script>

<template>
  <div class="page">
    <div class="card">
      <div class="row between">
        <button class="btn small ghost" @click="year--"><Icon name="left" /></button>
        <h2 style="margin: 0">Urlaub {{ year }}</h2>
        <button class="btn small ghost" @click="year++"><Icon name="right" /></button>
      </div>
      <div v-if="acc" class="kpis" style="margin-top: 10px">
        <div class="kpi"><b>{{ acc.total }}</b><span>Anspruch gesamt</span></div>
        <div class="kpi"><b>{{ acc.taken + acc.planned }}</b><span>genommen/geplant</span></div>
        <div class="kpi"><b :class="acc.remaining < 0 ? 'neg' : 'pos'">{{ acc.remaining }}</b><span>Rest</span></div>
      </div>
      <p v-if="acc" class="muted" style="font-size: .88rem; margin-top: 8px">
        Jahresanspruch {{ acc.entitlement }}<template v-if="acc.carry"> · Übertrag {{ acc.carry }} (verfällt {{ de(acc.expiry) }}<template v-if="acc.carryLost">, verfallen: {{ acc.carryLost }}</template>)</template><template v-if="acc.adjust"> · Korrektur {{ acc.adjust }}</template>
      </p>
    </div>
    <button class="btn primary block" style="margin-bottom: 12px" @click="open"><Icon name="plus" :size="18" /> Abwesenheit eintragen</button>
    <div class="card">
      <div v-if="!list.length" class="empty">Keine Einträge in {{ year }}.</div>
      <ul class="list">
        <li v-for="a in list" :key="a.id" class="row">
          <div class="grow" :style="a.cancelled ? 'opacity:.55' : ''">
            <b>{{ ABSENCE_TYPES[a.type]?.label || a.type }}</b><span v-if="a.half"> (halber Tag)</span>
            <span v-if="a.cancelled" class="badge warn">storniert</span><br />
            <small>{{ de(a.from) }}<template v-if="a.to !== a.from"> – {{ de(a.to) }}</template><template v-if="ABSENCE_TYPES[a.type]?.vacation"> · {{ vacationDays(a, settings()) }} Urlaubstag(e)</template><template v-if="a.approvedBy"> · genehmigt von {{ a.approvedBy }}</template></small>
            <small v-if="a.note" class="muted"><br />{{ a.note }}</small>
          </div>
          <button v-if="!a.cancelled" class="btn small ghost" @click="cancel = { id: a.id, reason: '' }">Stornieren</button>
        </li>
      </ul>
    </div>

    <Modal v-if="form" title="Abwesenheit" @close="form = null">
      <label class="f">Art</label>
      <select v-model="form.type"><option v-for="(t, k) in ABSENCE_TYPES" :key="k" :value="k">{{ t.label }}</option></select>
      <div class="grid2">
        <div><label class="f">von</label><input v-model="form.from" type="date" /></div>
        <div><label class="f">bis</label><input v-model="form.to" type="date" /></div>
      </div>
      <label v-if="form.from === form.to" class="check"><input v-model="form.half" type="checkbox" /> <span>halber Tag</span></label>
      <p v-if="ABSENCE_TYPES[form.type]?.vacation" class="muted">= {{ days }} Urlaubstag(e) (Wochenenden, Feiertage und halbe freie Tage berücksichtigt)</p>
      <template v-if="['urlaub', 'sonder', 'abbau', 'brcomp', 'schulung'].includes(form.type)">
        <div class="grid2">
          <div><label class="f">beantragt am</label><input v-model="form.requestedAt" type="date" /></div>
          <div><label class="f">genehmigt am</label><input v-model="form.approvedAt" type="date" /></div>
        </div>
        <label class="f">genehmigt von</label><input v-model="form.approvedBy" />
      </template>
      <label class="f">Notiz</label><input v-model="form.note" :placeholder="form.type === 'krank' ? 'z. B. AU-Bescheinigung abgegeben am …' : ''" />
      <div class="actions"><button class="btn" @click="form = null">Abbrechen</button><button class="btn primary" @click="save">Speichern</button></div>
    </Modal>
    <Modal v-if="cancel" title="Abwesenheit stornieren" @close="cancel = null">
      <p class="muted">Der Eintrag bleibt sichtbar und wird als storniert gekennzeichnet.</p>
      <label class="f">Grund</label><input v-model="cancel.reason" placeholder="z. B. Urlaub verschoben, Antrag abgelehnt" />
      <div class="actions"><button class="btn" @click="cancel = null">Abbrechen</button><button class="btn danger" @click="doCancel">Stornieren</button></div>
    </Modal>
  </div>
</template>
