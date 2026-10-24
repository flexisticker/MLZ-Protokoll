<script setup>
import { computed, ref } from 'vue';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import { queueEvidence, store, toast } from '../services/store.js';
import { brAcc } from '../services/derived.js';
import { fmtDur } from '../../shared/worktime.js';
import { de, minutesBetween, nowTime, today, uuid } from '../services/util.js';

const list = computed(() => Object.values(store.data?.br || {}).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)));
const acc = computed(() => (store.data ? brAcc() : null));
const form = ref(null);
const cancel = ref(null);
function open() { form.value = { id: uuid(), date: today(), start: nowTime(), end: '', outside: false, topic: '', place: '', abmeldungTo: '', abmeldungAt: nowTime(), rueckmeldungAt: '', reasonOutside: '', note: '', paid: false }; }
async function save() {
  if (!form.value.start || !form.value.end) return toast('Beginn und Ende angeben');
  await queueEvidence('br', { ...form.value }, { id: form.value.id, label: 'BR-Tätigkeit' });
  form.value = null;
  toast('Gespeichert');
}
async function doCancel() {
  await queueEvidence('br-cancel', { reason: cancel.value.reason }, { ref: cancel.value.id, label: 'Storno BR' });
  cancel.value = null;
}
</script>

<template>
  <div class="page">
    <div class="tiles">
      <router-link class="tile" to="/diktat?bereich=br"><span class="ico"><Icon name="mic" /></span>BR-Vorfall diktieren</router-link>
      <button class="tile green" @click="open"><span class="ico"><Icon name="clock" /></span>BR-Zeit erfassen<small>Ab-/Rückmeldung</small></button>
    </div>
    <div v-if="acc" class="card">
      <h2>Ausgleich § 37 Abs. 3 BetrVG</h2>
      <p class="muted" style="font-size: .9rem">BR-Arbeit, die aus betriebsbedingten Gründen außerhalb der Arbeitszeit stattfindet, ist durch Freizeit auszugleichen – grundsätzlich innerhalb eines Monats, sonst ist sie wie Mehrarbeit zu vergüten.</p>
      <div class="kpis">
        <div class="kpi"><b>{{ fmtDur(acc.earned) }}</b><span>außerhalb erworben</span></div>
        <div class="kpi"><b>{{ fmtDur(acc.used) }}</b><span>ausgeglichen</span></div>
        <div class="kpi"><b :class="acc.balance > 0 ? 'neg' : ''">{{ fmtDur(acc.balance) }}</b><span>offen</span></div>
      </div>
      <ul v-if="acc.open.length" class="list" style="margin-top: 8px">
        <li v-for="o in acc.open" :key="o.id"><span :class="o.overdue ? 'neg' : ''">{{ de(o.date) }}: {{ fmtDur(o.minutes) }} Std. – Ausgleich bis {{ de(o.deadline) }}{{ o.overdue ? ' (überfällig → Vergütung verlangen)' : '' }}</span></li>
      </ul>
      <small class="muted">Freizeitausgleich nehmen: Urlaub &amp; Abwesenheit → „Freizeitausgleich BR-Arbeit“.</small>
    </div>
    <div class="card">
      <h2>BR-Zeiten</h2>
      <div v-if="!list.length" class="empty">Noch keine BR-Zeiten erfasst.</div>
      <ul class="list">
        <li v-for="b in list" :key="b.id" class="row">
          <div class="grow" :style="b.cancelled ? 'opacity:.55' : ''">
            <b>{{ de(b.date) }} {{ b.start }}–{{ b.end }}</b> <small>({{ fmtDur(minutesBetween(b.start, b.end)) }} Std.)</small>
            <span v-if="b.outside" class="badge warn">außerhalb</span><span v-if="b.cancelled" class="badge">storniert</span><br />
            <small>{{ b.topic }}<template v-if="b.place"> · {{ b.place }}</template><template v-if="b.abmeldungTo"> · abgemeldet bei {{ b.abmeldungTo }} {{ b.abmeldungAt }}</template><template v-if="b.rueckmeldungAt"> · zurück {{ b.rueckmeldungAt }}</template></small>
          </div>
          <button v-if="!b.cancelled" class="btn small ghost" @click="cancel = { id: b.id, reason: '' }">Stornieren</button>
        </li>
      </ul>
    </div>

    <Modal v-if="form" title="BR-Tätigkeit" @close="form = null">
      <label class="f">Datum</label><input v-model="form.date" type="date" />
      <div class="grid2">
        <div><label class="f">von</label><input v-model="form.start" type="time" /></div>
        <div><label class="f">bis</label><input v-model="form.end" type="time" /></div>
      </div>
      <label class="f">Anlass / Thema<span class="hint">ohne Personaldaten von Kolleginnen und Kollegen</span></label><input v-model="form.topic" placeholder="z. B. BR-Sitzung, Sprechstunde, Gespräch mit GF" />
      <label class="f">Ort</label><input v-model="form.place" />
      <div class="grid2">
        <div><label class="f">abgemeldet bei</label><input v-model="form.abmeldungTo" /></div>
        <div><label class="f">um</label><input v-model="form.abmeldungAt" type="time" /></div>
      </div>
      <label class="f">zurückgemeldet um</label><input v-model="form.rueckmeldungAt" type="time" />
      <label class="check"><input v-model="form.outside" type="checkbox" /> <span>außerhalb meiner Arbeitszeit (betriebsbedingt, § 37 Abs. 3)</span></label>
      <template v-if="form.outside"><label class="f">Warum außerhalb?</label><input v-model="form.reasonOutside" placeholder="z. B. Schichtbetrieb, Termin vom Arbeitgeber gelegt" /></template>
      <label class="f">Notiz</label><input v-model="form.note" />
      <div class="actions"><button class="btn" @click="form = null">Abbrechen</button><button class="btn primary" @click="save">Speichern</button></div>
    </Modal>
    <Modal v-if="cancel" title="BR-Zeit stornieren" @close="cancel = null">
      <label class="f">Grund</label><input v-model="cancel.reason" />
      <div class="actions"><button class="btn" @click="cancel = null">Abbrechen</button><button class="btn danger" @click="doCancel">Stornieren</button></div>
    </Modal>
  </div>
</template>
