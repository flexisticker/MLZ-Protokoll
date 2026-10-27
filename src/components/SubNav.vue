<script setup>
// Reiter innerhalb eines Bereichs (z. B. Zeit: Monat · Urlaub · Verstöße · Import)
import { useRoute } from 'vue-router';

defineProps({ items: Array }); // [[pfad, beschriftung, zähler?]]
const route = useRoute();
</script>

<template>
  <nav class="subnav">
    <router-link v-for="[to, label, n] in items" :key="to" :to="to" :class="{ on: route.path === to }">{{ label }}<i v-if="n" class="cnt">{{ n }}</i></router-link>
  </nav>
</template>
