// DOM references - initialized on page load
let board;
let statusMsg;
let nextBtn;
let fetchBtn;
let exportBtn;
let clearBtn;
let debugToggleBtn;
let debugPanel;
let debugCorrectMoveEl;
let localstorageFullnessEl;
let localstorageStateEl;
let positionsContentEl;
let metadataDisplay;
let maxPositionsInput;

const storage = window.blunderStorage;
if (!storage) {
    throw new Error('blunderStorage is not available. Ensure storage.js is loaded before script.js.');
}

let chess = new Chess();
let currentPuzzle = null;
let hasAttemptedMoveOnCurrentPuzzle = false;
// Extract module references
const board_module = window.boardModule;
const puzzleState_module = window.puzzleStateModule;
const format_module = window.formatModule;
const lichess_module = window.lichessModule;

if (!board_module || !puzzleState_module || !format_module || !lichess_module) {
    throw new Error('Module dependencies not loaded. Ensure board.js, puzzle-state.js, format.js, and lichess.js are loaded before script.js.');
}

// Make puzzle states and functions available
const APP_PUZZLE_STATES = puzzleState_module.PUZZLE_STATES;

// Initialize app.
window.onload = () => {
    initDOMReferences();
    attachEventListeners();

    if (maxPositionsInput) {
        maxPositionsInput.value = String(storage.getPositionLimit());
    }

    const limited = setBlunders(getBlunders());
    if (limited.length === 0) {
        storage.removeBlunders();
    }

    const storedUsername = storage.getUsername();
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

// Attach UI events to focused handlers.
function attachEventListeners() {
    if (!nextBtn || !clearBtn || !exportBtn || !debugToggleBtn || !fetchBtn || !maxPositionsInput) {
        throw new Error('Required DOM elements are not initialized');
    }

    maxPositionsInput.onchange = handleMaxPositionsChange;
    fetchBtn.onclick = handleFetchPositions;
    positionsContentEl.addEventListener('click', handlePositionsListClick);

    nextBtn.onclick = loadNextPuzzle;
    clearBtn.onclick = handleClearData;
    exportBtn.onclick = handleExportData;
    debugToggleBtn.onclick = handleDebugToggle;

    board.addEventListener('drop', boardSelectedMoveHandler);
}

// Handle max position changes and trim local puzzle storage.
function handleMaxPositionsChange() {
    const normalized = storage.setPositionLimit(maxPositionsInput.value);
    maxPositionsInput.value = String(normalized);

    const trimmed = setBlunders(getBlunders());
    if (trimmed.length === 0) {
        storage.removeBlunders();
        currentPuzzle = null;
        hasAttemptedMoveOnCurrentPuzzle = false;
        board_module.setBoardLastMoveHighlight(null, null);
        board_module.clearCurrentMoveHighlight();
        setStatusTone('neutral');
        statusMsg.innerText = 'No puzzles loaded yet.';
    } else if (currentPuzzle && !trimmed.some((p) => p.id === currentPuzzle.id)) {
        loadPuzzleById(trimmed[0].id);
    }

    refreshPuzzleUi();
}

// Fetch games from Lichess and merge extracted blunders into storage.
async function handleFetchPositions() {
    const user = document.getElementById('username').value.trim();
    if (!user) return alert("Enter a username");

    storage.setUsername(user);
    const selectedLimit = storage.setPositionLimit(maxPositionsInput.value);
    maxPositionsInput.value = String(selectedLimit);

    setStatusTone('neutral');
    statusMsg.innerText = "Fetching and analyzing games...";
    try {
        let blunders = getBlunders();
        const existingIds = new Set(blunders.map((p) => p.id));

        await lichess_module.fetchGamesFromLichess(user, (gameData) => {
            extractBlunders(gameData, user, blunders, existingIds);
        });

        blunders = setBlunders(blunders);
        refreshPuzzleUi();
        setStatusTone('neutral');
        statusMsg.innerText = "Sync complete!";
    } catch (e) {
        console.error(e);
        setStatusTone('neutral');
        statusMsg.innerText = `Error: ${format_module.formatErrorMessage(e)}`;
    }
}

// Handle clicks in the position list for state toggles and row selection.
function handlePositionsListClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const toggle = target.closest('.position-state-toggle');
    if (toggle instanceof HTMLButtonElement) {
        const puzzleId = toggle.dataset.puzzleId;
        if (!puzzleId) return;

        const blunders = getBlunders();
        const puzzle = blunders.find((p) => p.id === puzzleId);
        if (!puzzle) return;

        const previousState = puzzleState_module.normalizePuzzleState(puzzle);
        puzzle.state = puzzleState_module.getNextPuzzleState(previousState);
        setBlunders(blunders);
        refreshPuzzleUi();
        return;
    }

    const row = target.closest('.position-row');
    if (!(row instanceof HTMLElement)) return;
    const puzzleId = row.dataset.puzzleId;
    if (!puzzleId) return;

    loadPuzzleById(puzzleId);
}

// Clear local puzzle data and reset current puzzle UI.
function handleClearData() {
    storage.removeBlunders();
    currentPuzzle = null;
    hasAttemptedMoveOnCurrentPuzzle = false;
    board_module.setBoardLastMoveHighlight(null, null);
    refreshPuzzleUi();
    setStatusTone('neutral');
    statusMsg.innerText = "Local data cleared.";
}

// Export puzzle performance data to CSV.
function handleExportData() {
    const blunders = getBlunders();
    if (blunders.length === 0) {
        alert('No puzzle data to export');
        return;
    }

    const headers = ['ID', 'State', 'Attempts', 'Failures'];
    const rows = blunders.map((p) => [
        `"${p.id}"`,
        p.state || 'unvetted',
        Number(p.attempts || 0),
        Number(p.failures || 0)
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `blunder-driller-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setStatusTone('neutral');
    statusMsg.innerText = `Exported ${blunders.length} puzzle(s)`;
}

// Toggle debug panel visibility and update control labels.
function handleDebugToggle() {
    debugPanel.classList.toggle('visible');
    const isVisible = debugPanel.classList.contains('visible');
    debugToggleBtn.innerText = isVisible ? 'Hide' : 'Show localStorage';
    debugToggleBtn.title = isVisible
        ? 'Hide debug details including localStorage contents'
        : 'Show debug details including localStorage contents';
}

// Load the next weighted puzzle or reset the board if no puzzles are available.
function loadNextPuzzle() {
    const nextPuzzle = selectWeightedPuzzle();
    if (!nextPuzzle) {
        currentPuzzle = null;
        hasAttemptedMoveOnCurrentPuzzle = false;
        board_module.clearCurrentMoveHighlight();
        updateNextPuzzleButtonAppearance();
        board_module.setBoardLastMoveHighlight(null, null);
        setStatusTone('neutral');
        statusMsg.innerText = "No puzzles loaded yet.";
        renderCurrentPositionInfo(null);
        renderDebugInfo(null);
        return;
    }

    loadPuzzleById(nextPuzzle.id);
}

// Load a puzzle by id and refresh board and metadata displays.
function loadPuzzleById(puzzleId) {
    if (!puzzleId) return;
    const blunders = getBlunders().slice(0, storage.getPositionLimit());
    const puzzle = blunders.find((p) => p.id === puzzleId);
    if (!puzzle) return;

    currentPuzzle = puzzle;
    hasAttemptedMoveOnCurrentPuzzle = false;
    board_module.clearCurrentMoveHighlight();
    updateNextPuzzleButtonAppearance();

    chess.load(currentPuzzle.fen);
    board.setAttribute('position', currentPuzzle.fen);
    board.setAttribute('orientation', currentPuzzle.color);
    board_module.setBoardLastMoveHighlight(currentPuzzle.previousMoveFrom, currentPuzzle.previousMoveTo);
    renderCurrentPositionInfo(currentPuzzle);
    renderDebugInfo(currentPuzzle);

    const playerToMove = currentPuzzle.color === 'white' ? 'White' : 'Black';
    const metadata = `${currentPuzzle.gameFormat} (${currentPuzzle.gameDate}) | ${currentPuzzle.whitePlayer} vs ${currentPuzzle.blackPlayer}`;
    const lichessUrl = lichess_module.getPuzzleLichessUrl(currentPuzzle);

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

// Validate and score a selected move against the current puzzle.
function boardSelectedMoveHandler(e) {
    if (!currentPuzzle) {
        setStatusTone('neutral');
        statusMsg.innerText = "Load a puzzle first.";
        return 'snapback';
    }

    const { source, target } = e.detail;
    if (source && target) {
        hasAttemptedMoveOnCurrentPuzzle = true;
        board_module.setCurrentMoveHighlight(source, target);
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

    const playedMove = format_module.normalizeUci(`${move.from}${move.to}${move.promotion || ''}`);

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

// Extract blunder positions from one analyzed Lichess game.
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
    const gameTimestamp = game.createdAt || 0;
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
                    bestMove: format_module.normalizeUci(moveEval.best),
                    color: turn,
                    previousMoveFrom,
                    previousMoveTo,
                    state: APP_PUZZLE_STATES.UNVETTED,
                    attempts: 0,
                    failures: 0,
                    gameTimestamp,
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

// Select a puzzle using weighted random sampling by mistake rate.
function selectWeightedPuzzle() {
    const puzzles = getBlunders().slice(0, storage.getPositionLimit()).filter(puzzleState_module.isPuzzleActive);
    if (!puzzles.length) return null;

    const weights = puzzles.map((p) => (p.failures + 1) / (p.attempts + 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;

    for (let i = 0; i < puzzles.length; i++) {
        if (random < weights[i]) return puzzles[i];
        random -= weights[i];
    }
    return puzzles[0];
}

// Refresh all UI regions dependent on current puzzle/storage state.
function refreshPuzzleUi() {
    updateStats();
    renderCurrentPositionInfo(currentPuzzle);
    renderDebugInfo(currentPuzzle);
}

// Render the puzzle list with the current selection highlighted.
function renderCurrentPositionInfo(puzzle) {
    if (!puzzle) {
        renderAllPositions(null);
        return;
    }
    renderAllPositions(puzzle.id);
}

// Render puzzle rows with performance and probability metadata.
function renderAllPositions(currentId) {
    const blunders = getBlunders().slice(0, storage.getPositionLimit());
    if (blunders.length === 0) {
        positionsContentEl.innerText = 'No positions loaded';
        return;
    }

    blunders.sort((a, b) => (Number(b.gameTimestamp || 0)) - (Number(a.gameTimestamp || 0)));

    const weights = blunders.map((p) => {
        if (!puzzleState_module.isPuzzleActive(p)) return 0;
        return (Number(p.failures || 0) + 1) / (Number(p.attempts || 0) + 1);
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    const rows = blunders.map((p, idx) => {
        const attempts = Number(p.attempts || 0);
        const failures = Number(p.failures || 0);
        const correct = Math.max(0, attempts - failures);
        const accuracy = attempts > 0 ? `${Math.round((correct / attempts) * 100)}%` : '-';
        const probability = totalWeight > 0 ? Math.round((weights[idx] / totalWeight) * 100) : 0;
        const state = puzzleState_module.normalizePuzzleState(p);
        const stateLabel = puzzleState_module.getPuzzleStateLabel(state);
        const stateTitle = puzzleState_module.getPuzzleStateTooltip(state);
        const activeClass = currentId === p.id ? ' active' : '';
        const disabledClass = !puzzleState_module.isPuzzleActive(p) ? ' disabled' : '';
        const unvettedClass = state === APP_PUZZLE_STATES.UNVETTED ? ' unvetted' : '';
        const dateDisplay = p.gameDate || '-';
        return `<div class="position-row${activeClass}${disabledClass}${unvettedClass}" data-puzzle-id="${p.id}"><div class="position-toggle"><button class="position-state-toggle" type="button" data-puzzle-id="${p.id}" data-puzzle-state="${state}" title="${stateTitle}" aria-label="${stateTitle}">${stateLabel}</button><span class="position-row-text">${dateDisplay} | ${p.id}: ${correct} / ${attempts} ${accuracy} [${probability}%]</span></div></div>`;
    }).join('');
    positionsContentEl.innerHTML = rows;
}

// Render debug details for the selected puzzle.
function renderDebugInfo(puzzle) {
    debugCorrectMoveEl.innerText = puzzle?.bestMove || '-';
    renderLocalStorageFullness();
    const raw = storage.getItem('blunders');
    localstorageStateEl.innerText = raw || '[]';
}

// Render estimated localStorage usage in the debug panel.
function renderLocalStorageFullness() {
    if (!localstorageFullnessEl) throw new Error('localstorage-fullness element not found');

    const usedBytes = storage.estimateUsageBytes();
    const quotaBytes = 5 * 1024 * 1024;
    const percent = Math.min(100, Math.round((usedBytes / quotaBytes) * 100));
    localstorageFullnessEl.innerText = `${format_module.formatBytes(usedBytes)} / ${format_module.formatBytes(quotaBytes)} (${percent}%)`;
}

// Update headline puzzle count stats.
function updateStats() {
    const blunders = getBlunders().slice(0, storage.getPositionLimit());
    const count = blunders.length;
    document.getElementById('puzzle-count').innerText = count;
    updateNextPuzzleButtonAppearance();
}

// Keep next puzzle button state synchronized with current attempt state.
function updateNextPuzzleButtonAppearance() {
    if (!nextBtn) throw new Error('next-btn element not found');
    nextBtn.disabled = false;
    nextBtn.classList.toggle('pending-move', !hasAttemptedMoveOnCurrentPuzzle);
}

// Update status banner tone for neutral/correct/wrong states.
function setStatusTone(tone = 'neutral') {
    if (!statusMsg) throw new Error('status-msg element not found');
    statusMsg.classList.remove('status-correct', 'status-wrong');
    if (tone === 'correct') statusMsg.classList.add('status-correct');
    if (tone === 'wrong') statusMsg.classList.add('status-wrong');
}

// Read and normalize persisted blunder records.
function getBlunders() {
    const parsed = storage.getRawBlunders();
    return parsed.map(normalizePuzzleEntry);
}

// Persist normalized blunders constrained by current position limit.
function setBlunders(blunders) {
    const trimmed = blunders.slice(0, storage.getPositionLimit()).map(normalizePuzzleEntry);
    storage.setRawBlunders(trimmed);
    return trimmed;
}

// Normalize puzzle records from storage to current schema.
function normalizePuzzleEntry(puzzle) {
    const state = puzzleState_module.normalizePuzzleState(puzzle);
    return {
        ...puzzle,
        state
    };
}

// Cache required DOM references and initialize board highlight styles.
function initDOMReferences() {
    board = document.getElementById('board');
    statusMsg = document.getElementById('status-msg');
    nextBtn = document.getElementById('next-btn');
    fetchBtn = document.getElementById('fetch-btn');
    exportBtn = document.getElementById('export-btn');
    clearBtn = document.getElementById('clear-btn');
    debugToggleBtn = document.getElementById('debug-toggle-btn');
    debugPanel = document.getElementById('debug-panel');
    debugCorrectMoveEl = document.getElementById('debug-correct-move');
    localstorageFullnessEl = document.getElementById('localstorage-fullness');
    localstorageStateEl = document.getElementById('localstorage-state');
    positionsContentEl = document.getElementById('positions-content');
    metadataDisplay = document.getElementById('metadata-display');
    maxPositionsInput = document.getElementById('max-positions');
    board_module.ensureBoardHighlightStyles();
}
