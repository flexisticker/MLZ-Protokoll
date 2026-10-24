# MLZ-Protokoll auf Unraid installieren

Ein Container (`mlz-protokoll`, Port 8095 → 8090). Die Spracherkennung (whisper.cpp) ist eingebaut – dieselbe Technik
wie in der Video-Zentrale. Deren schon heruntergeladene Sprachmodelle werden **mitbenutzt** (nur lesend eingehängt), es wird
nichts doppelt geladen und es braucht keinen zweiten Container. Diktate warten nie auf Video-Erkennungen, und die Inhalte
laufen nicht durch die Video-Zentrale.

## 1. Paket-Zugang (falls das Repository privat ist)

Wie bei Flex-Studio: Unraid meldet sich mit einem GitHub-Token (`read:packages`) bei `ghcr.io` an.
Den vorhandenen Token weiterverwenden – er gilt für alle Pakete von `flexisticker`.

## 2. Container anlegen

1. `unraid/mlz-protokoll.xml` nach `/boot/config/plugins/dockerMan/templates-user/my-mlz-protokoll.xml` kopieren.
2. Docker → „Add Container“ → Vorlage `mlz-protokoll` → Apply.
   - Port: `8095` (frei wählbar)
   - Daten: `/mnt/user/appdata/mlz-protokoll`
   - Sprachmodelle: `/mnt/user/appdata/video-zentrale/whisper` → `/models`, Zugriff **Read Only**
3. Test im Heimnetz: `http://192.168.1.10:8095` → Einrichten (Name, Benutzername, Passwort).

## 3. Spracherkennung prüfen

In der App: **Mehr → Prüfung & Zeitstempel → Spracherkennung**.

- Standard ist `small` (liegt schon bei der Video-Zentrale).
- Genauer: `large-v3-turbo-q5_0` (≈ 550 MB). MLZ lädt es beim Auswählen einmalig nach `/data/whisper` (eigener Ordner,
  weil die Modelle der Video-Zentrale nur lesend eingehängt sind). Soll die Video-Zentrale es auch sehen, den Pfad
  `/models` auf **Read/Write** stellen – dann landet es in ihrem Ordner.
- Nach dem ersten Diktat steht dort die Rechenzeit. Auf dem Xeon E3-1225 v5 grob: `small` 15–30 s, `large-v3-turbo-q5_0`
  1–2 Min. je Minute Diktat (Schätzung). Arbeitszeit-Sätze laufen immer mit dem schnellen Modell.

## 4. Kein eigenes Netz nötig

Version 1.0.0 brauchte noch den Container `speaches` und das Netz `mlz-net`. Ab 1.1.0 kann beides weg:
Docker → `speaches` → Remove (inkl. Image), dann im Terminal `docker network rm mlz-net` und bei `mlz-protokoll`
Network Type auf `bridge` stellen. `/mnt/user/appdata/speaches` kann gelöscht werden.

## 5. HTTPS über Nginx Proxy Manager (nötig für Mikrofon, Kamera, Passkey)

Wie bei `studio.flexisticker.de`:

1. DNS: A-Eintrag z. B. `protokoll.flexisticker.de` → feste IP (für das Let's-Encrypt-Zertifikat),
   lokaler UniFi-DNS-Eintrag `protokoll` → 192.168.1.111.
2. NPM → Proxy Host: Domain `protokoll.flexisticker.de`, Forward `http://192.168.1.10:8095`,
   **Websockets an**, Access List **„Nur Heimnetz“**, SSL: Let's Encrypt, Force SSL, HTTP/2.
3. Unter „Advanced“ für große Sprachaufnahmen/Fotos:
   ```
   client_max_body_size 200m;
   proxy_read_timeout 300s;
   ```
4. Am Handy `https://protokoll.flexisticker.de` öffnen → Chrome-Menü → **„App installieren“** bzw. „Zum Startbildschirm“.

**Von unterwegs:** nicht öffentlich freigeben, sondern über VPN (UniFi WireGuard/Teleport) ins Heimnetz.
Ohne Netz nimmt die App trotzdem auf – Aufnahmen und Einträge bleiben auf dem Handy und werden gesendet,
sobald wieder eine Verbindung besteht (oben erscheint dann „offline“ und die Anzahl wartender Einträge).

## 6. Nach der Einrichtung in der App

1. **Mehr → Anmeldung & Sicherheit:** Fingerabdruck (Passkey) hinzufügen, Zwei-Faktor einschalten,
   **Wiederherstellungscodes ausdrucken**.
2. **Mehr → Einstellungen:** Name, Arbeitgeber, Soll-Stunden, Urlaubstage, Grundlage für 24.12./31.12., Ausschlussfrist,
   Namen/Fachwörter für die Spracherkennung. Optional: tägliche Prüfwert-Mail (Gmail mit App-Passwort).
3. **Sicherung** nach Google Drive einrichten: `docs/SICHERUNG-GOOGLE-DRIVE.md`.

## 7. Updates

Docker → „Check for Updates“ → „apply update“ (Daten bleiben erhalten). Die Beweiskette wird beim Update nicht verändert.

## 8. Notfall: Passwort vergessen / Handy mit Authenticator verloren

1. Wiederherstellungscode beim Anmelden statt des 6-stelligen Codes eingeben, oder
2. Unraid → Docker → `mlz-protokoll` → Konsole:
   ```
   node server/reset-login.js            # zeigt den Benutzernamen
   node server/reset-login.js michael    # Einmal-Passwort, Zwei-Faktor aus
   ```
   Danach anmelden, neues Passwort vergeben, Zwei-Faktor wieder einschalten.
   Bei Sperre nach Fehlversuchen: Container neu starten (die Sperre liegt nur im Speicher).

## Datenordner

```
/mnt/user/appdata/mlz-protokoll/
  mlz.sqlite          Datenbank (Beweiskette, Einstellungen, Anmeldung)
  dateien/JJJJ/       Original-Sprachaufnahmen und Fotos (schreibgeschützt)
  zeitstempel/        RFC-3161-Zeitstempel (.tsr)
  sicherungen/        tägliche Datenbanksicherungen (30 Tage)
  whisper/            selbst geladene Sprachmodelle (falls nicht bei der Video-Zentrale vorhanden)
  arbeit/             Arbeitskopien (können gelöscht werden)
```
