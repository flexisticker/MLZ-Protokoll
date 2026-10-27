<script setup>
// Vorgaben & Pflichten (oft nur mündlich) mit geschätztem Zeitbedarf – Grundlage für „Mehrarbeit war notwendig“.
import { computed, ref } from 'vue';
import SubNav from '../components/SubNav.vue';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import { NAV } from '../services/nav.js';
import { queueEvidence, queueFile, settings, store, toast } from '../services/store.js';
import { activeRules, ruleMinutes } from '../../shared/rules.js';
import { fmtDur } from '../../shared/worktime.js';
import { de, deTime, today, uuid } from '../services/util.js';

const all = computed(() => Object.values(store.data?.rules || {}).sort((a, b) => String(b.since || '').localeCompare(String(a.since || ''))));
const active = computed(() => all.value.filter((r) => !r.ended));
const ended = computed(() => all.value.filter((r) => r.ended));
const need = computed(() => activeRules(store.data?.rules, today()).reduce((n, r) => n + ruleMinutes(r), 0));
const target = computed(() => Math.max(...settings().weekTarget));

const TEMPLATES = [
  { title: 'Besuchsvorgabe pro Tag (z. B. 7+1)', text: 'Pro Tag sind 7 Bestandskunden und 1 Neukunde zu besuchen.', effort: [{ label: 'Kundenbesuch', count: 8, minutes: 40, per: 'day' }, { label: 'Fahrt zwischen den Kunden', count: 8, minutes: 25, per: 'day' }, { label: 'Besuchsbericht / CRM', count: 8, minutes: 10, per: 'day' }] },
  { title: 'Besuchszeiten (erster Besuch bis 8 Uhr, letzter nicht vor 16 Uhr)', text: 'Der erste Kundenbesuch soll spätestens um 8:00 Uhr sein, der letzte nicht vor 16:00 Uhr.', effort: [{ label: 'Anfahrt zum ersten Kunden', count: 1, minutes: 45, per: 'day' }, { label: 'Rückfahrt vom letzten Kunden', count: 1, minutes: 45, per: 'day' }] },
  { title: 'CRM-Pflege und Datenpflege', text: '', effort: [{ label: 'CRM / Daten pflegen', count: 1, minutes: 30, per: 'day' }] },
  { title: 'Wochenvorplanung mit Screenshot', text: 'Die Wochenplanung muss vorab erstellt und als Screenshot geschickt werden.', effort: [{ label: 'Wochenvorplanung', count: 1, minutes: 60, per: 'week' }] },
  { title: 'Pflicht-Strategien / Kampagnen bearbeiten', text: '', effort: [{ label: 'Strategien bearbeiten', count: 1, minutes: 60, per: 'week' }] },
  { title: 'Zusatzlisten bei Nichterreichen (z. B. L-Kunden-Liste, W30-Liste)', text: 'Werden Ziele nicht erreicht, müssen zusätzlich Listen bearbeitet werden.', effort: [{ label: 'Liste bearbeiten', count: 1, minutes: 90, per: 'week' }] },
];

const form = ref(null);
function open(r = null, tpl = null) {
  const base = r || tpl || {};
  form.value = {
    id: r?.id || uuid(), title: base.title || '', text: base.text || '', since: r?.since || '', by: r?.by || '', how: r?.how || 'mündlich', written: !!r?.written,
    witnesses: r?.witnesses || '', consequence: r?.consequence || '', evidence: r?.evidence || '',
    effort: JSON.parse(JSON.stringify(base.effort || [{ label: '', count: 1, minutes: 0, per: 'day' }])), fileIds: [...(r?.fileIds || [])], isNew: !r,
  };
}
const formNeed = computed(() => (form.value ? ruleMinutes(form.value) : 0));
async function attach(e) {
  for (const file of [...(e.target.files || [])]) {
    const f = await queueFile(file, { purpose: file.type.startsWith('image/') ? 'photo' : 'attachment', name: file.name, capturedAt: new Date(file.lastModified || Date.now()).toISOString() });
    form.value.fileIds.push(f.id);
  }
  e.target.value = '';
  toast('Anlage hinzugefügt');
}
async function save() {
  if (!form.value.title.trim()) return toast('Bitte kurz benennen');
  const { isNew, ...p } = form.value;
  await queueEvidence('rule', p, { label: isNew ? 'Vorgabe' : 'Vorgabe geändert' });
  form.value = null;
  toast(isNew ? 'Vorgabe festgehalten' : 'Neue Fassung gespeichert – die alte bleibt sichtbar');
}
const end = ref(null);
async function doEnd() {
  await queueEvidence('rule-end', { date: end.value.date, reason: end.value.reason }, { ref: end.value.id, label: 'Vorgabe aufgehoben' });
  end.value = null;
}
const history = ref(null);
const fileName = (id) => store.data?.files?.[id]?.name || 'Anlage';
</script>

<template>
  <div class="page">
    <SubNav :items="NAV.log()" />
    <div class="card">
      <h2 style="margin-top: 0">Vorgaben &amp; Pflichten</h2>
      <p class="muted" style="font-size: .88rem">
        Halte fest, was von dir verlangt wird – auch wenn es nie schriftlich kam: wer hat es gesagt, seit wann, was passiert bei Nichterfüllung.
        Mit dem geschätzten <b>Zeitbedarf</b> zeigt MLZ, ob das in deiner Sollzeit überhaupt zu schaffen ist. Das ist die Grundlage für
        „die Mehrarbeit war zur Erledigung notwendig“.
      </p>
      <div class="kpis">
        <div class="kpi"><b :class="need > target ? 'neg' : ''">{{ fmtDur(need) }}</b><span>Zeitbedarf je Tag</span></div>
        <div class="kpi"><b>{{ fmtDur(target) }}</b><span>Sollzeit je Tag</span></div>
        <div class="kpi"><b :class="need > target ? 'neg' : 'pos'">{{ fmtDur(need - target, true) }}</b><span>Differenz</span></div>
      </div>
      <p v-if="need > target" class="neg" style="font-size: .88rem; margin-top: 8px">Allein die festgehaltenen Vorgaben brauchen mehr Zeit als die Sollzeit – BR-Arbeit, Urlaub und alle anderen Aufgaben noch nicht eingerechnet.</p>
    </div>

    <button class="btn primary block" style="margin-bottom: 8px" @click="open()"><Icon name="plus" :size="18" /> Vorgabe festhalten</button>
    <details class="card" style="padding: 10px 14px">
      <summary>Vorlagen (anpassen, Zeiten sind nur Startwerte)</summary>
      <div class="row wrap" style="gap: 6px; margin-top: 8px">
        <button v-for="tp in TEMPLATES" :key="tp.title" class="btn small" style="text-align: left" @click="open(null, tp)">+ {{ tp.title }}</button>
      </div>
    </details>

    <div class="card">
      <div v-if="!active.length" class="empty">Noch keine Vorgaben festgehalten.</div>
      <ul class="list">
        <li v-for="r in active" :key="r.id" style="display: block">
          <div class="row between" style="align-items: flex-start">
            <div class="grow">
              <b>{{ r.title }}</b> <span v-if="!r.written" class="badge warn">nur mündlich</span><br />
              <small class="muted">{{ [r.since && `seit ${de(r.since)}`, r.by && `von ${r.by}`, r.how].filter(Boolean).join(' · ') }}</small>
              <p v-if="r.text" style="margin: 4px 0; font-size: .92rem">{{ r.text }}</p>
              <small v-if="r.consequence" class="neg">Folge bei Nichterfüllung: {{ r.consequence }}<br /></small>
              <small v-if="ruleMinutes(r)">Zeitbedarf ca. <b>{{ fmtDur(ruleMinutes(r)) }} Std./Tag</b> ({{ r.effort.map((e) => `${e.label || 'Tätigkeit'} ${e.count} × ${e.minutes} Min./${e.per === 'week' ? 'Woche' : 'Tag'}`).join(', ') }})<br /></small>
              <small v-if="r.fileIds?.length" class="muted">Anlagen: <a v-for="f in r.fileIds" :key="f" :href="`/api/files/${f}`" target="_blank" style="margin-right: 8px">{{ fileName(f) }}</a><br /></small>
              <small class="muted">Fassung vom {{ deTime(r.receivedAt) }}<template v-if="r.versions.length"> · <a href="#" @click.prevent="history = r">{{ r.versions.length }} frühere Fassung(en)</a></template></small>
            </div>
          </div>
          <div class="row" style="margin-top: 6px">
            <button class="btn small" @click="open(r)">Ändern</button>
            <button class="btn small ghost" @click="end = { id: r.id, date: today(), reason: '' }">Aufgehoben</button>
          </div>
        </li>
      </ul>
    </div>
    <div v-if="ended.length" class="card">
      <h3 style="margin-top: 0">Aufgehobene Vorgaben</h3>
      <ul class="list"><li v-for="r in ended" :key="r.id"><div><b>{{ r.title }}</b><br /><small class="muted">{{ r.since ? `${de(r.since)} – ` : 'bis ' }}{{ de(r.ended.date) }}<template v-if="r.ended.reason"> · {{ r.ended.reason }}</template></small></div></li></ul>
    </div>

    <Modal v-if="form" :title="form.isNew ? 'Vorgabe festhalten' : 'Vorgabe ändern (neue Fassung)'" @close="form = null">
      <label class="f">Was wird verlangt? (kurz)</label><input v-model="form.title" placeholder="z. B. 7+1 Besuche am Tag" />
      <label class="f">Genauer Wortlaut / Beschreibung</label><textarea v-model="form.text" rows="3" placeholder="Möglichst so, wie es gesagt wurde" />
      <div class="grid2">
        <div><label class="f">seit wann?</label><input v-model="form.since" type="date" /></div>
        <div><label class="f">wie mitgeteilt?</label>
          <select v-model="form.how"><option>mündlich</option><option>in einer Besprechung</option><option>Telefon</option><option>Teams/Chat</option><option>E-Mail</option><option>Präsentation/Folie</option></select></div>
      </div>
      <label class="f">von wem?</label><input v-model="form.by" placeholder="Name, Funktion" />
      <label class="check"><input v-model="form.written" type="checkbox" /> <span>gibt es schriftlich (Mail, Folie, Protokoll)</span></label>
      <label class="f">Zeugen (wer war dabei / betrifft es noch?)</label><input v-model="form.witnesses" />
      <label class="f">Folge bei Nichterfüllung</label><input v-model="form.consequence" placeholder="z. B. zusätzlich L-Kunden-Liste und W30-Liste bearbeiten" />
      <h3>Zeitbedarf (Schätzung)</h3>
      <div v-for="(e, i) in form.effort" :key="i" class="row" style="margin-bottom: 6px; gap: 6px">
        <input v-model="e.label" class="grow" placeholder="Tätigkeit" style="min-width: 0" />
        <input v-model.number="e.count" type="number" min="0" inputmode="numeric" style="width: 56px" aria-label="Anzahl" />
        <span>×</span>
        <input v-model.number="e.minutes" type="number" min="0" inputmode="numeric" style="width: 64px" aria-label="Minuten" />
        <select v-model="e.per" style="width: auto"><option value="day">Min./Tag</option><option value="week">Min./Woche</option></select>
        <button class="btn small ghost" aria-label="Entfernen" @click="form.effort.splice(i, 1)"><Icon name="trash" :size="16" /></button>
      </div>
      <button class="btn small" @click="form.effort.push({ label: '', count: 1, minutes: 0, per: 'day' })"><Icon name="plus" :size="16" /> Tätigkeit</button>
      <p style="margin-top: 8px">= ca. <b>{{ fmtDur(formNeed) }} Std. je Arbeitstag</b><template v-if="formNeed > target"> – <span class="neg">mehr als die Sollzeit ({{ fmtDur(target) }})</span></template></p>
      <label class="f">Belege (optional)</label><input v-model="form.evidence" placeholder="z. B. Mail vom …, Folie aus Meeting vom …" />
      <label class="btn small" style="margin-top: 8px"><Icon name="paperclip" :size="16" /> Screenshot / Datei anhängen<input type="file" accept="image/*,application/pdf" multiple hidden @change="attach" /></label>
      <small v-if="form.fileIds.length" class="muted" style="display: block">{{ form.fileIds.length }} Anlage(n)</small>
      <div class="actions"><button class="btn" @click="form = null">Abbrechen</button><button class="btn primary" @click="save">Festhalten</button></div>
    </Modal>
    <Modal v-if="end" title="Vorgabe aufgehoben" @close="end = null">
      <label class="f">gilt nicht mehr ab</label><input v-model="end.date" type="date" />
      <label class="f">Grund / wie erfahren?</label><input v-model="end.reason" />
      <div class="actions"><button class="btn" @click="end = null">Abbrechen</button><button class="btn primary" @click="doEnd">Speichern</button></div>
    </Modal>
    <Modal v-if="history" title="Frühere Fassungen" @close="history = null">
      <div v-for="v in history.versions.slice().reverse()" :key="v.evidenceId" class="card flat" style="padding: 10px">
        <b>{{ v.title }}</b><br /><small class="muted">Fassung vom {{ deTime(v.receivedAt) }}</small>
        <p v-if="v.text" style="font-size: .9rem">{{ v.text }}</p>
        <small v-if="ruleMinutes(v)">Zeitbedarf {{ fmtDur(ruleMinutes(v)) }} Std./Tag</small>
      </div>
    </Modal>
  </div>
</template>
