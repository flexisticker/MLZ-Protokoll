<script setup>
// Monatskalender für Urlaub & Abwesenheit: Feiertage, halbe freie Tage (Heiligabend/Silvester),
// eingetragene Abwesenheiten. Antippen wählt einen Tag, ein zweiter Tag macht daraus einen Zeitraum.
import { computed, ref, watch } from 'vue';
import Icon from './Icon.vue';
import { addDays, holidayName, weekday } from '../../shared/holidays.js';
import { ABSENCE_TYPES, baseTarget, halfFree, vacationDays } from '../../shared/worktime.js';
import { MONTHS, WEEKDAYS, de, num, today } from '../services/util.js';

const props = defineProps({ year: Number, absences: Array, settings: Object });
const emit = defineEmits(['year', 'add', 'open']);
const t = today();
const month = ref(props.year === Number(t.slice(0, 4)) ? Number(t.slice(5, 7)) : 1);
const shownYear = ref(props.year);
watch(() => props.year, (y) => { if (y !== shownYear.value) { shownYear.value = y; month.value = y === Number(t.slice(0, 4)) ? Number(t.slice(5, 7)) : 1; } });
function move(n) {
  let m = month.value + n, y = shownYear.value;
  if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
  month.value = m; shownYear.value = y;
  if (y !== props.year) emit('year', y);
}

const sel = ref(null); // { from, to }
const ym = computed(() => `${shownYear.value}-${String(month.value).padStart(2, '0')}`);
const cells = computed(() => {
  const first = `${ym.value}-01`;
  const out = Array.from({ length: weekday(first) }, () => null);
  for (let d = first; d.startsWith(ym.value); d = addDays(d, 1)) {
    const abs = props.absences.filter((a) => !a.cancelled && d >= a.from && d <= (a.to || a.from)).at(-1) || null;
    const s = props.settings;
    out.push({
      date: d, n: Number(d.slice(8)), we: weekday(d) >= 5, holiday: holidayName(d, s.state, s.extraHolidays), half: halfFree(d, s)?.name || '',
      work: baseTarget(d, s) > 0, abs, type: abs?.type || '', past: d < t,
    });
  }
  return out;
});
const inSel = (d) => sel.value && d >= sel.value.from && d <= (sel.value.to || sel.value.from);
function tap(c) {
  if (!c) return;
  if (c.abs && !sel.value) { emit('open', c.abs); return; }
  if (!sel.value || sel.value.to || c.date < sel.value.from) sel.value = { from: c.date, to: '' };
  else if (c.date === sel.value.from) sel.value = null;
  else sel.value.to = c.date;
}
const range = computed(() => (sel.value ? { from: sel.value.from, to: sel.value.to || sel.value.from } : null));
const single = computed(() => range.value && range.value.from === range.value.to);
const selHalf = computed(() => (single.value ? halfFree(range.value.from, props.settings) : null));
const workdays = computed(() => {
  if (!range.value) return 0;
  let n = 0;
  for (let d = range.value.from; d <= range.value.to; d = addDays(d, 1)) if (baseTarget(d, props.settings) > 0) n++;
  return n;
});
const vac = (half) => (range.value ? vacationDays({ type: 'urlaub', ...range.value, half }, props.settings) : 0);
function add(type, half = false) { emit('add', { type, ...range.value, half }); sel.value = null; }
const cls = (c) => [c.abs && `t-${c.type}`, c.abs?.half && 'halfabs', { we: c.we || c.holiday, hol: c.holiday, halfday: c.half, past: c.past, today: c.date === t, sel: inSel(c.date) }];
const title = (c) => [c.holiday, c.half && `${c.half} (halber Tag frei)`, c.abs && `${ABSENCE_TYPES[c.abs.type]?.label || c.abs.type}${c.abs.half ? ' (½)' : ''}`].filter(Boolean).join(' · ');
const legend = [['urlaub', 'Urlaub'], ['krank', 'Krank'], ['schulung', 'Schulung/BR'], ['abbau', 'Gleittag'], ['sonder', 'Sonstiges']];
</script>

<template>
  <div class="card">
    <div class="row between">
      <button class="btn small ghost" aria-label="Vormonat" @click="move(-1)"><Icon name="left" /></button>
      <h2 style="margin: 0">{{ MONTHS[month - 1] }} {{ shownYear }}</h2>
      <button class="btn small ghost" aria-label="Folgemonat" @click="move(1)"><Icon name="right" /></button>
    </div>
    <div class="cal">
      <div v-for="w in WEEKDAYS" :key="w" class="wd">{{ w }}</div>
      <button v-for="(c, i) in cells" :key="c?.date || `e${i}`" type="button" class="cd" :class="c && cls(c)" :disabled="!c" :title="c && title(c)" @click="tap(c)">
        <template v-if="c">
          <span class="n">{{ c.n }}</span>
          <span v-if="c.half && !c.holiday" class="mk">½</span>
          <span v-else-if="c.holiday" class="mk">F</span>
          <span v-if="c.abs?.half" class="mk">½</span>
        </template>
      </button>
    </div>
    <div class="legend">
      <span v-for="[k, l] in legend" :key="k"><i :class="`t-${k}`" />{{ l }}</span>
      <span><i class="hol" />F Feiertag</span><span><i class="halfday" />½ halber Tag frei</span>
      <router-link to="/einstellungen#halbetage">halbe freie Tage festlegen</router-link>
    </div>

    <div v-if="range" class="selbar">
      <div><b>{{ de(range.from) }}<template v-if="!single"> – {{ de(range.to) }}</template></b>
        <small class="muted"> · {{ workdays }} Arbeitstag(e)<template v-if="!single && !sel.to"> – weiteren Tag antippen für einen Zeitraum</template></small></div>
      <small v-if="selHalf" class="muted">{{ selHalf.name }}: halber Tag ist ohnehin frei. Urlaub für den Rest des Tages zählt ½ Urlaubstag.</small>
      <small v-else-if="single && !workdays" class="muted">An diesem Tag ist keine Arbeitszeit vorgesehen (Wochenende/Feiertag).</small>
      <div class="row wrap" style="margin-top: 8px">
        <button class="btn small primary" :disabled="!workdays" @click="add('urlaub')">Urlaub ({{ num(vac(false)) }} Tag{{ vac(false) === 1 ? '' : 'e' }})</button>
        <button v-if="single && workdays && !selHalf" class="btn small primary" @click="add('urlaub', true)">½ Tag Urlaub</button>
        <button class="btn small" @click="add('')">Andere Art …</button>
        <button class="btn small ghost" @click="sel = null">Abbrechen</button>
      </div>
    </div>
    <small v-else class="muted">Tag antippen zum Eintragen (zweiten Tag antippen = Zeitraum). Eingetragene Tage antippen zum Ansehen oder Stornieren.</small>
  </div>
</template>

<style scoped>
.cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin: 10px 0 8px; }
.wd { text-align: center; font-size: .72rem; color: var(--muted); padding-bottom: 2px; }
.cd { position: relative; aspect-ratio: 1 / 1; min-width: 0; border: 1px solid var(--line); border-radius: 10px; background: var(--card); color: var(--text); font: inherit; padding: 0; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.cd:disabled { visibility: hidden; }
.cd .n { font-size: .92rem; font-variant-numeric: tabular-nums; }
.cd .mk { position: absolute; top: 1px; right: 4px; font-size: .62rem; font-weight: 700; opacity: .85; }
.cd.we { background: var(--soft); color: var(--muted); }
.cd.past .n { opacity: .6; }
.cd.today { outline: 2px solid var(--brand-2); outline-offset: -2px; }
.cd.halfday { background: linear-gradient(135deg, var(--card) 50%, var(--soft) 50%); }
.cd.sel { outline: 3px solid var(--accent); outline-offset: -3px; }
.t-urlaub { --c: #2a9d8f; } .t-krank { --c: #c1121f; } .t-kindkrank { --c: #c1121f; } .t-schulung { --c: #6a4c93; } .t-brcomp { --c: #6a4c93; }
.t-sonder { --c: #457b9d; } .t-abbau { --c: #d4860b; } .t-unbezahlt { --c: #5d6877; }
.cd[class*='t-'] { background: var(--c); border-color: var(--c); color: #fff; }
.cd[class*='t-'].halfabs { background: linear-gradient(135deg, var(--c) 50%, var(--card) 50%); color: var(--text); }
.cd[class*='t-'].halfabs .n { text-shadow: 0 0 3px var(--card); }
.legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: .74rem; color: var(--muted); }
.legend span { display: inline-flex; align-items: center; gap: 5px; }
.legend i { display: inline-block; width: 11px; height: 11px; border-radius: 3px; background: var(--c, var(--soft)); border: 1px solid var(--line); }
.legend i.halfday { background: linear-gradient(135deg, var(--card) 50%, var(--muted) 50%); }
.selbar { margin-top: 10px; padding: 10px; border-radius: 12px; background: var(--brand-soft); }
</style>
