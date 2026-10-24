<script setup>
import { onMounted, ref } from 'vue';
import qrcode from 'qrcode-generator';
import { startRegistration } from '@simplewebauthn/browser';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import { api } from '../services/api.js';
import { store, toast } from '../services/store.js';
import { deTime } from '../services/util.js';

const info = ref(null);
const pw = ref({ password: '', newPassword: '', again: '' });
const totp = ref(null); // { step, secret, uri, qr, code, password }
const codes = ref(null);
const ask = ref(null); // Passwortabfrage { action, password }
const pkName = ref('Handy');
const passkeyOk = !!window.PublicKeyCredential && window.isSecureContext;

async function load() { info.value = await api('/me/security'); store.session.user = info.value.user; }
onMounted(load);

async function changePw() {
  if (pw.value.newPassword !== pw.value.again) return toast('Passwörter stimmen nicht überein');
  try { await api('/me/password', { method: 'POST', body: pw.value }); pw.value = { password: '', newPassword: '', again: '' }; toast('Passwort geändert – andere Geräte wurden abgemeldet'); } catch (e) { toast(e.message); }
}
async function totpStart(password) {
  const r = await api('/me/totp/start', { method: 'POST', body: { password } });
  const q = qrcode(0, 'M'); q.addData(r.uri); q.make();
  totp.value = { ...r, qr: q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }), code: '' };
}
async function totpConfirm() {
  try {
    const r = await api('/me/totp/confirm', { method: 'POST', body: { code: totp.value.code } });
    totp.value = null;
    if (r.codes) codes.value = r.codes;
    toast('Zwei-Faktor eingeschaltet');
    await load();
  } catch (e) { toast(e.message); }
}
async function runAsk() {
  const { action, password } = ask.value;
  try {
    if (action === 'totp') await totpStart(password);
    if (action === 'totp-off') { await api('/me/totp/disable', { method: 'POST', body: { password } }); toast('Zwei-Faktor ausgeschaltet'); }
    if (action === 'codes') codes.value = (await api('/me/recovery', { method: 'POST', body: { password } })).codes;
    ask.value = null;
    await load();
  } catch (e) { toast(e.message); }
}
async function addPasskey() {
  try {
    const options = await api('/passkey/register/options', { method: 'POST', body: {} });
    const response = await startRegistration({ optionsJSON: options });
    await api('/passkey/register/verify', { method: 'POST', body: { response, name: pkName.value } });
    toast('Passkey gespeichert');
    await load();
  } catch (e) { toast(e.name === 'NotAllowedError' ? 'Abgebrochen' : e.message); }
}
async function removePasskey(id) { if (confirm('Passkey entfernen?')) { await api(`/me/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }); await load(); } }
async function logoutAll() { await api('/me/logout-all', { method: 'POST', body: {} }); toast('Andere Geräte abgemeldet'); await load(); }
</script>

<template>
  <div v-if="info" class="page">
    <div class="card">
      <h2>Fingerabdruck / Passkey</h2>
      <p class="muted" style="font-size: .9rem">Anmelden per Fingerabdruck oder Gesichtserkennung – sicherer als ein Passwort. Funktioniert nur über die https-Adresse.</p>
      <ul class="list">
        <li v-for="p in info.passkeys" :key="p.id" class="row"><Icon name="key" /><div class="grow"><b>{{ p.name }}</b><br /><small>angelegt {{ deTime(p.created_at) }}<template v-if="p.last_used"> · zuletzt {{ deTime(p.last_used) }}</template></small></div><button class="btn small ghost" @click="removePasskey(p.id)"><Icon name="trash" :size="18" /></button></li>
      </ul>
      <div v-if="passkeyOk" class="row" style="margin-top: 8px"><input v-model="pkName" class="grow" placeholder="Name des Geräts" /><button class="btn" @click="addPasskey"><Icon name="plus" :size="18" /> Hinzufügen</button></div>
      <p v-else class="alert warn">Passkeys brauchen die https-Adresse.</p>
    </div>

    <div class="card">
      <h2>Zwei-Faktor (Authenticator-App)</h2>
      <p v-if="info.user.totp" class="pos"><Icon name="check" :size="18" /> eingeschaltet · {{ info.user.recoveryLeft }} Wiederherstellungscodes übrig</p>
      <p v-else class="muted">Beim Anmelden mit Passwort zusätzlich ein 6-stelliger Code aus einer App (z. B. Google Authenticator, Aegis).</p>
      <div class="row wrap">
        <button v-if="!info.user.totp" class="btn primary" @click="ask = { action: 'totp', password: '' }">Einschalten</button>
        <template v-else>
          <button class="btn" @click="ask = { action: 'codes', password: '' }">Neue Wiederherstellungscodes</button>
          <button class="btn" @click="ask = { action: 'totp-off', password: '' }">Ausschalten</button>
        </template>
      </div>
    </div>

    <div class="card">
      <h2>Passwort ändern</h2>
      <label class="f">Aktuelles Passwort</label><input v-model="pw.password" type="password" autocomplete="current-password" />
      <label class="f">Neues Passwort (mind. 10 Zeichen)</label><input v-model="pw.newPassword" type="password" autocomplete="new-password" />
      <label class="f">Wiederholen</label><input v-model="pw.again" type="password" autocomplete="new-password" />
      <button class="btn" style="margin-top: 10px" @click="changePw">Ändern</button>
    </div>

    <div class="card">
      <h2>Angemeldete Geräte</h2>
      <ul class="list"><li v-for="(s, i) in info.sessions" :key="i"><small>{{ s.ua || 'unbekannt' }}<br />seit {{ deTime(s.created_at) }}</small></li></ul>
      <button class="btn" @click="logoutAll">Alle anderen abmelden</button>
    </div>

    <div class="card">
      <h2>Sicherheitsprotokoll</h2>
      <ul class="list"><li v-for="(l, i) in info.log.slice(0, 30)" :key="i"><small><b>{{ l.type }}</b> · {{ deTime(l.at) }} · {{ l.ip }}<template v-if="l.detail"> · {{ l.detail }}</template></small></li></ul>
    </div>

    <Modal v-if="ask" title="Passwort bestätigen" @close="ask = null">
      <input v-model="ask.password" type="password" autocomplete="current-password" @keyup.enter="runAsk" />
      <div class="actions"><button class="btn" @click="ask = null">Abbrechen</button><button class="btn primary" @click="runAsk">Weiter</button></div>
    </Modal>
    <Modal v-if="totp" title="Authenticator-App einrichten" @close="totp = null">
      <p>1. QR-Code mit der App scannen (auf einem anderen Gerät) – oder den Schlüssel eintippen:</p>
      <div class="qr" style="width: 210px" v-html="totp.qr" />
      <p class="mono">{{ totp.secret }}</p>
      <a class="btn small" :href="totp.uri">In Authenticator-App öffnen (gleiches Handy)</a>
      <p>2. Den angezeigten 6-stelligen Code eingeben:</p>
      <input v-model="totp.code" inputmode="numeric" autocomplete="one-time-code" />
      <div class="actions"><button class="btn" @click="totp = null">Abbrechen</button><button class="btn primary" @click="totpConfirm">Bestätigen</button></div>
    </Modal>
    <Modal v-if="codes" title="Wiederherstellungscodes" @close="codes = null">
      <p><b>Jetzt ausdrucken oder abschreiben</b> und sicher aufbewahren. Jeder Code funktioniert einmal, falls das Handy mit der Authenticator-App verloren geht.</p>
      <div class="codes"><div v-for="c in codes" :key="c">{{ c }}</div></div>
      <div class="actions"><button class="btn primary" @click="codes = null">Erledigt</button></div>
    </Modal>
  </div>
</template>
