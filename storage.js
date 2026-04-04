(function () {
    const DEFAULT_POSITION_LIMIT = 3;
    const MAX_POSITION_LIMIT_KEY = 'maxPositions';
    const POSITIONS_KEY = 'positions';
    const USERNAME_KEY = 'username';

    function parsePositionLimit(value) {
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            throw new Error(`Invalid position limit: expected positive integer, got ${value}`);
        }
        return parsed;
    }

    function getPositionLimit() {
        const stored = localStorage.getItem(MAX_POSITION_LIMIT_KEY);
        if (stored === null) return DEFAULT_POSITION_LIMIT;
        return parsePositionLimit(stored);
    }

    function setPositionLimit(value) {
        const normalized = parsePositionLimit(value);
        localStorage.setItem(MAX_POSITION_LIMIT_KEY, String(normalized));
        return normalized;
    }

    function getRawPositions() {
        const raw = localStorage.getItem(POSITIONS_KEY);
        if (raw === null) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            throw new Error(`Invalid positions data in localStorage: expected array, got ${typeof parsed}`);
        }
        return parsed;
    }

    function setRawPositions(positions) {
        localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
    }

    function removePositions() {
        localStorage.removeItem(POSITIONS_KEY);
    }

    function getUsername() {
        const username = localStorage.getItem(USERNAME_KEY);
        return username === null ? '' : username;
    }

    function setUsername(username) {
        if (typeof username !== 'string') {
            throw new TypeError(`setUsername expects a string, got ${typeof username}`);
        }
        localStorage.setItem(USERNAME_KEY, username);
    }

    function estimateUsageBytes() {
        let total = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key === null) {
                throw new Error(`localStorage.key(${i}) returned null unexpectedly`);
            }
            const value = localStorage.getItem(key);
            if (value === null) {
                throw new Error(`localStorage value for key "${key}" disappeared during iteration`);
            }
            // JS strings are UTF-16; estimate 2 bytes per code unit for quota use.
            total += (key.length + value.length) * 2;
        }
        return total;
    }

    function getItem(key) {
        if (typeof key !== 'string') {
            throw new TypeError(`getItem expects a string key, got ${typeof key}`);
        }
        return localStorage.getItem(key);
    }

    window.positionsStorage = {
        parsePositionLimit,
        getPositionLimit,
        setPositionLimit,
        getRawPositions,
        setRawPositions,
        removePositions,
        getUsername,
        setUsername,
        estimateUsageBytes,
        getItem
    };
})();
