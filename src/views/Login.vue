<script setup>
import { ref } from 'vue';
import { startAuthentication } from '@simplewebauthn/browser';
import { api } from '../services/api.js';
import { afterLogin, store } from '../services/store.js';

const username = ref('');
const password = ref('');
const password2 = ref('');
const name = ref('');
const code = ref('');
const needCode = ref(false);
const busy = ref(false);
const err = ref('');
const newPw = ref('');
const newPw2 = ref('');
const passkeyOk = !!window.PublicKeyCredential && window.isSecureContext;

async function run(fn) {
  busy.value = true; err.value = '';
  try { await fn(); } catch (e) { err.value = e.message; } finally { busy.value = false; }
}
const setup = () => run(async () => {
  if (password.value !== password2.value) throw new Error('Passwörter stimmen nicht überein');
  const r = await api('/setup', { method: 'POST', body: { username: username.value, password: password.value, name: name.value } });
  await afterLogin(r.user);
});
const login = () => run(async () => {
  const r = await api('/login', { method: 'POST', body: { username: username.value, password: password.value, code: code.value || undefined } });
  if (r.needCode) { needCode.value = true; return; }
  await afterLogin(r.user);
});
const passkey = () => run(async () => {
  const { key, options } = await api('/passkey/login/options', { method: 'POST', body: {} });
  const response = await startAuthentication({ optionsJSON: options });
  const r = await api('/passkey/login/verify', { method: 'POST', body: { key, response } });
  await afterLogin(r.user);
});
const change = () => run(async () => {
  if (newPw.value !== newPw2.value) throw new Error('Passwörter stimmen nicht überein');
  const r = await api('/me/password', { method: 'POST', body: { newPassword: newPw.value } });
  await afterLogin(r.user);
});
const logout = () => run(async () => { await api('/logout', { method: 'POST', body: {} }).catch(() => {}); window.dispatchEvent(new Event('mlz-logout')); });
</script>

<template>
  <div class="page" style="max-width: 420px; padding-top: 8vh">
    <div style="text-align: center; margin-bottom: 18px">
      <img src="/icon.svg" alt="" width="72" height="72" />
      <h1 style="margin-top: 8px">MLZ-Protokoll</h1>
      <p class="muted">Logbuch · Arbeitszeit · Nachweise</p>
    </div>
    <div v-if="store.session?.offline" class="alert warn">Server nicht erreichbar. Aufnahmen sind erst nach der Anmeldung möglich – bitte Verbindung (WLAN/VPN) prüfen.</div>

    <form v-if="store.session?.user?.mustChange" class="card" @submit.prevent="change">
      <h2>Neues Passwort vergeben</h2>
      <p class="muted">Der Zugang wurde über die Konsole zurückgesetzt.</p>
      <label class="f">Neues Passwort (mind. 10 Zeichen)</label><input v-model="newPw" type="password" autocomplete="new-password" />
      <label class="f">Wiederholen</label><input v-model="newPw2" type="password" autocomplete="new-password" />
      <p v-if="err" class="alert bad">{{ err }}</p>
      <div class="actions"><button type="button" class="btn ghost" @click="logout">Abbrechen</button><button class="btn primary" :disabled="busy">Speichern</button></div>
    </form>

    <form v-else-if="store.session?.setup" class="card" @submit.prevent="setup">
      <h2>Einrichten</h2>
      <p class="muted">Einmalig: Zugang für dich anlegen. Danach unter „Mehr → Anmeldung & Sicherheit“ Zwei-Faktor und Fingerabdruck (Passkey) einschalten.</p>
      <label class="f">Dein Name (für Berichte)</label><input v-model="name" autocomplete="name" />
      <label class="f">Benutzername</label><input v-model="username" autocomplete="username" autocapitalize="off" />
      <label class="f">Passwort (mind. 10 Zeichen)</label><input v-model="password" type="password" autocomplete="new-password" />
      <label class="f">Passwort wiederholen</label><input v-model="password2" type="password" autocomplete="new-password" />
      <p v-if="err" class="alert bad">{{ err }}</p>
      <button class="btn primary block" style="margin-top: 14px" :disabled="busy">Einrichten</button>
    </form>

    <form v-else class="card" @submit.prevent="login">
      <template v-if="!needCode">
        <label class="f">Benutzername</label><input v-model="username" autocomplete="username" autocapitalize="off" />
        <label class="f">Passwort</label><input v-model="password" type="password" autocomplete="current-password" />
      </template>
      <template v-else>
        <label class="f">Code aus der Authenticator-App<span class="hint">oder einer deiner Wiederherstellungscodes</span></label>
        <input v-model="code" inputmode="numeric" autocomplete="one-time-code" autofocus />
      </template>
      <p v-if="err" class="alert bad" style="margin-top: 10px">{{ err }}</p>
      <button class="btn primary block" style="margin-top: 14px" :disabled="busy">Anmelden</button>
      <button v-if="passkeyOk && !needCode" type="button" class="btn block" style="margin-top: 8px" :disabled="busy" @click="passkey">Mit Fingerabdruck / Passkey</button>
    </form>
  </div>
</template>
