// Reiter je Bereich (Leiste oben auf den Seiten)
import { store } from './store.js';
import { violations } from './derived.js';
import { today } from './util.js';

export const NAV = {
  log: () => [['/logbuch', 'Einträge', store.drafts.length], ['/vorgaenge', 'Vorgänge'], ['/vorgaben', 'Vorgaben & Pflichten']],
  time: () => {
    const y = today().slice(0, 4);
    const n = store.data ? violations(`${y}-01-01`, `${y}-12-31`).filter((v) => v.severity === 'bad').length : 0;
    return [['/zeit', 'Monat'], ['/abwesenheit', 'Urlaub & Kalender'], ['/zeit/verstoesse', 'Verstöße', n], ['/zeit/import', 'Import']];
  },
  br: () => [['/betriebsrat', 'BR-Zeiten'], ['/betriebsrat/ziele', 'BR-Zeit & Ziele'], ['/logbuch?bereich=br', 'BR-Einträge']],
};
