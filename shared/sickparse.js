// Krankmeldung aus einem gesprochenen Satz, z. B.
//   „Ich bin krank, ab Montag fange ich wieder an“
//   „Bin um 11 Uhr während der Arbeit krank geworden und nach Hause, Chef Bescheid gesagt“
//   „Krankgeschrieben bis einschließlich Freitag, war heute beim Arzt“
// Nur ein Vorschlag – das Formular zeigt ihn zur Bestätigung an.
import { addDays, pad, weekday } from './holidays.js';
import { normalize } from './timeparse.js';

const WD = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];
const MONTHS = ['januar', 'februar', 'maerz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
export const SICK_WORDS = /\b(krank\w*|arbeitsunfaehig\w*|au[- ]?bescheinigung|eau|gelber schein|krankenschein|grippe|fieber|magen-?darm|migraene|krankgeschrieben|krankgemeldet|krankmeldung)\b/;

/** Datum in der Zukunft (oder heute) aus einem Satzteil. */
function futureDate(s, today) {
  if (/\buebermorgen\b/.test(s)) return addDays(today, 2);
  if (/\bmorgen\b/.test(s)) return addDays(today, 1);
  if (/\bheute\b/.test(s)) return today;
  let m = s.match(/\bin (\d+) tagen?\b/);
  if (m) return addDays(today, Number(m[1]));
  if (/\bnaechste[nr]? woche\b/.test(s) && !new RegExp(`\\b(${WD.join('|')})\\b`).test(s)) return addDays(today, 7 - weekday(today));
  m = s.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4})?)?(?!\d)/);
  if (m) {
    let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
    if (y < 100) y += 2000;
    let d = `${y}-${pad(m[2])}-${pad(m[1])}`;
    if (!m[3] && d < addDays(today, -60)) d = `${y + 1}${d.slice(4)}`;
    return d;
  }
  m = s.match(new RegExp(`\\b(\\d{1,2})\\.? (${MONTHS.join('|')})\\b`));
  if (m) {
    const y = Number(today.slice(0, 4));
    let d = `${y}-${pad(MONTHS.indexOf(m[2]) + 1)}-${pad(m[1])}`;
    if (d < addDays(today, -60)) d = `${y + 1}${d.slice(4)}`;
    return d;
  }
  m = s.match(new RegExp(`\\b(?:(naechste[nr]?|kommende[nr]?) )?(${WD.join('|')})\\b`));
  if (m) {
    let ahead = (WD.indexOf(m[2]) - weekday(today) + 7) % 7;
    if (ahead === 0 || m[1]) ahead = ahead || 7;
    return addDays(today, ahead);
  }
  return null;
}
/** Datum in der Vergangenheit (oder heute): „seit gestern“, „seit Montag“. */
function pastDate(s, today) {
  if (/\bvorgestern\b/.test(s)) return addDays(today, -2);
  if (/\bgestern\b/.test(s)) return addDays(today, -1);
  if (/\bheute\b/.test(s)) return today;
  const m = s.match(new RegExp(`\\b(${WD.join('|')})\\b`));
  if (m) return addDays(today, -((weekday(today) - WD.indexOf(m[1]) + 7) % 7));
  const d = futureDate(s, today);
  return d && d <= today ? d : null;
}
function timeIn(s) {
  let m = s.match(/\b(\d{1,2}):(\d{2})\b/) || s.match(/\b(\d{1,2}) uhr(?: (\d{1,2}))?\b/);
  if (m) return Number(m[1]) < 24 ? `${pad(m[1])}:${pad(m[2] || 0)}` : '';
  m = s.match(/\bhalb (\d{1,2})\b/);
  if (m) return `${pad(Number(m[1]) - 1)}:30`;
  m = s.match(/\b(?:um|gegen) (\d{1,2})\b/);
  return m && Number(m[1]) < 24 ? `${pad(m[1])}:00` : '';
}

export function parseSick(text, today) {
  const s = normalize(text).replace(/\b(\d{1,2}\.\d{1,2})\.(?!\d)/g, '$1'); // „3.11.“ → „3.11“, damit der Punkt den Satz nicht teilt
  const out = { sick: SICK_WORDS.test(s), from: today, to: '', back: '', fromTime: '', openEnd: false, doctorAt: '', reportedTo: '', unsure: [] };
  if (!out.sick) return out;
  const parts = s.split(/[,;]|\.(?!\d)| und /);
  // Wiederbeginn: „ab Montag wieder“, „fange Montag wieder an“, „am 3.11. wieder arbeiten“
  for (const p of parts) {
    if (!/\b(wieder|zurueck|arbeit\w*|anfangen|fange|einsteigen|dienstbeginn)\b/.test(p)) continue;
    const d = futureDate(p, today);
    if (d && d > today) { out.back = d; break; }
  }
  // Ende: „bis einschließlich Freitag“, „krankgeschrieben bis 7.11.“
  if (!out.back) {
    const m = s.match(/\bbis (?:einschliesslich |inklusive |zum |ende )?([^,;]{1,30})/);
    const d = m && futureDate(m[1], today);
    if (d) out.to = d;
  }
  // Beginn: „seit gestern“, „seit Montag krank“
  const since = s.match(/\bseit ([^,.;]{1,25})/);
  if (since) { const d = pastDate(since[1], today); if (d) out.from = d; }
  // Während der Arbeit krank geworden
  for (const p of parts) {
    if (!/(waehrend der arbeit|nach hause|heim(gefahren|gegangen)?|abgebrochen|aufgehoert|krank geworden|schlecht geworden|ging nicht mehr)/.test(p)) continue;
    const t = timeIn(p) || timeIn(s);
    if (t) { out.fromTime = t; break; }
    out.unsure.push('fromTime');
  }
  // Arzt
  if (/\b(arzt|aerztin|hausarzt|krankgeschrieben|eau|au-?bescheinigung|gelber schein)\b/.test(s)) {
    const m = s.match(/\b(?:beim|zum|beim haus)?arzt[^,.;]{0,25}/);
    out.doctorAt = (m && pastDate(m[0], today)) || (/\b(war|bin|gewesen) .{0,15}arzt|krankgeschrieben\b/.test(s) ? today : '');
  }
  // gemeldet bei
  const rep = text.match(/(?:Bescheid gesagt|abgemeldet|krankgemeldet|gemeldet|informiert)[^.]{0,10}?\b(?:bei |an )?((?:Herrn?|Frau)\s+[A-ZÄÖÜ][\wäöüß-]+|(?:dem |der |meinem |meiner )?(?:Chef(?:in)?|Vorgesetzten|Teamleiter(?:in)?|Gebietsleiter(?:in)?|RVL|Personalabteilung|Büro))/i)
    || text.match(/((?:Herrn?|Frau)\s+[A-ZÄÖÜ][\wäöüß-]+|(?:dem |der |meinem |meiner )?(?:Chef(?:in)?|Vorgesetzten|Teamleiter(?:in)?|RVL|Personalabteilung))[^.]{0,20}(?:Bescheid gesagt|informiert|gemeldet|angerufen)/i);
  if (rep) out.reportedTo = rep[1].replace(/^(dem|der|meinem|meiner)\s+/i, '').trim();
  out.to = out.back ? addDays(out.back, -1) : out.to;
  if (out.to && out.to < out.from) out.to = out.from;
  if (!out.to) { out.to = out.from; out.openEnd = true; }
  return out;
}
