import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import { init } from './services/store.js';
import './app.css';

init();
createApp(App).use(router).mount('#app');
