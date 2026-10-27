// gclipy: Clipy's clipboard history and snippet menus for GNOME Shell.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {HistoryStore, itemsFromJSON} from './lib/historyStore.js';
import {ImageStore} from './lib/images.js';
import {buildHistoryNodes, buildMainMenu, buildSnippetNodes, historyNumbers} from './lib/menuModel.js';
import {digitForKey, numberForDigit} from './lib/numberKeys.js';
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
import {PreviewPanel} from './shell/previewPanel.js';

const SNIPPETS_RELOAD_DELAY_MS = 300;
const IMAGE_CLEANUP_DELAY_S = 2;
// Larger clipboard images are skipped rather than written to disk on every copy.
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

// Settings that only need the menus rebuilt; any other key has its own handler below.
const MENU_KEYS = new Set([
    'reorder-after-paste', 'show-icons', 'snippets-above-history', 'inline-limit', 'folder-limit', 'max-title-length',
    'mark-numbers', 'start-at-zero', 'show-clear-history-item', 'show-tooltips', 'max-preview-lines',
    'show-images', 'thumbnail-width', 'thumbnail-height', 'show-move-buttons',
]);

export default class GclipyExtension extends Extension {
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

        this._images = new ImageStore(GLib.build_filenamev([dataDir, 'images']));
        this._imageCancellable = new Gio.Cancellable();
        this._imageCleanupId = 0;
        this._pinRerenderId = 0;
        this._cleanUpImages();

        this._monitor = new ClipboardMonitor({
            onClip: clip => this._onClip(clip).catch(e => logError(e, 'gclipy: failed to record clipboard')),
            recordImages: () => this._settings.get_boolean('record-images'),
        });
        this._paster = new Paster();
        // Number to history item id for each rendered menu, used by the number keys.
        this._menuNumbers = new Map();
        // Where keyboard focus goes when each menu opens: its first History item.
        this._menuStart = new Map();
        // Shell menus have no tooltips; this panel beside the open menu stands in for them.
        this._preview = new PreviewPanel();
        // PointerMenu registers with its menu manager first, so the manager's modal grab runs
        // before _watchMenu's open handler moves focus to an item.
        this._pointerMenu = new PointerMenu();
        this._watchMenu(this._pointerMenu.menu);
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
        this._imageCancellable.cancel();
        if (this._pinRerenderId)
            GLib.source_remove(this._pinRerenderId);
        if (this._imageCleanupId)
            GLib.source_remove(this._imageCleanupId);
        if (this._clearTimeoutId)
            GLib.source_remove(this._clearTimeoutId);
        if (this._snippetsReloadId)
            GLib.source_remove(this._snippetsReloadId);
        this._snippetsMonitor.cancel();
        this._dialog?.destroy();
        this._indicator?.destroy();
        this._pointerMenu.destroy();
        this._preview.destroy();
        this._paster.destroy();
        this._monitor.destroy();

        if (this._settings.get_boolean('clear-on-disable') && this._history.clear())
            this._historyFile.saveLater(() => this._history.toJSON());
        try {
            this._historyFile.flush();
        } catch (e) {
            logError(e, 'gclipy: failed to save history');
        }
        this._cleanUpImages();

        this._settings = null;
        this._keybindings = null;
        this._clearTimeoutId = 0;
        this._snippetsReloadId = 0;
        this._snippetsMonitor = null;
        this._dialog = null;
        this._indicator = null;
        this._pointerMenu = null;
        this._preview = null;
        this._paster = null;
        this._monitor = null;
        this._history = null;
        this._folders = null;
        this._historyFile = null;
        this._snippetsFile = null;
        this._menuNumbers = null;
        this._menuStart = null;
        this._images = null;
        this._imageCancellable = null;
        this._imageCleanupId = 0;
        this._pinRerenderId = 0;
    }

    // MARK: - Storage

    _loadHistoryItems() {
        try {
            return itemsFromJSON(this._historyFile.load());
        } catch (e) {
            // Keep the unreadable file for the user instead of overwriting it on the next save.
            logError(e, 'gclipy: failed to load history');
            const backup = `${this._historyFile.path}.corrupt-${GLib.DateTime.new_now_local().format('%Y%m%d%H%M%S')}`;
            try {
                this._historyFile.file.move(Gio.File.new_for_path(backup), Gio.FileCopyFlags.NONE, null, null);
                Main.notify('gclipy', `History could not be read and was moved to ${backup}`);
            } catch (moveError) {
                logError(moveError, 'gclipy: failed to back up unreadable history');
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
            Main.notify('gclipy', `Snippets could not be loaded from ${this._snippetsFile.path}: ${e.message}`);
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
        // Trims, deletes and clears can leave image files behind; batch their removal.
        if (!this._imageCleanupId) {
            this._imageCleanupId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, IMAGE_CLEANUP_DELAY_S, () => {
                this._imageCleanupId = 0;
                this._cleanUpImages();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _cleanUpImages() {
        try {
            this._images.collectGarbage(this._history.imageHashes());
        } catch (e) {
            logError(e, 'gclipy: failed to clean up images');
        }
    }

    // MARK: - Clipboard

    async _onClip(clip) {
        if (clip.concealed && this._settings.get_boolean('ignore-concealed'))
            return;
        if (matchesApp(clip.wmClass, clip.appId, this._settings.get_strv('excluded-apps')))
            return;

        let image = null;
        if (clip.kind === 'image') {
            if (clip.bytes.get_size() > MAX_IMAGE_BYTES)
                return;
            try {
                image = await this._images.save(clip.bytes, clip.mimetype, this._imageCancellable);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    logError(e, 'gclipy: failed to store clipboard image');
                return;
            }
            // The extension may have been disabled while the image was being written.
            if (!this._history)
                return;
        }

        const options = {
            allowDuplicate: this._settings.get_boolean('allow-duplicate'),
            overwriteDuplicate: this._settings.get_boolean('overwrite-duplicate'),
            maxHistory: this._settings.get_int('max-history'),
            sortByCreatedAt: this._sortByCreatedAt(),
        };
        const added = image ? this._history.addImage(image, options) : this._history.addText(clip.text, options);
        if (added)
            this._historyChanged();
    }

    /**
     * @param {string} id
     * @param {Set<string>} pressed modifiers held while selecting
     */
    _onHistorySelected(id, pressed) {
        const item = this._history.get(id);
        if (!item)
            return;
        const action = historyAction({
            pressed,
            deleteModifier: this._settings.get_string('delete-modifier'),
            pasteDeleteModifier: this._settings.get_string('paste-delete-modifier'),
        });
        if (action !== 'delete') {
            if (action === 'paste-delete')
                this._monitor.ignoreNextChange();
            if (!this._copyItem(item))
                return;
            this._pasteSoon();
        }
        if (action !== 'paste' && this._history.delete(id))
            this._historyChanged();
    }

    /** @returns {boolean} false when an image file is missing and the item was dropped */
    _copyItem(item) {
        if (item.kind !== 'image') {
            this._monitor.setText(item.text);
            return true;
        }
        let bytes;
        try {
            bytes = this._images.load(item.hash);
        } catch (e) {
            logError(e, 'gclipy: image file missing');
            Main.notify('gclipy', 'This image is no longer available and was removed from history.');
            if (this._history.delete(item.id))
                this._historyChanged();
            return false;
        }
        this._monitor.setImage(bytes);
        return true;
    }

    _onSnippetSelected(id) {
        const snippet = this._folders.flatMap(folder => folder.snippets).find(s => s.id === id);
        if (!snippet)
            return;
        // Snippets are already one click away, so pasting one should not fill the history.
        this._monitor.ignoreNextChange();
        this._monitor.setText(snippet.content);
        this._pasteSoon();
    }

    _pasteSoon() {
        if (this._settings.get_boolean('paste-automatically'))
            this._paster.pasteSoon(this._settings.get_strv('terminal-wm-classes'));
    }

    _onAction(action) {
        switch (action) {
        case 'clear-history':
            this._clearHistoryWithConfirmation();
            break;
        case 'edit-snippets':
            this._editSnippets();
            break;
        case 'settings':
            this.openPreferences();
            break;
        }
    }

    /**
     * Open snippets.json in the default text editor. The default app for JSON is often a browser,
     * which can only show the file, so the plain-text handler is preferred.
     */
    _editSnippets() {
        const file = this._snippetsFile.file;
        const context = global.create_app_launch_context(0, -1);
        try {
            const editor = Gio.AppInfo.get_default_for_type('text/plain', false);
            if (editor)
                editor.launch([file], context);
            else
                Gio.AppInfo.launch_default_for_uri(file.get_uri(), context);
        } catch (e) {
            logError(e, 'gclipy: failed to open snippets');
            Main.notify('gclipy', `Could not open ${file.get_path()}: ${e.message}`);
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
            maxPreviewLines: s.get_int('max-preview-lines'),
            showTooltips: s.get_boolean('show-tooltips'),
            markNumbers: s.get_boolean('mark-numbers'),
            startAtZero: s.get_boolean('start-at-zero'),
            snippetsAboveHistory: s.get_boolean('snippets-above-history'),
            showClearHistoryItem: s.get_boolean('show-clear-history-item'),
            showIcons: s.get_boolean('show-icons'),
        };
    }

    /** @returns {Map<string, {item: object, folder: object | null}>} rendered history items by id */
    _render(menu, kind) {
        const options = this._menuOptions();
        const history = {pinned: this._history.pinned(), recent: this._history.unpinned(this._sortByCreatedAt())};
        const nodes = {
            main: () => buildMainMenu(history, this._folders, options),
            history: () => buildHistoryNodes(history, options),
            snippets: () => buildSnippetNodes(this._folders, options),
        }[kind]();
        this._menuNumbers.set(menu, historyNumbers(nodes));
        const items = renderMenu(menu, nodes, {
            onHistory: (id, event) => this._onHistorySelected(id, pressedModifiers(event)),
            onPin: (id, pinned) => {
                if (this._history.setPinned(id, pinned)) {
                    this._historyChanged();
                    this._rebuildKeepingFocus(menu, kind, id);
                }
            },
            onMovePinned: (id, offset) => {
                if (this._history.movePinned(id, offset)) {
                    this._historyChanged();
                    this._rebuildKeepingFocus(menu, kind, id);
                }
            },
            onDelete: id => {
                // Focus moves to the item below, or above when the last one goes.
                const numbers = [...this._menuNumbers.get(menu)];
                const index = numbers.findIndex(([, itemId]) => itemId === id);
                const neighbour = (numbers[index + 1] ?? numbers[index - 1])?.[1];
                if (this._history.delete(id)) {
                    this._historyChanged();
                    this._rebuildKeepingFocus(menu, kind, neighbour);
                }
            },
            onSnippet: id => this._onSnippetSelected(id),
            onAction: action => this._onAction(action),
        }, {
            showIcons: this._settings.get_boolean('show-icons'),
            showMoveButtons: this._settings.get_boolean('show-move-buttons'),
            preview: this._preview,
            imagePreview: this._settings.get_boolean('show-tooltips')
                ? hash => this._images.thumbnailFile(hash).get_uri()
                : null,
            thumbnails: this._settings.get_boolean('show-images') ? {
                width: this._settings.get_int('thumbnail-width'),
                height: this._settings.get_int('thumbnail-height'),
                uri: hash => this._images.thumbnailFile(hash).get_uri(),
            } : null,
        });
        const firstRecent = kind === 'snippets' ? null : history.recent[0];
        this._menuStart.set(menu, firstRecent ? items.get(firstRecent.id) ?? null : null);
        return items;
    }

    /**
     * Rebuild the open menu so a pinned, unpinned, rearranged or deleted item changes at once, and
     * keep the focus on the given item.
     * Deferred because the click or key handler that triggered it belongs to an item being replaced.
     */
    _rebuildKeepingFocus(menu, kind, id) {
        if (this._pinRerenderId)
            GLib.source_remove(this._pinRerenderId);
        this._pinRerenderId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._pinRerenderId = 0;
            if (!menu.isOpen)
                return GLib.SOURCE_REMOVE;
            const moved = this._render(menu, kind).get(id);
            if (menu === this._indicator?.menu)
                this._indicatorDirty = false;
            if (!moved) {
                // Nothing left to follow (the last item was deleted): keep the keyboard working.
                menu.actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
                return GLib.SOURCE_REMOVE;
            }
            // The item may be in a range folder; open it so the item stays in view.
            moved.folder?.setSubmenuShown(true);
            moved.item.grab_key_focus();
            return GLib.SOURCE_REMOVE;
        });
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
            // After addToStatusArea, so the panel's menu manager has taken its modal grab (which
            // moves focus to the menu) before _watchMenu focuses the first History item.
            this._watchMenu(this._indicator.menu);
        } else if (!show && this._indicator) {
            this._menuNumbers.delete(this._indicator.menu);
            this._menuStart.delete(this._indicator.menu);
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    _watchMenu(menu) {
        menu.actor.connect('key-press-event', (_actor, event) => this._onMenuKey(menu, event));
        menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._focusMenuStart(menu);
            else
                this._preview.hide();
        });
    }

    /**
     * Put keyboard focus on the first History item, skipping pinned items and snippets, so Enter
     * pastes the latest copy. An item inside a collapsed range folder is reached through the folder.
     */
    _focusMenuStart(menu) {
        const start = this._menuStart.get(menu);
        if (start)
            (start.folder ?? start.item).grab_key_focus();
        else
            menu.actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
    }

    _onMenuKey(menu, event) {
        if (!this._settings.get_boolean('number-keys'))
            return Clutter.EVENT_PROPAGATE;
        // Leave Ctrl, Alt and Super combinations to other shortcuts such as Ctrl+P. Shift is allowed
        // because some layouts (e.g. French) need it to type digits.
        const blocked = Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.MOD1_MASK |
            Clutter.ModifierType.SUPER_MASK | Clutter.ModifierType.MOD4_MASK;
        if (event.get_state() & blocked)
            return Clutter.EVENT_PROPAGATE;
        const digit = digitForKey(event.get_key_symbol(), event.get_key_code());
        const id = digit === null ? null
            : this._menuNumbers.get(menu)?.get(numberForDigit(digit, this._settings.get_boolean('start-at-zero')));
        if (!id)
            return Clutter.EVENT_PROPAGATE;
        menu.itemActivated();
        // No modifiers: a Shift needed to type the digit must not trigger the delete modifier.
        this._onHistorySelected(id, new Set());
        return Clutter.EVENT_STOP;
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
