// Position evaluation utilities
if (typeof Chess !== 'function') {
    throw new Error('Chess library is not available. Ensure chess.js is loaded before eval.js.');
}

const stockfish_module = window.stockfishModule;
if (!stockfish_module) {
    throw new Error('stockfishModule is not available. Ensure stockfish.js is loaded before eval.js.');
}

/**
 * Evaluate a FEN position and return white-perspective score data.
 */
async function evaluateFen(fen) {
    return evaluateFenStream(fen);
}

/**
 * Evaluate a FEN and emit intermediate white-perspective updates while searching.
 */
async function evaluateFenStream(fen, onUpdate) {
    const fenValue = String(fen || '').trim();
    if (!fenValue) {
        throw new Error('FEN is required');
    }

    const chess = new Chess();
    const loaded = chess.load(fenValue);
    if (!loaded) {
        throw new Error(`Invalid FEN: ${fen}`);
    }

    const raw = await stockfish_module.evaluateFenRaw(
        fenValue,
        createNormalizedScoreUpdater(chess.turn(), onUpdate)
    );
    return normalizeStockfishScore(raw.score, chess.turn(), raw.depth);
}

/**
 * Find the best move and its eval for a FEN position.
 * Returns { bestMove: string (UCI), score: white-perspective score }.
 */
async function findBestMoveWithEval(fen) {
    return findBestMoveWithEvalStream(fen);
}

/**
 * Find best move/eval and emit intermediate updates while searching.
 */
async function findBestMoveWithEvalStream(fen, onUpdate) {
    const fenValue = String(fen || '').trim();
    if (!fenValue) {
        throw new Error('FEN is required');
    }

    const chess = new Chess();
    if (!chess.load(fenValue)) {
        throw new Error(`Invalid FEN: ${fen}`);
    }

    const raw = await stockfish_module.evaluateFenRaw(
        fenValue,
        createBestMoveUpdater(chess.turn(), onUpdate)
    );
    return {
        bestMove: raw.bestMove,
        score: normalizeStockfishScore(raw.score, chess.turn(), raw.depth),
    };
}

/**
 * Evaluate the position after applying a UCI move to a FEN.
 * Returns white-perspective score data for the position after the move.
 */
async function evaluateMoveFromFen(fen, moveUci) {
    return evaluateMoveFromFenStream(fen, moveUci);
}

/**
 * Evaluate post-move position and emit intermediate updates while searching.
 */
async function evaluateMoveFromFenStream(fen, moveUci, onUpdate) {
    const fenValue = String(fen || '').trim();
    if (!fenValue) {
        throw new Error('FEN is required');
    }

    const moveValue = String(moveUci || '').trim().toLowerCase();
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(moveValue)) {
        throw new Error(`Invalid UCI move: ${moveUci}`);
    }

    const chess = new Chess();
    if (!chess.load(fenValue)) {
        throw new Error(`Invalid FEN: ${fen}`);
    }

    const move = chess.move({
        from: moveValue.slice(0, 2),
        to: moveValue.slice(2, 4),
        promotion: moveValue[4] || undefined,
    });

    if (!move) {
        throw new Error(`Illegal move for position: ${moveUci}`);
    }

    return evaluateFenStream(chess.fen(), onUpdate);
}

function createNormalizedScoreUpdater(sideToMove, onUpdate) {
    if (onUpdate === undefined || onUpdate === null) return undefined;
    if (typeof onUpdate !== 'function') {
        throw new Error('onUpdate must be a function');
    }

    return (rawUpdate) => {
        if (!rawUpdate || !rawUpdate.score) return;
        onUpdate(normalizeStockfishScore(rawUpdate.score, sideToMove, rawUpdate.depth));
    };
}

function createBestMoveUpdater(sideToMove, onUpdate) {
    if (onUpdate === undefined || onUpdate === null) return undefined;
    if (typeof onUpdate !== 'function') {
        throw new Error('onUpdate must be a function');
    }

    return (rawUpdate) => {
        if (!rawUpdate || !rawUpdate.score) return;
        onUpdate({
            bestMove: rawUpdate.bestMove,
            score: normalizeStockfishScore(rawUpdate.score, sideToMove, rawUpdate.depth),
        });
    };
}

function normalizeStockfishScore(rawScore, sideToMove, depth = null) {
    if (!rawScore || (rawScore.cp === undefined && rawScore.mate === undefined)) {
        throw new Error(`Invalid Stockfish score: ${rawScore}`);
    }
    if (sideToMove !== 'w' && sideToMove !== 'b') {
        throw new Error(`Invalid side to move: ${sideToMove}`);
    }

    const multiplier = sideToMove === 'w' ? 1 : -1;

    if (rawScore.mate !== undefined) {
        const mate = Number(rawScore.mate);
        if (!Number.isFinite(mate)) {
            throw new Error(`Invalid mate score: ${rawScore.mate}`);
        }
        return { mate: mate * multiplier, depth };
    }

    const cp = Number(rawScore.cp);
    if (!Number.isFinite(cp)) {
        throw new Error(`Invalid centipawn score: ${rawScore.cp}`);
    }
    return { cp: cp * multiplier, depth };
}

window.evalModule = {
    evaluateFen,
    evaluateFenStream,
    evaluateMoveFromFen,
    evaluateMoveFromFenStream,
    findBestMoveWithEval,
    findBestMoveWithEvalStream,
};
