// Turns a lib/menuModel.js tree into PopupMenu items.

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

/**
 * @typedef {object} MenuHandlers
 * @property {(id: string, event: Clutter.Event) => void} onHistory
 * @property {(id: string) => void} onSnippet
 * @property {(action: string) => void} onAction
 */

/**
 * Replace the contents of a menu with the rendered tree.
 *
 * @param {PopupMenu.PopupMenuBase} menu
 * @param {import('../lib/menuModel.js').MenuNode[]} nodes
 * @param {MenuHandlers} handlers
 * @param {object} options
 * @param {boolean} options.showIcons
 */
export function renderMenu(menu, nodes, handlers, {showIcons}) {
    menu.removeAll();
    const preview = new PreviewItem();
    addNodes(menu, nodes, handlers, {showIcons, preview});
    // A menu holding only labels counts as empty and refuses to open, so say so explicitly.
    if (menu.isEmpty())
        menu.addMenuItem(new PopupMenu.PopupMenuItem('No items', {reactive: false, can_focus: false}));
    // Shell menus have no tooltips, so the highlighted item's text is shown at the bottom instead.
    menu.addMenuItem(preview);
}

function addNodes(menu, nodes, handlers, context) {
    for (const node of nodes) {
        switch (node.type) {
        case 'label':
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(node.text));
            break;
        case 'separator':
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            break;
        case 'submenu': {
            const item = new PopupMenu.PopupSubMenuMenuItem(node.title, context.showIcons && node.isFolder);
            if (item.icon)
                item.icon.icon_name = 'folder-symbolic';
            addNodes(item.menu, node.children, handlers, context);
            menu.addMenuItem(item);
            break;
        }
        case 'history': {
            const item = new PopupMenu.PopupMenuItem(node.title);
            item.connect('activate', (_item, event) => handlers.onHistory(node.id, event));
            context.preview.track(item, node.tooltip);
            menu.addMenuItem(item);
            break;
        }
        case 'snippet': {
            const item = context.showIcons
                ? new PopupMenu.PopupImageMenuItem(node.title, 'text-x-generic-symbolic')
                : new PopupMenu.PopupMenuItem(node.title);
            item.connect('activate', () => handlers.onSnippet(node.id));
            context.preview.track(item, node.tooltip);
            menu.addMenuItem(item);
            break;
        }
        case 'action': {
            const item = new PopupMenu.PopupMenuItem(node.title);
            item.connect('activate', () => handlers.onAction(node.action));
            menu.addMenuItem(item);
            break;
        }
        }
    }
}

class PreviewItem extends PopupMenu.PopupMenuSection {
    constructor() {
        super();
        this._label = new St.Label({style: 'font-size: smaller; max-width: 32em;', opacity: 180});
        this._label.clutter_text.line_wrap = true;
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.add_child(this._label);
        this.addMenuItem(item);
        this.actor.hide();
    }

    /**
     * @param {PopupMenu.PopupBaseMenuItem} item
     * @param {string | null} text
     */
    track(item, text) {
        if (!text)
            return;
        item.connect('notify::active', () => {
            if (item.active) {
                this._current = item;
                // Long previews are capped by line count rather than characters.
                this._label.text = text.split('\n').slice(0, 8).join('\n');
                this.actor.show();
            } else if (this._current === item) {
                this._current = null;
                this.actor.hide();
            }
        });
    }
}

/**
 * @param {Clutter.Event | null} event
 * @returns {Set<string>} held modifiers using lib/paste.js names
 */
export function pressedModifiers(event) {
    const state = event?.get_state?.() ?? global.get_pointer()[2];
    const pressed = new Set();
    if (state & Clutter.ModifierType.CONTROL_MASK)
        pressed.add('ctrl');
    if (state & Clutter.ModifierType.SHIFT_MASK)
        pressed.add('shift');
    if (state & Clutter.ModifierType.MOD1_MASK)
        pressed.add('alt');
    if (state & (Clutter.ModifierType.SUPER_MASK | Clutter.ModifierType.MOD4_MASK))
        pressed.add('super');
    return pressed;
}
