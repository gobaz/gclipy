// "Clear History" confirmation with a "don't ask again" checkbox, as in Clipy's ClipService.clearAllHistory.

import Clutter from 'gi://Clutter';

import {CheckBox} from 'resource:///org/gnome/shell/ui/checkBox.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

/**
 * @param {(dontAskAgain: boolean) => void} onConfirm
 * @returns {ModalDialog.ModalDialog}
 */
export function openClearHistoryDialog(onConfirm) {
    const dialog = new ModalDialog.ModalDialog();
    dialog.contentLayout.add_child(new Dialog.MessageDialogContent({
        title: 'Clear History',
        description: 'Are you sure you want to clear your clipboard history?',
    }));
    const checkBox = new CheckBox("Don't ask again");
    dialog.contentLayout.add_child(checkBox);

    dialog.setButtons([
        {
            label: 'Cancel',
            action: () => dialog.close(),
            key: Clutter.KEY_Escape,
        },
        {
            label: 'Clear History',
            action: () => {
                dialog.close();
                onConfirm(checkBox.checked);
            },
            default: true,
        },
    ]);
    dialog.open();
    return dialog;
}
