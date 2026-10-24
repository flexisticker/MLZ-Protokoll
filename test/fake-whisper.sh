#!/bin/sh
# Stellvertreter für whisper-cli in Tests (WHISPER_BIN=test/fake-whisper.sh): schreibt ein festes Transkript als JSON.
# Text über FAKE_WHISPER_TEXT oder Datei FAKE_WHISPER_TEXT_FILE, sonst ein Arbeitszeit-Satz.
[ "$1" = "--help" ] && { echo "usage: whisper-cli [options] file0.wav" >&2; exit 0; }
while [ $# -gt 0 ]; do case "$1" in -of) OF="$2"; shift;; -m) M="$2"; shift;; esac; shift; done
[ -f "$M" ] || { echo "error: failed to open model $M" >&2; exit 1; }
sleep 1
[ -n "$FAKE_WHISPER_TEXT_FILE" ] && [ -f "$FAKE_WHISPER_TEXT_FILE" ] && FAKE_WHISPER_TEXT="$(cat "$FAKE_WHISPER_TEXT_FILE")"
TEXT="${FAKE_WHISPER_TEXT:-Heute um halb acht angefangen, 30 Minuten Pause, Feierabend um 17 Uhr. Herr Maier hat die Überstunden angeordnet.}"
node -e 'const [of, t] = process.argv.slice(1); require("fs").writeFileSync(of + ".json", JSON.stringify({ transcription: [{ offsets: { from: 0, to: 3000 }, text: " " + t }] }));' "$OF" "$TEXT"
