// Board highlighting and square normalization
let boardStylesEl = null;
let previousMoveHighlightSquares = [];
let currentMoveHighlightSquares = [];
let boardRef = null;
let onValidMoveCallback = null;
let currentFen = null;
let pendingFromSquare = null;

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
    pendingFromSquare = null;
}

function reset() {
    if (!boardRef) {
        throw new Error('Board is not initialized');
    }
    boardRef.start();
    currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    pendingFromSquare = null;
    clearCurrentMoveHighlight();
}

function getFenChess() {
    if (!currentFen) {
        throw new Error('Puzzle chess session is not initialized');
    }
    const chess = new Chess();
    chess.load(currentFen);
    return chess;
}

function isOwnPieceOnSquare(square) {
    const normalizedSquare = normalizeSquare(square);
    if (!normalizedSquare) return false;

    const chess = getFenChess();
    const piece = chess.get(normalizedSquare);
    if (!piece) return false;
    return piece.color === chess.turn();
}

function submitValidatedMove(from, to, setAction) {
    const moveObj = { from, to, promotion: 'q' };

    if (!isValidMove(moveObj)) {
        if (typeof setAction === 'function') {
            setAction('snapback');
        }
        return false;
    }

    if (typeof onValidMoveCallback !== 'function') {
        throw new Error('Board module is not initialized with a valid move callback');
    }

    const chess = getFenChess();
    const move = chess.move(moveObj);
    currentFen = chess.fen();
    boardRef.setAttribute('position', currentFen);
    pendingFromSquare = null;
    setCurrentMoveHighlight(from, to);

    const selectedMove = `${move.from}${move.to}${move.promotion || ''}`.toLowerCase();
    onValidMoveCallback({ selectedMove });
    return true;
}

function squareFromBoardPointerEvent(event) {
    let clientX, clientY;

    if (event instanceof MouseEvent) {
        clientX = event.clientX;
        clientY = event.clientY;
    } else if (event instanceof TouchEvent && event.changedTouches && event.changedTouches.length > 0) {
        clientX = event.changedTouches[0].clientX;
        clientY = event.changedTouches[0].clientY;
    } else {
        return null;
    }

    if (!boardRef) {
        throw new Error('Board is not initialized');
    }

    const rect = boardRef.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return null;
    }

    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
        return null;
    }

    const squareSize = Math.min(rect.width, rect.height) / 8;
    const fileIndexFromLeft = Math.floor(x / squareSize);
    const rankIndexFromTop = Math.floor(y / squareSize);

    if (fileIndexFromLeft < 0 || fileIndexFromLeft > 7 || rankIndexFromTop < 0 || rankIndexFromTop > 7) {
        return null;
    }

    const orientation = String(boardRef.getAttribute('orientation') || 'white').toLowerCase();
    const files = orientation === 'black' ? 'hgfedcba' : 'abcdefgh';
    const file = files[fileIndexFromLeft];
    const rank = orientation === 'black'
        ? String(rankIndexFromTop + 1)
        : String(8 - rankIndexFromTop);

    return normalizeSquare(`${file}${rank}`);
}

// Handle click/tap-to-move by selecting from-square then to-square.
function boardMoveSelectionHandler(event) {
    const selectedSquare = squareFromBoardPointerEvent(event);
    if (!selectedSquare || !currentFen) return;

    if (!pendingFromSquare) {
        if (!isOwnPieceOnSquare(selectedSquare)) {
            return;
        }
        pendingFromSquare = selectedSquare;
        setCurrentMoveHighlight(selectedSquare, null);
        return;
    }

    if (selectedSquare === pendingFromSquare) {
        pendingFromSquare = null;
        clearCurrentMoveHighlight();
        return;
    }

    if (!submitValidatedMove(pendingFromSquare, selectedSquare)) {
        if (isOwnPieceOnSquare(selectedSquare)) {
            pendingFromSquare = selectedSquare;
            setCurrentMoveHighlight(selectedSquare, null);
            return;
        }
        setCurrentMoveHighlight(pendingFromSquare, null);
    }
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

    submitValidatedMove(source, target, setAction);
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
    boardRef.addEventListener('click', boardMoveSelectionHandler);
    boardRef.addEventListener('touchend', boardMoveSelectionHandler);
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
    boardMoveSelectionHandler,
    init,
    get boardRef() { return boardRef; }
};
