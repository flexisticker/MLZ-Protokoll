import { createRouter, createWebHistory } from 'vue-router';

const views = import.meta.glob(['./views/*.vue', '!./views/Login.vue']);
const v = (name) => views[`./views/${name}.vue`];
export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (to, from, saved) => saved || (to.hash ? new Promise((ok) => setTimeout(() => ok({ el: to.hash, top: 70 }), 300)) : { top: 0 }),
  routes: [
    { path: '/', component: v('Home'), meta: { title: 'MLZ-Protokoll', tab: 'start' } },
    { path: '/diktat/:id?', component: v('Dictate'), meta: { title: 'Entwurf', tab: 'log', back: '/logbuch' } },
    { path: '/logbuch', component: v('Logbook'), meta: { title: 'Logbuch', tab: 'log' } },
    { path: '/eintrag/:id', component: v('Entry'), meta: { title: 'Eintrag', tab: 'log', back: '/logbuch' } },
    { path: '/zeit', component: v('Time'), meta: { title: 'Arbeitszeit', tab: 'time' } },
    { path: '/zeit/tag/:date', component: v('Day'), meta: { title: 'Arbeitstag', tab: 'time', back: '/zeit' } },
    { path: '/zeit/import', component: v('Import'), meta: { title: 'Arbeitszeit', tab: 'time' } },
    { path: '/zeit/verstoesse', component: v('Violations'), meta: { title: 'Arbeitszeit', tab: 'time' } },
    { path: '/abwesenheit', component: v('Absences'), meta: { title: 'Arbeitszeit', tab: 'time' } },
    { path: '/betriebsrat', component: v('Br'), meta: { title: 'Betriebsrat', tab: 'br' } },
    { path: '/betriebsrat/ziele', component: v('BrGoals'), meta: { title: 'Betriebsrat', tab: 'br' } },
    { path: '/vorgaenge', component: v('Cases'), meta: { title: 'Logbuch', tab: 'log' } },
    { path: '/vorgaben', component: v('Rules'), meta: { title: 'Logbuch', tab: 'log' } },
    { path: '/export', component: v('Export'), meta: { title: 'Export für Anwalt/Gericht', tab: 'more', back: '/mehr' } },
    { path: '/pruefung', component: v('Verify'), meta: { title: 'Prüfung & Zeitstempel', tab: 'more', back: '/mehr' } },
    { path: '/einstellungen', component: v('Settings'), meta: { title: 'Einstellungen', tab: 'more', back: '/mehr' } },
    { path: '/sicherheit', component: v('Security'), meta: { title: 'Anmeldung & Sicherheit', tab: 'more', back: '/mehr' } },
    { path: '/hinweise', component: v('Hints'), meta: { title: 'Rechtliche Hinweise', tab: 'more', back: '/mehr' } },
    { path: '/mehr', component: v('More'), meta: { title: 'Einstellungen & mehr', tab: 'more', back: '/' } },
    { path: '/:p(.*)*', redirect: '/' },
  ],
});
