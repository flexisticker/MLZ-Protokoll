<script setup>
import { computed, onMounted, ref } from 'vue';
import Icon from '../components/Icon.vue';
import { api } from '../services/api.js';
import { loadAssist, queueEvidence, settings, store, toast } from '../services/store.js';
import { STATES } from '../../shared/holidays.js';
import { WEEKDAYS, deTime, today } from '../services/util.js';

const s = ref(JSON.parse(JSON.stringify(settings())));
const hours = ref(s.value.weekTarget.map((m) => m / 60));
const year = Number(today().slice(0, 4));
const op = ref({ ...{ carry: null, adjust: 0 }, ...(s.value.vacation.opening?.[year] || {}) });
const balH = ref((Number(s.value.balanceStart.minutes) || 0) / 60);
const smtp = ref({ host: '', port: 465, secure: true, user: '', from: '', pass: '' });
const testTo = ref('');
onMounted(async () => {
  try { smtp.value = { ...smtp.value, ...(await api('/status')).smtp, pass: '' }; testTo.value = s.value.hashMail.to; } catch { /* offline */ }
  try { const a = await api('/assist/status'); ki.value = { ...ki.value, ...a, claudeKey: '' }; } catch { /* offline */ }
  ki.value.loaded = true;
});

// ------------------------------------------------------------ KI-Ausfüllhilfe (Einstellungen auf dem Server, nicht in der Beweiskette)
const ki = ref({ engine: 'off', ollamaUrl: '', ollamaModel: 'qwen2.5:7b-instruct', claudeKey: '', hasClaudeKey: false, pull: null });
const kiTest = ref(null);
let pullTimer;
async function saveKi(extra = {}) {
  try {
    const r = await api('/assist/config', { method: 'PUT', body: { engine: ki.value.engine, ollamaUrl: ki.value.ollamaUrl, ollamaModel: ki.value.ollamaModel, claudeKey: ki.value.claudeKey, ...extra } });
    ki.value = { ...ki.value, ...r, claudeKey: '' };
    await loadAssist();
    toast('KI-Ausfüllhilfe gespeichert');
  } catch (e) { toast(e.message); }
}
async function testKi() {
  await saveKi();
  kiTest.value = { busy: true };
  kiTest.value = await api('/assist/test', { method: 'POST', body: {} }).catch((e) => ({ ok: false, error: e.message }));
}
async function pullKi() {
  await saveKi();
  ki.value.pull = await api('/assist/pull', { method: 'POST', body: {} });
  clearInterval(pullTimer);
  pullTimer = setInterval(async () => {
    const a = await api('/assist/status').catch(() => null);
    if (!a) return;
    ki.value.pull = a.pull;
    if (!a.pull || a.pull.done || a.pull.error) clearInterval(pullTimer);
  }, 2000);
}
const history = computed(() => (store.data?.settingsHistory || []).slice().reverse().slice(0, 5));

async function save() {
  const out = JSON.parse(JSON.stringify(s.value));
  out.weekTarget = hours.value.map((h) => Math.round((Number(String(h).replace(',', '.')) || 0) * 60));
  out.vacation.opening = { ...(out.vacation.opening || {}), [year]: { ...(op.value.carry === null || op.value.carry === '' ? {} : { carry: Number(op.value.carry) }), adjust: Number(op.value.adjust) || 0 } };
  out.balanceStart.minutes = Math.round((Number(String(balH.value).replace(',', '.')) || 0) * 60);
  await queueEvidence('settings', out, { label: 'Einstellungen' });
  toast('Einstellungen gespeichert');
}
async function saveSmtp() {
  try { await api('/smtp', { method: 'PUT', body: smtp.value }); smtp.value.pass = ''; toast('Mailzugang gespeichert'); } catch (e) { toast(e.message); }
}
async function testMail() {
  try { await api('/smtp/test', { method: 'POST', body: { to: testTo.value } }); toast('Testmail gesendet'); } catch (e) { toast(e.message); }
}
</script>

<template>
  <div class="page">
    <p class="muted" style="font-size: .9rem">Jede Änderung wird mit Datum in der Beweiskette gespeichert – so bleibt nachvollziehbar, welche Regel wann galt.</p>

    <div class="card">
      <h2>Person</h2>
      <label class="f">Name</label><input v-model="s.name" />
      <label class="f">Funktion</label><input v-model="s.position" placeholder="z. B. Lagerist, Betriebsratsmitglied" />
      <label class="f">Arbeitgeber</label><input v-model="s.employer" />
    </div>

    <div class="card">
      <h2>Arbeitszeit</h2>
      <label class="f">Arbeitszeitmodell</label><input v-model="s.workModel" />
      <label class="f">Bundesland (Feiertage)</label>
      <select v-model="s.state"><option v-for="(n, k) in STATES" :key="k" :value="k">{{ n }}</option></select>
      <label class="f">Soll-Stunden je Wochentag</label>
      <div class="grid3" style="grid-template-columns: repeat(7, 1fr); gap: 4px">
        <div v-for="(d, i) in WEEKDAYS" :key="d" style="text-align: center"><small>{{ d }}</small><input v-model="hours[i]" inputmode="decimal" style="padding: 8px 4px; text-align: center" /></div>
      </div>
      <small class="muted">Summe {{ hours.reduce((a, b) => a + (Number(String(b).replace(',', '.')) || 0), 0) }} Std./Woche</small>
      <label class="f">Pausen</label>
      <div v-for="(r, i) in s.breakRules" :key="i" class="row" style="margin-bottom: 6px">
        <span>ab</span><input v-model.number="r.afterMin" type="number" style="width: 80px" /><span>Min. Arbeit →</span><input v-model.number="r.breakMin" type="number" style="width: 70px" /><span>Min. Pause</span>
      </div>
      <small class="muted">Gesetzlich (§ 4 ArbZG): über 6 Std. 30 Min., über 9 Std. 45 Min.</small>
      <label class="f">Wenn die Pause zu kurz ist</label>
      <select v-model="s.breakMode"><option value="auto">fehlende Pause abziehen (wie es das Gesetz verlangt)</option><option value="warn">nur Hinweis anzeigen</option></select>
      <label class="f">Saldo ab<span class="hint">Beginn der Aufzeichnung; Übertrag aus der Zeit davor in Stunden (+/−)</span></label>
      <div class="grid2"><input v-model="s.balanceStart.date" type="date" /><input v-model="balH" inputmode="decimal" placeholder="0" /></div>
      <label class="f">Ausschlussfrist für Mehrarbeit (Monate)<span class="hint">aus Arbeitsvertrag/Tarifvertrag – oft 3 oder 6 Monate</span></label>
      <input v-model.number="s.exclusionMonths" type="number" min="1" max="36" />
    </div>

    <div class="card">
      <h2>Urlaub</h2>
      <label class="f">Urlaubstage pro Jahr</label><input v-model.number="s.vacation.daysPerYear" type="number" step="0.5" />
      <label class="f">Resturlaub aus dem Vorjahr verfällt am</label>
      <input v-model="s.vacation.carryExpiry" placeholder="03-31" />
      <small class="muted">Format MM-TT, z. B. 03-31 für 31. März</small>
      <div class="grid2">
        <div><label class="f">Übertrag aus {{ year - 1 }}<span class="hint">leer = automatisch</span></label><input v-model="op.carry" type="number" step="0.5" /></div>
        <div><label class="f">Korrektur {{ year }} (+/−)</label><input v-model="op.adjust" type="number" step="0.5" /></div>
      </div>
    </div>

    <div id="halbetage" class="card">
      <h2>Halbe freie Tage</h2>
      <p class="muted" style="font-size: .9rem">24.12. und 31.12. sind keine gesetzlichen Feiertage. Halbe freie Tage gibt es nur aus Arbeitsvertrag, Tarifvertrag, Betriebsvereinbarung oder betrieblicher Übung – bitte die Grundlage eintragen.</p>
      <div v-for="(h, i) in s.halfDays" :key="i" class="card flat" style="padding: 10px">
        <div class="row"><input v-model="h.active" type="checkbox" /><input v-model="h.name" class="grow" /><input v-model="h.md" style="width: 80px" placeholder="12-24" /><button class="btn small ghost" @click="s.halfDays.splice(i, 1)"><Icon name="trash" :size="16" /></button></div>
        <input v-model="h.basis" style="margin-top: 6px" placeholder="Grundlage, z. B. § 5 Arbeitsvertrag / BV Arbeitszeit vom …" />
      </div>
      <button class="btn small" @click="s.halfDays.push({ md: '', name: '', active: true, basis: '' })"><Icon name="plus" :size="16" /> Tag</button>
      <h3>Zusätzliche örtliche Feiertage</h3>
      <div v-for="(h, i) in s.extraHolidays" :key="i" class="row" style="margin-bottom: 6px"><input v-model="h.name" class="grow" /><input v-model="h.md" style="width: 80px" placeholder="MM-TT" /><button class="btn small ghost" @click="s.extraHolidays.splice(i, 1)"><Icon name="trash" :size="16" /></button></div>
      <button class="btn small" @click="s.extraHolidays.push({ md: '', name: '' })"><Icon name="plus" :size="16" /> Feiertag</button>
    </div>

    <div class="card">
      <h2>Betriebsrat &amp; Aufbewahrung</h2>
      <label class="f">Frist für Freizeitausgleich § 37 Abs. 3 (Monate)</label><input v-model.number="s.brCompMonths" type="number" min="1" />
      <label class="f">Aufbewahrung nach Abschluss eines Vorgangs (Jahre)</label><input v-model.number="s.retentionYears" type="number" min="1" max="30" />
    </div>

    <div class="card">
      <h2>Spracherkennung</h2>
      <label class="f">Namen und Fachwörter<span class="hint">helfen der Erkennung, z. B. „Maier, Schulz, Betriebsrat, BetrVG, Schichtplan“</span></label>
      <textarea v-model="s.promptWords" rows="2" />
      <label class="check"><input v-model="s.webSpeech" type="checkbox" /> <span><b>Live-Erkennung des Browsers erlauben</b><br /><small class="muted">Schneller, aber der Ton geht dabei an Google bzw. Apple. Für sensible Inhalte die eigene Erkennung (Standard) benutzen.</small></span></label>
    </div>

    <div id="ki" class="card">
      <h2>KI-Ausfüllhilfe</h2>
      <p class="muted" style="font-size: .9rem">Du erzählst frei, die KI verteilt das Gesagte auf die Felder (wer, was, wann, wo, Zeugen, Zitate …) und erkennt, ob es um einen Vorfall, BR-Sache, Arbeitszeit oder Urlaub geht. Du prüfst und schreibst fest. Original-Aufnahme, Transkript und der KI-Vorschlag bleiben in der Beweiskette.</p>
      <p v-if="!ki.loaded" class="muted">Lädt …</p>
      <template v-else>
      <label class="f">KI</label>
      <select v-model="ki.engine">
        <option value="off">aus</option>
        <option value="ollama">lokal auf dem Server (Ollama) – empfohlen</option>
        <option value="claude">Claude (Anthropic, Internet)</option>
      </select>
      <template v-if="ki.engine === 'ollama'">
        <label class="f">Ollama-Adresse<span class="hint">z. B. http://192.168.1.10:11434</span></label>
        <input v-model="ki.ollamaUrl" placeholder="http://192.168.1.10:11434" inputmode="url" />
        <label class="f">Modell<span class="hint">qwen2.5:7b-instruct = gute Qualität; qwen2.5:3b-instruct = schneller, ungenauer</span></label>
        <input v-model="ki.ollamaModel" list="ki-models" />
        <datalist id="ki-models"><option value="qwen2.5:7b-instruct" /><option value="qwen2.5:3b-instruct" /><option value="qwen2.5:14b-instruct" /><option value="llama3.1:8b" /><option value="gemma2:9b" /></datalist>
      </template>
      <template v-if="ki.engine === 'claude'">
        <div class="alert warn" style="margin-top: 10px">Der erkannte Text (mit Namen von Kolleginnen und Kollegen) wird an Anthropic in den USA gesendet. Für BR-Inhalte und Personaldaten besser die lokale KI benutzen.</div>
        <label class="f">Claude-API-Schlüssel<span class="hint">{{ ki.hasClaudeKey ? 'gespeichert – leer lassen, um ihn zu behalten' : 'noch nicht gespeichert' }}</span></label>
        <input v-model="ki.claudeKey" type="password" autocomplete="off" placeholder="sk-ant-…" />
        <button v-if="ki.hasClaudeKey" class="btn small ghost" @click="saveKi({ removeKey: true })">Schlüssel entfernen</button>
      </template>
      <div class="row wrap" style="margin-top: 12px">
        <button class="btn primary" @click="saveKi()">Speichern</button>
        <button v-if="ki.engine !== 'off'" class="btn" @click="testKi">Verbindung testen</button>
        <button v-if="ki.engine === 'ollama'" class="btn" @click="pullKi">Modell laden</button>
      </div>
      <p v-if="kiTest && !kiTest.busy" class="alert" :class="kiTest.ok ? (kiTest.hasModel === false ? 'warn' : 'ok') : 'bad'" style="margin-top: 10px">
        <template v-if="!kiTest.ok">{{ kiTest.error }}</template>
        <template v-else-if="kiTest.hasModel === false">Ollama erreichbar, aber das Modell {{ ki.ollamaModel }} fehlt noch → „Modell laden“ (ca. 4–5 GB).</template>
        <template v-else>Verbindung in Ordnung.</template>
      </p>
      <p v-if="ki.pull" class="alert" :class="ki.pull.error ? 'bad' : ki.pull.done ? 'ok' : ''" style="margin-top: 10px">
        <template v-if="ki.pull.error">{{ ki.pull.error }}</template>
        <template v-else-if="ki.pull.done">Modell {{ ki.pull.model }} ist geladen.</template>
        <template v-else>Lade {{ ki.pull.model }}: {{ ki.pull.status }} {{ ki.pull.total ? `${Math.round(ki.pull.completed / ki.pull.total * 100)} %` : '' }}</template>
      </p>
      </template>
    </div>
    <div class="card">
      <h2>Tägliche Prüfwert-Mail</h2>
      <p class="muted" style="font-size: .9rem">Schickt jede Nacht den Prüfwert der Kette an deine private Adresse – ein zusätzlicher, unabhängiger Nachweis.</p>
      <label class="check"><input v-model="s.hashMail.enabled" type="checkbox" /> <span>einschalten</span></label>
      <label class="f">An (private Adresse)</label><input v-model="s.hashMail.to" type="email" />
    </div>

    <button class="btn primary block" style="margin-bottom: 16px" @click="save"><Icon name="check" :size="18" /> Einstellungen speichern</button>

    <div class="card">
      <h2>Mailversand (SMTP)</h2>
      <p class="muted" style="font-size: .9rem">Für Gmail: smtp.gmail.com, Port 465, Benutzer = Gmail-Adresse, Passwort = <b>App-Passwort</b> (Google-Konto → Sicherheit → App-Passwörter). Wird nur auf dem Server gespeichert.</p>
      <div class="grid2"><div><label class="f">Server</label><input v-model="smtp.host" placeholder="smtp.gmail.com" /></div><div><label class="f">Port</label><input v-model.number="smtp.port" type="number" /></div></div>
      <label class="f">Benutzer</label><input v-model="smtp.user" autocomplete="off" />
      <label class="f">Passwort<span class="hint">{{ smtp.hasPass ? 'gespeichert – leer lassen, um es zu behalten' : 'noch nicht gespeichert' }}</span></label><input v-model="smtp.pass" type="password" autocomplete="new-password" />
      <label class="f">Absender (optional)</label><input v-model="smtp.from" />
      <div class="row wrap" style="margin-top: 10px"><button class="btn" @click="saveSmtp">Speichern</button><input v-model="testTo" class="grow" placeholder="Testadresse" /><button class="btn" @click="testMail">Testen</button></div>
    </div>

    <div v-if="history.length" class="card">
      <h3>Letzte Änderungen</h3>
      <small v-for="h in history" :key="h.seq" class="muted" style="display: block">{{ deTime(h.at) }} · Nr. {{ h.seq }}</small>
    </div>
  </div>
</template>
