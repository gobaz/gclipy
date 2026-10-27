// gclippy: Clipy's clipboard history and snippet menus for GNOME Shell.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {HistoryStore, itemsFromJSON} from './lib/historyStore.js';
import {buildHistoryNodes, buildMainMenu, buildSnippetNodes} from './lib/menuModel.js';
import {historyAction, matchesApp} from './lib/paste.js';
import {EXAMPLE_SNIPPETS, parseSnippets} from './lib/snippetStore.js';
import {defaultDataDir, JsonFile} from './lib/storage.js';
import {ClipboardMonitor} from './shell/clipboardMonitor.js';
import {openClearHistoryDialog} from './shell/confirmDialog.js';
import {createIndicator} from './shell/indicator.js';
import {Keybindings} from './shell/keybindings.js';
import {pressedModifiers, renderMenu} from './shell/menuRenderer.js';
import {Paster} from './shell/paster.js';
import {PointerMenu} from './shell/pointerMenu.js';

const SNIPPETS_RELOAD_DELAY_MS = 300;

// Settings that only need the menus rebuilt; any other key has its own handler below.
const MENU_KEYS = new Set([
    'reorder-after-paste', 'show-icons', 'snippets-above-history', 'inline-limit', 'folder-limit', 'max-title-length',
    'mark-numbers', 'start-at-zero', 'show-clear-history-item', 'show-tooltips', 'max-tooltip-length',
]);

export default class GclippyExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        const dataDir = defaultDataDir();
        this._historyFile = new JsonFile(dataDir, 'history.json');
        this._snippetsFile = new JsonFile(dataDir, 'snippets.json');

        this._history = new HistoryStore({
            items: this._loadHistoryItems(),
            hash: text => GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, text, -1),
            newId: () => GLib.uuid_string_random(),
        });
        this._folders = this._loadSnippets();
        this._watchSnippets(dataDir);

        this._monitor = new ClipboardMonitor(clip => this._onClip(clip));
        this._paster = new Paster();
        this._pointerMenu = new PointerMenu();
        this._indicator = null;
        this._dialog = null;
        this._clearTimeoutId = 0;
        this._updateIndicator();

        this._keybindings = new Keybindings(this._settings);
        this._keybindings.add('shortcut-main', () => this._popUp('main'));
        this._keybindings.add('shortcut-history', () => this._popUp('history'));
        this._keybindings.add('shortcut-snippets', () => this._popUp('snippets'));
        this._keybindings.add('shortcut-settings', () => this.openPreferences());

        this._settings.connectObject('changed', (_settings, key) => this._onSettingChanged(key), this);
        this._schedulePeriodicClear();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._keybindings.destroy();
        if (this._clearTimeoutId)
            GLib.source_remove(this._clearTimeoutId);
        if (this._snippetsReloadId)
            GLib.source_remove(this._snippetsReloadId);
        this._snippetsMonitor.cancel();
        this._dialog?.destroy();
        this._indicator?.destroy();
        this._pointerMenu.destroy();
        this._paster.destroy();
        this._monitor.destroy();

        if (this._settings.get_boolean('clear-on-disable') && this._history.clear())
            this._historyFile.saveLater(() => this._history.toJSON());
        try {
            this._historyFile.flush();
        } catch (e) {
            logError(e, 'gclippy: failed to save history');
        }

        this._settings = null;
        this._keybindings = null;
        this._clearTimeoutId = 0;
        this._snippetsReloadId = 0;
        this._snippetsMonitor = null;
        this._dialog = null;
        this._indicator = null;
        this._pointerMenu = null;
        this._paster = null;
        this._monitor = null;
        this._history = null;
        this._folders = null;
        this._historyFile = null;
        this._snippetsFile = null;
    }

    // MARK: - Storage

    _loadHistoryItems() {
        try {
            return itemsFromJSON(this._historyFile.load());
        } catch (e) {
            // Keep the unreadable file for the user instead of overwriting it on the next save.
            logError(e, 'gclippy: failed to load history');
            const backup = `${this._historyFile.path}.corrupt-${GLib.DateTime.new_now_local().format('%Y%m%d%H%M%S')}`;
            try {
                this._historyFile.file.move(Gio.File.new_for_path(backup), Gio.FileCopyFlags.NONE, null, null);
                Main.notify('gclippy', `History could not be read and was moved to ${backup}`);
            } catch (moveError) {
                logError(moveError, 'gclippy: failed to back up unreadable history');
            }
            return [];
        }
    }

    _loadSnippets() {
        try {
            if (!this._snippetsFile.exists())
                this._snippetsFile.saveNow(EXAMPLE_SNIPPETS);
            return parseSnippets(this._snippetsFile.load());
        } catch (e) {
            Main.notify('gclippy', `Snippets could not be loaded from ${this._snippetsFile.path}: ${e.message}`);
            return this._folders ?? [];
        }
    }

    _watchSnippets(dataDir) {
        this._snippetsReloadId = 0;
        // Watch the directory: editors often save by writing a new file and renaming it over the old one.
        this._snippetsMonitor = Gio.File.new_for_path(dataDir).monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._snippetsMonitor.connect('changed', (_monitor, file, otherFile) => {
            const name = this._snippetsFile.file.get_basename();
            if (file?.get_basename() !== name && otherFile?.get_basename() !== name)
                return;
            if (this._snippetsReloadId)
                GLib.source_remove(this._snippetsReloadId);
            this._snippetsReloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SNIPPETS_RELOAD_DELAY_MS, () => {
                this._snippetsReloadId = 0;
                this._folders = this._loadSnippets();
                this._invalidateMenus();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _historyChanged() {
        this._historyFile.saveLater(() => this._history.toJSON());
        this._invalidateMenus();
    }

    // MARK: - Clipboard

    _onClip({text, concealed, wmClass, appId}) {
        if (concealed && this._settings.get_boolean('ignore-concealed'))
            return;
        if (matchesApp(wmClass, appId, this._settings.get_strv('excluded-apps')))
            return;
        const added = this._history.add(text, {
            allowDuplicate: this._settings.get_boolean('allow-duplicate'),
            overwriteDuplicate: this._settings.get_boolean('overwrite-duplicate'),
            maxHistory: this._settings.get_int('max-history'),
            sortByCreatedAt: this._sortByCreatedAt(),
        });
        if (added)
            this._historyChanged();
    }

    _onHistorySelected(id, event) {
        const item = this._history.get(id);
        if (!item)
            return;
        const action = historyAction({
            pressed: pressedModifiers(event),
            deleteModifier: this._settings.get_string('delete-modifier'),
            pasteDeleteModifier: this._settings.get_string('paste-delete-modifier'),
        });
        if (action === 'paste-delete')
            this._monitor.ignoreNextChange();
        if (action !== 'delete')
            this._copyAndPaste(item.text);
        if (action !== 'paste' && this._history.delete(id))
            this._historyChanged();
    }

    _onSnippetSelected(id) {
        const snippet = this._folders.flatMap(folder => folder.snippets).find(s => s.id === id);
        if (snippet)
            this._copyAndPaste(snippet.content);
    }

    _copyAndPaste(text) {
        this._monitor.setText(text);
        if (this._settings.get_boolean('paste-automatically'))
            this._paster.pasteSoon(this._settings.get_strv('terminal-wm-classes'));
    }

    _onAction(action) {
        switch (action) {
        case 'clear-history':
            this._clearHistoryWithConfirmation();
            break;
        case 'edit-snippets':
            Gio.AppInfo.launch_default_for_uri(this._snippetsFile.file.get_uri(), null);
            break;
        case 'settings':
            this.openPreferences();
            break;
        }
    }

    _clearHistoryWithConfirmation() {
        if (!this._settings.get_boolean('confirm-clear-history')) {
            this._clearHistory();
            return;
        }
        this._dialog?.destroy();
        this._dialog = openClearHistoryDialog(dontAskAgain => {
            if (dontAskAgain)
                this._settings.set_boolean('confirm-clear-history', false);
            this._clearHistory();
        });
        this._dialog.connect('destroy', () => {
            this._dialog = null;
        });
    }

    _clearHistory() {
        if (this._history.clear())
            this._historyChanged();
    }

    _schedulePeriodicClear() {
        if (this._clearTimeoutId) {
            GLib.source_remove(this._clearTimeoutId);
            this._clearTimeoutId = 0;
        }
        if (!this._settings.get_boolean('clear-periodically'))
            return;
        const seconds = Math.max(60, this._settings.get_int('clear-interval'));
        this._clearTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._clearHistory();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // MARK: - Menus

    _sortByCreatedAt() {
        return !this._settings.get_boolean('reorder-after-paste');
    }

    _menuOptions() {
        const s = this._settings;
        return {
            inlineLimit: s.get_int('inline-limit'),
            folderLimit: s.get_int('folder-limit'),
            maxTitleLength: s.get_int('max-title-length'),
            maxTooltipLength: s.get_int('max-tooltip-length'),
            showTooltips: s.get_boolean('show-tooltips'),
            markNumbers: s.get_boolean('mark-numbers'),
            startAtZero: s.get_boolean('start-at-zero'),
            snippetsAboveHistory: s.get_boolean('snippets-above-history'),
            showClearHistoryItem: s.get_boolean('show-clear-history-item'),
        };
    }

    _render(menu, kind) {
        const options = this._menuOptions();
        const history = this._history.sorted(this._sortByCreatedAt());
        const nodes = {
            main: () => buildMainMenu(history, this._folders, options),
            history: () => buildHistoryNodes(history, options),
            snippets: () => buildSnippetNodes(this._folders, options),
        }[kind]();
        renderMenu(menu, nodes, {
            onHistory: (id, event) => this._onHistorySelected(id, event),
            onSnippet: id => this._onSnippetSelected(id),
            onAction: action => this._onAction(action),
        }, {showIcons: this._settings.get_boolean('show-icons')});
    }

    _popUp(kind) {
        this._render(this._pointerMenu.menu, kind);
        this._pointerMenu.open();
    }

    _invalidateMenus() {
        // Rebuilding an open menu would close submenus under the pointer, so wait until it closes.
        this._indicatorDirty = true;
        if (this._indicator && !this._indicator.menu.isOpen)
            this._renderIndicator();
    }

    _renderIndicator() {
        this._indicatorDirty = false;
        this._render(this._indicator.menu, 'main');
    }

    _updateIndicator() {
        const show = this._settings.get_boolean('show-indicator');
        if (show && !this._indicator) {
            this._indicator = createIndicator();
            this._indicator.menu.connect('open-state-changed', (_menu, open) => {
                if (!open && this._indicatorDirty)
                    this._renderIndicator();
            });
            this._renderIndicator();
            Main.panel.addToStatusArea(this.uuid, this._indicator);
        } else if (!show && this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    _onSettingChanged(key) {
        if (MENU_KEYS.has(key)) {
            this._invalidateMenus();
        } else if (key === 'show-indicator') {
            this._updateIndicator();
        } else if (key === 'max-history') {
            if (this._history.trim(this._settings.get_int('max-history'), this._sortByCreatedAt()))
                this._historyChanged();
            else
                this._invalidateMenus();
        } else if (key === 'clear-periodically' || key === 'clear-interval') {
            this._schedulePeriodicClear();
        }
    }
}
