// Board highlighting and square normalization
let boardStylesEl = null;
let previousMoveHighlightSquares = [];
let currentMoveHighlightSquares = [];
let puzzleSessionChess = null;

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

function initializePuzzlePosition(fen) {
    const chess = new Chess();
    chess.load(fen);
    puzzleSessionChess = chess;
}

function tryPuzzleMove(moveObj) {
    if (!puzzleSessionChess) {
        throw new Error('Puzzle chess session is not initialized');
    }
    return puzzleSessionChess.move(moveObj);
}

function undoPuzzleMove() {
    if (!puzzleSessionChess) {
        throw new Error('Puzzle chess session is not initialized');
    }
    return puzzleSessionChess.undo();
}

function resetPuzzleSession() {
    puzzleSessionChess = null;
}

window.boardModule = {
    ensureBoardHighlightStyles,
    setCurrentMoveHighlight,
    clearCurrentMoveHighlight,
    setBoardLastMoveHighlight,
    initializePuzzlePosition,
    tryPuzzleMove,
    undoPuzzleMove,
    resetPuzzleSession
};
