// Shows the highlighted item's text in a panel beside the menu. Keeping it outside the menu
// means showing and hiding it never resizes the menu, which used to make the menu jump.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const GAP = 6;

export class PreviewPanel {
    constructor() {
        this._label = new St.Label({style: 'font-size: smaller;'});
        this._label.clutter_text.line_wrap = true;
        this._label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        // Reuses the menu's own background, border and corner radius so the panel matches the theme.
        this.actor = new St.Bin({
            style_class: 'popup-menu-content',
            style: 'padding: 8px 12px; max-width: 32em;',
            child: this._label,
            reactive: false,
            visible: false,
        });
        Main.layoutManager.uiGroup.add_child(this.actor);
        this._item = null;
        this._laterId = 0;
    }

    /**
     * Follow an item: show its text while it is highlighted.
     *
     * @param {import('resource:///org/gnome/shell/ui/popupMenu.js').PopupBaseMenuItem} item
     * @param {string | null} text
     * @param {import('resource:///org/gnome/shell/ui/popupMenu.js').PopupMenu} menu top-level menu the item is in
     */
    track(item, text, menu) {
        if (!text)
            return;
        item.connect('notify::active', () => {
            if (item.active)
                this._show(item, text, menu);
            else if (this._item === item)
                this.hide();
        });
        item.connect('destroy', () => {
            if (this._item === item)
                this.hide();
        });
    }

    hide() {
        this._stopWaitingForLayout();
        this._item = null;
        this.actor.hide();
    }

    _show(item, text, menu) {
        this._stopWaitingForLayout();
        this._item = item;
        // Already limited to the configured number of lines by lib/menuModel.js.
        this._label.text = text;
        if (this._place(item, menu)) {
            this._reveal();
            return;
        }
        // Right after a menu opens or is rebuilt, the highlighted item has not been laid out
        // and its position is NaN. Retry before each redraw until it has one; doing this from
        // the item's allocation signal would move the panel in the middle of a layout pass.
        this.actor.hide();
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            if (this._item !== item)
                return GLib.SOURCE_REMOVE;
            if (!this._place(item, menu))
                return GLib.SOURCE_CONTINUE;
            this._laterId = 0;
            this._reveal();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopWaitingForLayout() {
        if (this._laterId) {
            global.compositor.get_laters().remove(this._laterId);
            this._laterId = 0;
        }
    }

    /** @returns {boolean} false when the menu or item has no usable position yet */
    _place(item, menu) {
        const box = menu.actor;
        const monitor = Main.layoutManager.findMonitorForActor(box) ?? Main.layoutManager.primaryMonitor;
        // The menu slides in using a translation, and the first item is highlighted as it opens;
        // removing the translation places the panel where the menu ends up.
        const [boxX] = box.get_transformed_position();
        const menuX = boxX - box.translation_x;
        const [menuWidth] = box.get_transformed_size();
        const [, itemTransformedY] = item.get_transformed_position();
        const itemY = itemTransformedY - box.translation_y;
        const [, , width, height] = this.actor.get_preferred_size();

        // Right of the menu if it fits, otherwise left; level with the item but kept on screen.
        let x = menuX + menuWidth + GAP;
        if (x + width > monitor.x + monitor.width)
            x = menuX - GAP - width;
        const y = Math.min(Math.max(itemY, monitor.y), monitor.y + monitor.height - height);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return false;
        this.actor.set_position(Math.round(Math.max(x, monitor.x)), Math.round(y));
        return true;
    }

    _reveal() {
        this.actor.get_parent().set_child_above_sibling(this.actor, null);
        this.actor.show();
    }

    destroy() {
        this._stopWaitingForLayout();
        this.actor.destroy();
    }
}
