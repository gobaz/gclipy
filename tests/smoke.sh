#!/usr/bin/env bash
# Runs gclippy and tests/smoke in a headless GNOME Shell with its own D-Bus session,
# dconf database and data directories, so the running desktop session is not touched.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d -t gclippy-smoke-XXXXXX)
# KEEP_LOG=1 keeps the shell log for inspection.
trap '[[ -n "${KEEP_LOG:-}" ]] && cp "$work/shell.log" "${KEEP_LOG_PATH:-./smoke-shell.log}"; rm -rf "$work"' EXIT

export XDG_DATA_HOME="$work/data" XDG_CONFIG_HOME="$work/config" XDG_CACHE_HOME="$work/cache" XDG_STATE_HOME="$work/state"
export XDG_RUNTIME_DIR="$work/runtime"
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
unset DISPLAY WAYLAND_DISPLAY
# Plain GNOME: distribution session modes (e.g. Ubuntu's) load extra system extensions whose
# own warnings would make results depend on the machine.
export GNOME_SHELL_SESSION_MODE=user

extensions="$XDG_DATA_HOME/gnome-shell/extensions"
mkdir -p "$extensions/gclippy@gclippy.local" "$extensions/gclippy-smoke@gclippy.local"
(cd "$root" && cp -r metadata.json extension.js prefs.js lib shell schemas "$extensions/gclippy@gclippy.local/")
glib-compile-schemas --strict "$extensions/gclippy@gclippy.local/schemas"
cp "$root"/tests/smoke/* "$extensions/gclippy-smoke@gclippy.local/"

log="$work/shell.log"
dbus-run-session -- bash -c '
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell enabled-extensions "[\"gclippy@gclippy.local\", \"gclippy-smoke@gclippy.local\"]"
    gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 > "$1" 2>&1 &
    shell=$!
    timeout 60 grep -q -m1 "SMOKE DONE" <(tail -n +1 -f "$1") || echo "timed out waiting for the smoke test" >> "$1"
    kill $shell 2>/dev/null; wait $shell 2>/dev/null || true
' smoke "$log"

grep -E "SMOKE (ok|FAIL)" "$log" | sed 's/^.*SMOKE /    /'
# Anything else gclippy logged is worth a look: prefs errors, warnings, stack traces.
grep -iE "gclippy|prefs\.js|JS ERROR|TypeError|ReferenceError" "$log" | grep -v "SMOKE" | sed 's/^/log: /' || true
# Criticals from the shell's libraries point at real bugs (NaN layout, stale objects) even when
# every check passes. Gjs criticals at shutdown come from killing the shell and are ignored.
criticals=$(grep -E "(Clutter|GLib|GLib-GIO|St|mutter|libmutter)-CRITICAL" "$log" || true)
if [[ -n "$criticals" ]]; then
    echo "criticals in the shell log:"
    echo "$criticals" | sort | uniq -c | sed 's/^/    /'
fi
if grep -q "SMOKE FAIL\|timed out" "$log" || [[ -n "$criticals" ]]; then
    exit 1
fi
