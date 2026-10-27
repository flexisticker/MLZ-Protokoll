<script setup>
import SubNav from '../components/SubNav.vue';
import { NAV } from '../services/nav.js';
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import AbsenceCalendar from '../components/AbsenceCalendar.vue';
import { deleteDraft, queueEvidence, settings, store, toast } from '../services/store.js';
import { vacation } from '../services/derived.js';
import { ABSENCE_TYPES, halfFree, vacationDays } from '../../shared/worktime.js';
import { de, num, today, uuid, fromB64 } from '../services/util.js';

const year = ref(Number(today().slice(0, 4)));
const acc = computed(() => (store.data ? vacation(year.value) : null));
const list = computed(() => Object.values(store.data?.absences || {}).filter((a) => a.from.slice(0, 4) <= String(year.value) && (a.to || a.from).slice(0, 4) >= String(year.value)).sort((a, b) => b.from.localeCompare(a.from)));
const route = useRoute();
const form = ref(null);
const cancel = ref(null);
function open(pre = {}) { form.value = { id: uuid(), type: 'urlaub', from: today(), to: today(), half: false, approvedBy: '', approvedAt: '', requestedAt: '', note: '', ...pre }; }
const allAbsences = computed(() => Object.values(store.data?.absences || {}));
function fromCalendar(p) { open({ type: p.type || 'urlaub', from: p.from, to: p.to, half: p.half }); }
const shown = ref(null); // im Kalender angetippte Abwesenheit
const formHalfFree = computed(() => (form.value && form.value.from === form.value.to ? halfFree(form.value.from, settings()) : null));
const days = computed(() => (form.value ? vacationDays(form.value, settings()) : 0));
onMounted(() => { // Vorschlag der KI-Ausfüllhilfe
  const sg = route.query.vorschlag && fromB64(route.query.vorschlag);
  if (!sg) return;
  open();
  Object.assign(form.value, { type: sg.type || 'urlaub', from: sg.from || today(), to: sg.to || sg.from || today(), half: !!sg.half, approvedBy: sg.approvedBy || '' });
  toast('Vorschlag der KI übernommen – bitte prüfen');
});
async function save() {
  const p = { ...form.value, to: form.value.to || form.value.from };
  if (p.from !== p.to || halfFree(p.from, settings())) p.half = false; // Heiligabend/Silvester: Rest des Tages = ganzer Eintrag
  if (p.to < p.from) return toast('Ende liegt vor dem Beginn');
  await queueEvidence('absence', p, { id: p.id, label: 'Abwesenheit' });
  if (route.query.entwurf) await deleteDraft(String(route.query.entwurf));
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
    <SubNav :items="NAV.time()" />
    <div class="card">
      <div class="row between">
        <button class="btn small ghost" @click="year--"><Icon name="left" /></button>
        <h2 style="margin: 0">Urlaub {{ year }}</h2>
        <button class="btn small ghost" @click="year++"><Icon name="right" /></button>
      </div>
      <div v-if="acc" class="kpis" style="margin-top: 10px">
        <div class="kpi"><b>{{ num(acc.total) }}</b><span>Anspruch gesamt</span></div>
        <div class="kpi"><b>{{ num(acc.taken) }}<small v-if="acc.planned" class="muted"> + {{ num(acc.planned) }}</small></b><span>genommen<template v-if="acc.planned"> + geplant</template></span></div>
        <div class="kpi"><b :class="acc.remaining < 0 ? 'neg' : 'pos'">{{ num(acc.remaining) }}</b><span>Rest</span></div>
      </div>
      <p v-if="acc" class="muted" style="font-size: .88rem; margin-top: 8px">
        Jahresanspruch {{ num(acc.entitlement) }}<template v-if="acc.carry"> · Übertrag {{ num(acc.carry) }} (verfällt {{ de(acc.expiry) }}<template v-if="acc.carryLost">, verfallen: {{ num(acc.carryLost) }}</template>)</template><template v-if="acc.adjust"> · Korrektur {{ num(acc.adjust) }}</template>
      </p>
    </div>
    <AbsenceCalendar :year="year" :absences="allAbsences" :settings="settings()" @year="year = $event" @add="fromCalendar" @open="shown = $event" />
    <button class="btn primary block" style="margin-bottom: 12px" @click="open()"><Icon name="plus" :size="18" /> Abwesenheit eintragen</button>
    <div class="card">
      <div v-if="!list.length" class="empty">Keine Einträge in {{ year }}.</div>
      <ul class="list">
        <li v-for="a in list" :key="a.id" class="row">
          <div class="grow" :style="a.cancelled ? 'opacity:.55' : ''">
            <b>{{ ABSENCE_TYPES[a.type]?.label || a.type }}</b><span v-if="a.half"> (halber Tag)</span>
            <span v-if="a.cancelled" class="badge warn">storniert</span><br />
            <small>{{ de(a.from) }}<template v-if="a.to !== a.from"> – {{ de(a.to) }}</template><template v-if="ABSENCE_TYPES[a.type]?.vacation"> · {{ num(vacationDays(a, settings())) }} Urlaubstag(e)</template><template v-if="a.approvedBy"> · genehmigt von {{ a.approvedBy }}</template></small>
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
      <p v-if="formHalfFree" class="muted" style="font-size: .88rem">{{ formHalfFree.name }}: der halbe Tag ist ohnehin frei. Dieser Eintrag deckt den Rest des Tages ab und zählt ½ Urlaubstag.</p>
      <label v-else-if="form.from === form.to" class="check"><input v-model="form.half" type="checkbox" /> <span>halber Tag</span></label>
      <p v-if="ABSENCE_TYPES[form.type]?.vacation" class="muted">= {{ num(days) }} Urlaubstag(e) (Wochenenden, Feiertage und halbe freie Tage berücksichtigt)</p>
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
    <Modal v-if="shown" :title="ABSENCE_TYPES[shown.type]?.label || shown.type" @close="shown = null">
      <p><b>{{ de(shown.from) }}<template v-if="shown.to !== shown.from"> – {{ de(shown.to) }}</template></b><template v-if="shown.half"> (halber Tag)</template><template v-if="ABSENCE_TYPES[shown.type]?.vacation"> · {{ num(vacationDays(shown, settings())) }} Urlaubstag(e)</template></p>
      <p v-if="shown.approvedBy" class="muted">genehmigt von {{ shown.approvedBy }}<template v-if="shown.approvedAt"> am {{ de(shown.approvedAt) }}</template></p>
      <p v-if="shown.note" class="muted">{{ shown.note }}</p>
      <div class="actions"><button class="btn" @click="shown = null">Schließen</button><button class="btn danger" @click="cancel = { id: shown.id, reason: '' }; shown = null">Stornieren</button></div>
    </Modal>
    <Modal v-if="cancel" title="Abwesenheit stornieren" @close="cancel = null">
      <p class="muted">Der Eintrag bleibt sichtbar und wird als storniert gekennzeichnet.</p>
      <label class="f">Grund</label><input v-model="cancel.reason" placeholder="z. B. Urlaub verschoben, Antrag abgelehnt" />
      <div class="actions"><button class="btn" @click="cancel = null">Abbrechen</button><button class="btn danger" @click="doCancel">Stornieren</button></div>
    </Modal>
  </div>
</template>

