// Entry labels and the keys that select them while a gclipy menu is open, like Clipy's numeric
// key equivalents. Entries are labelled in keyboard order, 1-9 then 0 for the tenth, then A-Z,
// so every label is one key. When numbering starts at 0, 0 is the first entry and A the eleventh.

// X keysyms for 0-9 on the main row and the keypad, and for the letters.
const KEY_0 = 0x30;
const KEY_KP_0 = 0xffb0;
const KEY_A = 0x41;
const KEY_a = 0x61;
// Hardware keycodes (evdev + 8) of the number row, 1 through 9 then 0. Layouts such as
// Lithuanian or French type letters on that row, so the key's position is used when the
// symbol is not a digit.
const KEYCODE_1 = 10;
const KEYCODE_0 = 19;
// Hardware keycodes of the letter keys in US QWERTY order, used for layouts whose letter keys
// type other scripts (Cyrillic, Greek…). Latin layouts such as AZERTY go by the typed letter.
const LETTER_KEYCODES = new Map([
    ...[...'qwertyuiop'].map((letter, i) => [24 + i, letter]),
    ...[...'asdfghjkl'].map((letter, i) => [38 + i, letter]),
    ...[...'zxcvbnm'].map((letter, i) => [52 + i, letter]),
]);

const LETTERS = 26;

/** @returns {number} the entry number labelled "A" */
function firstLetterNumber(startAtZero) {
    return startAtZero ? 10 : 11;
}

/**
 * @param {number} number entry number
 * @param {boolean} startAtZero whether entries are numbered from 0
 * @returns {string} a digit, then "A"-"Z"; numbers past Z keep their digits and have no key
 */
export function entryLabel(number, startAtZero) {
    if (!startAtZero && number === 10)
        return '0';
    const first = firstLetterNumber(startAtZero);
    if (number < first || number >= first + LETTERS)
        return String(number);
    return String.fromCharCode(KEY_A + number - first);
}

/**
 * @param {number} keysym
 * @param {number} keycode hardware keycode
 * @param {boolean} startAtZero whether entries are numbered from 0
 * @returns {number | null} the entry number whose label the key types
 */
export function numberForKey(keysym, keycode, startAtZero) {
    const digit = digitForKey(keysym, keycode);
    if (digit !== null)
        return digit === 0 && !startAtZero ? 10 : digit;
    const letter = letterForKey(keysym, keycode);
    return letter === null ? null : firstLetterNumber(startAtZero) + letter;
}

/** @returns {number | null} 0-9 */
function digitForKey(keysym, keycode) {
    if (keysym >= KEY_0 && keysym <= KEY_0 + 9)
        return keysym - KEY_0;
    if (keysym >= KEY_KP_0 && keysym <= KEY_KP_0 + 9)
        return keysym - KEY_KP_0;
    if (keycode >= KEYCODE_1 && keycode <= KEYCODE_0 && letterKeysym(keysym) === null)
        return (keycode - KEYCODE_1 + 1) % 10;
    return null;
}

/** @returns {number | null} 0 for A through 25 for Z */
function letterForKey(keysym, keycode) {
    const letter = letterKeysym(keysym);
    if (letter !== null)
        return letter;
    const positional = LETTER_KEYCODES.get(keycode);
    return positional ? positional.charCodeAt(0) - KEY_a : null;
}

function letterKeysym(keysym) {
    if (keysym >= KEY_a && keysym < KEY_a + LETTERS)
        return keysym - KEY_a;
    if (keysym >= KEY_A && keysym < KEY_A + LETTERS)
        return keysym - KEY_A;
    return null;
}
