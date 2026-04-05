// Stockfish integration utilities
// Using local copy to avoid CORS issues with Worker scripts
const STOCKFISH_WORKER_URL = './stockfish.worker.js';
const TARGET_DEPTH = 21;

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
            postToEngine(`go depth ${activeEval.targetDepth}`);
        }
        return;
    }

    if (line.startsWith('info ') && activeEval && activeEval.state === 'searching') {
        const parsed = parseScoreFromInfoLine(line);
        if (parsed) {
            activeEval.latestScore = parsed;
        }

        const depthMatch = line.match(/\bdepth\s+(\d+)/);
        if (depthMatch) {
            activeEval.latestDepth = Number(depthMatch[1]);
        }

        const previousBestMove = activeEval.latestBestMove;
        const pvMoveMatch = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
        if (pvMoveMatch) {
            activeEval.latestBestMove = pvMoveMatch[1];
        }

        const bestMoveChanged = Boolean(activeEval.latestBestMove && activeEval.latestBestMove !== previousBestMove);

        if ((parsed || bestMoveChanged) && typeof activeEval.onUpdate === 'function') {
            notifyActiveUpdate();
        }

        return;
    }

    if (line.startsWith('bestmove ') && activeEval && activeEval.state === 'searching') {
        const parts = line.split(' ');
        const bestMove = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
        resolveActiveEval({
            score: activeEval.latestScore || { cp: 0 },
            bestMove,
            depth: activeEval.latestDepth || null,
        });
    }
}

function notifyActiveUpdate() {
    if (!activeEval || typeof activeEval.onUpdate !== 'function') return;

    try {
        activeEval.onUpdate({
            score: activeEval.latestScore,
            bestMove: activeEval.latestBestMove || null,
            depth: activeEval.latestDepth || null,
        });
    } catch (_) {
        // Ignore callback exceptions so engine processing remains stable.
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
        latestDepth: null,
        latestBestMove: null,
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
        postToEngine(`go depth ${activeEval.targetDepth}`);
    }
}

function evaluateFenRaw(fen, options) {
    const fenValue = String(fen || '').trim();
    const config = resolveEvaluationOptions(options);

    if (!fenValue) {
        throw new Error('FEN is required');
    }

    return new Promise((resolve, reject) => {
        queuedEvals.push({
            fen: fenValue,
            targetDepth: TARGET_DEPTH,
            onUpdate: config.onUpdate,
            resolve,
            reject,
        });
        processQueue();
    });
}

function resolveEvaluationOptions(options) {
    if (options === undefined) return { onUpdate: null };

    if (typeof options === 'function') {
        return { onUpdate: options };
    }

    if (typeof options !== 'object' || options === null) {
        throw new Error(`Invalid evaluation options: ${options}`);
    }

    if (options.onUpdate !== undefined && typeof options.onUpdate !== 'function') {
        throw new Error('Invalid onUpdate callback');
    }

    return { onUpdate: options.onUpdate || null };
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
