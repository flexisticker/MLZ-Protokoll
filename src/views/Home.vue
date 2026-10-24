<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import { queueEvidence, settings, store, toast } from '../services/store.js';
import { todos } from '../services/todos.js';
import { dayRow, totalBalance, vacation } from '../services/derived.js';
import { fmtDur } from '../../shared/worktime.js';
import { localNow, minutesBetween, nowTime, today } from '../services/util.js';
import { holidayName } from '../../shared/holidays.js';

const router = useRouter();
const now = ref(nowTime());
let t;
onMounted(() => { t = setInterval(() => { now.value = nowTime(); }, 30000); });
onUnmounted(() => clearInterval(t));

const hintsSeen = ref(localStorage.getItem('mlz-hints') === '1');
const closeHints = () => { localStorage.setItem('mlz-hints', '1'); hintsSeen.value = true; };

const stampsToday = computed(() => {
  const d = today();
  const server = store.data?.stamps?.[d] || [];
  const pending = store.outbox.filter((o) => o.kind === 'stamp' && o.payload?.at?.startsWith(d)).map((o) => ({ ...o.payload, pending: true }));
  return [...server, ...pending].sort((a, b) => a.at.localeCompare(b.at));
});
const manualToday = computed(() => store.data?.times?.[today()]);
const last = computed(() => stampsToday.value[stampsToday.value.length - 1]?.type || null);
const state = computed(() => (last.value === 'in' || last.value === 'break-end' ? 'work' : last.value === 'break-start' ? 'break' : last.value === 'out' ? 'done' : 'none'));
const workedSoFar = computed(() => {
  let m = 0; let open = null;
  for (const s of stampsToday.value) {
    const tt = s.at.slice(11, 16);
    if (s.type === 'in' || s.type === 'break-end') open = open || tt;
    else if (open) { m += minutesBetween(open, tt); open = null; }
  }
  if (open) m += minutesBetween(open, now.value);
  return m;
});
const row = computed(() => (store.data ? dayRow(today()) : null));
const label = { in: 'Beginn', out: 'Ende', 'break-start': 'Pause', 'break-end': 'weiter' };

const custom = ref(null);
async function stamp(type, at = localNow()) {
  await queueEvidence('stamp', { at, type, late: at.slice(11, 16) !== nowTime() }, { label: 'Stempelung' });
  toast(`${label[type]} ${at.slice(11, 16)} gespeichert`);
  custom.value = null;
}
const list = computed(() => todos());
const s = computed(() => settings());
const holiday = computed(() => holidayName(today(), s.value.state, s.value.extraHolidays));
</script>

<template>
  <div class="page">
    <div v-if="!hintsSeen" class="alert warn">
      <b>Wichtig für gerichtsfeste Notizen</b>
      <ul style="margin: 6px 0 6px 18px; padding: 0">
        <li>Nur die <b>eigenen</b> Notizen diktieren – Gespräche nie heimlich aufnehmen (§ 201 StGB).</li>
        <li>Möglichst am selben Tag erfassen: wer, was, wann, wo, Zeugen, wörtliche Zitate.</li>
        <li>Fotos von Zuständen, nicht von Personen. Keine vertraulichen Firmenunterlagen kopieren.</li>
        <li>Keine Personaldaten von Kollegen aus der BR-Arbeit hier speichern.</li>
        <li>Nur privates Handy und privates Netz benutzen.</li>
      </ul>
      <div class="row"><router-link to="/hinweise" class="btn small">Mehr dazu</router-link><button class="btn small primary" @click="closeHints">Verstanden</button></div>
    </div>

    <router-link class="btn rec block speak" to="/diktat?bereich=incident"><Icon name="mic" :size="26" /> Sprechen – die App füllt aus</router-link>
    <p class="muted" style="font-size: .85rem; margin: 6px 2px 12px">
      <template v-if="store.assist?.engine && store.assist.engine !== 'off'">Einfach erzählen: Vorfall, BR-Sache, Arbeitszeit oder Urlaub – die App erkennt, worum es geht, und füllt das passende Formular aus.</template>
      <template v-else>Die KI-Ausfüllhilfe ist aus – dann landet der gesprochene Text in „Was ist passiert?“. Einschalten: <router-link to="/einstellungen#ki">Einstellungen</router-link>.</template>
    </p>
    <div class="tiles">
      <router-link class="tile red" to="/diktat?bereich=incident"><span class="ico"><Icon name="mic" /></span>Auffälligkeit diktieren</router-link>
      <router-link class="tile" to="/diktat?bereich=br"><span class="ico"><Icon name="users" /></span>Betriebsrat diktieren</router-link>
      <router-link class="tile green" :to="`/zeit/tag/${today()}?sprechen=1`"><span class="ico"><Icon name="clock" /></span>Arbeitszeit sprechen</router-link>
      <router-link class="tile amber" to="/diktat?bereich=incident&foto=1"><span class="ico"><Icon name="camera" /></span>Foto festhalten</router-link>
    </div>

    <div class="card">
      <div class="row between">
        <h2 style="margin: 0">Heute</h2>
        <small v-if="holiday" class="badge warn">{{ holiday }}</small>
        <small v-else-if="row?.half" class="badge warn">{{ row.half }} (halber Tag)</small>
        <small v-else-if="row?.absence" class="badge">{{ row.absence.type === 'urlaub' ? 'Urlaub' : 'abwesend' }}</small>
      </div>
      <template v-if="manualToday">
        <p>Von Hand erfasst: {{ manualToday.segments.map((x) => `${x.start}–${x.end}`).join(', ') }} · Pause {{ manualToday.breakMinutes }} Min.</p>
      </template>
      <p v-if="stampsToday.length" class="muted" style="font-size: .9rem">
        <span v-for="x in stampsToday" :key="x.at + x.type" style="margin-right: 10px">{{ label[x.type] }} {{ x.at.slice(11, 16) }}<template v-if="x.pending">*</template></span>
      </p>
      <div class="kpis" style="margin: 10px 0">
        <div class="kpi"><b>{{ fmtDur(workedSoFar) }}</b><span>gestempelt</span></div>
        <div class="kpi"><b :class="totalBalance() < 0 ? 'neg' : ''">{{ fmtDur(totalBalance(), true) }}</b><span>Saldo bis heute</span></div>
        <div class="kpi"><b>{{ vacation().remaining }}</b><span>Urlaubstage frei</span></div>
      </div>
      <div class="row">
        <template v-if="state === 'none' || state === 'done'">
          <button class="btn primary grow" @click="stamp('in')"><Icon name="play" :size="18" /> {{ state === 'done' ? 'Wieder anfangen' : 'Arbeitsbeginn' }}</button>
        </template>
        <template v-else-if="state === 'work'">
          <button class="btn grow" @click="stamp('break-start')"><Icon name="pause" :size="18" /> Pause</button>
          <button class="btn primary grow" @click="stamp('out')"><Icon name="stop" :size="18" /> Feierabend</button>
        </template>
        <template v-else>
          <button class="btn primary grow" @click="stamp('break-end')"><Icon name="play" :size="18" /> Pause beenden</button>
        </template>
        <button class="btn small ghost" title="Mit anderer Uhrzeit stempeln" @click="custom = { time: nowTime(), type: state === 'work' ? 'out' : state === 'break' ? 'break-end' : 'in' }"><Icon name="edit" :size="18" /></button>
      </div>
      <small class="muted">Stempeln speichert die Uhrzeit sofort mit Server-Eingang. Ganze Tage nachtragen: „Zeit“ → Tag antippen.</small>
    </div>

    <div v-if="list.length" class="card">
      <h2>Zu erledigen</h2>
      <ul class="list">
        <li v-for="(x, i) in list" :key="i">
          <a class="item" href="#" @click.prevent="router.push(x.to)">
            <Icon :name="x.icon" :class="x.level === 'bad' ? 'neg' : ''" />
            <span class="grow" :class="x.level === 'bad' ? 'neg' : ''">{{ x.text }}</span>
            <Icon name="right" />
          </a>
        </li>
      </ul>
    </div>

    <Modal v-if="custom" title="Stempeln mit Uhrzeit" @close="custom = null">
      <p class="muted">Für vergessene Stempelungen von heute. Die tatsächliche Eingabezeit wird mit gespeichert.</p>
      <label class="f">Art</label>
      <select v-model="custom.type"><option value="in">Arbeitsbeginn</option><option value="break-start">Pause Anfang</option><option value="break-end">Pause Ende</option><option value="out">Feierabend</option></select>
      <label class="f">Uhrzeit</label><input v-model="custom.time" type="time" />
      <div class="actions"><button class="btn" @click="custom = null">Abbrechen</button><button class="btn primary" @click="stamp(custom.type, `${today()}T${custom.time}`)">Speichern</button></div>
    </Modal>
  </div>
</template>
