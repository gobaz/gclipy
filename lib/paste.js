// Paste decisions, ported from Clipy's PasteService modifier handling.

export const MODIFIERS = ['none', 'ctrl', 'shift', 'alt', 'super'];

/**
 * Decide what selecting a history item does. Paste-and-delete wins over delete, as in Clipy.
 *
 * @param {object} params
 * @param {Set<string>} params.pressed modifiers held while selecting, e.g. new Set(['ctrl'])
 * @param {string} params.deleteModifier one of MODIFIERS
 * @param {string} params.pasteDeleteModifier one of MODIFIERS
 * @returns {'paste' | 'delete' | 'paste-delete'}
 */
export function historyAction({pressed, deleteModifier, pasteDeleteModifier}) {
    if (pasteDeleteModifier !== 'none' && pressed.has(pasteDeleteModifier))
        return 'paste-delete';
    if (deleteModifier !== 'none' && pressed.has(deleteModifier))
        return 'delete';
    return 'paste';
}

/**
 * Match a window against a list typed in prefs. Entries may be a WM_CLASS ("KeePassXC")
 * or an application id with or without ".desktop" ("org.gnome.Ptyxis"), compared case-insensitively.
 *
 * @param {string | null} wmClass
 * @param {string | null} appId e.g. "org.gnome.Ptyxis.desktop"
 * @param {string[]} entries
 * @returns {boolean}
 */
export function matchesApp(wmClass, appId, entries) {
    const candidates = [wmClass, appId, appId?.replace(/\.desktop$/, '')]
        .filter(Boolean)
        .map(value => value.toLowerCase());
    return entries.some(entry => candidates.includes(entry.trim().toLowerCase()));
}
