// Board highlighting and square normalization
let boardStylesEl = null;
let previousMoveHighlightSquares = [];
let currentMoveHighlightSquares = [];
let boardRef = null;
let onValidMoveCallback = null;
let currentFen = null;

const PREVIOUS_MOVE_HIGHLIGHT_COLOR = 'rgba(46, 204, 113, 0.75)';
const CURRENT_MOVE_HIGHLIGHT_COLOR = 'rgba(241, 196, 15, 0.85)';

if (typeof Chess !== 'function') {
    throw new Error('Chess library is not available. Ensure chess.js is loaded before board.js.');
}

function ensureBoardHighlightStyles() {
    if (boardStylesEl) return;
    boardStylesEl = document.createElement('style');
    boardStylesEl.id = 'board-square-highlights';
    document.head.append(boardStylesEl);
}

function normalizeSquare(square) {
    if (square === null || square === undefined) {
        return null;
    }
    const value = String(square).toLowerCase();
    if (!/^[a-h][1-8]$/.test(value)) {
        if (value === '') return null; // Allow empty string to represent no square
        throw new Error(`Invalid square: ${square}`);
    }
    return value;
}

function makeSquareHighlightRule(square, color) {
    return `#board::part(${square}) { box-shadow: inset 0 0 3px 3px ${color}; }`;
}

function renderBoardHighlights() {
    ensureBoardHighlightStyles();
    if (!boardStylesEl) return;

    const rules = [];
    for (const square of previousMoveHighlightSquares) {
        rules.push(makeSquareHighlightRule(square, PREVIOUS_MOVE_HIGHLIGHT_COLOR));
    }
    for (const square of currentMoveHighlightSquares) {
        rules.push(makeSquareHighlightRule(square, CURRENT_MOVE_HIGHLIGHT_COLOR));
    }
    boardStylesEl.textContent = rules.join('\n');
}

function setCurrentMoveHighlight(fromSquare, toSquare) {
    const squares = [normalizeSquare(fromSquare), normalizeSquare(toSquare)].filter(Boolean);
    currentMoveHighlightSquares = squares;
    renderBoardHighlights();
}

function clearCurrentMoveHighlight() {
    currentMoveHighlightSquares = [];
    renderBoardHighlights();
}

function setBoardLastMoveHighlight(fromSquare, toSquare) {
    const squares = [normalizeSquare(fromSquare), normalizeSquare(toSquare)].filter(Boolean);
    previousMoveHighlightSquares = squares;
    renderBoardHighlights();
}

function initializePuzzlePosition(fen, color) {
    boardRef.setAttribute('position', fen);
    boardRef.setAttribute('orientation', color);
    currentFen = fen;
}

function reset() {
    if (!boardRef) {
        throw new Error('Board is not initialized');
    }
    boardRef.start();
    currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    clearCurrentMoveHighlight();
}

/** Returns true if moveObj is a legal move in the current puzzle position, without mutating state. */
function isValidMove(moveObj) {
    const chess = new Chess();
    if (!currentFen) {
        throw new Error('Puzzle chess session is not initialized');
    }
    chess.load(currentFen);
    const move = chess.move(moveObj);
    if (!move) return false;
    chess.undo();
    return true;
}

// Handle a board drop event for puzzle move validation/scoring.
function boardSelectedMoveHandler(event) {
    const { source, target, setAction } = event.detail;

    if (!currentFen) {
        setAction('snapback');
        return;
    }

    const moveObj = { from: source, to: target, promotion: 'q' };

    if (!isValidMove(moveObj)) {
        setAction('snapback');
        return;
    }

    if (typeof onValidMoveCallback !== 'function') {
        throw new Error('Board module is not initialized with a valid move callback');
    }

    const chess = new Chess();
    chess.load(currentFen);
    const move = chess.move(moveObj);
    currentFen = chess.fen();
    if (source && target) {
        setCurrentMoveHighlight(source, target);
    }
    const selectedMove = `${move.from}${move.to}${move.promotion || ''}`.toLowerCase();
    onValidMoveCallback({ selectedMove });
}

function init(divName, onValidMove) {
    boardRef = document.getElementById(divName);
    if (!(boardRef instanceof HTMLElement)) {
        throw new Error('init expects an existing board HTMLElement id');
    }
    if (boardRef.tagName.toLowerCase() !== 'chess-board') {
        throw new Error('init expects a <chess-board> element');
    }
    if (typeof onValidMove !== 'function') {
        throw new Error('init expects onValidMove callback function');
    }

    onValidMoveCallback = onValidMove;
    boardRef.addEventListener('drop', boardSelectedMoveHandler);
}

window.boardModule = {
    ensureBoardHighlightStyles,
    setCurrentMoveHighlight,
    clearCurrentMoveHighlight,
    setBoardLastMoveHighlight,
    initializePuzzlePosition,
    reset,
    isValidMove,
    boardSelectedMoveHandler,
    init,
    get boardRef() { return boardRef; }
};
