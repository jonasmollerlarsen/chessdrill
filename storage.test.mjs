import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function createLocalStorageMock(initialEntries = []) {
    const store = new Map(initialEntries);

    return {
        get length() {
            return store.size;
        },
        key(index) {
            const keys = Array.from(store.keys());
            return keys[index] ?? null;
        },
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(String(key), String(value));
        },
        removeItem(key) {
            store.delete(String(key));
        }
    };
}

function loadStorageModule(localStorageMock) {
    const storagePath = path.resolve('storage.js');
    const code = fs.readFileSync(storagePath, 'utf8');

    const sandbox = {
        window: {},
        localStorage: localStorageMock,
        console
    };

    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'storage.js' });

    return {
        storage: sandbox.window.positionsStorage,
        localStorage: localStorageMock
    };
}

test('exports positionsStorage API on window', () => {
    const { storage } = loadStorageModule(createLocalStorageMock());
    assert.ok(storage);
    assert.equal(typeof storage.parsePositionLimit, 'function');
    assert.equal(typeof storage.getPositionLimit, 'function');
    assert.equal(typeof storage.setPositionLimit, 'function');
    assert.equal(typeof storage.getRawPositions, 'function');
    assert.equal(typeof storage.setRawPositions, 'function');
    assert.equal(typeof storage.removePositions, 'function');
    assert.equal(typeof storage.getUsername, 'function');
    assert.equal(typeof storage.setUsername, 'function');
    assert.equal(typeof storage.estimateUsageBytes, 'function');
    assert.equal(typeof storage.getItem, 'function');
});

test('parsePositionLimit parses positive integers', () => {
    const { storage } = loadStorageModule(createLocalStorageMock());
    assert.equal(storage.parsePositionLimit('5'), 5);
    assert.equal(storage.parsePositionLimit(9), 9);
});

test('parsePositionLimit rejects invalid values', () => {
    const { storage } = loadStorageModule(createLocalStorageMock());
    assert.throws(() => storage.parsePositionLimit('0'), /Invalid position limit/);
    assert.throws(() => storage.parsePositionLimit('-3'), /Invalid position limit/);
    assert.throws(() => storage.parsePositionLimit('abc'), /Invalid position limit/);
});

test('getPositionLimit defaults to 3 when unset', () => {
    const { storage } = loadStorageModule(createLocalStorageMock());
    assert.equal(storage.getPositionLimit(), 3);
});

test('setPositionLimit stores normalized value and returns it', () => {
    const localStorageMock = createLocalStorageMock();
    const { storage, localStorage } = loadStorageModule(localStorageMock);

    const result = storage.setPositionLimit('7');

    assert.equal(result, 7);
    assert.equal(localStorage.getItem('maxPositions'), '7');
    assert.equal(storage.getPositionLimit(), 7);
});

test('getRawPositions returns empty array when unset', () => {
    const { storage } = loadStorageModule(createLocalStorageMock());
    assert.deepEqual(storage.getRawPositions(), []);
});

test('getRawPositions returns parsed array when valid JSON array is stored', () => {
    const localStorageMock = createLocalStorageMock([
        ['positions', JSON.stringify([{ id: 'game-1', attempts: 1 }])]
    ]);
    const { storage } = loadStorageModule(localStorageMock);

    assert.deepEqual(storage.getRawPositions(), [{ id: 'game-1', attempts: 1 }]);
});

test('getRawPositions throws when stored JSON is not an array', () => {
    const localStorageMock = createLocalStorageMock([
        ['positions', JSON.stringify({ id: 'not-an-array' })]
    ]);
    const { storage } = loadStorageModule(localStorageMock);

    assert.throws(() => storage.getRawPositions(), /expected array/);
});

test('setRawPositions stores JSON payload', () => {
    const localStorageMock = createLocalStorageMock();
    const { storage, localStorage } = loadStorageModule(localStorageMock);

    storage.setRawPositions([{ id: 'abc-1' }]);

    assert.equal(localStorage.getItem('positions'), '[{"id":"abc-1"}]');
});

test('removePositions deletes the positions key', () => {
    const localStorageMock = createLocalStorageMock([
        ['positions', '[{"id":"abc-1"}]']
    ]);
    const { storage, localStorage } = loadStorageModule(localStorageMock);

    storage.removePositions();

    assert.equal(localStorage.getItem('positions'), null);
});

test('getUsername returns empty string when unset', () => {
    const { storage } = loadStorageModule(createLocalStorageMock());
    assert.equal(storage.getUsername(), '');
});

test('setUsername enforces string type and stores value', () => {
    const localStorageMock = createLocalStorageMock();
    const { storage, localStorage } = loadStorageModule(localStorageMock);

    storage.setUsername('lichess-user');
    assert.equal(localStorage.getItem('username'), 'lichess-user');

    assert.throws(() => storage.setUsername(42), /expects a string/);
});

test('estimateUsageBytes returns 2 bytes per UTF-16 code unit', () => {
    const localStorageMock = createLocalStorageMock([
        ['a', 'b'],
        ['username', 'bob']
    ]);
    const { storage } = loadStorageModule(localStorageMock);

    // ("a"+"b") + ("username"+"bob") => (1+1 + 8+3) code units = 13
    // 13 * 2 = 26 bytes
    assert.equal(storage.estimateUsageBytes(), 26);
});

test('getItem enforces string key', () => {
    const localStorageMock = createLocalStorageMock([['x', '1']]);
    const { storage } = loadStorageModule(localStorageMock);

    assert.equal(storage.getItem('x'), '1');
    assert.throws(() => storage.getItem(1), /expects a string key/);
});
