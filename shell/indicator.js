// Top bar icon whose menu is the main gclippy menu, like Clipy's status item.

import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export function createIndicator() {
    const button = new PanelMenu.Button(0.0, 'gclippy', false);
    button.add_child(new St.Icon({icon_name: 'edit-paste-symbolic', style_class: 'system-status-icon'}));
    return button;
}
