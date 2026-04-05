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
    const fenValue = String(fen || '').trim();
    if (!fenValue) {
        throw new Error('FEN is required');
    }

    const chess = new Chess();
    const loaded = chess.load(fenValue);
    if (!loaded) {
        throw new Error(`Invalid FEN: ${fen}`);
    }

    const raw = await stockfish_module.evaluateFenRaw(fenValue);
    return normalizeStockfishScore(raw.score, chess.turn());
}

/**
 * Find the best move and its eval for a FEN position.
 * Returns { bestMove: string (UCI), score: white-perspective score }.
 */
async function findBestMoveWithEval(fen) {
    const fenValue = String(fen || '').trim();
    if (!fenValue) {
        throw new Error('FEN is required');
    }

    const chess = new Chess();
    if (!chess.load(fenValue)) {
        throw new Error(`Invalid FEN: ${fen}`);
    }

    const raw = await stockfish_module.evaluateFenRaw(fenValue);
    return {
        bestMove: raw.bestMove,
        score: normalizeStockfishScore(raw.score, chess.turn()),
    };
}

/**
 * Evaluate the position after applying a UCI move to a FEN.
 * Returns white-perspective score data for the position after the move.
 */
async function evaluateMoveFromFen(fen, moveUci) {
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

    return evaluateFen(chess.fen());
}

function normalizeStockfishScore(rawScore, sideToMove) {
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
        return { mate: mate * multiplier };
    }

    const cp = Number(rawScore.cp);
    if (!Number.isFinite(cp)) {
        throw new Error(`Invalid centipawn score: ${rawScore.cp}`);
    }
    return { cp: cp * multiplier };
}

window.evalModule = {
    evaluateFen,
    evaluateMoveFromFen,
    findBestMoveWithEval,
};
