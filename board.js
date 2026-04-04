// Board highlighting and square normalization
let boardStylesEl = null;
let previousMoveHighlightSquares = [];
let currentMoveHighlightSquares = [];

const PREVIOUS_MOVE_HIGHLIGHT_COLOR = 'rgba(46, 204, 113, 0.75)';
const CURRENT_MOVE_HIGHLIGHT_COLOR = 'rgba(241, 196, 15, 0.85)';

function ensureBoardHighlightStyles() {
    if (boardStylesEl) return;
    boardStylesEl = document.createElement('style');
    boardStylesEl.id = 'board-square-highlights';
    document.head.append(boardStylesEl);
}

function normalizeSquare(square) {
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

window.boardModule = {
    ensureBoardHighlightStyles,
    setCurrentMoveHighlight,
    clearCurrentMoveHighlight,
    setBoardLastMoveHighlight
};
