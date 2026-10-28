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
import { de, localNow, num, nowTime, today, uuid, fromB64 } from '../services/util.js';
import { addDays } from '../../shared/holidays.js';

const year = ref(Number(today().slice(0, 4)));
const acc = computed(() => (store.data ? vacation(year.value) : null));
const list = computed(() => Object.values(store.data?.absences || {}).filter((a) => a.from.slice(0, 4) <= String(year.value) && (a.to || a.from).slice(0, 4) >= String(year.value)).sort((a, b) => b.from.localeCompare(a.from)));
const route = useRoute();
const form = ref(null);
const cancel = ref(null);
function open(pre = {}) { form.value = { id: uuid(), type: 'urlaub', from: today(), to: today(), half: false, approvedBy: '', approvedAt: '', requestedAt: '', note: '', fromTime: '', openEnd: false, reportedTo: '', reportedAt: '', reportedHow: '', doctorAt: '', stampOut: true, ...pre }; }
const allAbsences = computed(() => Object.values(store.data?.absences || {}).map((a) => (a.openEnd && !a.cancelled ? { ...a, to: a.from > today() ? a.from : today() } : a)));
function fromCalendar(p) { open({ type: p.type || 'urlaub', from: p.from, to: p.to, half: p.half }); }
const shown = ref(null); // im Kalender angetippte Abwesenheit
const formHalfFree = computed(() => (form.value && form.value.from === form.value.to ? halfFree(form.value.from, settings()) : null));
const days = computed(() => (form.value ? vacationDays(form.value, settings()) : 0));
// Krankmeldung: offener Arbeitstag heute? Dann kann das Arbeitsende gleich mit gestempelt werden.
const stampsToday = computed(() => (store.data?.stamps?.[today()] || []).slice().sort((a, b) => a.at.localeCompare(b.at)));
const working = computed(() => ['in', 'break-end'].includes(stampsToday.value.at(-1)?.type));
const timeToday = computed(() => store.data?.times?.[today()]);
const keepDraft = ref(false);
onMounted(() => {
  if (route.query.krank) open({ type: 'krank', fromTime: working.value ? nowTime() : '', openEnd: true, reportedAt: localNow() });
  if (route.query.ende) { const a = store.data?.absences?.[route.query.ende]; if (a) openEnd(a); }
  const sg = route.query.vorschlag && fromB64(route.query.vorschlag); // Vorschlag der KI-Ausfüllhilfe / Krankmeldung
  if (!sg) return;
  open();
  Object.assign(form.value, {
    type: sg.type || 'urlaub', from: sg.from || today(), to: sg.to || sg.from || today(), half: !!sg.half, approvedBy: sg.approvedBy || '',
    fromTime: sg.fromTime || '', openEnd: !!sg.openEnd, reportedTo: sg.reportedTo || '', doctorAt: sg.doctorAt || '', note: sg.note || '',
    reportedAt: sg.type === 'krank' && sg.reportedTo ? localNow() : '',
  });
  toast('Vorschlag übernommen – bitte prüfen');
});
async function save() {
  const { stampOut, ...rest } = form.value;
  const p = { ...rest, to: rest.openEnd ? rest.from : rest.to || rest.from };
  if (p.type !== 'krank') { delete p.fromTime; delete p.openEnd; delete p.reportedTo; delete p.reportedAt; delete p.reportedHow; delete p.doctorAt; }
  if (p.from !== p.to || halfFree(p.from, settings())) p.half = false; // Heiligabend/Silvester: Rest des Tages = ganzer Eintrag
  if (p.to < p.from) return toast('Ende liegt vor dem Beginn');
  if (stampOut && p.fromTime && p.from === today() && working.value) await queueEvidence('stamp', { at: `${today()}T${p.fromTime}`, type: 'out', note: 'krank', late: p.fromTime !== nowTime() }, { label: 'Stempelung' });
  await queueEvidence('absence', p, { id: p.id, label: p.type === 'krank' ? 'Krankmeldung' : 'Abwesenheit' });
  if (route.query.entwurf && !keepDraft.value) await deleteDraft(String(route.query.entwurf));
  form.value = null;
  toast('Gespeichert');
}
// Ende einer Krankmeldung nachtragen
const ending = ref(null);
function openEnd(a) { ending.value = { id: a.id, from: a.from, back: '', to: '', doctorAt: a.doctorAt || '', note: '' }; }
async function doEnd() {
  const e = ending.value;
  const to = e.back ? addDays(e.back, -1) : e.to;
  if (!to || to < e.from) return toast('Bitte angeben, wann du wieder anfängst (oder den letzten Krankheitstag)');
  await queueEvidence('absence-end', { to, back: e.back, doctorAt: e.doctorAt, note: e.note }, { ref: e.id, label: 'Ende Krankmeldung' });
  ending.value = null;
  toast('Ende eingetragen');
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
        <button class="btn small ghost" aria-label="Vorjahr" @click="year--"><Icon name="left" /></button>
        <h2 style="margin: 0">Urlaub {{ year }}</h2>
        <button class="btn small ghost" aria-label="Folgejahr" @click="year++"><Icon name="right" /></button>
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
            <span v-if="a.cancelled" class="badge warn">storniert</span><span v-else-if="a.openEnd" class="badge inc">offen</span><br />
            <small>{{ de(a.from) }}<template v-if="a.to !== a.from"> – {{ de(a.to) }}</template><template v-if="ABSENCE_TYPES[a.type]?.vacation"> · {{ num(vacationDays(a, settings())) }} Urlaubstag(e)</template><template v-if="a.approvedBy"> · genehmigt von {{ a.approvedBy }}</template></small>
            <small v-if="a.fromTime || a.openEnd || a.reportedTo || a.doctorAt" class="muted"><br />{{ [a.fromTime && `ab ${a.fromTime} Uhr während der Arbeit`, a.openEnd && 'Ende noch offen', a.reportedTo && `gemeldet bei ${a.reportedTo}${a.reportedAt ? ` am ${de(a.reportedAt.slice(0, 10))} ${a.reportedAt.slice(11)}` : ''}`, a.doctorAt && `Arzt/AU ${de(a.doctorAt)}`].filter(Boolean).join(' · ') }}</small>
            <small v-if="a.note" class="muted"><br />{{ a.note }}</small>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px">
            <button v-if="a.openEnd && !a.cancelled" class="btn small primary" @click="openEnd(a)">Ende eintragen</button>
            <button v-if="!a.cancelled" class="btn small ghost" @click="cancel = { id: a.id, reason: '' }">Stornieren</button>
          </div>
        </li>
      </ul>
    </div>

    <Modal v-if="form" :title="form.type === 'krank' ? 'Krankmeldung' : 'Abwesenheit'" @close="form = null">
      <label class="f">Art</label>
      <select v-model="form.type"><option v-for="(t, k) in ABSENCE_TYPES" :key="k" :value="k">{{ t.label }}</option></select>
      <div class="grid2">
        <div><label class="f">von</label><input v-model="form.from" type="date" /></div>
        <div><label class="f">bis</label><input v-model="form.to" type="date" :disabled="form.type === 'krank' && form.openEnd" /></div>
      </div>
      <template v-if="form.type === 'krank'">
        <label class="check"><input v-model="form.openEnd" type="checkbox" /> <span>Ende noch offen (später „Ende eintragen“)</span></label>
        <label class="f">Während der Arbeit krank geworden? Ab Uhrzeit<span class="hint">bis dahin zählt die Arbeitszeit, der Rest des Tages wird angerechnet</span></label>
        <input v-model="form.fromTime" type="time" />
        <label v-if="form.fromTime && form.from === today() && working" class="check"><input v-model="form.stampOut" type="checkbox" /> <span>Arbeitsende um {{ form.fromTime }} stempeln</span></label>
        <p v-if="form.fromTime && form.from === today() && timeToday" class="muted" style="font-size: .85rem">Für heute ist schon eine Arbeitszeit eingetragen – bitte unter <router-link :to="`/zeit/tag/${today()}`">Zeit</router-link> auf {{ form.fromTime }} Uhr kürzen.</p>
        <h3>Krankmeldung beim Arbeitgeber</h3>
        <div class="grid2">
          <div><label class="f">bei wem?</label><input v-model="form.reportedTo" placeholder="z. B. Herr Maier" /></div>
          <div><label class="f">wie?</label><select v-model="form.reportedHow"><option value="">–</option><option>Telefon</option><option>WhatsApp/SMS</option><option>E-Mail</option><option>persönlich</option></select></div>
        </div>
        <label class="f">wann gemeldet?</label><input v-model="form.reportedAt" type="datetime-local" />
        <label class="f">beim Arzt / krankgeschrieben am</label><input v-model="form.doctorAt" type="date" />
        <small class="muted">Krankheit unverzüglich melden; dauert sie länger als 3 Kalendertage, braucht es spätestens am folgenden Arbeitstag eine ärztliche Feststellung (eAU, § 5 EFZG) – der Vertrag kann das früher verlangen.</small>
      </template>
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
      <label v-if="route.query.entwurf" class="check"><input v-model="keepDraft" type="checkbox" /> <span>Gesprochenes zusätzlich als Logbuch-Entwurf behalten</span></label>
      <div class="actions"><button class="btn" @click="form = null">Abbrechen</button><button class="btn primary" @click="save">Speichern</button></div>
    </Modal>
    <Modal v-if="ending" title="Ende der Krankmeldung" @close="ending = null">
      <p class="muted">Krank seit {{ de(ending.from) }}.</p>
      <label class="f">Ich fange wieder an am</label><input v-model="ending.back" type="date" @change="ending.to = ''" />
      <label class="f">oder: letzter Krankheitstag</label><input v-model="ending.to" type="date" @change="ending.back = ''" />
      <label class="f">beim Arzt / krankgeschrieben am</label><input v-model="ending.doctorAt" type="date" />
      <label class="f">Notiz</label><input v-model="ending.note" placeholder="z. B. eAU bis …, Folgebescheinigung" />
      <div class="actions"><button class="btn" @click="ending = null">Abbrechen</button><button class="btn primary" @click="doEnd">Speichern</button></div>
    </Modal>
    <Modal v-if="shown" :title="ABSENCE_TYPES[shown.type]?.label || shown.type" @close="shown = null">
      <p><b>{{ de(shown.from) }}<template v-if="shown.to !== shown.from"> – {{ de(shown.to) }}</template></b><template v-if="shown.half"> (halber Tag)</template><template v-if="ABSENCE_TYPES[shown.type]?.vacation"> · {{ num(vacationDays(shown, settings())) }} Urlaubstag(e)</template></p>
      <p v-if="shown.approvedBy" class="muted">genehmigt von {{ shown.approvedBy }}<template v-if="shown.approvedAt"> am {{ de(shown.approvedAt) }}</template></p>
      <p v-if="shown.note" class="muted">{{ shown.note }}</p>
      <div class="actions"><button class="btn" @click="shown = null">Schließen</button><button v-if="shown.openEnd" class="btn primary" @click="openEnd(shown); shown = null">Ende eintragen</button><button class="btn danger" @click="cancel = { id: shown.id, reason: '' }; shown = null">Stornieren</button></div>
    </Modal>
    <Modal v-if="cancel" title="Abwesenheit stornieren" @close="cancel = null">
      <p class="muted">Der Eintrag bleibt sichtbar und wird als storniert gekennzeichnet.</p>
      <label class="f">Grund</label><input v-model="cancel.reason" placeholder="z. B. Urlaub verschoben, Antrag abgelehnt" />
      <div class="actions"><button class="btn" @click="cancel = null">Abbrechen</button><button class="btn danger" @click="doCancel">Stornieren</button></div>
    </Modal>
  </div>
</template>

