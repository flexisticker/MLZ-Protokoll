# Beweisführung mit MLZ-Protokoll

> Keine Rechtsberatung. Stand der Recherche Oktober 2026 – Fristen und Vorgehen mit Fachanwalt oder Gewerkschaft klären.

## Rechtliche Einordnung

- Ein privates Logbuch ist vor dem Arbeitsgericht ein **Indiz**, das frei gewürdigt wird (§ 286 ZPO). Eine Datei ohne
  qualifizierte elektronische Signatur ist ein Augenscheinsobjekt (§ 371 ZPO), ein Ausdruck eine Privaturkunde (§ 416 ZPO),
  die nur beweist, dass der Verfasser das geschrieben hat – nicht, dass es stimmt.
- Wert hat das Logbuch, weil es die eigene Darstellung **konkret** macht (Substantiierung), die Grundlage für eine
  Parteivernehmung/-anhörung liefern kann und Zeugen als Gedächtnisstütze dient.
- Glaubwürdig wird es durch: zeitnahe Erfassung, konkrete Angaben (wer/was/wann/wo/Zeugen/Zitate), durchgehende Führung,
  keine nachträglichen Änderungen (nur datierte Nachträge), Trennung von Tatsachen und Bewertung.
- **Überstunden** (BAG 4.5.2022 – 5 AZR 359/21): Arbeitnehmer muss darlegen, dass er über die Normalarbeitszeit hinaus gearbeitet
  hat **und** dass der Arbeitgeber die Mehrarbeit angeordnet, gebilligt, geduldet oder als notwendig hingenommen hat.
- **Zeiterfassung** (BAG 13.9.2022 – 1 ABR 22/21, EuGH C-55/18): Arbeitgeber muss Arbeitszeit erfassen – auch bei Vertrauensarbeitszeit.
- **BR-Arbeit** außerhalb der Arbeitszeit: Freizeitausgleich innerhalb eines Monats, sonst Vergütung (§ 37 Abs. 3 BetrVG).
  Behinderung der BR-Arbeit (§ 78) ist strafbar (§ 119 BetrVG, Antrag u. a. durch den Betriebsrat).

## Grenzen

- **§ 201 StGB:** keine heimlichen Tonaufnahmen von Gesprächen – nur eigene Notizen diktieren.
- Fotos: Zustände statt Personen; keine vertraulichen Unterlagen kopieren (GeschGehG, arbeitsrechtliche Folgen).
- Keine Personaldaten von Kollegen aus der BR-Arbeit im privaten Logbuch (§§ 79, 79a BetrVG).
- DSGVO: Daten Dritter sparsam, gut geschützt, nach Abschluss und Aufbewahrungsfrist löschen.

## Technische Umsetzung

| Maßnahme | Umsetzung |
|---|---|
| Nur anhängen | Tabelle `evidence`, Trigger verbieten UPDATE/DELETE (Ausnahme: Inhalt löschen nach Löschvermerk, Prüfwerte bleiben) |
| Hash-Kette | `hash = SHA-256(prev_hash\|seq\|id\|kind\|ref\|event_at\|captured_at\|received_at\|payload_hash\|device)` |
| Drei Zeitpunkte | Geschehen (Angabe), Aufnahme am Handy, Eingang Server (Serveruhr) |
| Originale | Ton/Foto unverändert, SHA-256 schon am Handy gebildet und beim Empfang verglichen, Datei schreibgeschützt |
| Transkript | eigener Eintrag „automatisch, ungeprüft“, Bezug auf die Tondatei; bearbeiteter Text steht im Logbuch-Eintrag |
| Korrekturen | Nachtrag / Zurückziehen / neue Fassung (Arbeitszeit) – Altes bleibt sichtbar |
| Externer Zeitanker | RFC 3161 bei FreeTSA und DigiCert: nachts und ca. 10 Min. nach neuen Einträgen; optional Prüfwert-Mail |
| Prüfung | Kette + Dateien nachts und per Knopf; Export mit `verify.py` (ohne Zusatzpakete) |

Ein qualifizierter eIDAS-Zeitstempel (gesetzliche Vermutung der Richtigkeit, kostenpflichtig) ist bewusst nicht eingebaut;
die beiden freien Dienste lassen sich unter `TSA_URLS` durch einen qualifizierten ersetzen oder ergänzen.
