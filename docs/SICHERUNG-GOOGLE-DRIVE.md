# Sicherung nach Google Drive (verschlüsselt)

Die App sichert jede Nacht die Datenbank nach `sicherungen/`. Gegen Brand, Diebstahl oder Plattenschaden braucht es
zusätzlich eine Kopie **außer Haus**. Google Drive darf dabei **nur verschlüsselte** Daten sehen – sonst lägen die
Protokolle lesbar bei Google.

Werkzeug: **rclone** mit einem verschlüsselten Ziel („crypt“). Google sieht nur unlesbare Datei- und Ordnernamen.

## 1. rclone installieren

Unraid → Apps → **„rclone“** (Plugin von Waseh) installieren.

## 2. Google Drive verbinden

Unraid-Terminal:

```
rclone config
```

1. `n` (neues Ziel) → Name: `gdrive` → Typ: `drive` (Google Drive)
2. client_id / client_secret leer lassen → scope: `1` (voller Zugriff) → root_folder_id leer → service_account leer
3. „Use web browser to automatically authenticate?“ → `n` → den angezeigten Befehl auf einem PC mit Browser
   ausführen (`rclone authorize "drive" ...`), dort mit dem Google-Konto anmelden, das Ergebnis zurück ins Terminal kopieren.

## 3. Verschlüsseltes Ziel anlegen

```
rclone config
```

1. `n` → Name: `gdrive-mlz` → Typ: `crypt`
2. remote: `gdrive:MLZ-Sicherung`
3. filename_encryption: `standard`, directory_name_encryption: `true`
4. Passwort: **selbst wählen** (lang!), zweites Passwort (salt): ebenfalls wählen
5. **Beide Passwörter auf Papier notieren** und sicher aufbewahren. Ohne sie ist die Sicherung wertlos.

## 4. Tägliches Skript

Unraid → Plugins → **User Scripts** → „Add new script“ → Name `mlz-sicherung`:

```bash
#!/bin/bash
# MLZ-Protokoll verschlüsselt nach Google Drive sichern (läuft nach der nächtlichen App-Sicherung)
rclone sync /mnt/user/appdata/mlz-protokoll gdrive-mlz:mlz-protokoll \
  --exclude "arbeit/**" --exclude "mlz.sqlite" --exclude "mlz.sqlite-*" \
  --log-file /mnt/user/appdata/mlz-protokoll-rclone.log --log-level INFO
```

`mlz.sqlite` selbst wird ausgelassen (könnte gerade beschrieben werden); gesichert werden die sauberen Kopien in
`sicherungen/` plus alle Originaldateien und Zeitstempel.

Zeitplan: „Custom“ → `30 2 * * *` (täglich 2:30 Uhr – die App sichert um 23:30 Uhr).

## 5. Wiederherstellung testen (einmal im Quartal)

```
mkdir /tmp/mlz-test
rclone copy gdrive-mlz:mlz-protokoll /tmp/mlz-test
ls /tmp/mlz-test/sicherungen
```

Zurückspielen im Ernstfall: Container stoppen, Ordner nach `/mnt/user/appdata/mlz-protokoll` kopieren, neueste
`sicherungen/mlz-JJJJ-MM-TT.sqlite` nach `mlz.sqlite` kopieren, Container starten, in der App
**Prüfung → Jetzt prüfen** ausführen.
