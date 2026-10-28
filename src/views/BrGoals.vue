<script setup>
// BR-Zeit gegenüber der Zeit, die für die eigentliche Arbeit bleibt (§ 37 Abs. 2, § 78 BetrVG).
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import SubNav from '../components/SubNav.vue';
import Modal from '../components/Modal.vue';
import { NAV } from '../services/nav.js';
import { newDraft, saveDraft, store } from '../services/store.js';
import { brWeeksRecent } from '../services/derived.js';
import { fmtDur } from '../../shared/worktime.js';
import { de, localNow } from '../services/util.js';
import { addDays } from '../../shared/holidays.js';

const router = useRouter();
const n = ref(12);
const weeks = computed(() => (store.data ? brWeeksRecent(n.value) : []));
const withBr = computed(() => weeks.value.filter((w) => w.br > 0));
const sum = computed(() => weeks.value.reduce((a, w) => ({ br: a.br + w.br, target: a.target + w.target - w.away, need: a.need + w.need, available: a.available + w.available }), { br: 0, target: 0, need: 0, available: 0 }));
const kw = (d) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7)); const y1 = new Date(x.getFullYear(), 0, 4); return 1 + Math.round(((x - y1) / 864e5 - 3 + ((y1.getDay() + 6) % 7)) / 7); };

const form = ref(null);
function openForm() { form.value = { weeks: new Set(withBr.value.map((w) => w.week)), by: '', how: '', note: '' }; }
function toggle(w) { const s = new Set(form.value.weeks); s.has(w) ? s.delete(w) : s.add(w); form.value.weeks = s; }
async function create() {
  const ws = weeks.value.filter((w) => form.value.weeks.has(w.week)).sort((a, b) => a.week.localeCompare(b.week));
  const lines = ws.map((w) => `KW ${kw(w.week)} (${de(w.week)} – ${de(addDays(w.week, 6))}): Sollzeit ${fmtDur(w.target - w.away)} Std., davon BR-Arbeit ${fmtDur(w.br)} Std. (${Math.round(w.brShare * 100)} %), für die übrigen Aufgaben verfügbar ${fmtDur(w.available)} Std.${w.need ? `, Zeitbedarf der Vorgaben ca. ${fmtDur(w.need)} Std.` : ''}, tatsächlich gearbeitet ${fmtDur(w.worked)} Std.`);
  const facts = [
    `Meine Ziele und Vorgaben${form.value.by ? ` (festgelegt von ${form.value.by})` : ''} wurden nicht um die Zeit für meine Betriebsratsarbeit gekürzt.`,
    form.value.how && `Wie sich das zeigt: ${form.value.how}`,
    'Zeiten laut meiner Aufzeichnung:', ...lines,
    form.value.note,
  ].filter(Boolean).join('\n');
  const d = newDraft('br', { sectionChosen: true, eventAt: `${ws.at(-1)?.week || localNow().slice(0, 10)}T12:00`, eventAtAuto: false, category: 'BR-Arbeit bei Zielen nicht berücksichtigt (§ 37 Abs. 2, § 78 BetrVG)', title: 'BR-Zeit bei Zielen nicht berücksichtigt', persons: form.value.by, facts });
  await saveDraft(d);
  form.value = null;
  router.push(`/diktat/${d.id}`);
}
</script>

<template>
  <div class="page">
    <SubNav :items="NAV.br()" />
    <div class="card">
      <h2 style="margin-top: 0">BR-Zeit &amp; Ziele</h2>
      <p class="muted" style="font-size: .88rem">
        Betriebsratsarbeit ist Arbeitszeit (§ 37 Abs. 2 BetrVG). Werden Ziele, Besuchszahlen oder Vorgaben trotzdem nicht gekürzt, kann das eine
        Benachteiligung wegen der BR-Arbeit sein (§ 78 BetrVG). Hier siehst du je Woche, wie viel Zeit nach BR-Arbeit und Abwesenheit für die übrigen Aufgaben
        bleibt – und was die festgehaltenen <router-link to="/vorgaben">Vorgaben</router-link> bräuchten.
      </p>
      <div class="kpis">
        <div class="kpi"><b>{{ fmtDur(sum.br) }}</b><span>BR-Zeit {{ n }} Wochen</span></div>
        <div class="kpi"><b>{{ sum.target ? Math.round((sum.br / sum.target) * 100) : 0 }} %</b><span>Anteil an der Sollzeit</span></div>
        <div class="kpi"><b :class="sum.need > sum.available ? 'neg' : ''">{{ fmtDur(sum.available) }}</b><span>verfügbar für Aufgaben</span></div>
      </div>
      <p v-if="sum.need > sum.available" class="neg" style="font-size: .88rem; margin-top: 8px">Die Vorgaben bräuchten {{ fmtDur(sum.need) }} Std. – {{ fmtDur(sum.need - sum.available) }} Std. mehr, als nach BR-Arbeit verfügbar war.</p>
    </div>

    <button class="btn primary block" style="margin-bottom: 12px" :disabled="!withBr.length" @click="openForm">Festhalten: Ziele nicht um BR-Zeit gekürzt</button>

    <div class="card">
      <div class="row between"><h3 style="margin: 0">Je Woche</h3>
        <select v-model.number="n" style="width: auto"><option :value="8">8 Wochen</option><option :value="12">12 Wochen</option><option :value="26">26 Wochen</option><option :value="52">52 Wochen</option></select></div>
      <div class="table-wrap" style="margin-top: 8px">
        <table class="t">
          <thead><tr><th>KW</th><th class="num">Soll</th><th class="num">BR</th><th class="num">verfügbar</th><th class="num">Bedarf</th><th class="num">Ist</th></tr></thead>
          <tbody>
            <tr v-for="w in weeks" :key="w.week" :class="{ hi: w.need > w.available && w.br }">
              <td style="white-space: nowrap">{{ kw(w.week) }} <small class="muted">{{ de(w.week).slice(0, 6) }}</small></td>
              <td class="num">{{ fmtDur(w.target - w.away) }}</td>
              <td class="num" :style="w.br ? 'color:var(--br-text);font-weight:650' : ''">{{ w.br ? fmtDur(w.br) : '–' }}</td>
              <td class="num">{{ fmtDur(w.available) }}</td>
              <td class="num" :class="w.need > w.available ? 'neg' : ''">{{ w.need ? fmtDur(w.need) : '–' }}</td>
              <td class="num">{{ fmtDur(w.worked) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <small class="muted">Soll = Sollzeit ohne Urlaub/Krankheit · BR = BR-Tätigkeit + BR-Schulungen · verfügbar = Soll − BR · Bedarf = geschätzter Zeitbedarf der Vorgaben · Ist = tatsächlich gearbeitet.</small>
    </div>

    <Modal v-if="form" title="Als BR-Eintrag festhalten" @close="form = null">
      <p class="muted" style="font-size: .88rem">Es entsteht ein Logbuch-Entwurf (Betriebsrat) mit deinen Zahlen. Den prüfst und ergänzt du, dann festschreiben.</p>
      <label class="f">Welche Wochen?</label>
      <div class="row wrap" style="gap: 6px">
        <button v-for="w in withBr" :key="w.week" class="btn small" :class="{ primary: form.weeks.has(w.week) }" @click="toggle(w.week)">KW {{ kw(w.week) }} · BR {{ fmtDur(w.br) }}</button>
      </div>
      <label class="f">Wer legt die Ziele fest?</label><input v-model="form.by" placeholder="z. B. Herr Maier (Regionalleiter)" />
      <label class="f">Woran zeigt sich, dass nichts gekürzt wurde?</label>
      <textarea v-model="form.how" rows="3" placeholder="z. B. gleiche Besuchsvorgabe 7+1 wie Kollegen ohne BR-Amt; Nachfrage im Wochengespräch, warum Besuche fehlen; Zusatzliste bekommen" />
      <label class="f">Notiz (optional)</label><input v-model="form.note" />
      <div class="actions"><button class="btn" @click="form = null">Abbrechen</button><button class="btn primary" :disabled="!form.weeks.size" @click="create">Entwurf anlegen</button></div>
    </Modal>
  </div>
</template>
