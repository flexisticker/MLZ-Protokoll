// Gesetzliche Feiertage je Bundesland (ohne Internet berechnet).
// Datumswerte immer als 'JJJJ-MM-TT' (lokales Kalenderdatum, keine Zeitzone).

export const STATES = {
  BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg',
  HE: 'Hessen', MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen',
  RP: 'Rheinland-Pfalz', SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen',
};

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const weekday = (s) => (parseYmd(s).getDay() + 6) % 7; // 0 = Montag … 6 = Sonntag

/** Ostersonntag (Gaußsche Osterformel, Ergänzung von Lichtenberg). */
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(new Date(y, month - 1, day, 12));
}

/** Buß- und Bettag: Mittwoch vor dem 23. November. */
function repentance(y) {
  const d = new Date(y, 10, 22, 12);
  while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
  return ymd(d);
}

/**
 * Feiertage eines Jahres → Map 'JJJJ-MM-TT' → Name.
 * extra: zusätzliche örtliche Feiertage [{md: 'MM-TT', name}] (z. B. Augsburger Friedensfest).
 */
export function holidays(year, state = 'BW', extra = []) {
  const e = easter(year);
  const list = [
    [`${year}-01-01`, 'Neujahr'],
    [addDays(e, -2), 'Karfreitag'],
    [addDays(e, 1), 'Ostermontag'],
    [`${year}-05-01`, 'Tag der Arbeit'],
    [addDays(e, 39), 'Christi Himmelfahrt'],
    [addDays(e, 50), 'Pfingstmontag'],
    [`${year}-10-03`, 'Tag der Deutschen Einheit'],
    [`${year}-12-25`, '1. Weihnachtstag'],
    [`${year}-12-26`, '2. Weihnachtstag'],
  ];
  const add = (states, date, name) => { if (states.includes(state)) list.push([date, name]); };
  add(['BW', 'BY', 'ST'], `${year}-01-06`, 'Heilige Drei Könige');
  add(['BE', 'MV'], `${year}-03-08`, 'Internationaler Frauentag');
  add(['BB'], e, 'Ostersonntag');
  add(['BB'], addDays(e, 49), 'Pfingstsonntag');
  add(['BW', 'BY', 'HE', 'NW', 'RP', 'SL'], addDays(e, 60), 'Fronleichnam');
  add(['BY', 'SL'], `${year}-08-15`, 'Mariä Himmelfahrt');
  add(['TH'], `${year}-09-20`, 'Weltkindertag');
  add(['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'], `${year}-10-31`, 'Reformationstag');
  add(['BW', 'BY', 'NW', 'RP', 'SL'], `${year}-11-01`, 'Allerheiligen');
  add(['SN'], repentance(year), 'Buß- und Bettag');
  for (const x of extra || []) if (/^\d\d-\d\d$/.test(x?.md || '')) list.push([`${year}-${x.md}`, x.name || 'Örtlicher Feiertag']);
  return new Map(list.sort((a, b) => a[0].localeCompare(b[0])));
}

const cache = new Map();
export function holidayName(date, state = 'BW', extra = []) {
  const y = Number(String(date).slice(0, 4));
  const key = `${y}|${state}|${JSON.stringify(extra || [])}`;
  if (!cache.has(key)) cache.set(key, holidays(y, state, extra));
  return cache.get(key).get(date) || '';
}
