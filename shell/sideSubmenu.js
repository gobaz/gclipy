// A submenu that opens beside the menu, like macOS and GTK cascading menus, instead of
// GNOME Shell's PopupSubMenuMenuItem, which expands inline.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const OPEN_DELAY_MS = 150;
// Grace period when the pointer leaves the folder item, so it can travel diagonally into the panel.
const CLOSE_DELAY_MS = 300;
// The panel slightly overlaps the menu's edge, as cascading menus usually do.
const OVERLAP = 4;

// The submenu open in each parent menu, so opening one closes its sibling at once.
const openSubmenus = new WeakMap();

export const SideSubmenuItem = GObject.registerClass({
    GTypeName: 'GclipySideSubmenuItem',
}, class SideSubmenuItem extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {string} text
     * @param {boolean} wantIcon adds `this.icon` before the label
     */
    _init(text, wantIcon) {
        super._init();
        this.add_style_class_name('popup-submenu-menu-item');
        if (wantIcon) {
            this.icon = new St.Icon({style_class: 'popup-menu-icon'});
            this.add_child(this.icon);
        }
        this.label = new St.Label({text, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this.label);
        this.label_actor = this.label;
        this.add_child(new St.Icon({icon_name: 'pan-end-symbolic', style_class: 'popup-menu-arrow', y_align: Clutter.ActorAlign.CENTER}));

        // Items go into a section shown in a panel of its own.
        this.menu = new PopupMenu.PopupMenuSection();
        this._panel = new St.BoxLayout({style_class: 'popup-menu-content', vertical: true, reactive: true, visible: false});
        this._panel.add_child(this.menu.actor);
        // Arrow keys inside the panel stay inside it.
        global.focus_manager.add_group(this._panel);
        this._panel.connect('key-press-event', (_panel, event) => this._onPanelKey(event));
        this.menu.connect('active-changed', (_menu, item) => {
            if (item)
                this._clearTimer('_closeId');
        });
        // The open menu holds a modal grab that only its own actors receive input through, so the
        // panel lives inside the menu: in a zero-size holder whose children can be placed anywhere.
        this._holder = new St.Widget({layout_manager: new Clutter.FixedLayout(), width: 0, height: 0});
        this._holder.add_child(this._panel);

        /** Stands in for a menu when the preview panel positions itself beside this submenu. */
        this.panelMenu = {actor: this._panel};

        this._onLeft = false;
        this._openId = 0;
        this._closeId = 0;
        this._laterId = 0;
        this._signals = [];
        this.connect('notify::hover', () => {
            if (this.hover) {
                this._clearTimer('_closeId');
                this._startTimer('_openId', OPEN_DELAY_MS, () => this.setSubmenuShown(true));
            } else {
                this._clearTimer('_openId');
            }
        });
        this.connect('key-press-event', (_item, event) => this._onItemKey(event));
        this.connect('destroy', () => this._onDestroy());
    }

    get isSubmenuOpen() {
        return this._panel.visible;
    }

    _setParent(parent) {
        super._setParent(parent);
        this.menu._setParent(parent);
        const top = parent._getTopMenu();
        top.box.add_child(this._holder);
        this._signals.push(
            [top, top.connect('open-state-changed', (_menu, open) => {
                if (!open)
                    this.setSubmenuShown(false);
            })],
            [parent, parent.connect('active-changed', (_menu, item) => {
                if (item === this) {
                    this._clearTimer('_closeId');
                    // Selected with the keyboard: show what is inside at once, leaving focus here.
                    // Hovering opens after a delay instead (notify::hover).
                    if (!this.hover)
                        this.setSubmenuShown(true);
                    return;
                }
                this._clearTimer('_openId');
                if (this.isSubmenuOpen)
                    this._startTimer('_closeId', CLOSE_DELAY_MS, () => this.setSubmenuShown(false));
            })]);
    }

    /** Clicking or pressing Enter/Space enters the panel instead of closing the menu. */
    activate(_event) {
        this._enter();
    }

    _enter() {
        this.setSubmenuShown(true);
        this._focusFirstItem();
    }

    /** @param {boolean} open */
    setSubmenuShown(open) {
        this._clearTimer('_openId');
        this._clearTimer('_closeId');
        if (open === this.isSubmenuOpen)
            return;
        this._clearLater();
        if (!open) {
            const focus = global.stage.get_key_focus();
            this._panel.hide();
            this.remove_style_pseudo_class('open');
            if (openSubmenus.get(this._parent) === this)
                openSubmenus.delete(this._parent);
            if (focus && this._panel.contains(focus))
                this.grab_key_focus();
            return;
        }
        openSubmenus.get(this._parent)?.setSubmenuShown(false);
        openSubmenus.set(this._parent, this);
        this.add_style_pseudo_class('open');
        this._panel.show();
        if (this._place())
            return;
        // Placement needs the menu laid out; right after a rebuild it is not yet.
        this._panel.opacity = 0;
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            if (!this.isSubmenuOpen || !this._place())
                return this.isSubmenuOpen ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
            this._laterId = 0;
            this._panel.opacity = 255;
            return GLib.SOURCE_REMOVE;
        });
    }

    /** @returns {boolean} false while the menu has no usable position yet */
    _place() {
        const menuActor = this._parent._getTopMenu().actor;
        const [menuX] = menuActor.get_transformed_position();
        const [menuWidth] = menuActor.get_transformed_size();
        const [, itemY] = this.get_transformed_position();
        const [holderX, holderY] = this._holder.get_transformed_position();
        const [, , width, height] = this._panel.get_preferred_size();
        const monitor = Main.layoutManager.findMonitorForActor(menuActor) ?? Main.layoutManager.primaryMonitor;
        // Line the first item up with this one.
        const padding = this._panel.get_theme_node().get_padding(St.Side.TOP);

        let x = menuX + menuWidth - OVERLAP;
        this._onLeft = x + width > monitor.x + monitor.width;
        if (this._onLeft)
            x = menuX - width + OVERLAP;
        const y = Math.max(monitor.y, Math.min(itemY - padding, monitor.y + monitor.height - height));
        const position = [x - holderX, y - holderY];
        if (!position.every(Number.isFinite))
            return false;
        this._panel.set_position(...position.map(Math.round));
        return true;
    }

    _focusFirstItem() {
        this._panel.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
    }

    _onItemKey(event) {
        const key = event.get_key_symbol();
        // The arrow pointing at the panel enters it; the panel flips left near the screen edge.
        if (key === (this._onLeft ? Clutter.KEY_Left : Clutter.KEY_Right)) {
            this._enter();
            return Clutter.EVENT_STOP;
        }
        // Close before the menu moves the focus, so Up/Down go to the neighbouring menu item
        // rather than into the panel next to it.
        if ((key === Clutter.KEY_Up || key === Clutter.KEY_Down) && this.isSubmenuOpen)
            this.setSubmenuShown(false);
        return Clutter.EVENT_PROPAGATE;
    }

    /** The arrow pointing back at the menu returns to the folder, which keeps showing the panel. */
    _onPanelKey(event) {
        if (event.get_key_symbol() !== (this._onLeft ? Clutter.KEY_Right : Clutter.KEY_Left))
            return Clutter.EVENT_PROPAGATE;
        this.grab_key_focus();
        return Clutter.EVENT_STOP;
    }

    _startTimer(name, delay, callback) {
        this._clearTimer(name);
        this[name] = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this[name] = 0;
            callback();
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearTimer(name) {
        if (this[name]) {
            GLib.source_remove(this[name]);
            this[name] = 0;
        }
    }

    _clearLater() {
        if (this._laterId) {
            global.compositor.get_laters().remove(this._laterId);
            this._laterId = 0;
        }
    }

    _onDestroy() {
        this._clearTimer('_openId');
        this._clearTimer('_closeId');
        this._clearLater();
        this._signals.forEach(([object, id]) => object.disconnect(id));
        if (openSubmenus.get(this._parent) === this)
            openSubmenus.delete(this._parent);
        this._holder.destroy();
    }
});
