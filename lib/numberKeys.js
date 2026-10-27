// Number keys select history items while a gclippy menu is open, like Clipy's numeric key equivalents.

// X keysyms for 0-9 on the main row and the keypad.
const KEY_0 = 0x30;
const KEY_KP_0 = 0xffb0;
// Hardware keycodes (evdev + 8) of the number row, 1 through 9 then 0. Layouts such as
// Lithuanian or French type letters on that row, so the key's position is used when the
// symbol is not a digit.
const KEYCODE_1 = 10;
const KEYCODE_0 = 19;

/**
 * @param {number} keysym
 * @param {number} keycode hardware keycode
 * @returns {number | null} the digit 0-9 the key stands for
 */
export function digitForKey(keysym, keycode) {
    if (keysym >= KEY_0 && keysym <= KEY_0 + 9)
        return keysym - KEY_0;
    if (keysym >= KEY_KP_0 && keysym <= KEY_KP_0 + 9)
        return keysym - KEY_KP_0;
    if (keycode >= KEYCODE_1 && keycode <= KEYCODE_0)
        return (keycode - KEYCODE_1 + 1) % 10;
    return null;
}

/**
 * Map a digit to an item number. When numbering starts at 1, the 0 key selects item 10.
 *
 * @param {number} digit
 * @param {boolean} startAtZero
 * @returns {number}
 */
export function numberForDigit(digit, startAtZero) {
    return !startAtZero && digit === 0 ? 10 : digit;
}
