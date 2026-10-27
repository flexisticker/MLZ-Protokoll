<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import { queueEvidence, settings, store, toast } from '../services/store.js';
import { todos } from '../services/todos.js';
import { activeAbsences, activeBr, brAcc, dayRow, totalBalance, vacation, violations, workDays } from '../services/derived.js';
import { api } from '../services/api.js';
import { brMinutesOn } from '../../shared/rules.js';
import { ABSENCE_TYPES, fmtDur, range } from '../../shared/worktime.js';
import { WEEKDAYS, de, deLocal, localNow, minutesBetween, num, nowTime, today } from '../services/util.js';
import { addDays, holidayName, weekday } from '../../shared/holidays.js';

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
const recent = computed(() => Object.values(store.data?.entries || {}).filter((e) => !e.erased)
  .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))).slice(0, 3));
const entryCount = computed(() => Object.values(store.data?.entries || {}).filter((e) => !e.erased).length);
const s = computed(() => settings());
const holiday = computed(() => holidayName(today(), s.value.state, s.value.extraHolidays));

// Begrüßung und Prüfstatus der Beweiskette
const hour = Number(nowTime().slice(0, 2));
const greet = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';
const firstName = computed(() => (s.value.name || store.session?.user?.username || '').split(/\s+/)[0]);
const dateLong = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const chain = ref(null);
onMounted(async () => { try { chain.value = await api('/verify'); } catch { /* offline */ } });

// Heute
const todayMin = computed(() => (stampsToday.value.length ? workedSoFar.value : row.value?.worked || 0));
const breakDue = computed(() => state.value === 'work' && workedSoFar.value >= 330 && !stampsToday.value.some((x) => x.type === 'break-start'));
const statusText = computed(() => {
  const first = stampsToday.value.find((x) => x.type === 'in');
  if (state.value === 'work') return `arbeitet seit ${first?.at.slice(11, 16) || ''}`;
  if (state.value === 'break') return 'in der Pause';
  if (state.value === 'done') return 'Arbeitsende gestempelt';
  if (manualToday.value) return 'von Hand erfasst';
  return 'noch nicht begonnen';
});

// Kacheln
const year = today().slice(0, 4);
const viol = computed(() => (store.data ? violations(`${year}-01-01`, `${year}-12-31`) : []));
const violHard = computed(() => viol.value.filter((v) => v.severity === 'bad').length);
const violOpen = computed(() => viol.value.filter((v) => v.severity === 'bad' && !Object.values(store.data?.assessments || {}).some((a) => !a.cancelled && a.dates.includes(v.date))).length);
const vac = computed(() => (store.data ? vacation() : null));
const brMonth = computed(() => {
  if (!store.data) return 0;
  const m = today().slice(0, 7);
  let n = 0;
  for (let d = `${m}-01`; d <= today(); d = addDays(d, 1)) n += brMinutesOn(d, activeBr(), activeAbsences(), s.value);
  return n;
});
const brOpen = computed(() => (store.data ? brAcc().balance : 0));

// Diese Woche
const week = computed(() => {
  if (!store.data) return [];
  const mon = addDays(today(), -weekday(today()));
  const rows = range(mon, addDays(mon, 6), s.value, workDays(), activeAbsences(), { today: today() });
  return rows.map((r) => ({ ...r, v: r.violations.some((x) => x.severity === 'bad'), u: !!r.absence, b: activeBr().some((x) => x.date === r.date), val: r.worked + r.credit }));
});
const wMax = computed(() => Math.max(600, ...week.value.map((r) => r.val)));
const wTarget = computed(() => Math.max(...s.value.weekTarget));

// Demnächst
const upcoming = computed(() => activeAbsences().filter((a) => (a.to || a.from) >= today()).sort((a, b) => a.from.localeCompare(b.from)).slice(0, 4));
</script>

<template>
  <div class="page">
    <div class="hello">
      <div><b>{{ greet }}{{ firstName ? `, ${firstName}` : '' }}</b><br /><small class="muted">{{ dateLong }}</small></div>
      <router-link v-if="chain" to="/pruefung" class="badge" :class="chain.ok ? 'ok' : 'inc'" style="text-decoration: none"><Icon name="shield" :size="13" /> {{ chain.ok ? 'Kette geprüft' : 'Prüfung!' }}</router-link>
    </div>

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

    <div class="card">
      <div class="row between" style="align-items: flex-start">
        <div>
          <small class="muted"><span class="dotl" :class="state" />{{ statusText }}</small>
          <div style="font-size: 1.6rem; font-weight: 700; font-variant-numeric: tabular-nums">{{ fmtDur(todayMin) }} <small style="font-size: .9rem; font-weight: 500" class="muted">Std.</small></div>
          <small class="muted">Soll heute {{ fmtDur(row?.target || 0) }}<template v-if="holiday"> · {{ holiday }}</template><template v-else-if="row?.half"> · {{ row.half }} (halber Tag)</template><template v-else-if="row?.absence"> · {{ ABSENCE_TYPES[row.absence.type]?.label }}</template></small>
          <small v-if="breakDue" class="neg" style="display: block">Pause fällig (über 6 Std. mindestens 30 Min.)</small>
        </div>
        <router-link :to="`/zeit/tag/${today()}`" class="btn small ghost">Tag</router-link>
      </div>
      <p v-if="stampsToday.length" class="muted" style="font-size: .85rem; margin: 6px 0 0">
        <span v-for="x in stampsToday" :key="x.at + x.type" style="margin-right: 10px">{{ label[x.type] }} {{ x.at.slice(11, 16) }}<template v-if="x.pending">*</template></span>
      </p>
      <div class="row" style="margin-top: 10px">
        <template v-if="state === 'none' || state === 'done'">
          <button class="btn primary grow" @click="stamp('in')"><Icon name="play" :size="18" /> {{ state === 'done' ? 'Arbeit wieder aufnehmen' : 'Arbeitsbeginn' }}</button>
        </template>
        <template v-else-if="state === 'work'">
          <button class="btn grow" @click="stamp('break-start')"><Icon name="pause" :size="18" /> Pause</button>
          <button class="btn primary grow" @click="stamp('out')"><Icon name="stop" :size="18" /> Arbeitsende</button>
        </template>
        <template v-else>
          <button class="btn primary grow" @click="stamp('break-end')"><Icon name="play" :size="18" /> Pause beenden</button>
        </template>
        <button class="btn small ghost" title="Mit anderer Uhrzeit stempeln" @click="custom = { time: nowTime(), type: state === 'work' ? 'out' : state === 'break' ? 'break-end' : 'in' }"><Icon name="edit" :size="18" /></button>
      </div>
      <router-link to="/abwesenheit?krank=1" style="display: inline-block; margin-top: 8px; font-size: .85rem">{{ state === 'work' || state === 'break' ? 'Krank geworden? Arbeit abbrechen und krankmelden' : 'Krank? Krankmeldung eintragen' }}</router-link>
    </div>

    <div class="kgrid">
      <router-link to="/zeit" class="kt"><Icon name="clock" :size="18" class="ico" /><b :class="totalBalance() < 0 ? 'neg' : 'pos'">{{ fmtDur(totalBalance(), true) }}</b><span>Stundensaldo</span></router-link>
      <router-link to="/abwesenheit" class="kt"><Icon name="sun" :size="18" class="ico" /><b>{{ num(vac?.remaining) }}</b><span>Urlaub frei<template v-if="vac?.planned"> · {{ num(vac.planned) }} geplant</template></span></router-link>
      <router-link to="/zeit/verstoesse" class="kt" :class="{ bad: violHard }"><Icon name="alert" :size="18" class="ico" /><b>{{ violHard }}</b><span>Verstöße ArbZG {{ year }}<template v-if="viol.length > violHard"> · {{ viol.length - violHard }} prüfen</template></span></router-link>
      <router-link to="/betriebsrat" class="kt"><Icon name="users" :size="18" class="ico" /><b>{{ fmtDur(brMonth) }}</b><span>BR-Zeit diesen Monat<template v-if="brOpen > 0"> · {{ fmtDur(brOpen) }} Ausgleich offen</template></span></router-link>
    </div>

    <div v-if="list.length || violOpen" class="card">
      <h2 style="margin-top: 0">Zu erledigen</h2>
      <ul class="list">
        <li v-for="(x, i) in list" :key="i">
          <a class="item" href="#" @click.prevent="router.push(x.to)">
            <Icon :name="x.icon" :class="x.level === 'bad' ? 'neg' : ''" />
            <span class="grow" :class="x.level === 'bad' ? 'neg' : ''">{{ x.text }}</span>
            <Icon name="right" />
          </a>
        </li>
        <li v-if="violOpen">
          <router-link class="item" to="/zeit/verstoesse"><Icon name="alert" /><span class="grow">{{ violOpen }} Verstöße ohne Einschätzung – festhalten, wer davon wusste</span><Icon name="right" /></router-link>
        </li>
      </ul>
    </div>

    <div class="card">
      <div class="row between"><h2 style="margin: 0">Diese Woche</h2><router-link to="/zeit" class="btn small ghost">Arbeitszeit</router-link></div>
      <div class="wbars">
        <div class="tgt" :style="{ bottom: `${(wTarget / wMax) * 90 + 16}px` }" />
        <router-link v-for="r in week" :key="r.date" :to="`/zeit/tag/${r.date}`" :class="{ v: r.v, u: r.u && !r.worked, b: r.b && !r.v, today: r.date === today() }" :title="`${de(r.date)}: ${fmtDur(r.val)} Std.`">
          <div :style="{ height: `${Math.max(2, (r.val / wMax) * 90)}px` }" /><span>{{ WEEKDAYS[weekday(r.date)] }}</span>
        </router-link>
      </div>
      <div class="legend2">gestrichelt = Sollzeit · <span class="neg">rot = Verstoß</span> · <span style="color: #6a4c93">lila = mit BR-Arbeit</span> · <span class="pos">grün = Urlaub/abwesend</span></div>
    </div>

    <div class="card">
      <div class="row between"><h2 style="margin: 0">Zuletzt festgehalten</h2><router-link to="/logbuch" class="btn small ghost">Logbuch ({{ entryCount }})</router-link></div>
      <div v-if="!recent.length" class="empty">Noch keine festgeschriebenen Einträge. Einfach unten auf das Mikrofon tippen und erzählen.</div>
      <ul v-else class="list">
        <li v-for="e in recent" :key="e.id">
          <router-link class="item" :to="`/eintrag/${e.id}`">
            <div class="grow">
              <span class="badge" :class="e.section === 'br' ? 'br' : 'inc'">{{ e.section === 'br' ? 'Betriebsrat' : 'Auffälligkeit' }}</span>
              <span v-if="e.addenda?.length" class="badge">{{ e.addenda.length }} Nachtrag</span>
              <br /><b>{{ e.title || e.category || (e.facts || '').slice(0, 60) }}</b>
              <br /><small>{{ deLocal(e.eventAt) }}<template v-if="e.location"> · {{ e.location }}</template></small>
            </div>
            <Icon name="right" />
          </router-link>
        </li>
      </ul>
    </div>

    <div v-if="upcoming.length" class="card">
      <div class="row between"><h2 style="margin: 0">Demnächst</h2><router-link to="/abwesenheit" class="btn small ghost">Kalender</router-link></div>
      <ul class="list">
        <li v-for="a in upcoming" :key="a.id"><div><b>{{ ABSENCE_TYPES[a.type]?.label || a.type }}</b><template v-if="a.half"> (½)</template><br /><small class="muted">{{ de(a.from) }}<template v-if="a.to !== a.from"> – {{ de(a.to) }}</template></small></div></li>
      </ul>
    </div>

    <Modal v-if="custom" title="Stempeln mit Uhrzeit" @close="custom = null">
      <p class="muted">Für vergessene Stempelungen von heute. Die tatsächliche Eingabezeit wird mit gespeichert.</p>
      <label class="f">Art</label>
      <select v-model="custom.type"><option value="in">Arbeitsbeginn</option><option value="break-start">Pause Anfang</option><option value="break-end">Pause Ende</option><option value="out">Arbeitsende</option></select>
      <label class="f">Uhrzeit</label><input v-model="custom.time" type="time" />
      <div class="actions"><button class="btn" @click="custom = null">Abbrechen</button><button class="btn primary" @click="stamp(custom.type, `${today()}T${custom.time}`)">Speichern</button></div>
    </Modal>
  </div>
</template>

