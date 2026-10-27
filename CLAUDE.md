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
  Port 8090 (Unraid-Host 8180 – 8094 hat die Video-Zentrale, 8095 ist ebenfalls belegt), Volume `/data`, optional `/models` = Whisper-Modelle der **Video-Zentrale** (`/mnt/user/appdata/video-zentrale/whisper`, nur lesend).
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

## Netz beim Kunden (Stand 24.10.2026)
- Fritzbox (Exposed Host) → UDM (WAN 192.168.178.24) → Heimnetz 192.168.1.0/24, Büro-PC 192.168.175.0/24. NPM 192.168.1.111,
  Unraid 192.168.1.10. Domain `protokoll.flexisticker.de` (A-Eintrag Alfahosting → feste IP, lokaler UniFi-DNS → NPM), Access List „Nur Heimnetz“.
- Unterwegs: **WireGuard auf der UDM**, VPN-Netz 192.168.3.0/24, DNS-Server **192.168.3.1** (mit 192.168.1.1 ging im Tunnel gar nichts),
  192.168.3.0/24 in der Access List. Details `docs/INSTALLATION-UNRAID.md` Abschnitt 5.

## Testen
- `npm test` (24 Tests), `node test/mock-services.mjs` (Zeitstempeldienst :8098 mit eigener CA in `test/.tsa/`, Ollama-Attrappe :8097,
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
- **1.3.0 (24.10.2026):** Entwürfe erst bei Inhalt speichern (`draftHasContent`; leere werden in `loadDrafts` aufgeräumt) – vorher legte
  schon das Öffnen der Diktat-Seite einen Entwurf an. Startseite „Zuletzt festgehalten“ (5 Einträge + Knopf Logbuch).
  **Korrektur per Sprache:** weitere Aufnahme im Entwurf („Ergänzen oder korrigieren“) → `combineSpoken` nummeriert die Aufnahmen,
  Prompt: spätere Aussage gilt, alle Felder füllen; Arbeitszeit: Regel-Parser je Aufnahme der Reihe nach, spätere Angabe ersetzt
  (`parseWorkTime(...).dateGiven` – Korrektur ohne Datum bleibt beim Tag, auch im Formular „Korrektur sprechen“). Nach dem Festschreiben
  bleibt die Korrektur ein (gesprochener) Nachtrag.
- **1.4.0 (24.10.2026):** Zeitpunkte. Prompt mit ausgefülltem Beispiel (Few-Shot), damit auch Qwen 7B alle Felder füllt. Findet die KI keinen
  Zeitpunkt, liest `extractWhen` (shared/assist.js, auf Basis `parseWorkTime`; Ende nur bei „von … bis …“) ihn aus dem Text; ohne KI setzt
  der Browser so „Wann?“, „bis“ und einen Kurztitel (`titleFrom`, erster Satz) – markiert „aus Text“ (`autoFields`), KI-Felder „KI“.
  Entwurf zeigt unter „Wann?“ Aufnahmezeit (Handy, erste Anlage `capturedAt`), Eingang beim Server und Abstand zum Geschehen;
  „Grund für spätere Erfassung“ richtet sich jetzt nach der Aufnahmezeit. Eintragsseite: Geschehen / aufgenommen / festgeschrieben, Logbuch: „erfasst …“.
- **1.5.0 (26.10.2026):** Import alter Arbeitszeiten aus **ibuchron** (CSV, Seite `/zeit/import`, Knopf unter Arbeitszeit).
  `shared/importcsv.js`: Spalten per Kopfzeile (Tag;Datum;Kommen;Gehen;Projekt;Stunden;Überstunden;Pause;…;Notizen;Arbeitsort;Urlaub;Krankheit;
  Feiertag;Abwesenheit;Freizeitausgleich;Jahresurlaub), „07:00Uhr“, „9 Std 20 Min“, Kennzeichen „1.0“/„0.5“, Trennzeichen ; / Tab / ,
  UTF-8 oder Windows-1252, Summenzeilen „Summe“/„Gesamt“ nur zum Vergleich. Kommen/Gehen → `time` (source `import`, `import {fileId, file, line}`,
  ID `imp-t-<datum>-<start>`), Urlaub/Krankheit/Abwesenheit/Freizeitausgleich → `absence` urlaub/krank/sonder/abbau (zusammenhängende Tage
  zu einem Zeitraum, ID `imp-a-…`), ½ an Heiligabend/Silvester = Rest des Tages (ganzer Eintrag, zählt ½ Urlaubstag). Notiz mit „BR“
  (= Betriebsrat) ohne Kommen/Gehen → `schulung` (Schulung/Seminar) bzw. `sonder`. Feiertage rechnet MLZ, Projekt ignoriert.
  Vorhandene Tage/Abwesenheiten werden nie überschrieben (erneuter Import = 0). Ablauf: CSV als Datei `purpose: 'import'` (text/csv) in die
  Kette → `POST /api/import/times {fileId}` (Server liest genau diese Datei, prüft mit `validate`). **Stundenstand:** ibuchron enthält einen
  Übertrag aus der Software davor → Vorschlag Übertrag = Gesamt − Summe (Überstunden-Spalte) als `balanceStart` zum ersten Tag der Datei (änderbar),
  Vergleich MLZ ↔ ibuchron (nur bis heute). **Notizen → Logbuch:** „KI entscheiden lassen“ (`POST/GET /api/import/notes/classify`, Hintergrund-Job,
  15 Notizen je Anfrage, `NOTE_SCHEMA`/`notesPrompt` in shared/assist.js) hakt auffällige Notizen an; `POST /api/import/notes/drafts` legt
  **Entwürfe** an (`source {kind csv-note, text, date, start, end, fileId, line}`, CSV als Anlage, Grund der späteren Erfassung vorbelegt),
  KI füllt sie (runFor nimmt `source.text`, „heute“ = Tag der Notiz). Festschreiben erst nach Prüfung. Export-PDF: „Import aus früherer Zeiterfassung“.
  Getestet: `test/import.test.mjs`, Playwright + Ollama-Attrappe (Vorschau, KI-Auswahl, Import, Entwurf, zweiter Import 0, Export + verify.py).
  **Nicht getestet:** echte vollständige ibuchron-Datei (nur Muster/Ausschnitte des Kunden), echtes Ollama bei vielen Notizen (Dauer).
- **1.6.0 (26.10.2026):** Urlaubskalender auf „Urlaub & Abwesenheit“ (`src/components/AbsenceCalendar.vue`): Monatsansicht mit Feiertagen (F),
  halben freien Tagen (½, aus `settings.halfDays`), Abwesenheiten farbig je Art (halbe Tage halb gefüllt). Tag antippen → zweiten Tag antippen = Zeitraum →
  „Urlaub (n Tage)“, „½ Tag Urlaub“, „Andere Art …“ öffnen das vorbelegte Formular; eingetragenen Tag antippen = Ansicht + Stornieren. Auch für die Zukunft
  (geplant, im Urlaubskonto als „+ geplant“). An Heiligabend/Silvester gibt es kein „halber Tag“: der Eintrag deckt den Rest des Tages (½ Urlaubstag),
  `save()` setzt `half` dort auf false (sonst würde nur ¼ Tag angerechnet). Link „halbe freie Tage festlegen“ → Einstellungen `#halbetage`
  (Router scrollt jetzt zu Ankern). Zahlen mit Komma (`num()` in util.js).
- **1.7.0 (26.10.2026):** Verstöße gegen das Arbeitszeitgesetz hervorgehoben. `dayResult().violations[{code, law, text, severity bad|check}]`
  (max10 § 3, break § 4, rest § 5, sunday/holiday § 9 = check), `lawViolations(rows)` + week60 (§ 3, > 60 Std./Woche) und avg48 (Halbjahr > 8 Std./Werktag,
  check), `LAW_LABEL`. **Fehler behoben:** Ruhezeit wurde mit `first + 1440 - prevEnd` gerechnet (24 Std. zu viel) → § 5 wurde nie gemeldet; jetzt `first - prevEnd`.
  UI: Hinweis oben auf Arbeitszeit, Monatstabelle rot markiert mit §, Tag zeigt Verstöße (inkl. Ruhezeit zum Vortag), Seite `/zeit/verstoesse` (Filter alle/Verstöße/
  ibuchron/ohne Einschätzung, Auswahl, „Alle importierten auswählen“). **Einschätzung** = neue Beweisart `assessment` {id, dates[], codes[], scope import|manual,
  how gebilligt|geduldet|angeordnet|bekannt, person, text, basis (Pflicht), evidence} + `assessment-cancel`. Wunsch Kunde: bei importierten Verstößen „Vorgesetzter
  hat billigend in Kauf genommen“ → bewusst als **Aussage des Arbeitnehmers mit Begründung** („Nach meiner Einschätzung hat …“), nicht als Tatsache.
  Export-PDF: Abschnitt „Verstöße gegen das Arbeitszeitgesetz“ (VERSTOSS/Prüfen, Import-Hinweis) + „Eigene Einschätzung“, Original-CSV des Imports im ZIP.
- **1.8.0 (27.10.2026):** Arbeit nach Feierabend (Anlass: Chef ruft um 17 Uhr an, Kundenmail). Zeitabschnitte haben jetzt `note`, `by` (veranlasst von),
  `after` (nach Feierabend) – Server-`validate` übernimmt sie. Tagesseite: je Abschnitt „Wofür?“/„Veranlasst von“/Häkchen, Knopf „Nach Feierabend gearbeitet“.
  **Sprechen hängt an statt zu überschreiben:** Tag hat schon Zeiten + neuer Beginn ≥ letztes Ende oder Wörter wie angerufen/danach/nach Feierabend (nicht bei
  „Korrektur/falsch/vertan“) → neuer Abschnitt mit Text als Bemerkung; gilt auch für KI-Vorschläge (`?vorschlag`). `initiator(text)` (shared/timeparse.js)
  erkennt Chef/Vorgesetzte/RVL/Herr X/Frau Y → `by` + Mehrarbeit „angeordnet“. Nach dem Speichern Angebot „Als Vorfall ins Logbuch“ → `POST /api/drafts/from-time`
  (`draftFromTimeNote` in assist.js, `source.kind 'time-note'`, Art „Überstunden / Arbeitszeit“, KI füllt aus; offline lokaler Entwurf). Monat: „nach Feierabend gearbeitet“,
  Export: Abschnitts-Bemerkungen im Hinweis. **Achtung CSS:** `.seg` ist der Umschalter (Auffälligkeit/BR) – nicht wiederverwenden (jetzt `.seg-extra`).

## Offene Punkte / Ideen
- Nach der Installation: Erkennungsdauer auf dem Xeon messen; bei guter Zeit Diktat-Modell auf `large-v3-turbo-q5_0` stellen.
  Später möglich: CUDA-Build wie in der Video-Zentrale (GTX 1050 Ti mitnutzen) – macht das Image deutlich größer.
- Optional: qualifizierter eIDAS-Zeitstempel (kostenpflichtig) über `TSA_URLS`; Dateien zusätzlich mit AES-GCM verschlüsseln;
  Ollama-Prompt nach echten Diktaten nachschärfen (Beispiele des Kunden sammeln).
