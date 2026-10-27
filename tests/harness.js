// Minimal test harness for `gjs -m`. The shell has no test runner, so keep this dependency-free.

const tests = [];

export function test(name, fn) {
    tests.push({name, fn});
}

export function assertEqual(actual, expected, message = '') {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`${message ? `${message}: ` : ''}expected ${e}, got ${a}`);
}

export function assertThrows(fn, errorClass, message = '') {
    try {
        fn();
    } catch (e) {
        if (errorClass && !(e instanceof errorClass))
            throw new Error(`${message ? `${message}: ` : ''}expected ${errorClass.name}, got ${e}`);
        return;
    }
    throw new Error(`${message ? `${message}: ` : ''}expected an exception`);
}

/** @returns {number} number of failed tests */
export function runAll() {
    let failed = 0;
    for (const {name, fn} of tests) {
        try {
            fn();
            print(`ok   ${name}`);
        } catch (e) {
            failed++;
            print(`FAIL ${name}\n     ${e.message}`);
        }
    }
    print(`\n${tests.length - failed}/${tests.length} passed`);
    return failed;
}
