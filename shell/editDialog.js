// A small multi-line editor for the text of a history item, opened with Ctrl+E in the menu.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

/**
 * @param {string} text
 * @param {(text: string) => void} onSave called with the edited text
 * @returns {ModalDialog.ModalDialog & {entry: St.Entry}}
 */
export function openEditDialog(text, onSave) {
    const dialog = new ModalDialog.ModalDialog();
    dialog.contentLayout.add_child(new Dialog.MessageDialogContent({
        title: 'Edit Item',
        description: 'Ctrl+Enter saves, Escape cancels.',
    }));

    // An entry switched to multi-line mode, inside a scroll view so long text stays usable.
    const entry = new St.Entry({text, can_focus: true, x_expand: true, style: 'width: 32em;'});
    const clutterText = entry.clutter_text;
    clutterText.single_line_mode = false;
    // Not activatable, so Enter inserts a new line instead of activating the entry.
    clutterText.activatable = false;
    clutterText.line_wrap = true;
    clutterText.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    const box = new St.BoxLayout({vertical: true, x_expand: true});
    box.add_child(entry);
    const scrollView = new St.ScrollView({
        child: box,
        style: 'max-height: 20em;',
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: true,
    });
    dialog.contentLayout.add_child(scrollView);

    const save = () => {
        const edited = clutterText.text;
        dialog.close();
        onSave(edited);
    };
    clutterText.connect('key-press-event', (_actor, event) => {
        const key = event.get_key_symbol();
        const ctrl = (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;
        if (ctrl && (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter || key === Clutter.KEY_ISO_Enter)) {
            save();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    // Keep the cursor in view while typing or moving through long text. Its coordinates are
    // only right after the next layout, so look them up just before the next redraw.
    let laterId = 0;
    clutterText.connect('cursor-changed', () => {
        if (laterId)
            return;
        laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            laterId = 0;
            scrollToCursor(box, entry, clutterText);
            return GLib.SOURCE_REMOVE;
        });
    });
    dialog.connect('destroy', () => {
        if (laterId)
            global.compositor.get_laters().remove(laterId);
    });

    dialog.setButtons([
        {label: 'Cancel', action: () => dialog.close(), key: Clutter.KEY_Escape},
        {label: 'Save', action: save},
    ]);
    dialog.setInitialKeyFocus(clutterText);
    dialog.open();
    clutterText.set_cursor_position(-1);
    dialog.entry = entry;
    return dialog;
}

function scrollToCursor(box, entry, clutterText) {
    const [found, , y, lineHeight] = clutterText.position_to_coords(clutterText.cursor_position);
    if (!found)
        return;
    const adjustment = box.vadjustment;
    const top = entry.y + clutterText.y + y;
    if (top < adjustment.value)
        adjustment.value = top;
    else if (top + lineHeight > adjustment.value + adjustment.page_size)
        adjustment.value = top + lineHeight - adjustment.page_size;
}
