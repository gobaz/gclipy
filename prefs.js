// Preferences window, mirroring the panes of Clipy's Settings window.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const MODIFIER_LABELS = [
    ['none', 'Off'],
    ['ctrl', 'Ctrl'],
    ['shift', 'Shift'],
    ['alt', 'Alt'],
    ['super', 'Super'],
];

// Same choices as Clipy's HistoryClearInterval.
const CLEAR_INTERVALS = [
    [300, 'Every 5 minutes'],
    [1800, 'Every 30 minutes'],
    [3600, 'Every hour'],
    [14400, 'Every 4 hours'],
    [28800, 'Every 8 hours'],
    [86400, 'Every day'],
    [259200, 'Every 3 days'],
    [604800, 'Every 7 days'],
];

export default class GclipyPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(640, 720);
        window.add(generalPage(settings));
        window.add(menuPage(settings));
        window.add(shortcutsPage(settings, window));
        window.add(applicationsPage(settings));
    }
}

function generalPage(settings) {
    const page = new Adw.PreferencesPage({title: 'General', icon_name: 'preferences-system-symbolic'});

    const history = new Adw.PreferencesGroup({title: 'History'});
    history.add(spinRow(settings, 'max-history', 'Maximum history size', 1, 9999));
    history.add(switchRow(settings, 'reorder-after-paste', 'Move pasted items to the top'));
    history.add(switchRow(settings, 'allow-duplicate', 'Record items already in history'));
    history.add(switchRow(settings, 'overwrite-duplicate', 'Replace the existing entry for duplicates'));
    history.add(switchRow(settings, 'record-images', 'Record images',
        'Copies that also contain text are recorded as text'));
    history.add(switchRow(settings, 'ignore-concealed', 'Ignore passwords marked as secret',
        'Skips copies that password managers flag as concealed'));
    page.add(history);

    const clearing = new Adw.PreferencesGroup({title: 'Clearing'});
    clearing.add(switchRow(settings, 'confirm-clear-history', 'Ask before clearing history'));
    clearing.add(switchRow(settings, 'clear-periodically', 'Clear history periodically'));
    const interval = choiceRow(settings, 'clear-interval', 'Interval', CLEAR_INTERVALS, 'int');
    settings.bind('clear-periodically', interval, 'sensitive', Gio.SettingsBindFlags.GET);
    clearing.add(interval);
    clearing.add(switchRow(settings, 'clear-on-disable', 'Clear history when disabled',
        'GNOME disables extensions while the screen is locked, so this also clears on lock'));
    page.add(clearing);

    const paste = new Adw.PreferencesGroup({title: 'Paste'});
    paste.add(switchRow(settings, 'paste-automatically', 'Paste after selecting an item',
        'Otherwise the item is only copied to the clipboard'));
    paste.add(switchRow(settings, 'number-keys', 'Paste by number or letter key',
        'In an open menu, 1–9, 0 and A–Z paste the entry with that label or open that folder'));
    paste.add(choiceRow(settings, 'delete-modifier', 'Delete item when selected with', MODIFIER_LABELS, 'string'));
    paste.add(choiceRow(settings, 'paste-delete-modifier', 'Paste and delete when selected with', MODIFIER_LABELS, 'string'));
    page.add(paste);

    return page;
}

function menuPage(settings) {
    const page = new Adw.PreferencesPage({title: 'Menu', icon_name: 'view-list-symbolic'});

    const layout = new Adw.PreferencesGroup({title: 'Layout'});
    layout.add(switchRow(settings, 'show-indicator', 'Show icon in the top bar'));
    layout.add(switchRow(settings, 'snippets-above-history', 'Show snippets before history',
        'Between pinned items and history; when off, after history'));
    layout.add(spinRow(settings, 'inline-limit', 'Items shown inline', 0, 999,
        'History items listed directly in the menu before the numbered folders'));
    layout.add(spinRow(settings, 'folder-limit', 'Items per folder', 1, 999));
    layout.add(switchRow(settings, 'show-clear-history-item', 'Show "Clear History"'));
    page.add(layout);

    const items = new Adw.PreferencesGroup({title: 'Items'});
    items.add(spinRow(settings, 'max-title-length', 'Maximum title length', 3, 500));
    items.add(switchRow(settings, 'mark-numbers', 'Number items'));
    items.add(switchRow(settings, 'start-at-zero', 'Start numbering at 0'));
    items.add(switchRow(settings, 'show-icons', 'Show icons'));
    items.add(switchRow(settings, 'show-move-buttons', 'Show ▲/▼ buttons on pinned items',
        'Pinned items can always be rearranged with Ctrl+Up and Ctrl+Down'));
    items.add(switchRow(settings, 'show-images', 'Show image thumbnails'));
    const thumbnailWidth = spinRow(settings, 'thumbnail-width', 'Thumbnail width', 16, 512);
    const thumbnailHeight = spinRow(settings, 'thumbnail-height', 'Thumbnail height', 16, 512);
    for (const row of [thumbnailWidth, thumbnailHeight]) {
        settings.bind('show-images', row, 'sensitive', Gio.SettingsBindFlags.GET);
        items.add(row);
    }
    items.add(switchRow(settings, 'show-tooltips', 'Preview the highlighted item'));
    items.add(spinRow(settings, 'max-preview-lines', 'Maximum preview lines', 1, 100));
    page.add(items);

    return page;
}

function shortcutsPage(settings, window) {
    const page = new Adw.PreferencesPage({title: 'Shortcuts', icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic'});
    const group = new Adw.PreferencesGroup({
        description: 'Click a shortcut to change it. Press Backspace in the dialog to disable it.',
    });
    group.add(shortcutRow(settings, 'shortcut-main', 'Main menu', window));
    group.add(shortcutRow(settings, 'shortcut-history', 'History menu', window));
    group.add(shortcutRow(settings, 'shortcut-snippets', 'Snippets menu', window));
    group.add(shortcutRow(settings, 'shortcut-settings', 'Settings', window));
    page.add(group);
    return page;
}

function applicationsPage(settings) {
    const page = new Adw.PreferencesPage({title: 'Applications', icon_name: 'application-x-executable-symbolic'});
    page.add(stringListGroup(settings, 'excluded-apps', 'Excluded applications',
        'Copies made in these applications are not recorded. Use the WM_CLASS (run "xprop WM_CLASS" and click the window) or the application id.'));
    page.add(stringListGroup(settings, 'terminal-wm-classes', 'Terminals',
        'These windows receive Ctrl+Shift+V instead of Ctrl+V when pasting.'));
    return page;
}

// MARK: - Rows

function switchRow(settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({title, subtitle: subtitle ?? ''});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinRow(settings, key, title, min, max, subtitle) {
    const row = Adw.SpinRow.new_with_range(min, max, 1);
    row.title = title;
    row.subtitle = subtitle ?? '';
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/**
 * @param {Gio.Settings} settings
 * @param {string} key
 * @param {string} title
 * @param {Array<[string | number, string]>} choices value and label pairs
 * @param {'string' | 'int'} type
 */
function choiceRow(settings, key, title, choices, type) {
    const row = new Adw.ComboRow({title, model: Gtk.StringList.new(choices.map(([, label]) => label))});
    const get = () => (type === 'int' ? settings.get_int(key) : settings.get_string(key));
    const sync = () => {
        const index = choices.findIndex(([value]) => value === get());
        row.selected = index === -1 ? Gtk.INVALID_LIST_POSITION : index;
    };
    sync();
    const changedId = settings.connect(`changed::${key}`, sync);
    row.connect('destroy', () => settings.disconnect(changedId));
    row.connect('notify::selected', () => {
        const choice = choices[row.selected];
        if (!choice || choice[0] === get())
            return;
        if (type === 'int')
            settings.set_int(key, choice[0]);
        else
            settings.set_string(key, choice[0]);
    });
    return row;
}

function shortcutRow(settings, key, title, window) {
    const label = new Gtk.ShortcutLabel({disabled_text: 'Disabled', valign: Gtk.Align.CENTER});
    const row = new Adw.ActionRow({title, activatable: true});
    row.add_suffix(label);
    const sync = () => {
        label.accelerator = settings.get_strv(key)[0] ?? '';
    };
    sync();
    const changedId = settings.connect(`changed::${key}`, sync);
    row.connect('destroy', () => settings.disconnect(changedId));
    row.connect('activated', () => captureShortcut(window, title, accelerators => settings.set_strv(key, accelerators)));
    return row;
}

/**
 * @param {Gtk.Window} parent
 * @param {string} title
 * @param {(accelerators: string[]) => void} onCapture empty array disables the shortcut
 */
function captureShortcut(parent, title, onCapture) {
    const dialog = new Adw.Window({
        modal: true,
        transient_for: parent,
        default_width: 420,
        default_height: 240,
        content: new Adw.StatusPage({
            title,
            description: 'Press a key combination, Esc to cancel or Backspace to disable.',
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
        }),
    });
    const controller = new Gtk.EventControllerKey();
    controller.connect('key-pressed', (_controller, keyval, keycode, state) => {
        const mask = state & Gtk.accelerator_get_default_mod_mask();
        const key = Gdk.keyval_to_lower(keyval);
        if (mask === 0 && key === Gdk.KEY_Escape) {
            dialog.close();
            return Gdk.EVENT_STOP;
        }
        if (mask === 0 && key === Gdk.KEY_BackSpace) {
            onCapture([]);
            dialog.close();
            return Gdk.EVENT_STOP;
        }
        // Require a modifier so a plain letter cannot become a global shortcut.
        if (mask === 0 || !Gtk.accelerator_valid(key, mask))
            return Gdk.EVENT_STOP;
        onCapture([Gtk.accelerator_name_with_keycode(null, key, keycode, mask)]);
        dialog.close();
        return Gdk.EVENT_STOP;
    });
    dialog.add_controller(controller);
    dialog.present();
}

function stringListGroup(settings, key, title, description) {
    const group = new Adw.PreferencesGroup({title, description});
    const entry = new Adw.EntryRow({title: 'Add…', show_apply_button: true});
    entry.connect('apply', () => {
        const value = entry.text.trim();
        const values = settings.get_strv(key);
        if (value && !values.includes(value))
            settings.set_strv(key, [...values, value]);
        entry.text = '';
    });

    let rows = [];
    const sync = () => {
        rows.forEach(row => group.remove(row));
        if (entry.get_parent())
            group.remove(entry);
        rows = settings.get_strv(key).map(value => {
            const row = new Adw.ActionRow({title: value});
            const remove = new Gtk.Button({icon_name: 'user-trash-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat']});
            remove.connect('clicked', () => settings.set_strv(key, settings.get_strv(key).filter(v => v !== value)));
            row.add_suffix(remove);
            group.add(row);
            return row;
        });
        group.add(entry);
    };
    sync();
    const changedId = settings.connect(`changed::${key}`, sync);
    group.connect('destroy', () => settings.disconnect(changedId));
    return group;
}
