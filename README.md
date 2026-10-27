# MLZ-Protokoll

Selbst gehostete App (Docker auf Unraid, Bedienung am Handy) für:

- **Logbuch per Sprache:** Auffälligkeiten im Beruf und Betriebsratsangelegenheiten diktieren, lokale Spracherkennung
  (whisper.cpp im Container, Modelle der Video-Zentrale mitbenutzt, keine Cloud), Fotos und Anlagen, Leitfragen (wer, was, wann, wo, Zeugen, Zitate), Tatsachen getrennt von Bewertungen.
- **KI-Ausfüllhilfe:** frei erzählen – eine lokale KI (Ollama, optional Claude) erkennt Vorfall / BR-Sache / Arbeitszeit / Urlaub
  und füllt das passende Formular aus; KI-Felder sind markiert, festgeschrieben wird erst nach Prüfung, der Vorschlag bleibt in der Beweiskette.
- **Arbeitszeit:** Stempeln (Beginn/Pause/Arbeitsende) oder per Sprache („halb acht angefangen, 30 Minuten Pause, bis 16 Uhr“),
  Pausenregeln (§ 4 ArbZG), Soll/Ist/Saldo, Feiertage je Bundesland, halbe freie Tage (24.12./31.12.) mit Grundlage,
  Mehrarbeit mit „angeordnet/gebilligt/geduldet von“, Ausschlussfristen und Geltendmachung.
- **Urlaub & Abwesenheit:** Urlaubskonto mit halben Tagen, Übertrag und Verfall, Krankheit, Schulung, Freizeitausgleich.
- **BR-Tätigkeit:** Ab-/Rückmeldung, Arbeit außerhalb der Arbeitszeit mit Ausgleichskonto (§ 37 Abs. 3 BetrVG).
- **Nachweiskette:** Einträge nur anhängen (Datenbank-Trigger), SHA-256-Hash-Kette, Nachträge statt Änderungen,
  drei Zeitpunkte je Eintrag (Geschehen, Handy, Server), RFC-3161-Zeitstempel bei zwei unabhängigen Diensten,
  Originaldateien mit Prüfsumme vom Handy, optionale tägliche Prüfwert-Mail.
- **Export für Anwalt/Gericht:** ZIP mit PDF-Bericht, Originaldaten, Originaldateien, Zeitstempeln, `MANIFEST.sha256`
  und Prüfprogramm (`verify.py`, `verify.sh`).
- **Offline:** Aufnahmen, Fotos und Einträge bleiben ohne Netz auf dem Handy und werden später übertragen.
- **Sicherheit:** Passkey (Fingerabdruck), Passwort + Authenticator-Code, Wiederherstellungscodes, Login-Sperre,
  CSRF-Schutz, Notfall-Zugang über die Unraid-Konsole.

Installation: [`docs/INSTALLATION-UNRAID.md`](docs/INSTALLATION-UNRAID.md) · Sicherung: [`docs/SICHERUNG-GOOGLE-DRIVE.md`](docs/SICHERUNG-GOOGLE-DRIVE.md) ·
Beweisführung: [`docs/BEWEISFUEHRUNG.md`](docs/BEWEISFUEHRUNG.md)

## Entwicklung

```
npm install
npm test                                  # Feiertage, Sprach-Parser, Arbeitszeitlogik
node test/mock-services.mjs &             # Zeitstempel (8098), Ollama (8097), Claude (8096) als Attrappen
mkdir -p data/whisper && touch data/whisper/ggml-small.bin   # Platzhalter-Modell für die Attrappe
npx vite build
DATA_DIR=./data WHISPER_BIN=$PWD/test/fake-whisper.sh TSA_URLS=http://127.0.0.1:8098/tsr \
  TSA_CA_FILE=$PWD/test/.tsa/ca.crt WHISPER_PRELOAD=off npm start   # http://localhost:8090
```

Keine Rechtsberatung – die Hinweise in der App ersetzen keinen Fachanwalt oder die Gewerkschaft.
