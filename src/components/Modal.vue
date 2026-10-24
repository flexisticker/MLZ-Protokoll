<script setup>
const emit = defineEmits(['close']);
defineProps({ title: String });
</script>
<template>
  <Teleport to="body">
    <div class="modal-bg" @click.self="emit('close')">
      <div class="modal" role="dialog" aria-modal="true">
        <h2 v-if="title">{{ title }}</h2>
        <slot />
      </div>
    </div>
  </Teleport>
</template>
