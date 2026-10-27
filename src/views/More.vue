<script setup>
import Icon from '../components/Icon.vue';
import { api } from '../services/api.js';
import { store } from '../services/store.js';

const items = [
  ['/export', 'download', 'Export für Anwalt/Gericht', 'PDF + Originale + Prüfprogramm'],
  ['/pruefung', 'shield', 'Prüfung & Zeitstempel', 'Beweiskette, Sicherung, Warteschlange'],
  ['/einstellungen', 'settings', 'Einstellungen', 'Arbeitszeit, Pausen, Urlaub, halbe Tage'],
  ['/sicherheit', 'lock', 'Anmeldung & Sicherheit', 'Passwort, Zwei-Faktor, Fingerabdruck'],
  ['/hinweise', 'info', 'Rechtliche Hinweise', 'Was ist erlaubt, was zählt vor Gericht'],
];
async function logout() { await api('/logout', { method: 'POST', body: {} }).catch(() => {}); window.dispatchEvent(new Event('mlz-logout')); }
</script>

<template>
  <div class="page">
    <div class="card">
      <ul class="list">
        <li v-for="[to, icon, title, sub] in items" :key="to">
          <router-link class="item" :to="to"><Icon :name="icon" /><div class="grow"><b>{{ title }}</b><br /><small>{{ sub }}</small></div><Icon name="right" /></router-link>
        </li>
      </ul>
    </div>
    <button class="btn block" @click="logout"><Icon name="logout" :size="18" /> Abmelden</button>
    <p class="muted" style="text-align: center; font-size: .8rem; margin-top: 14px">MLZ-Protokoll {{ store.session?.version }} · angemeldet als {{ store.session?.user?.username }}</p>
  </div>
</template>
