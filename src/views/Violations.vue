<script setup>
// Verstöße gegen das Arbeitszeitgesetz: automatisch aus den erfassten Zeiten. Dazu eigene Einschätzung
// (z. B. „Vorgesetzter hat es billigend in Kauf genommen“) – als Aussage mit Begründung in der Beweiskette.
import { computed, ref } from 'vue';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import { queueEvidence, store, toast } from '../services/store.js';
import { violations } from '../services/derived.js';
import { LAW_LABEL } from '../../shared/worktime.js';
import { weekday } from '../../shared/holidays.js';
import { MONTHS, WEEKDAYS, de, deTime, today, uuid } from '../services/util.js';

const year = ref(Number(today().slice(0, 4)));
const filter = ref('all');
const list = computed(() => (store.data ? violations(`${year.value}-01-01`, `${year.value}-12-31`) : []));
const assessments = computed(() => Object.values(store.data?.assessments || {}).filter((a) => !a.cancelled));
const assessedOn = (d) => assessments.value.find((a) => a.dates.includes(d));
const imported = (v) => !!store.data?.times?.[v.date]?.import;
const shown = computed(() => list.value.filter((v) => filter.value === 'all' || (filter.value === 'import' ? imported(v) : filter.value === 'open' ? !assessedOn(v.date) : v.severity === 'bad')));
const counts = computed(() => {
  const c = {};
  for (const v of list.value) c[v.code] = (c[v.code] || 0) + 1;
  return c;
});
const hard = computed(() => list.value.filter((v) => v.severity === 'bad').length);
const byMonth = computed(() => {
  const m = new Map();
  for (const v of shown.value) { const k = v.date.slice(0, 7); if (!m.has(k)) m.set(k, []); m.get(k).push(v); }
  return [...m.entries()];
});

const picked = ref(new Set());
const key = (v) => `${v.date}|${v.code}`;
function toggle(v) { const s = new Set(picked.value); s.has(key(v)) ? s.delete(key(v)) : s.add(key(v)); picked.value = s; }
function pickImported() { picked.value = new Set(list.value.filter((v) => imported(v) && !assessedOn(v.date)).map(key)); }
const pickedList = computed(() => list.value.filter((v) => picked.value.has(key(v))));

const HOW = {
  gebilligt: 'die Überschreitungen der Arbeitszeit billigend in Kauf genommen',
  geduldet: 'die Überschreitungen der Arbeitszeit gekannt und geduldet',
  angeordnet: 'die Mehrarbeit angeordnet',
  bekannt: 'von diesen Arbeitszeiten gewusst',
};
const BASIS = [
  'Die Arbeitszeiten waren bekannt: Zeiterfassung/Stundenzettel liegen dem Vorgesetzten vor.',
  'Die zugewiesene Arbeitsmenge war in der regulären Arbeitszeit nicht zu schaffen.',
  'Termine wurden außerhalb der regulären Arbeitszeit angesetzt.',
  'Ich habe auf die Überlastung hingewiesen, geändert hat sich nichts.',
  'Es gibt keine Regelung zum Ausgleich, Überstunden werden stillschweigend erwartet.',
];
const form = ref(null);
function openForm() {
  if (!pickedList.value.length) return toast('Bitte zuerst Verstöße auswählen');
  form.value = { how: 'gebilligt', person: '', basis: '', evidence: '' };
}
const statement = computed(() => form.value && `Nach meiner Einschätzung hat ${form.value.person.trim() || 'mein Vorgesetzter'} ${HOW[form.value.how]}.`);
function addBasis(b) { form.value.basis = form.value.basis.trim() ? `${form.value.basis.trim()}\n${b}` : b; }
async function save() {
  if (!form.value.basis.trim()) return toast('Bitte begründen, woran man das erkennt – sonst ist es nur eine Behauptung');
  const dates = [...new Set(pickedList.value.map((v) => v.date))].sort();
  await queueEvidence('assessment', {
    id: uuid(), dates, codes: [...new Set(pickedList.value.map((v) => v.code))], scope: pickedList.value.every(imported) ? 'import' : 'manual',
    how: form.value.how, person: form.value.person, text: statement.value, basis: form.value.basis, evidence: form.value.evidence,
  }, { label: 'Einschätzung Verstöße' });
  form.value = null; picked.value = new Set();
  toast('Einschätzung festgehalten');
}
const cancel = ref(null);
async function doCancel() {
  await queueEvidence('assessment-cancel', { reason: cancel.value.reason }, { ref: cancel.value.id, label: 'Einschätzung zurückgenommen' });
  cancel.value = null;
}
</script>

<template>
  <div class="page">
    <div class="card">
      <div class="row between">
        <button class="btn small ghost" aria-label="Vorjahr" @click="year--"><Icon name="left" /></button>
        <h2 style="margin: 0">Verstöße {{ year }}</h2>
        <button class="btn small ghost" aria-label="Folgejahr" @click="year++"><Icon name="right" /></button>
      </div>
      <div class="kpis" style="margin-top: 10px">
        <div class="kpi"><b :class="hard ? 'neg' : 'pos'">{{ hard }}</b><span>Verstöße</span></div>
        <div class="kpi"><b>{{ list.length - hard }}</b><span>zu prüfen</span></div>
        <div class="kpi"><b>{{ list.filter((v) => assessedOn(v.date)).length }}</b><span>mit Einschätzung</span></div>
      </div>
      <div class="row wrap" style="margin-top: 8px; gap: 6px">
        <span v-for="(n, k) in counts" :key="k" class="badge" :class="['sunday', 'holiday', 'avg48'].includes(k) ? 'warn' : 'inc'">{{ LAW_LABEL[k] }}: {{ n }}</span>
      </div>
      <p class="muted" style="font-size: .85rem; margin-top: 8px">
        Automatisch aus deinen erfassten Zeiten nach dem Arbeitszeitgesetz: höchstens 10 Std. am Tag und 60 Std. in der Woche (§ 3), Pausen (§ 4),
        11 Std. Ruhezeit (§ 5). Sonn- und Feiertagsarbeit (§ 9) und ein Schnitt über 48 Std./Woche sind „zu prüfen“ (Ausnahmen/Ausgleich möglich).
        Auch wenn du freiwillig länger bleibst: Verantwortlich für die Einhaltung ist der Arbeitgeber.
      </p>
    </div>

    <div class="card">
      <div class="row wrap" style="gap: 6px">
        <select v-model="filter" style="width: auto">
          <option value="all">alle</option><option value="bad">nur Verstöße</option><option value="import">nur importierte (ibuchron)</option><option value="open">ohne Einschätzung</option>
        </select>
        <button class="btn small" @click="pickImported">Alle importierten auswählen</button>
        <button class="btn small primary" :disabled="!picked.size" @click="openForm">Einschätzung festhalten ({{ picked.size }})</button>
      </div>
      <div v-if="!shown.length" class="empty">Keine Verstöße {{ filter === 'all' ? `in ${year}` : 'für diesen Filter' }}.</div>
      <template v-for="[m, vs] in byMonth" :key="m">
        <h3>{{ MONTHS[Number(m.slice(5)) - 1] }} {{ m.slice(0, 4) }}</h3>
        <ul class="list">
          <li v-for="v in vs" :key="key(v)" class="row" style="align-items: flex-start">
            <input type="checkbox" :checked="picked.has(key(v))" style="margin-top: 4px" @change="toggle(v)" />
            <div class="grow">
              <router-link :to="`/zeit/tag/${v.date}`" class="plain"><b>{{ v.week || v.period ? '' : `${WEEKDAYS[weekday(v.date)]} ` }}{{ de(v.date) }}</b></router-link>
              <span class="badge" :class="v.severity === 'bad' ? 'inc' : 'warn'" style="margin-left: 6px">{{ v.severity === 'bad' ? 'Verstoß' : 'prüfen' }} · {{ v.law }}</span>
              <span v-if="imported(v)" class="badge" style="margin-left: 4px">ibuchron</span><br />
              <small>{{ v.text }}</small>
              <small v-if="assessedOn(v.date)" class="muted"><br />Einschätzung: {{ assessedOn(v.date).text }}</small>
            </div>
          </li>
        </ul>
      </template>
    </div>

    <div v-if="assessments.length" class="card">
      <h2>Festgehaltene Einschätzungen</h2>
      <ul class="list">
        <li v-for="a in assessments" :key="a.id" class="row" style="align-items: flex-start">
          <div class="grow">
            <b>{{ a.text }}</b><br />
            <small>Begründung: {{ a.basis }}</small><br />
            <small v-if="a.evidence" class="muted">Belege: {{ a.evidence }}<br /></small>
            <small class="muted">{{ a.dates.length }} Tag(e), {{ de(a.dates[0]) }} – {{ de(a.dates[a.dates.length - 1]) }} · festgehalten {{ deTime(a.receivedAt) }}</small>
          </div>
          <button class="btn small ghost" @click="cancel = { id: a.id, reason: '' }">Zurücknehmen</button>
        </li>
      </ul>
    </div>

    <Modal v-if="form" title="Einschätzung festhalten" @close="form = null">
      <p class="muted" style="font-size: .88rem">{{ pickedList.length }} Verstoß/Verstöße an {{ new Set(pickedList.map((v) => v.date)).size }} Tag(en). Wird als <b>deine Aussage</b> mit Begründung in die Beweiskette geschrieben.</p>
      <label class="f">Wer?</label><input v-model="form.person" placeholder="z. B. Herr Maier (Abteilungsleiter)" />
      <label class="f">Was trifft zu?</label>
      <select v-model="form.how">
        <option value="gebilligt">billigend in Kauf genommen</option><option value="geduldet">gekannt und geduldet</option>
        <option value="angeordnet">angeordnet</option><option value="bekannt">wusste davon</option>
      </select>
      <div class="alert" style="margin-top: 10px">„{{ statement }}“</div>
      <label class="f">Woran erkennt man das? (Pflicht)</label>
      <textarea v-model="form.basis" rows="4" placeholder="Konkrete Tatsachen: wer wusste was, seit wann, woher" />
      <div class="row wrap" style="gap: 6px; margin-top: 6px">
        <button v-for="b in BASIS" :key="b" class="btn small ghost" style="text-align: left" @click="addBasis(b)">+ {{ b }}</button>
      </div>
      <label class="f">Belege (optional)</label><input v-model="form.evidence" placeholder="z. B. Mail vom 12.03., Dienstplan KW 11, Zeuge Herr Becker" />
      <p class="muted" style="font-size: .82rem">Tipp: Je konkreter die Begründung, desto mehr Gewicht hat die Aussage. Für die Bezahlung von Überstunden zählt vor Gericht, ob sie angeordnet, gebilligt oder geduldet wurden.</p>
      <div class="actions"><button class="btn" @click="form = null">Abbrechen</button><button class="btn primary" @click="save">Festhalten</button></div>
    </Modal>
    <Modal v-if="cancel" title="Einschätzung zurücknehmen" @close="cancel = null">
      <p class="muted">Bleibt in der Beweiskette sichtbar und wird als zurückgenommen gekennzeichnet.</p>
      <label class="f">Grund</label><input v-model="cancel.reason" />
      <div class="actions"><button class="btn" @click="cancel = null">Abbrechen</button><button class="btn danger" @click="doCancel">Zurücknehmen</button></div>
    </Modal>
  </div>
</template>
