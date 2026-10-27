// A popup menu that opens at the mouse pointer, used by the keyboard shortcuts like Clipy's popUpMenu.

import St from 'gi://St';

import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export class PointerMenu {
    constructor() {
        // The menu needs a source actor to point at, so an invisible one follows the pointer.
        this._anchor = new St.Widget({width: 1, height: 1, opacity: 0, reactive: false});
        Main.layoutManager.uiGroup.add_child(this._anchor);

        this.menu = new PopupMenu.PopupMenu(this._anchor, 0.0, St.Side.TOP);
        Main.layoutManager.uiGroup.add_child(this.menu.actor);
        this.menu.actor.hide();

        this._manager = new PopupMenu.PopupMenuManager(this._anchor);
        this._manager.addMenu(this.menu);
    }

    open() {
        if (this.menu.isOpen)
            this.menu.close(BoxPointer.PopupAnimation.NONE);
        const [x, y] = global.get_pointer();
        this._anchor.set_position(x, y);
        // The extension focuses an item when the menu reports it opened.
        this.menu.open(BoxPointer.PopupAnimation.FULL);
    }

    destroy() {
        this._manager.removeMenu(this.menu);
        this.menu.destroy();
        this._anchor.destroy();
    }
}
