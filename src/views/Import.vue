<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Icon from '../components/Icon.vue';
import { api } from '../services/api.js';
import { sha256Blob } from '../services/hash.js';
import { loadDrafts, queueEvidence, refresh, settings, store, sync, toast } from '../services/store.js';
import { activeAbsences, workDays } from '../services/derived.js';
import { ABSENCE_TYPES, fmtDur, range, vacationDays } from '../../shared/worktime.js';
import { buildImport, decodeCsv, parseTimeCsv } from '../../shared/importcsv.js';
import { de, today, uuid } from '../services/util.js';

const file = ref(null);
const parsed = ref(null);
const busy = ref(false);
const result = ref(null);
const ki = ref({ engine: 'off' });
const job = ref(null);
const setStart = ref(true);
const startH = ref('');
let timer = null;

onMounted(async () => { try { ki.value = await api('/assist/status'); } catch { /* offline */ } });
onBeforeUnmount(() => clearInterval(timer));

async function pick(e) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  result.value = null; job.value = null;
  const text = decodeCsv(new Uint8Array(await f.arrayBuffer()));
  const p = parseTimeCsv(text);
  if (!p.rows.length) return toast(p.errors[0] || 'Keine Tage gefunden');
  file.value = f;
  parsed.value = { ...p, notes: p.rows.filter((r) => r.note.trim()).map((r) => ({ ...r, pick: false, kind: 'incident', reason: '' })) };
  const s = p.totals.gesamt?.overtimeMin, y = p.totals.summe?.overtimeMin;
  startH.value = s != null && y != null ? hours(s - y) : '';
  setStart.value = startH.value !== '' && !settings().balanceStart?.date;
}
const hours = (m) => `${m < 0 ? '-' : ''}${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, '0')}`;
const toMin = (s) => {
  const t = String(s || '').trim().replace(/\s+/g, '').replace(/^\+/, '');
  let m = t.match(/^(-?)(\d+):(\d{1,2})$/);
  if (m) return (m[1] ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  m = t.match(/^-?\d+(?:[.,]\d+)?$/);
  return m ? Math.round(Number(t.replace(',', '.')) * 60) : null;
};

const plan = computed(() => parsed.value && buildImport(parsed.value.rows, { times: store.data?.times || {}, absences: activeAbsences(), settings: settings(), file: file.value?.name }));
const first = computed(() => parsed.value?.rows[0]?.date || '');
const last = computed(() => parsed.value?.rows.at(-1)?.date || '');
const vacImported = computed(() => (plan.value?.absences || []).reduce((n, a) => n + vacationDays(a.payload, settings()), 0));
const counts = computed(() => {
  const c = {};
  for (const a of plan.value?.absences || []) c[a.payload.type] = (c[a.payload.type] || 0) + 1;
  return c;
});
// Saldo, den MLZ für den Zeitraum der Datei rechnet (vorhandene + importierte Daten)
const mlzSum = computed(() => {
  if (!plan.value) return null;
  const days = new Map(workDays());
  for (const t of plan.value.times) if (!days.has(t.payload.date)) days.set(t.payload.date, t.payload);
  const abs = [...activeAbsences(), ...plan.value.absences.map((a) => a.payload)];
  const until = last.value < today() ? last.value : today();
  return until < first.value ? 0 : range(first.value, until, settings(), days, abs, { start: first.value, today: today() }).reduce((n, r) => n + r.balance, 0);
});
const startMin = computed(() => toMin(startH.value));
const picked = computed(() => (parsed.value?.notes || []).filter((n) => n.pick));

async function askKi() {
  const items = parsed.value.notes.map((n, i) => ({ n: i, date: n.date, start: n.start, end: n.end, note: n.note }));
  try { job.value = await api('/import/notes/classify', { method: 'POST', body: { items } }); } catch (e) { return toast(e.message); }
  clearInterval(timer);
  timer = setInterval(async () => {
    const j = await api('/import/notes/classify').catch(() => null);
    if (!j || j.id !== job.value.id) return;
    job.value = j;
    for (const [n, r] of Object.entries(j.results || {})) {
      const note = parsed.value.notes[Number(n)];
      if (!note || note.decided) continue;
      note.decided = true;
      note.reason = r.reason;
      note.pick = r.kind !== 'none';
      if (r.kind !== 'none') note.kind = r.kind;
    }
    if (j.status !== 'running') clearInterval(timer);
  }, 2000);
}

async function upload() {
  const f = file.value;
  const blob = new Blob([await f.arrayBuffer()], { type: 'text/csv' });
  const r = await api('/files', { method: 'POST', body: blob, headers: { 'Content-Type': 'text/csv', 'x-file-id': uuid(), 'x-purpose': 'import', 'x-sha256': await sha256Blob(blob), 'x-captured-at': new Date(f.lastModified || Date.now()).toISOString(), 'x-name': encodeURIComponent(f.name) } });
  return r.row.id;
}
async function run() {
  if (!store.online) return toast('Für den Import muss der Server erreichbar sein');
  if (setStart.value && startMin.value == null) return toast('Stundenstand bitte als z. B. 165:52 oder -12:30 eingeben');
  busy.value = true;
  try {
    const fileId = await upload();
    const r = await api('/import/times', { method: 'POST', body: { fileId } });
    if (setStart.value) {
      const s = JSON.parse(JSON.stringify(settings()));
      s.balanceStart = { date: first.value, minutes: startMin.value };
      await queueEvidence('settings', s, { label: 'Stundenstand aus Import' });
    }
    let drafts = 0;
    if (picked.value.length) {
      const d = await api('/import/notes/drafts', { method: 'POST', body: { fileId, items: picked.value.map((n) => ({ date: n.date, start: n.start, end: n.end, note: n.note, kind: n.kind, line: n.line, reason: n.reason })) } });
      drafts = d.ids.length;
    }
    await sync();
    await refresh();
    await loadDrafts();
    result.value = { ...r, drafts };
    parsed.value = null;
  } catch (e) { toast(e.message); } finally { busy.value = false; }
}
</script>

<template>
  <div class="page">
    <div class="card">
      <h2>Alte Arbeitszeiten importieren</h2>
      <p class="muted" style="font-size: .9rem">
        CSV-Export der bisherigen Zeiterfassung (z. B. ibuchron, Trennzeichen „;“). Gelesen werden Datum, Kommen, Gehen, Pause, Notizen, Arbeitsort
        sowie Urlaub, Krankheit, Abwesenheit und Freizeitausgleich. Feiertage rechnet MLZ selbst, die Spalte Projekt wird ignoriert.
        Die Originaldatei wird mit Prüfsumme in der Beweiskette abgelegt; importierte Tage sind als „Import“ gekennzeichnet.
        Tage, die hier schon erfasst sind, bleiben unverändert.
      </p>
      <label class="btn primary block"><Icon name="plus" :size="18" /> CSV-Datei wählen<input type="file" accept=".csv,text/csv" hidden @change="pick" /></label>
    </div>

    <div v-if="result" class="alert ok">
      Import abgeschlossen: {{ result.times }} Arbeitstage, {{ result.absences }} Abwesenheiten<template v-if="result.drafts">, {{ result.drafts }} Logbuch-Entwürfe aus Notizen</template>.
      <template v-if="result.skipped.length"> {{ result.skipped.length }} Zeilen übersprungen.</template>
      <div style="margin-top: 8px" class="row">
        <router-link class="btn small" to="/zeit">Zur Arbeitszeit</router-link>
        <router-link v-if="result.drafts" class="btn small" to="/logbuch">Entwürfe prüfen</router-link>
        <router-link class="btn small" to="/zeit/verstoesse">Verstöße ansehen</router-link>
      </div>
    </div>

    <template v-if="parsed && plan">
      <div class="card">
        <h2>Vorschau: {{ file.name }}</h2>
        <p>{{ de(first) }} – {{ de(last) }} · {{ parsed.rows.length }} Tage in der Datei</p>
        <ul class="list">
          <li><b>{{ plan.times.length }}</b> Arbeitstage mit Kommen/Gehen</li>
          <li v-for="(n, k) in counts" :key="k"><b>{{ n }}</b> × {{ ABSENCE_TYPES[k]?.label || k }}</li>
          <li><b>{{ vacImported }}</b> Urlaubstage<template v-if="parsed.totals.summe?.urlaub != null"> (ibuchron-Summe: {{ parsed.totals.summe.urlaub }})</template></li>
          <li class="muted">{{ plan.holidays }} Feiertage in der Datei – rechnet MLZ selbst (Baden-Württemberg)</li>
        </ul>
        <details v-if="plan.absences.length" style="margin-top: 8px">
          <summary>Abwesenheiten anzeigen</summary>
          <ul class="list">
            <li v-for="a in plan.absences" :key="a.id"><small>{{ ABSENCE_TYPES[a.payload.type]?.label }}<template v-if="a.payload.half"> (½)</template>: {{ de(a.payload.from) }}<template v-if="a.payload.to !== a.payload.from"> – {{ de(a.payload.to) }}</template><br /><span class="muted">{{ a.payload.note }}</span></small></li>
          </ul>
        </details>
        <details v-if="plan.skipped.length || parsed.errors.length" style="margin-top: 8px" open>
          <summary>{{ plan.skipped.length + parsed.errors.length }} Hinweise</summary>
          <ul class="list">
            <li v-for="e in parsed.errors" :key="e" class="neg"><small>{{ e }}</small></li>
            <li v-for="s in plan.skipped" :key="`${s.line}-${s.why}`"><small>{{ de(s.date) }} (Zeile {{ s.line }}): {{ s.why }}</small></li>
          </ul>
        </details>
      </div>

      <div class="card">
        <h2>Stundenstand übernehmen</h2>
        <p class="muted" style="font-size: .9rem">
          In ibuchron steckt auch der Übertrag aus der Software davor. Übertrag = „Gesamt“ minus „Summe“ der Überstunden-Spalte
          <template v-if="parsed.totals.gesamt?.overtimeMin != null">(ibuchron: Gesamt {{ fmtDur(parsed.totals.gesamt.overtimeMin, true) }}, Summe {{ fmtDur(parsed.totals.summe?.overtimeMin, true) }})</template>.
          Er wird als Saldo zum {{ de(first) }} eingetragen (Einstellungen → Saldo-Start).
        </p>
        <label class="check"><input v-model="setStart" type="checkbox" /> <span>Saldo-Start auf {{ de(first) }} setzen</span></label>
        <template v-if="setStart">
          <label class="f">Übertrag zum {{ de(first) }} (Std:Min)</label>
          <input v-model="startH" inputmode="text" placeholder="z. B. 400:13 oder -12:30" />
          <small v-if="settings().balanceStart?.date" class="muted">Bisher eingestellt: {{ de(settings().balanceStart.date) }}, {{ fmtDur(settings().balanceStart.minutes, true) }} – wird ersetzt.</small>
        </template>
        <div v-if="mlzSum != null" class="kpis" style="margin-top: 10px">
          <div class="kpi"><b>{{ fmtDur(mlzSum, true) }}</b><span>MLZ Zeitraum</span></div>
          <div v-if="parsed.totals.summe?.overtimeMin != null" class="kpi"><b>{{ fmtDur(parsed.totals.summe.overtimeMin, true) }}</b><span>ibuchron Summe</span></div>
          <div v-if="setStart && startMin != null" class="kpi"><b :class="startMin + mlzSum < 0 ? 'neg' : 'pos'">{{ fmtDur(startMin + mlzSum, true) }}</b><span>MLZ Stand</span></div>
          <div v-if="parsed.totals.gesamt?.overtimeMin != null" class="kpi"><b>{{ fmtDur(parsed.totals.gesamt.overtimeMin, true) }}</b><span>ibuchron Gesamt</span></div>
        </div>
        <small class="muted">MLZ rechnet vom {{ de(first) }} bis {{ de(last < today() ? last : today()) }} (spätere Tage zählen erst, wenn sie vorbei sind). Abweichungen kommen z. B. von Pausenregeln (§ 4 ArbZG), halben Tagen an Heiligabend/Silvester oder Tagen ohne Kommen/Gehen (siehe Hinweise).</small>
      </div>

      <div v-if="parsed.notes.length" class="card">
        <h2>Notizen ins Logbuch? ({{ parsed.notes.length }})</h2>
        <p class="muted" style="font-size: .9rem">
          Angehakte Notizen werden Logbuch-<b>Entwürfe</b> mit Datum des Tages und dem Hinweis, dass sie nachträglich übernommen wurden.
          Die KI füllt sie aus; festgeschrieben wird erst, wenn du sie geprüft hast.
        </p>
        <button v-if="ki.engine !== 'off'" class="btn block" style="margin-bottom: 10px" :disabled="job?.status === 'running'" @click="askKi">
          ✨ {{ job?.status === 'running' ? `KI prüft … ${job.done}/${job.total}` : 'KI entscheiden lassen' }}
        </button>
        <p v-else class="muted" style="font-size: .88rem">KI-Ausfüllhilfe ist aus – bitte selbst anhaken (oder unter Einstellungen einschalten).</p>
        <p v-if="job?.status === 'error'" class="neg">{{ job.error }}</p>
        <ul class="list">
          <li v-for="(n, i) in parsed.notes" :key="i" class="row" style="align-items: flex-start">
            <input v-model="n.pick" type="checkbox" style="margin-top: 4px" />
            <div class="grow">
              <small><b>{{ de(n.date) }}</b><template v-if="n.start"> · {{ n.start }}–{{ n.end }}</template></small><br />
              {{ n.note }}
              <small v-if="n.reason" class="muted"><br />KI: {{ n.reason }}</small>
            </div>
            <select v-if="n.pick" v-model="n.kind" style="width: auto"><option value="incident">Auffälligkeit</option><option value="br">Betriebsrat</option></select>
          </li>
        </ul>
      </div>

      <button class="btn primary block" :disabled="busy" @click="run">
        {{ busy ? 'Importiere …' : `Importieren: ${plan.times.length} Tage, ${plan.absences.length} Abwesenheiten${picked.length ? `, ${picked.length} Entwürfe` : ''}` }}
      </button>
    </template>
  </div>
</template>
