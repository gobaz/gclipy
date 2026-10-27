# gclippy

Clipboard history and snippet menus for GNOME Shell, ported from the macOS app
[Clipy](https://github.com/Clipy/Clipy). It runs as a GNOME Shell extension
because only code inside the shell can watch the clipboard, register global
shortcuts and paste into other windows on Wayland.

![The gclippy menu: pinned items, numbered history with an image thumbnail, a preview of the highlighted item, and snippets](docs/screenshot.png)

Tested on GNOME Shell 46. `metadata.json` also lists 45, 47 and 48, which share
the same extension API, but those versions are untested.

## Features

- Clipboard history of text and images, newest first, with Clipy's duplicate
  handling (record or ignore duplicates, move a re-copied item to the top).
- Images (screenshots, "Copy Image" in browsers, image editors) are listed as
  "(Image) W×H" with a thumbnail and are pasted back as PNG. When a copy offers
  both text and an image, as spreadsheets and office apps do, the text is
  recorded.
- Snippet folders, read from `~/.local/share/gclippy/snippets.json`.
- Clipy's menu layout:
  - numbered items, counting continuously from pinned items through history,
    with older history grouped into "6 - 15", "16 - 25"… submenus
  - the 5 most recent items shown directly in the menu (configurable)
  - snippets above or below history
  - folders (history ranges and snippet folders) open beside the menu, by
    hovering or with Right/Enter; Left goes back
- Pinned items: click the pin icon on a history item, or press Ctrl+P while it
  is highlighted, to keep it in a "Pinned" section above History. Pins are
  never removed by Clear History, periodic clearing or the history size limit.
  Click the pin again to unpin, or delete the item with the delete modifier.
  Rearrange pinned items with Ctrl+Up / Ctrl+Down on the highlighted item, or
  turn on ▲/▼ buttons under Settings → Menu → "Show ▲/▼ buttons on pinned items".
- Number keys: while a menu is open, press 1–9 to paste item 1–9, or 0 for
  item 10, including items inside folders. The keypad works with NumLock on. On
  layouts whose number row types letters (Lithuanian, French…) the keys still
  work by position. You can turn this off under Settings → General → Paste.
- Selecting an item copies it and pastes it into the focused window. Terminals
  get Ctrl+Shift+V and everything else gets Ctrl+V.
- Optional modifiers that delete an item, or paste it and then delete it.
- Excluded applications, and skipping of content that password managers mark
  as secret (`x-kde-passwordManagerHint`).
- Clearing history manually (with confirmation), periodically, or when the
  extension is disabled.

Not in this version: a graphical snippet editor, and importing Clipy snippet
exports.

## Shortcuts

Clipy's ⌘ maps to Super:

| Action | Default |
| --- | --- |
| Main menu | Shift+Super+V |
| History | Ctrl+Super+V |
| Snippets | Shift+Super+B |
| Settings | Ctrl+Alt+Shift+Super+V |

Change them on the **Shortcuts** page in settings.

## Install

```sh
make install
```

On X11, restart GNOME Shell with Alt+F2, `r`, Enter. On Wayland, log out and
back in. Then enable it:

```sh
gnome-extensions enable gclippy@gclippy.local
```

`make pack` builds an installable zip in `dist/`.

If `clipboard-indicator` or another clipboard manager is enabled, both will
record history. Disable one of them to avoid duplicate menus and shortcuts.

## Snippets

**Edit Snippets** opens `snippets.json` in your default editor. The menu
reloads when you save it. If the file is invalid, you get a notification and the
previous snippets stay in the menu. `title` defaults to the content and
`enabled` defaults to `true`.

```json
{
  "folders": [
    {
      "title": "Work",
      "snippets": [
        {"title": "Signature", "content": "Best regards,\nName"},
        {"content": "https://example.com", "enabled": false}
      ]
    }
  ]
}
```

History is stored in `~/.local/share/gclippy/history.json`. Images are kept
next to it in `images/` as `<sha256>.png` plus a `.thumb.png` for the menu. They
are deleted once no history entry refers to them, and copies larger than 32 MiB
are skipped. If `history.json`
becomes unreadable, gclippy renames it to `history.json.corrupt-<time>` and
starts a new history.

## Development

```
lib/      pure logic (history rules, menu layout, titles, storage); imports only GLib/Gio
shell/    GNOME Shell code: clipboard monitor, menus, paste, shortcuts
tests/    unit tests for lib/, plus a headless shell smoke test
```

- `make test` runs the `lib/` unit tests with `gjs -m`. No shell is needed.
- `make smoke` (`tests/smoke.sh`) starts a headless GNOME Shell with its own
  D-Bus session, dconf database and data directories. It loads gclippy plus the
  `tests/smoke` extension, which copies text, opens the menus, selects items,
  toggles settings, and disables and re-enables gclippy. It does not touch
  your running session.
  - `SMOKE_SCREENSHOT=/path.png make smoke` also saves a screenshot with the
    prefs window open, and `SMOKE_MENU_SCREENSHOT=/path.png` one of the history
    menu with image thumbnails.
  - `KEEP_LOG=1` keeps the shell log.
- `make screenshot` regenerates `docs/screenshot.png` in the same headless shell, using the demo
  content in `tests/screenshot/extension.js`.
- Watch logs from the real session with `journalctl -f /usr/bin/gnome-shell`.

## License

MIT. See [LICENSE](LICENSE), which also includes Clipy's MIT notice.
