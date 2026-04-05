// Stockfish integration utilities
// Using local copy to avoid CORS issues with Worker scripts
const STOCKFISH_WORKER_URL = './stockfish.worker.js';
const DEFAULT_MOVETIME_MS = 500;

let engineWorker = null;
let isEngineReady = false;
let isEngineInitialized = false;
let isEngineReadyRequestPending = false;

let activeEval = null;
let queuedEvals = [];

function ensureWorker() {
    if (engineWorker) return;
    if (typeof Worker !== 'function') {
        throw new Error('Web Workers are not supported in this environment.');
    }

    engineWorker = new Worker(STOCKFISH_WORKER_URL);
    engineWorker.onmessage = handleEngineMessage;
    engineWorker.onerror = (event) => {
        const message = event && event.message ? event.message : 'Unknown Stockfish worker error';
        failActiveEval(new Error(message));
    };
}

function postToEngine(command) {
    if (!engineWorker) {
        throw new Error('Stockfish worker is not initialized');
    }
    engineWorker.postMessage(command);
}

function handleEngineMessage(event) {
    const line = String(event.data || '').trim();
    if (!line) return;

    if (line === 'uciok') {
        isEngineInitialized = true;
        if (!isEngineReadyRequestPending && !isEngineReady) {
            isEngineReadyRequestPending = true;
            postToEngine('isready');
        }
        return;
    }

    if (line === 'readyok') {
        isEngineReady = true;
        isEngineReadyRequestPending = false;
        if (activeEval && activeEval.state === 'waiting-ready') {
            activeEval.state = 'searching';
            postToEngine(`position fen ${activeEval.fen}`);
            postToEngine(`go movetime ${activeEval.movetime}`);
        }
        return;
    }

    if (line.startsWith('info ') && activeEval && activeEval.state === 'searching') {
        const parsed = parseScoreFromInfoLine(line);
        if (parsed) {
            activeEval.latestScore = parsed;
        }
        return;
    }

    if (line.startsWith('bestmove ') && activeEval && activeEval.state === 'searching') {
        const parts = line.split(' ');
        const bestMove = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
        resolveActiveEval({ score: activeEval.latestScore || { cp: 0 }, bestMove });
    }
}

function parseScoreFromInfoLine(line) {
    const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
    if (mateMatch) {
        return { mate: Number(mateMatch[1]) };
    }

    const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
    if (cpMatch) {
        return { cp: Number(cpMatch[1]) };
    }

    return null;
}

function resolveActiveEval(result) {
    if (!activeEval) return;
    const pending = activeEval;
    activeEval = null;
    pending.resolve(result);
    processQueue();
}

function failActiveEval(error) {
    if (!activeEval) return;
    const pending = activeEval;
    activeEval = null;
    pending.reject(error);
    processQueue();
}

function processQueue() {
    if (activeEval || queuedEvals.length === 0) return;

    const next = queuedEvals.shift();
    activeEval = {
        ...next,
        state: 'waiting-ready',
        latestScore: null,
    };

    ensureWorker();

    if (!isEngineInitialized) {
        postToEngine('uci');
    } else if (!isEngineReady && !isEngineReadyRequestPending) {
        isEngineReadyRequestPending = true;
        postToEngine('isready');
    } else if (isEngineReady && activeEval && activeEval.state === 'waiting-ready') {
        activeEval.state = 'searching';
        postToEngine(`position fen ${activeEval.fen}`);
        postToEngine(`go movetime ${activeEval.movetime}`);
    }
}

function evaluateFenRaw(fen) {
    const fenValue = String(fen || '').trim();

    if (!fenValue) {
        throw new Error('FEN is required');
    }

    return new Promise((resolve, reject) => {
        queuedEvals.push({ fen: fenValue, movetime: DEFAULT_MOVETIME_MS, resolve, reject });
        processQueue();
    });
}

function terminateEngine() {
    if (!engineWorker) return;

    engineWorker.terminate();
    engineWorker = null;
    isEngineInitialized = false;
    isEngineReady = false;
    isEngineReadyRequestPending = false;

    if (activeEval) {
        const pending = activeEval;
        activeEval = null;
        pending.reject(new Error('Stockfish engine terminated during evaluation.'));
    }

    while (queuedEvals.length > 0) {
        const pending = queuedEvals.shift();
        pending.reject(new Error('Stockfish engine terminated before evaluation started.'));
    }
}

window.stockfishModule = {
    evaluateFenRaw,
    terminateEngine,
};
