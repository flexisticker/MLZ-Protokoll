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
  Port 8090 (Unraid-Host 8095 – 8094 hat die Video-Zentrale), Volume `/data`, optional `/models` = Whisper-Modelle der **Video-Zentrale** (`/mnt/user/appdata/video-zentrale/whisper`, nur lesend).
  Seit 1.1.0 kein speaches-Container mehr. Unraid-Vorlage `unraid/mlz-protokoll.xml`, Anleitung `docs/INSTALLATION-UNRAID.md`. Action `.github/workflows/docker.yml` (Tests + Build auf `main`).
- `shared/` wird von Server **und** Browser genutzt: `holidays.js` (alle Bundesländer, Ostern), `timeparse.js`
  (gesprochene Zeiten inkl. schwäbisch „viertel acht“ = 7:15), `worktime.js` (Soll/Ist, Pausen § 4 ArbZG, Urlaubskonto,
  BR-Ausgleich § 37 Abs. 3, Ausschlussfristen).
- **Beweiskette** `server/evidence.js`: Tabelle `evidence` nur anhängen (Trigger), `hash = SHA-256(prev|seq|id|kind|ref|event_at|captured_at|received_at|payload_hash|device)`,
  Inhalt löschen nur nach Löschvermerk `erase` (Prüfwerte bleiben). Arten vom Browser: entry, addendum, retract, time, stamp,
  absence(-cancel), br(-cancel), claim, case(-close/-reopen), settings. Server: file, transcript, erase.
  Objekt-Arten (entry/absence/br/case) haben Beweis-ID = Objekt-ID (Doppelübertragung → idempotent).
- Lesesicht `server/state.js` baut alles aus der Kette (Cache, bei jedem Anhängen verworfen) → `/api/state`.
- Dateien `server/files.js`: Upload als Rohdaten mit `x-sha256` vom Handy (Abweichung → 422), Ablage `dateien/JJJJ/<id>.<ext>`, chmod 444.
- Spracherkennung `server/transcribe.js`: **whisper.cpp v1.9.5** (gleicher Build wie Video-Zentrale, Dockerfile-Stufe `whisper`,
  nur CPU) → ffmpeg WAV 16 kHz → `whisper-cli -m … -l de -t n -oj -of … -np [--prompt …]`. Modelle `ggml-<name>.bin`: erst `/models`,
  dann `/data/whisper`; fehlende lädt MLZ von huggingface in den ersten beschreibbaren Ordner. Auswahl (kv `whisper` {model, modelFast,
  threads}, Standard small/small/4) unter Prüfung → Spracherkennung, Route `PUT /api/transcribe/config`. Status `download` beim Laden.
  Bewusst **nicht** über die Video-Zentrale (keine Schnittstelle dort, Warteschlange mit langen Videos, Rechenhelfer pausiert beim Zocken,
  BR-Inhalte sollen nicht durch das Video-System). „Namen und Fachwörter“ → `--prompt`.
- **KI-Ausfüllhilfe** (1.2.0) `server/assist.js` + `shared/assist.js`: Startseite „Sprechen – die App füllt aus“ → Diktat-Entwurf mit
  `assistWanted`; Upload mit Kopf `x-assist: 1` + `x-draft` → Server legt/ergänzt den Entwurf (`draftForUpload`), nach jedem Transkript
  (`onTranscript`) läuft die KI, wenn alle Aufnahmen des Entwurfs erkannt sind. Engines: `ollama` (Standard-Empfehlung, `/api/chat` mit
  `format` = JSON-Schema, temperature 0, num_ctx 8192, Modell `qwen2.5:7b-instruct`, „Modell laden“ = `/api/pull`) oder `claude`
  (offizielles SDK `@anthropic-ai/sdk`, `claude-opus-5-5`, `output_config.format` json_schema + effort low, `fallbacks: 'default'`;
  SDK 1.3 schickt den Schlüssel als `Authorization: Bearer`). Einstellungen in kv `assist` (Schlüssel nie in der Kette), Route
  `PUT /api/assist/config`, Test `/api/assist/test`. Ergebnis = Beweiseintrag **`assist`** (ref = Entwurf) + Felder im Entwurf:
  `aiFields` (was die KI gesetzt hat), `assist {status upload|transcribing|queued|running|done|error|off, engine, model, missing[], evidenceId}`,
  `suggestion {kind, time, absence, brtime, spoken}`. **`mergeAssist`** (Server-PUT, Browser-Abfrage, `loadDrafts`): KI überschreibt nur leere
  Felder oder eigene alte KI-Werte, Bereich nur ohne `sectionChosen`, `eventAt` solange `eventAtAuto`. kind time/absence/brtime → Knopf
  leitet ins Formular (`?vorschlag=<base64 JSON>&entwurf=<id>`, nach Speichern Entwurf gelöscht); bei Arbeitszeit überschreibt der
  Regel-Parser die Uhrzeiten der KI. Festgeschriebener Eintrag trägt `ai {evidenceId, engine, model, kept[], edited[]}` → PDF-Hinweis.
  Engine `off`: Status `off`, Browser übernimmt den Text wie bisher.
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
- `npm test` (16 Tests), `node test/mock-services.mjs` (Zeitstempeldienst :8098 mit eigener CA in `test/.tsa/`, Ollama-Attrappe :8097,
  Claude-Attrappe :8096 mit `CLAUDE_BASE_URL=http://127.0.0.1:8096`, Schlüssel `sk-ant-test`), Spracherkennung per
  `WHISPER_BIN=$PWD/test/fake-whisper.sh` (Text über `FAKE_WHISPER_TEXT_FILE`; braucht eine – auch leere – Modelldatei `ggml-small.bin` in `MODEL_DIR` oder `DATA_DIR/whisper`),
  Server mit `TSA_URLS=http://127.0.0.1:8098/tsr TSA_CA_FILE=$PWD/test/.tsa/ca.crt WHISPER_PRELOAD=off`.
  Echtes whisper-cli lässt sich hier bauen (cmake/g++ vorhanden), Modelle von huggingface sind aus der Sandbox gesperrt.
- Playwright (global, Chromium `/opt/pw-browsers`) mit `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` für das Mikrofon.
- Getestet (24.10.2026): Einrichten, Stempeln, Diktat → Transkript → Festschreiben, Nachtrag, Arbeitszeit sprechen → Parser → Speichern,
  alle Seiten 390 px ohne Überlauf, offline Diktat + Festschreiben → später übertragen, Export + `verify.py` (alles in Ordnung), Trigger
  (UPDATE/DELETE abgelehnt), TOTP/Sperre/CSRF, Notfall-Reset, Produktions-Install (`npm ci --omit=dev`).
- 1.1.0: whisper-cli 1.9.5 hier gebaut (Optionen geprüft, Fehler „Modell defekt“ sauber gemeldet), Attrappe mit eingehängtem Modell-Ordner,
  Modellwechsel mit gesperrtem Download → verständliche Fehlermeldung + „Erneut“.
- 1.2.0 (Playwright + Attrappen): KI einstellen/testen, Sprechen → Felder ausgefüllt + markiert → eigene Änderung → Festschreiben
  (Bereich BR erkannt, `ai.kept/edited` korrekt), Arbeitszeit-Satz → Vorschlag → Zeitformular vorbefüllt → Entwurf gelöscht, Export mit
  `assist`-Eintrag + PDF-Hinweis (verify.py ok), Claude falscher/richtiger Schlüssel, KI aus → Status off.
- **Nicht getestet:** echtes Ollama/Qwen (Qualität und Dauer auf dem Xeon), echtes Claude, echte Erkennung mit echtem Modell (huggingface gesperrt), Rechenzeit auf dem Xeon, echte FreeTSA/DigiCert (Sandbox gesperrt), Docker-Build (kein Daemon),
  echtes Android-Handy (Mikrofon, Installation, Passkey), Gmail-Versand, rclone.

## Versionen
- **1.0.0 (24.10.2026):** Erstausgabe mit allen Funktionen oben.
- **1.1.0 (24.10.2026):** Spracherkennung mit eingebautem whisper.cpp statt speaches; Modelle der Video-Zentrale werden mitbenutzt;
  Modellwahl in der App.
- **1.1.1 (24.10.2026):** `reset-login.js <name>` legt den ersten Benutzer an, wenn noch keiner existiert (Einmal-Passwort, Wechsel erzwungen).
  Anlass: Kunde sah beim ersten Aufruf eine Anmeldung statt „Einrichten“ (Ursache ungeklärt, Server meldete setup:true).
- **1.2.0 (24.10.2026):** KI-Ausfüllhilfe (Ollama lokal, Claude optional), Knopf „Sprechen – die App füllt aus“.

## Offene Punkte / Ideen
- Nach der Installation: Erkennungsdauer auf dem Xeon messen; bei guter Zeit Diktat-Modell auf `large-v3-turbo-q5_0` stellen.
  Später möglich: CUDA-Build wie in der Video-Zentrale (GTX 1050 Ti mitnutzen) – macht das Image deutlich größer.
- Optional: qualifizierter eIDAS-Zeitstempel (kostenpflichtig) über `TSA_URLS`; Dateien zusätzlich mit AES-GCM verschlüsseln;
  Ollama-Prompt nach echten Diktaten nachschärfen (Beispiele des Kunden sammeln).
