// Stockfish integration utilities
// Using local copy to avoid CORS issues with Worker scripts
const STOCKFISH_WORKER_URL = './stockfish.worker.js';
const TARGET_DEPTH = 21;

// Maps each active worker to its reject function for group termination.
const activeWorkers = new Map();

/**
 * Run a single Stockfish search on a fresh worker.
 * Each call creates an independent worker so multiple evals run in parallel.
 * Resolves with { score, bestMove, depth } when the search completes.
 * Streams intermediate updates via onUpdate on each scored info line or PV change.
 */
function runEval(fen, targetDepth, onUpdate) {
    return new Promise((resolve, reject) => {
        if (typeof Worker !== 'function') {
            reject(new Error('Web Workers are not supported in this environment.'));
            return;
        }

        const worker = new Worker(STOCKFISH_WORKER_URL);
        activeWorkers.set(worker, reject);

        let latestScore = null;
        let latestDepth = null;
        let latestBestMove = null;
        let isSearching = false;

        function finish(result) {
            activeWorkers.delete(worker);
            worker.terminate();
            resolve(result);
        }

        function fail(error) {
            activeWorkers.delete(worker);
            worker.terminate();
            reject(error);
        }

        function notifyUpdate() {
            if (typeof onUpdate !== 'function') return;
            try {
                onUpdate({
                    score: latestScore,
                    bestMove: latestBestMove || null,
                    depth: latestDepth || null,
                });
            } catch (_) {
                // Ignore callback exceptions so engine processing remains stable.
            }
        }

        worker.onerror = (event) => {
            const message = event && event.message ? event.message : 'Unknown Stockfish worker error';
            fail(new Error(message));
        };

        worker.onmessage = (event) => {
            const line = String(event.data || '').trim();
            if (!line) return;

            if (line === 'uciok') {
                worker.postMessage('isready');
                return;
            }

            if (line === 'readyok') {
                isSearching = true;
                worker.postMessage(`position fen ${fen}`);
                worker.postMessage(`go depth ${targetDepth}`);
                return;
            }

            if (line.startsWith('info ') && isSearching) {
                const parsed = parseScoreFromInfoLine(line);
                if (parsed) {
                    latestScore = parsed;
                }

                const depthMatch = line.match(/\bdepth\s+(\d+)/);
                if (depthMatch) {
                    latestDepth = Number(depthMatch[1]);
                }

                const previousBestMove = latestBestMove;
                const pvMoveMatch = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
                if (pvMoveMatch) {
                    latestBestMove = pvMoveMatch[1];
                }

                const bestMoveChanged = Boolean(latestBestMove && latestBestMove !== previousBestMove);

                if ((parsed || bestMoveChanged) && typeof onUpdate === 'function') {
                    notifyUpdate();
                }

                return;
            }

            if (line.startsWith('bestmove ') && isSearching) {
                const parts = line.split(' ');
                const bestMove = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
                finish({
                    score: latestScore || { cp: 0 },
                    bestMove,
                    depth: latestDepth || null,
                });
            }
        };

        worker.postMessage('uci');
    });
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

function evaluateFenRaw(fen, options) {
    const fenValue = String(fen || '').trim();
    const config = resolveEvaluationOptions(options);

    if (!fenValue) {
        throw new Error('FEN is required');
    }

    return runEval(fenValue, TARGET_DEPTH, config.onUpdate);
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

/** Terminate all in-flight eval workers and reject their pending promises. */
function terminateEngine() {
    for (const [worker, reject] of activeWorkers) {
        worker.terminate();
        reject(new Error('Stockfish engine terminated.'));
    }
    activeWorkers.clear();
}

window.stockfishModule = {
    evaluateFenRaw,
    terminateEngine,
};
