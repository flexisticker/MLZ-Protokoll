# MLZ-Protokoll – Projektgedächtnis

Eigenständiges Projekt (nicht Teil von Flex-Studio). **Keine Passwörter, Tokens oder Schlüssel hier eintragen.**

## Nutzer & Zweck
- Michael (Flexisticker), Arbeitnehmer und **Betriebsratsmitglied**, Baden-Württemberg, Android-Handy, Unraid-Server
  (Xeon E3-1225 v5, 4 Kerne, 48 GB RAM). Kommunikation **Deutsch, Du-Form**, Pläne erst erklären, bei „leg los“ fertig bauen.
- Ziel: Logbuch per Sprache (Auffälligkeiten im Beruf + BR-Arbeit) mit gerichtsfester Nachweiskette, Fotos,
  Arbeitszeit per Sprache/Stempeln, Pausen, Urlaub inkl. halber Tage, 24.12./31.12. halbe Tage.
- Vorgaben: 40 Std. Vertrauensarbeitszeit, 30 Urlaubstage (Startwert), Ausschlussfrist 3 Monate (Startwert),
  Aufbewahrung **5 Jahre** nach Abschluss eines Vorgangs, Sicherung **Google Drive verschlüsselt** (rclone crypt).

## Architektur
- Ein Image `ghcr.io/flexisticker/mlz-protokoll` (Node 22, Express 5, `node:sqlite`, Vue 3 + Vite + vite-plugin-pwa),
  Port 8090, Volume `/data`. Zweiter Container **speaches** (Whisper, CPU) im Docker-Netz `mlz-net`, ohne Port nach außen.
  Unraid-Vorlagen `unraid/*.xml`, Anleitung `docs/INSTALLATION-UNRAID.md`. Action `.github/workflows/docker.yml` (Tests + Build auf `main`).
- `shared/` wird von Server **und** Browser genutzt: `holidays.js` (alle Bundesländer, Ostern), `timeparse.js`
  (gesprochene Zeiten inkl. schwäbisch „viertel acht“ = 7:15), `worktime.js` (Soll/Ist, Pausen § 4 ArbZG, Urlaubskonto,
  BR-Ausgleich § 37 Abs. 3, Ausschlussfristen).
- **Beweiskette** `server/evidence.js`: Tabelle `evidence` nur anhängen (Trigger), `hash = SHA-256(prev|seq|id|kind|ref|event_at|captured_at|received_at|payload_hash|device)`,
  Inhalt löschen nur nach Löschvermerk `erase` (Prüfwerte bleiben). Arten vom Browser: entry, addendum, retract, time, stamp,
  absence(-cancel), br(-cancel), claim, case(-close/-reopen), settings. Server: file, transcript, erase.
  Objekt-Arten (entry/absence/br/case) haben Beweis-ID = Objekt-ID (Doppelübertragung → idempotent).
- Lesesicht `server/state.js` baut alles aus der Kette (Cache, bei jedem Anhängen verworfen) → `/api/state`.
- Dateien `server/files.js`: Upload als Rohdaten mit `x-sha256` vom Handy (Abweichung → 422), Ablage `dateien/JJJJ/<id>.<ext>`, chmod 444.
- Spracherkennung `server/transcribe.js`: ffmpeg → WAV 16 kHz → speaches `/v1/audio/transcriptions` (lädt Modell per
  `POST /v1/models/<id>` nach). Diktat: large-v3-turbo, Arbeitszeit-Sätze: small (schnell). „Namen und Fachwörter“ → `prompt`.
- Zeitstempel `server/anchors.js`: `openssl ts` → FreeTSA + DigiCert (RFC 3161), nachts 23:30 und ~10 Min. nach neuen Einträgen;
  Tabelle `anchors` unveränderbar (außer `mailed_at`). Prüfwert-Mail `server/mail.js` (SMTP in kv, nicht in der Kette).
- Export `server/export.js`: ZIP (bericht.pdf via pdfkit, daten.json, kette.json, dateien/, zeitstempel/, MANIFEST.sha256, verify.py/.sh).
  PDF-Standardschriften = Windows-1252 → `pdfText()` ersetzt fehlende Zeichen. Seitenzahlen: `margins.bottom = 0` beim Schreiben (sonst Leerseiten).
- Browser: Warteschlange in IndexedDB (`src/services/store.js`, `idb.js`), Entwürfe lokal + `/api/drafts`, letzter Stand in
  IndexedDB `cache` → App startet offline mit gemerkter Anmeldung (`localStorage mlz-user`, nur Name/ID).
  **Payloads vor IndexedDB immer als JSON-Kopie** (Vue-Proxys sind nicht klonbar). `sync()` hängt bei laufendem Abgleich einen zweiten an.
- Anmeldung `server/auth.js`/`passkeys.js`: scrypt, TOTP (eigene Umsetzung), 10 Wiederherstellungscodes, Passkeys (@simplewebauthn, RP-ID aus Host),
  Sitzungen als Hash, Sperre 8 Fehlversuche/Std., CSRF-Kopf **`X-MLZ: 1`**. Notfall: `node server/reset-login.js <name>` in der Container-Konsole.

## Testen
- `npm test` (13 Tests), `node test/mock-services.mjs` (Whisper-Attrappe :8099, Zeitstempeldienst :8098 mit eigener CA in `test/.tsa/`),
  Server mit `WHISPER_URL=http://127.0.0.1:8099 TSA_URLS=http://127.0.0.1:8098/tsr TSA_CA_FILE=$PWD/test/.tsa/ca.crt WHISPER_PRELOAD=off`.
- Playwright (global, Chromium `/opt/pw-browsers`) mit `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` für das Mikrofon.
- Getestet (24.10.2026): Einrichten, Stempeln, Diktat → Transkript → Festschreiben, Nachtrag, Arbeitszeit sprechen → Parser → Speichern,
  alle Seiten 390 px ohne Überlauf, offline Diktat + Festschreiben → später übertragen, Export + `verify.py` (alles in Ordnung), Trigger
  (UPDATE/DELETE abgelehnt), TOTP/Sperre/CSRF, Notfall-Reset, Produktions-Install (`npm ci --omit=dev`).
- **Nicht getestet:** echter speaches-Container (Modellpfad/Download), echte FreeTSA/DigiCert (Sandbox gesperrt), Docker-Build (kein Daemon),
  echtes Android-Handy (Mikrofon, Installation, Passkey), Gmail-Versand, rclone.

## Versionen
- **1.0.0 (24.10.2026):** Erstausgabe mit allen Funktionen oben.

## Offene Punkte / Ideen
- Nach der Installation: Erkennungsdauer auf dem Xeon messen (large-v3-turbo); falls zu langsam → `WHISPER_MODEL` auf medium/small.
- Optional: qualifizierter eIDAS-Zeitstempel (kostenpflichtig) über `TSA_URLS`; Dateien zusätzlich mit AES-GCM verschlüsseln;
  Ollama für Zeitsätze, die der Regel-Parser nicht versteht.
