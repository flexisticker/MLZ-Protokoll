<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Icon from './components/Icon.vue';
import Login from './views/Login.vue';
import { store, sync } from './services/store.js';
import { todos } from './services/todos.js';

const route = useRoute();
const router = useRouter();
const loggedIn = computed(() => store.session?.user && !store.session.user.mustChange);
const pending = computed(() => store.outbox.length);
const failed = computed(() => store.outbox.some((o) => o.error));
const openTodos = computed(() => (loggedIn.value && store.data ? todos().filter((t) => t.level !== 'info').length : 0));
const back = () => (window.history.state?.back ? router.back() : router.push(route.meta.back || '/'));
</script>

<template>
  <div v-if="!store.ready" class="empty" style="padding-top: 40vh">Lädt …</div>
  <Login v-else-if="!loggedIn" />
  <template v-else>
    <header class="topbar">
      <button v-if="route.meta.back" aria-label="Zurück" @click="back"><Icon name="back" /></button>
      <div class="title">{{ route.meta.title || 'MLZ-Protokoll' }}</div>
      <span v-if="!store.online" class="chip warn" title="Keine Verbindung – Aufnahmen bleiben auf dem Handy"><Icon name="cloudoff" :size="14" /> offline</span>
      <button v-if="pending" class="chip" :class="{ bad: failed }" title="Noch nicht beim Server" @click="sync()"><Icon name="sync" :size="14" /> {{ pending }}</button>
      <router-link v-if="route.meta.tab !== 'more'" to="/mehr" class="gear" aria-label="Einstellungen und mehr" style="color: #fff; display: inline-flex; padding: 6px"><Icon name="settings" /></router-link>
    </header>
    <router-view v-slot="{ Component }">
      <component :is="Component" :key="route.fullPath.split('?')[0]" />
    </router-view>
    <router-link v-if="!route.path.startsWith('/diktat')" to="/diktat?bereich=incident&sprechen=1" class="fab" aria-label="Sprechen – neue Aufnahme" title="Sprechen"><Icon name="mic" :size="30" /></router-link>
    <nav class="tabs">
      <router-link to="/" :class="{ active: route.meta.tab === 'start' }" exact-active-class=""><Icon name="home" /><span>Start</span><i v-if="openTodos" class="dot">{{ openTodos }}</i></router-link>
      <router-link to="/logbuch" :class="{ active: route.meta.tab === 'log' }" active-class=""><Icon name="book" /><span>Logbuch</span><i v-if="store.drafts.length" class="dot">{{ store.drafts.length }}</i></router-link>
      <router-link to="/zeit" :class="{ active: route.meta.tab === 'time' }" active-class=""><Icon name="clock" /><span>Zeit</span></router-link>
      <router-link to="/betriebsrat" :class="{ active: route.meta.tab === 'br' }" active-class=""><Icon name="users" /><span>Betriebsrat</span></router-link>
    </nav>
  </template>
  <div v-if="store.toast" class="toast">{{ store.toast }}</div>
</template>
