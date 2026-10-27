#!/usr/bin/env bash
# Restarts GNOME Shell so it loads the freshly installed extension, then enables it.
# Used by `make enable`. X11 only: on Wayland the shell cannot restart without logging out.
set -euo pipefail

uuid=${1:?usage: enable.sh UUID}

if [ "${XDG_SESSION_TYPE:-}" != x11 ]; then
    echo "Wayland session: log out and back in, then run: gnome-extensions enable $uuid"
    exit 0
fi

old_pid=$(pgrep -u "$USER" -x gnome-shell || true)

# Alt+F2 r is the shell's own restart. Killing the process instead would count as a crash,
# and systemd then disables all extensions.
if command -v xdotool > /dev/null; then
    xdotool key --clearmodifiers alt+F2
    sleep 0.5
    xdotool type r
    xdotool key Return
else
    echo "Press Alt+F2, type r and press Enter to restart GNOME Shell (install xdotool to automate this)."
fi

echo "Waiting for GNOME Shell to restart..."
for _ in $(seq 240); do
    pid=$(pgrep -u "$USER" -x gnome-shell || true)
    # Meta.restart re-executes the same process, so wait for the shell to drop off D-Bus
    # and come back rather than for a new PID.
    if [ -n "${restarting:-}" ] || [ "$pid" != "$old_pid" ]; then
        if gnome-extensions info "$uuid" > /dev/null 2>&1; then
            gnome-extensions enable "$uuid"
            gnome-extensions info "$uuid" | grep -E '^ *(State|Enabled)' || true
            exit 0
        fi
    elif ! gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
            --method org.freedesktop.DBus.Peer.Ping > /dev/null 2>&1; then
        restarting=1
    fi
    sleep 0.25
done
echo "GNOME Shell did not restart within a minute." >&2
exit 1
