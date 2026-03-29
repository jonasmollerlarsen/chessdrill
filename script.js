// DOM references - initialized on page load
let board;
let statusMsg;
let nextBtn;
let fetchBtn;
let clearBtn;
let debugToggleBtn;
let debugPanel;
let debugCorrectMoveEl;
let localstorageFullnessEl;
let localstorageStateEl;
let positionsContentEl;
let metadataDisplay;
let maxPositionsInput;

const DEFAULT_POSITION_LIMIT = 3;
const MAX_POSITION_LIMIT_KEY = 'maxPositions';

let chess = new Chess();
let currentPuzzle = null;
let hasAttemptedMoveOnCurrentPuzzle = false;
let boardHighlightStylesEl = null;
let previousMoveHighlightSquares = [];
let currentMoveHighlightSquares = [];

const PREVIOUS_MOVE_HIGHLIGHT_COLOR = 'rgba(46, 204, 113, 0.75)';
const CURRENT_MOVE_HIGHLIGHT_COLOR = 'rgba(241, 196, 15, 0.85)';

function initDOMReferences() {
    board = document.getElementById('board');
    statusMsg = document.getElementById('status-msg');
    nextBtn = document.getElementById('next-btn');
    fetchBtn = document.getElementById('fetch-btn');
    clearBtn = document.getElementById('clear-btn');
    debugToggleBtn = document.getElementById('debug-toggle-btn');
    debugPanel = document.getElementById('debug-panel');
    debugCorrectMoveEl = document.getElementById('debug-correct-move');
    localstorageFullnessEl = document.getElementById('localstorage-fullness');
    localstorageStateEl = document.getElementById('localstorage-state');
    positionsContentEl = document.getElementById('positions-content');
    metadataDisplay = document.getElementById('metadata-display');
    maxPositionsInput = document.getElementById('max-positions');
    ensureBoardHighlightStyles();
}

function parsePositionLimit(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_POSITION_LIMIT;
    return parsed;
}

function getPositionLimit() {
    const stored = localStorage.getItem(MAX_POSITION_LIMIT_KEY);
    return parsePositionLimit(stored);
}

function setPositionLimit(value) {
    const normalized = parsePositionLimit(value);
    localStorage.setItem(MAX_POSITION_LIMIT_KEY, String(normalized));
    return normalized;
}

function ensureBoardHighlightStyles() {
    if (boardHighlightStylesEl) return;
    boardHighlightStylesEl = document.createElement('style');
    boardHighlightStylesEl.id = 'board-square-highlights';
    document.head.append(boardHighlightStylesEl);
}

function normalizeSquare(square) {
    const value = String(square || '').toLowerCase();
    return /^[a-h][1-8]$/.test(value) ? value : null;
}

function makeSquareHighlightRule(square, color) {
    return `#board::part(${square}) { box-shadow: inset 0 0 3px 3px ${color}; }`;
}

function renderBoardHighlights() {
    ensureBoardHighlightStyles();
    if (!boardHighlightStylesEl) return;

    const rules = [];
    for (const square of previousMoveHighlightSquares) {
        rules.push(makeSquareHighlightRule(square, PREVIOUS_MOVE_HIGHLIGHT_COLOR));
    }
    for (const square of currentMoveHighlightSquares) {
        rules.push(makeSquareHighlightRule(square, CURRENT_MOVE_HIGHLIGHT_COLOR));
    }
    boardHighlightStylesEl.textContent = rules.join('\n');
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

function normalizeUci(move) {
    return String(move || '').trim().toLowerCase().replace(/[^a-h1-8qrbn]/g, '');
}

function formatErrorMessage(error) {
    if (error instanceof Error && error.message) return error.message;
    return String(error || 'Unknown error');
}

const PUZZLE_STATES = {
    ENABLED: 'enabled',
    UNVETTED: 'unvetted',
    DISABLED: 'disabled'
};

function isPuzzleActive(puzzle) {
    return puzzle?.state !== PUZZLE_STATES.DISABLED;
}

function normalizePuzzleState(puzzle) {
    const state = puzzle?.state;
    if (state === PUZZLE_STATES.ENABLED || state === PUZZLE_STATES.UNVETTED || state === PUZZLE_STATES.DISABLED) {
        return state;
    }

    // Backward compatibility for older boolean-enabled records.
    if (puzzle?.enabled === false) return PUZZLE_STATES.DISABLED;
    return PUZZLE_STATES.ENABLED;
}

function getNextPuzzleState(state) {
    if (state === PUZZLE_STATES.UNVETTED) return PUZZLE_STATES.ENABLED;
    if (state === PUZZLE_STATES.ENABLED) return PUZZLE_STATES.DISABLED;
    return PUZZLE_STATES.UNVETTED;
}

function getPuzzleStateLabel(state) {
    if (state === PUZZLE_STATES.UNVETTED) return '?';
    if (state === PUZZLE_STATES.DISABLED) return 'X';
    return '\u2713';
}

function getPuzzleStateTitle(state) {
    if (state === PUZZLE_STATES.ENABLED) return 'Vetted and enabled';
    if (state === PUZZLE_STATES.UNVETTED) return 'Not yet vetted';
    return 'Disabled';
}

function getPuzzleStateTooltip(state) {
    return `Cycle puzzle state. Current: ${getPuzzleStateTitle(state)}`;
}

function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function getLocalStorageUsageBytes() {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || '';
        const value = localStorage.getItem(key) || '';
        // JS strings are UTF-16; estimate 2 bytes per code unit for quota use.
        total += (key.length + value.length) * 2;
    }
    return total;
}

function renderLocalStorageFullness() {
    if (!localstorageFullnessEl) return;

    const usedBytes = getLocalStorageUsageBytes();
    const quotaBytes = 5 * 1024 * 1024;
    const percent = Math.min(100, Math.round((usedBytes / quotaBytes) * 100));
    localstorageFullnessEl.innerText = `${formatBytes(usedBytes)} / ${formatBytes(quotaBytes)} (${percent}%)`;
}

function normalizePuzzleEntry(puzzle) {
    const state = normalizePuzzleState(puzzle);
    return {
        ...puzzle,
        state
    };
}

function getBlunders() {
    const parsed = JSON.parse(localStorage.getItem('blunders') || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePuzzleEntry);
}

function setBlunders(blunders) {
    const trimmed = blunders.slice(0, getPositionLimit()).map(normalizePuzzleEntry);
    localStorage.setItem('blunders', JSON.stringify(trimmed));
    return trimmed;
}

function getPuzzleLichessUrl(puzzle) {
    const id = String(puzzle?.id || '');
    const dash = id.lastIndexOf('-');
    if (dash <= 0) return '#';

    const gameId = id.slice(0, dash);
    const plyIndex = Number(id.slice(dash + 1));
    if (!gameId || !Number.isFinite(plyIndex)) return '#';

    const orientation = puzzle?.color === 'black' ? 'black' : 'white';
    const queriedPly = Math.max(1, plyIndex);
    return `https://lichess.org/${gameId}/${orientation}#${queriedPly}`;
}

function renderDebugInfo(puzzle) {
    debugCorrectMoveEl.innerText = puzzle?.bestMove || '-';
    renderLocalStorageFullness();
    const raw = localStorage.getItem('blunders');
    localstorageStateEl.innerText = raw || '[]';
}

function setStatusTone(tone = 'neutral') {
    if (!statusMsg) return;
    statusMsg.classList.remove('status-correct', 'status-wrong');
    if (tone === 'correct') statusMsg.classList.add('status-correct');
    if (tone === 'wrong') statusMsg.classList.add('status-wrong');
}

function updateNextPuzzleButtonAppearance() {
    if (!nextBtn) return;
    nextBtn.disabled = false;
    nextBtn.classList.toggle('pending-move', !hasAttemptedMoveOnCurrentPuzzle);
}

function renderAllPositions(currentId) {
    const blunders = getBlunders().slice(0, getPositionLimit());
    if (blunders.length === 0) {
        positionsContentEl.innerText = 'No positions loaded';
        return;
    }

    // Calculate weights and total for probability display
    const weights = blunders.map((p) => {
        if (!isPuzzleActive(p)) return 0;
        return (Number(p.failures || 0) + 1) / (Number(p.attempts || 0) + 1);
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    const rows = blunders.map((p, idx) => {
        const attempts = Number(p.attempts || 0);
        const failures = Number(p.failures || 0);
        const correct = Math.max(0, attempts - failures);
        const accuracy = attempts > 0 ? `${Math.round((correct / attempts) * 100)}%` : '-';
        const probability = totalWeight > 0 ? Math.round((weights[idx] / totalWeight) * 100) : 0;
        const state = normalizePuzzleState(p);
        const stateLabel = getPuzzleStateLabel(state);
        const stateTitle = getPuzzleStateTooltip(state);
        const activeClass = currentId === p.id ? ' active' : '';
        const disabledClass = !isPuzzleActive(p) ? ' disabled' : '';
        const unvettedClass = state === PUZZLE_STATES.UNVETTED ? ' unvetted' : '';
        return `<div class="position-row${activeClass}${disabledClass}${unvettedClass}" data-puzzle-id="${p.id}"><div class="position-toggle"><button class="position-state-toggle" type="button" data-puzzle-id="${p.id}" data-puzzle-state="${state}" title="${stateTitle}" aria-label="${stateTitle}">${stateLabel}</button><span class="position-row-text">${p.id}: ${correct} / ${attempts} ${accuracy} [${probability}%]</span></div></div>`;
    }).join('');
    positionsContentEl.innerHTML = rows;
}

function loadPuzzleById(puzzleId) {
    if (!puzzleId) return;
    const blunders = getBlunders().slice(0, getPositionLimit());
    const puzzle = blunders.find((p) => p.id === puzzleId);
    if (!puzzle) return;

    currentPuzzle = puzzle;
    hasAttemptedMoveOnCurrentPuzzle = false;
    clearCurrentMoveHighlight();
    updateNextPuzzleButtonAppearance();

    chess.load(currentPuzzle.fen);
    board.setAttribute('position', currentPuzzle.fen);
    board.setAttribute('orientation', currentPuzzle.color);
    setBoardLastMoveHighlight(currentPuzzle.previousMoveFrom, currentPuzzle.previousMoveTo);
    renderCurrentPositionInfo(currentPuzzle);
    renderDebugInfo(currentPuzzle);

    const playerToMove = currentPuzzle.color === 'white' ? 'White' : 'Black';
    const metadata = `${currentPuzzle.gameFormat} (${currentPuzzle.gameDate}) | ${currentPuzzle.whitePlayer} vs ${currentPuzzle.blackPlayer}`;
    const lichessUrl = getPuzzleLichessUrl(currentPuzzle);

    setStatusTone('neutral');
    statusMsg.innerHTML = '';
    const turnDiv = document.createElement('div');
    turnDiv.innerText = `${playerToMove} to move`;
    statusMsg.append(turnDiv);

    metadataDisplay.innerHTML = '';
    const link = document.createElement('a');
    link.href = lichessUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.innerText = metadata;
    metadataDisplay.append(link);
}

function renderCurrentPositionInfo(puzzle) {
    if (!puzzle) {
        renderAllPositions(null);
        return;
    }
    renderAllPositions(puzzle.id);
}

function setBoardLastMoveHighlight(fromSquare, toSquare) {
    const squares = [normalizeSquare(fromSquare), normalizeSquare(toSquare)].filter(Boolean);
    previousMoveHighlightSquares = squares;
    renderBoardHighlights();
}

// Initialize app
window.onload = () => {
    initDOMReferences();
    attachEventListeners();

    if (maxPositionsInput) {
        maxPositionsInput.value = String(getPositionLimit());
    }
    
    const limited = setBlunders(getBlunders());
    if (limited.length === 0) {
        localStorage.removeItem('blunders');
    }
    const storedUsername = localStorage.getItem('username');
    if (storedUsername) {
        document.getElementById('username').value = storedUsername;
    }
    updateStats();
    if (limited.length > 0) {
        loadNextPuzzle();
    } else {
        setStatusTone('neutral');
        statusMsg.innerText = "Enter username to start";
        renderCurrentPositionInfo(null);
        renderDebugInfo(null);
    }
};

/* Event listeners initialized in window.onload */

function extractBlunders(game, username, storage, existingIds) {
    const whiteName = game?.players?.white?.user?.name?.toLowerCase?.();
    const blackName = game?.players?.black?.user?.name?.toLowerCase?.();
    const userLower = username.toLowerCase();

    if (whiteName !== userLower && blackName !== userLower) {
        return;
    }

    const isWhite = whiteName === userLower;
    const tempGame = new Chess();
    const moveList = (game.moves || '').split(' ').filter(Boolean);
    const analysis = Array.isArray(game.analysis) ? game.analysis : [];
    const gameDate = game.createdAt ? new Date(game.createdAt).toLocaleDateString() : 'unknown';
    const gameFormat = game.speed || 'unknown';
    const whitePlayer = game?.players?.white?.user?.name || 'Unknown';
    const blackPlayer = game?.players?.black?.user?.name || 'Unknown';
    let previousMoveFrom = '';
    let previousMoveTo = '';
    
    analysis.forEach((moveEval, i) => {
        const turn = i % 2 === 0 ? 'white' : 'black';
        const isUserTurn = (isWhite && turn === 'white') || (!isWhite && turn === 'black');
        const move = moveList[i];

        if (!move) return;
        
        if (isUserTurn && moveEval.judgment?.name === "Blunder") {
            const id = `${game.id}-${i}`;
            if (!existingIds.has(id)) {
                storage.push({
                    id,
                    fen: tempGame.fen(),
                    bestMove: normalizeUci(moveEval.best),
                    color: turn,
                    previousMoveFrom,
                    previousMoveTo,
                    state: PUZZLE_STATES.UNVETTED,
                    attempts: 0,
                    failures: 0,
                    gameDate,
                    gameFormat,
                    whitePlayer,
                    blackPlayer
                });
                existingIds.add(id);
            }
        }

        const parsedMove = tempGame.move(move);
        previousMoveFrom = parsedMove?.from || '';
        previousMoveTo = parsedMove?.to || '';
    });
}

function selectWeightedPuzzle() {
    const puzzles = getBlunders().slice(0, getPositionLimit()).filter(isPuzzleActive);
    if (!puzzles.length) return null;

    // Weight formula: (Failures + 1) / (Total Attempts + 1)
    const weights = puzzles.map(p => (p.failures + 1) / (p.attempts + 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;

    for (let i = 0; i < puzzles.length; i++) {
        if (random < weights[i]) return puzzles[i];
        random -= weights[i];
    }
    return puzzles[0];
}

function loadNextPuzzle() {
    const nextPuzzle = selectWeightedPuzzle();
    if (!nextPuzzle) {
        currentPuzzle = null;
        hasAttemptedMoveOnCurrentPuzzle = false;
        clearCurrentMoveHighlight();
        updateNextPuzzleButtonAppearance();
        setBoardLastMoveHighlight(null, null);
        setStatusTone('neutral');
        statusMsg.innerText = "No puzzles loaded yet.";
        renderCurrentPositionInfo(null);
        renderDebugInfo(null);
        return;
    }

    loadPuzzleById(nextPuzzle.id);
}

function boardDropHandler(e) {
    if (!currentPuzzle) {
        setStatusTone('neutral');
        statusMsg.innerText = "Load a puzzle first.";
        return 'snapback';
    }

    const { source, target } = e.detail;
    if (source && target) {
        hasAttemptedMoveOnCurrentPuzzle = true;
        setCurrentMoveHighlight(source, target);
        updateNextPuzzleButtonAppearance();
    }
    const move = chess.move({ from: source, to: target, promotion: 'q' });

    if (!move) {
        setStatusTone('neutral');
        statusMsg.innerText = "Illegal move.";
        return 'snapback';
    }

    let blunders = getBlunders();
    let pIdx = blunders.findIndex(p => p.id === currentPuzzle.id);
    if (pIdx < 0) {
        setStatusTone('neutral');
        statusMsg.innerText = "Puzzle not found in storage.";
        return 'snapback';
    }

    const playedMove = normalizeUci(`${move.from}${move.to}${move.promotion || ''}`);

    if (playedMove === currentPuzzle.bestMove) {
        setStatusTone('correct');
        statusMsg.innerText = "Correct!";
        blunders[pIdx].attempts++;
        blunders = setBlunders(blunders);
    } else {
        setStatusTone('wrong');
        statusMsg.innerText = `Wrong. Correct is ${currentPuzzle.bestMove}`;
        blunders[pIdx].attempts++;
        blunders[pIdx].failures++;
        blunders = setBlunders(blunders);
        chess.undo();
        currentPuzzle = blunders[pIdx] || null;
        renderCurrentPositionInfo(currentPuzzle);
        renderDebugInfo(currentPuzzle);
        return 'snapback';
    }

    currentPuzzle = blunders[pIdx];
    renderCurrentPositionInfo(currentPuzzle);
    renderDebugInfo(currentPuzzle);
}

function updateStats() {
    const blunders = getBlunders().slice(0, getPositionLimit());
    const count = blunders.length;
    document.getElementById('puzzle-count').innerText = count;
    updateNextPuzzleButtonAppearance();
}

function attachEventListeners() {
    if (!nextBtn || !clearBtn || !debugToggleBtn || !fetchBtn || !maxPositionsInput) {
        console.warn('Some DOM elements not yet initialized');
        return;
    }

    maxPositionsInput.onchange = () => {
        const normalized = setPositionLimit(maxPositionsInput.value);
        maxPositionsInput.value = String(normalized);

        const trimmed = setBlunders(getBlunders());
        if (trimmed.length === 0) {
            localStorage.removeItem('blunders');
            currentPuzzle = null;
            hasAttemptedMoveOnCurrentPuzzle = false;
            setBoardLastMoveHighlight(null, null);
            clearCurrentMoveHighlight();
            setStatusTone('neutral');
            statusMsg.innerText = 'No puzzles loaded yet.';
        } else if (currentPuzzle && !trimmed.some((p) => p.id === currentPuzzle.id)) {
            loadPuzzleById(trimmed[0].id);
        }

        updateStats();
        renderCurrentPositionInfo(currentPuzzle);
        renderDebugInfo(currentPuzzle);
    };

    fetchBtn.onclick = async () => {
        const user = document.getElementById('username').value.trim();
        if (!user) return alert("Enter a username");
        localStorage.setItem('username', user);
        const selectedLimit = setPositionLimit(maxPositionsInput.value);
        maxPositionsInput.value = String(selectedLimit);
        
        setStatusTone('neutral');
        statusMsg.innerText = "Fetching and analyzing games...";
        try {
            const response = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=20&moves=true&evals=true&analysed=true`, {
                headers: { 'Accept': 'application/x-ndjson' }
            });

            if (!response.ok) {
                throw new Error(`Lichess API error: ${response.status}`);
            }
            if (!response.body) {
                throw new Error('No response stream available');
            }
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let blunders = getBlunders();
            const existingIds = new Set(blunders.map((p) => p.id));
            let remainder = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    remainder += decoder.decode();
                    const tail = remainder.trim();
                    if (tail) {
                        const gameData = JSON.parse(tail);
                        extractBlunders(gameData, user, blunders, existingIds);
                    }
                    break;
                }

                const chunk = remainder + decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                remainder = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    const gameData = JSON.parse(trimmed);
                    extractBlunders(gameData, user, blunders, existingIds);
                }
            }

            blunders = setBlunders(blunders);
            updateStats();
            renderCurrentPositionInfo(currentPuzzle);
            renderDebugInfo(currentPuzzle);
            setStatusTone('neutral');
            statusMsg.innerText = "Sync complete!";
        } catch (e) {
            console.error(e);
            setStatusTone('neutral');
            statusMsg.innerText = `Error: ${formatErrorMessage(e)}`;
        }
    };

    positionsContentEl.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        const toggle = target.closest('.position-state-toggle');
        if (toggle instanceof HTMLButtonElement) {
            const puzzleId = toggle.dataset.puzzleId;
            if (!puzzleId) return;

            const blunders = getBlunders();
            const puzzle = blunders.find((p) => p.id === puzzleId);
            if (!puzzle) return;

            const previousState = normalizePuzzleState(puzzle);
            puzzle.state = getNextPuzzleState(previousState);
            setBlunders(blunders);
            updateStats();

            renderCurrentPositionInfo(currentPuzzle);
            renderDebugInfo(currentPuzzle);
            return;
        }

        const row = target.closest('.position-row');
        if (!(row instanceof HTMLElement)) return;
        const puzzleId = row.dataset.puzzleId;
        if (!puzzleId) return;

        loadPuzzleById(puzzleId);
    });

    nextBtn.onclick = loadNextPuzzle;

    clearBtn.onclick = () => {
        localStorage.removeItem('blunders');
        currentPuzzle = null;
        hasAttemptedMoveOnCurrentPuzzle = false;
        setBoardLastMoveHighlight(null, null);
        updateStats();
        renderCurrentPositionInfo(null);
        renderDebugInfo(null);
        setStatusTone('neutral');
        statusMsg.innerText = "Local data cleared.";
    };

    debugToggleBtn.onclick = () => {
        debugPanel.classList.toggle('visible');
        const isVisible = debugPanel.classList.contains('visible');
        debugToggleBtn.innerText = isVisible ? 'Hide' : 'Show localStorage';
        debugToggleBtn.title = isVisible
            ? 'Hide debug details including localStorage contents'
            : 'Show debug details including localStorage contents';
    };

    // Attach board event listener
    board.addEventListener('drop', boardDropHandler);
}
