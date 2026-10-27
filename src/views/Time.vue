<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import { queueEvidence, store, toast } from '../services/store.js';
import { claims, monthRows, totalBalance, vacation, violations, workDays } from '../services/derived.js';
import { ABSENCE_TYPES, LAW_LABEL, fmtDur } from '../../shared/worktime.js';
import { MONTHS, WEEKDAYS, de, deShort, today } from '../services/util.js';
import { weekday } from '../../shared/holidays.js';

const router = useRouter();
const t = today();
const ym = ref({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) });
const move = (n) => { let { y, m } = ym.value; m += n; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } ym.value = { y, m }; };
const rows = computed(() => (store.data ? monthRows(ym.value.y, ym.value.m) : []));
const days = computed(() => (store.data ? workDays() : new Map()));
const sum = computed(() => rows.value.reduce((a, r) => ({ w: a.w + r.worked, t: a.t + r.target + 0, c: a.c + r.credit, b: a.b + r.balance }), { w: 0, t: 0, c: 0, b: 0 }));
const claimList = computed(() => (store.data ? claims().slice().reverse() : []));
const claim = ref(null);
async function saveClaim() {
  await queueEvidence('claim', { month: claim.value.month, date: claim.value.date, how: claim.value.how, to: claim.value.to, note: claim.value.note, minutes: claim.value.minutes }, { label: 'Geltendmachung' });
  claim.value = null;
  toast('Geltendmachung festgehalten');
}
const hint = (r) => [r.holiday, r.half && `${r.half} ½`, r.absence && `${ABSENCE_TYPES[r.absence.type]?.label.split(' ')[0] || ''}${r.absence.half ? ' ½' : ''}`, store.data?.times?.[r.date]?.overtime?.orderedBy && 'Mehrarbeit angeordnet', store.data?.times?.[r.date]?.segments?.some((x) => x.after) && 'nach Feierabend gearbeitet', ].filter(Boolean).join(' · ');
const yearViol = computed(() => (store.data ? violations(`${ym.value.y}-01-01`, `${ym.value.y}-12-31`) : []));
const hardViol = computed(() => yearViol.value.filter((v) => v.severity === 'bad').length);
</script>

<template>
  <div class="page">
    <div class="tiles">
      <router-link class="tile green" :to="`/zeit/tag/${t}?sprechen=1`"><span class="ico"><Icon name="mic" /></span>Arbeitszeit sprechen</router-link>
      <router-link class="tile amber" to="/abwesenheit"><span class="ico"><Icon name="calendar" /></span>Urlaub &amp; Abwesenheit<small>{{ vacation().remaining }} Tage frei</small></router-link>
    </div>

    <router-link v-if="yearViol.length" to="/zeit/verstoesse" class="alert plain-link" :class="hardViol ? 'bad' : 'warn'" style="display: block; text-decoration: none">
      <b>⚠ {{ hardViol }} Verstöße gegen das Arbeitszeitgesetz in {{ ym.y }}</b><template v-if="yearViol.length > hardViol"> · {{ yearViol.length - hardViol }} zu prüfen</template><br />
      <small>Ansehen und festhalten, wer davon wusste →</small>
    </router-link>
    <div class="card">
      <div class="row between">
        <button class="btn small ghost" aria-label="Vormonat" @click="move(-1)"><Icon name="left" /></button>
        <h2 style="margin: 0">{{ MONTHS[ym.m - 1] }} {{ ym.y }}</h2>
        <button class="btn small ghost" aria-label="Folgemonat" @click="move(1)"><Icon name="right" /></button>
      </div>
      <div class="kpis" style="margin: 10px 0">
        <div class="kpi"><b>{{ fmtDur(sum.w + sum.c) }}</b><span>Ist (inkl. Anrechnung)</span></div>
        <div class="kpi"><b>{{ fmtDur(sum.t) }}</b><span>Soll</span></div>
        <div class="kpi"><b :class="sum.b < 0 ? 'neg' : 'pos'">{{ fmtDur(sum.b, true) }}</b><span>Monat</span></div>
      </div>
      <div class="table-wrap">
        <table class="t">
          <thead><tr><th>Tag</th><th>Zeiten</th><th class="num">Ist</th><th class="num">Saldo</th><th /></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.date" class="daycell" :class="{ we: weekday(r.date) >= 5, hol: r.holiday, today: r.date === t, viol: r.violations.some((x) => x.severity === 'bad') }" @click="router.push(`/zeit/tag/${r.date}`)">
              <td style="white-space: nowrap">{{ WEEKDAYS[weekday(r.date)] }} {{ deShort(r.date) }}</td>
              <td>
                {{ (days.get(r.date)?.segments || []).map((x) => `${x.start}–${x.end}`).join(', ') }}
                <template v-if="days.get(r.date)?.open"> {{ days.get(r.date).open }}–…</template>
                <br v-if="hint(r)" /><small class="muted">{{ hint(r) }}</small>
                <template v-for="x in r.violations" :key="x.code"><br /><small :class="x.severity === 'bad' ? 'neg' : 'warnc'">⚠ {{ LAW_LABEL[x.code] }} ({{ x.law }})</small></template>
              </td>
              <td class="num">{{ r.worked || r.credit ? fmtDur(r.worked + r.credit) : '' }}</td>
              <td class="num" :class="r.balance < 0 ? 'neg' : r.balance > 0 ? 'pos' : ''">{{ r.future || r.untracked ? '' : fmtDur(r.balance, true) }}</td>
              <td><Icon name="right" :size="16" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p style="margin-top: 10px"><b>Saldo gesamt bis heute: <span :class="totalBalance() < 0 ? 'neg' : 'pos'">{{ fmtDur(totalBalance(), true) }} Std.</span></b></p>
      <router-link class="btn small" style="margin: 8px 0" to="/zeit/import">Alte Arbeitszeiten importieren (CSV)</router-link><br />
      <small class="muted">Tag antippen zum Erfassen oder Korrigieren. Korrekturen werden als neue Fassung gespeichert, die alte bleibt sichtbar.</small>
    </div>

    <div id="fristen" class="card">
      <h2>Mehrarbeit &amp; Ausschlussfristen</h2>
      <p class="muted" style="font-size: .9rem">Mehrarbeit muss oft innerhalb einer Frist (Vertrag/Tarif) schriftlich geltend gemacht werden. Hier festhalten, wann und wie das geschehen ist.</p>
      <div v-if="!claimList.length" class="empty">Noch keine Mehrarbeit erfasst.</div>
      <ul class="list">
        <li v-for="c in claimList" :key="c.month" class="row">
          <div class="grow">
            <b>{{ c.month.slice(5) }}/{{ c.month.slice(0, 4) }}: {{ fmtDur(c.overtime) }} Std.</b><br />
            <small v-if="c.claimed" class="pos">geltend gemacht am {{ de(c.claimed.date) }} ({{ c.claimed.how }}{{ c.claimed.to ? ` bei ${c.claimed.to}` : '' }})</small>
            <small v-else :class="c.overdue ? 'neg' : ''">Frist {{ c.overdue ? 'abgelaufen am' : 'bis' }} {{ de(c.deadline) }}</small>
          </div>
          <button v-if="!c.claimed" class="btn small" @click="claim = { month: c.month, minutes: c.overtime, date: t, how: 'E-Mail', to: '', note: '' }">Geltend gemacht</button>
        </li>
      </ul>
    </div>

    <Modal v-if="claim" title="Mehrarbeit geltend gemacht" @close="claim = null">
      <p>Monat {{ claim.month }} · {{ fmtDur(claim.minutes) }} Std.</p>
      <label class="f">Datum</label><input v-model="claim.date" type="date" />
      <label class="f">Wie?</label>
      <select v-model="claim.how"><option>E-Mail</option><option>Schreiben (Brief)</option><option>Schreiben (persönlich übergeben)</option><option>Antrag im Zeiterfassungssystem</option><option>mündlich (mit Zeugen)</option></select>
      <label class="f">Bei wem?</label><input v-model="claim.to" placeholder="z. B. Personalabteilung, Herr X" />
      <label class="f">Notiz</label><textarea v-model="claim.note" rows="2" placeholder="z. B. Kopie liegt in Ordner …, Eingang bestätigt am …" />
      <div class="actions"><button class="btn" @click="claim = null">Abbrechen</button><button class="btn primary" @click="saveClaim">Festhalten</button></div>
    </Modal>
  </div>
</template>
