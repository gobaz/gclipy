// Turns a lib/menuModel.js tree into PopupMenu items.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {fitWithin} from '../lib/images.js';
import {SideSubmenuItem} from './sideSubmenu.js';

/**
 * @typedef {object} MenuHandlers
 * @property {(id: string, event: Clutter.Event) => void} onHistory
 * @property {(id: string, pinned: boolean) => void} onPin
 * @property {(id: string, offset: number) => void} onMovePinned
 * @property {(id: string) => void} onDelete
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
 * @param {boolean} options.showMoveButtons ▲/▼ buttons on pinned items
 * @param {{width: number, height: number, uri: (hash: string) => string} | null} options.thumbnails
 *   null hides image thumbnails
 * @param {import('./previewPanel.js').PreviewPanel} options.preview shows the highlighted item's text or image
 * @param {((hash: string) => string) | null} options.imagePreview URI of an image to preview by its hash;
 *   null shows no image previews
 * @returns {Map<string, {item: PopupMenu.PopupMenuItem, folder: SideSubmenuItem | null}>}
 *   history items by id, with the folder holding each one
 */
export function renderMenu(menu, nodes, handlers, {showIcons, showMoveButtons, thumbnails, preview, imagePreview}) {
    menu.removeAll();
    const historyItems = new Map();
    addNodes(menu, nodes, handlers, {
        showIcons, showMoveButtons, thumbnails, preview, imagePreview, historyItems,
        folder: null,
        // The preview panel is placed beside whichever menu or side panel holds the item.
        previewMenu: menu,
    });
    // A menu holding only labels counts as empty and refuses to open, so say so explicitly.
    if (menu.isEmpty())
        menu.addMenuItem(new PopupMenu.PopupMenuItem('No items', {reactive: false, can_focus: false}));
    return historyItems;
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
            const item = new SideSubmenuItem(node.title, context.showIcons && node.isFolder);
            if (item.icon)
                item.icon.icon_name = 'folder-symbolic';
            menu.addMenuItem(item);
            addNodes(item.menu, node.children, handlers, {...context, folder: item, previewMenu: item.panelMenu});
            break;
        }
        case 'history': {
            const item = new PopupMenu.PopupMenuItem(node.title);
            // Push the thumbnail and pin button to the right edge.
            item.label.x_expand = true;
            if (context.showIcons)
                addKindIcon(item, node);
            if (node.image && context.thumbnails)
                item.add_child(thumbnail(context.thumbnails, node.image));
            addItemControls(item, node, handlers, context.showMoveButtons);
            item.connect('activate', (_item, event) => handlers.onHistory(node.id, event));
            const image = node.image && context.imagePreview
                ? {uri: context.imagePreview(node.image.hash), width: node.image.width, height: node.image.height}
                : null;
            context.preview.track(item, {text: node.tooltip, image}, context.previewMenu);
            context.historyItems.set(node.id, {item, folder: context.folder});
            menu.addMenuItem(item);
            break;
        }
        case 'snippet': {
            const item = context.showIcons
                ? new PopupMenu.PopupImageMenuItem(node.title, 'text-x-generic-symbolic')
                : new PopupMenu.PopupMenuItem(node.title);
            item.connect('activate', () => handlers.onSnippet(node.id));
            context.preview.track(item, {text: node.tooltip, image: null}, context.previewMenu);
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

/**
 * A text or image icon before the title, like the icons on folders and snippets. For images it
 * stands in for Clipy's "(Image)", which lib/menuModel.js then leaves out of the title.
 */
function addKindIcon(item, node) {
    const icon = new St.Icon({
        icon_name: node.image ? 'image-x-generic-symbolic' : 'text-x-generic-symbolic',
        style_class: 'popup-menu-icon',
    });
    item.insert_child_below(icon, item.label);
    if (node.image)
        item.accessible_name = `Image ${node.title}`;
}

/**
 * A pin toggle at the end of a history item, also reachable with Ctrl+P on the focused item.
 * The icon flips at once; the owner then rebuilds the menu to move the item.
 */
function addItemControls(item, node, {onPin, onMovePinned, onDelete}, showMoveButtons) {
    if (node.pinned && showMoveButtons) {
        item.add_child(iconButton('go-up-symbolic', 'Move up', node.canMoveUp, () => onMovePinned(node.id, -1)));
        item.add_child(iconButton('go-down-symbolic', 'Move down', node.canMoveDown, () => onMovePinned(node.id, 1)));
    }

    const pinButton = iconButton('view-pin-symbolic', '', true, () => toggle());
    let pinned = node.pinned;
    const update = () => {
        pinButton.child.opacity = pinned ? 255 : 80;
        pinButton.accessible_name = pinned ? 'Unpin' : 'Pin';
    };
    const toggle = () => {
        pinned = !pinned;
        update();
        onPin(node.id, pinned);
    };
    update();
    item.add_child(pinButton);

    // Delete removes the item; Ctrl+P pins or unpins; Ctrl+Up/Down rearrange pinned items.
    // Stopping the event also keeps the item's own arrow-key navigation from running.
    item.connect('key-press-event', (_item, event) => {
        const key = event.get_key_symbol();
        if (key === Clutter.KEY_Delete || key === Clutter.KEY_KP_Delete) {
            onDelete(node.id);
            return Clutter.EVENT_STOP;
        }
        if ((event.get_state() & Clutter.ModifierType.CONTROL_MASK) === 0)
            return Clutter.EVENT_PROPAGATE;
        if (key === Clutter.KEY_p || key === Clutter.KEY_P)
            toggle();
        else if (node.pinned && (key === Clutter.KEY_Up || key === Clutter.KEY_Down))
            onMovePinned(node.id, key === Clutter.KEY_Up ? -1 : 1);
        else
            return Clutter.EVENT_PROPAGATE;
        return Clutter.EVENT_STOP;
    });
}

/**
 * A small icon button inside a menu item. Not focusable, so arrow keys keep moving between items.
 * A disabled button stays in place but invisible, so icons line up across items.
 */
function iconButton(iconName, accessibleName, enabled, onClick) {
    const button = new St.Button({
        child: new St.Icon({icon_name: iconName, style_class: 'popup-menu-icon'}),
        accessible_name: accessibleName,
        can_focus: false,
        reactive: enabled,
        opacity: enabled ? 255 : 0,
        style: 'padding: 0 0 0 8px;',
        y_align: Clutter.ActorAlign.CENTER,
    });
    button.connect('clicked', onClick);
    return button;
}

function thumbnail({width: maxWidth, height: maxHeight, uri}, image) {
    // St cannot centre a background, so the widget takes the image's own aspect ratio
    // within the configured box and the thumbnail file is scaled to fill it.
    const [width, height] = fitWithin(image.width, image.height, maxWidth, maxHeight);
    return new St.Widget({
        style: `background-image: url("${uri(image.hash)}"); background-size: ${width}px ${height}px; ` +
            `width: ${width}px; height: ${height}px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
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
