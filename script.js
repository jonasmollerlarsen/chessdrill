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
let targetDepthInput;
let singlePositionUrlInput;
let loadUrlBtn;

const storage = window.positionsStorage;
if (!storage) {
    throw new Error('positionsStorage is not available. Ensure storage.js is loaded before script.js.');
}

let currentPuzzle = null;
let hasAttemptedMoveOnCurrentPuzzle = false;
let feedbackRenderToken = 0;
// Extract module references
const board_module = window.boardModule;
const puzzleState_module = window.puzzleStateModule;
const format_module = window.formatModule;
const lichess_module = window.lichessModule;
const eval_module = window.evalModule;
const stockfishEngine_module = window.stockfishModule;

if (!board_module || !puzzleState_module || !format_module || !lichess_module || !eval_module || !stockfishEngine_module) {
    throw new Error('Module dependencies not loaded. Ensure board.js, puzzle-state.js, format.js, game.js, lichess.js, stockfish.js, and eval.js are loaded before script.js.');
}

// Make puzzle states and functions available
const APP_PUZZLE_STATES = puzzleState_module.PUZZLE_STATES;

// Initialize app.
window.onload = () => {
    initDOMReferences();
    attachEventListeners();

    maxPositionsInput.value = String(storage.getPositionLimit());
    targetDepthInput.value = String(stockfishEngine_module.getTargetDepth());

    const limited = setBlunders(getBlunders());
    if (limited.length === 0) {
        storage.removePositions();
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
    if (!nextBtn || !clearBtn || !exportBtn || !debugToggleBtn || !fetchBtn || !maxPositionsInput || !targetDepthInput || !singlePositionUrlInput || !loadUrlBtn) {
        throw new Error('Required DOM elements are not initialized');
    }

    maxPositionsInput.onchange = handleMaxPositionsChange;
    targetDepthInput.onchange = handleTargetDepthChange;
    fetchBtn.onclick = handleFetchPositions;
    loadUrlBtn.onclick = handleLoadSinglePositionFromUrl;
    positionsContentEl.addEventListener('click', handlePositionsListClick);
    statusMsg.addEventListener('click', handleStatusAreaClick);

    nextBtn.onclick = loadNextPuzzle;
    clearBtn.onclick = handleClearData;
    exportBtn.onclick = handleExportData;
    debugToggleBtn.onclick = handleDebugToggle;

    board_module.init("board", handleValidSelectedMove);
}

function handleTargetDepthChange() {
    if (!targetDepthInput) {
        throw new Error('target-depth element not found');
    }

    const nextDepth = stockfishEngine_module.setTargetDepth(targetDepthInput.value);
    targetDepthInput.value = String(nextDepth);

    // Stop any in-flight eval so subsequent evaluations use the new target depth.
    haltActiveEvaluation();
}

async function handleValidSelectedMove({ selectedMove }) {
    if (!currentPuzzle) {
        setStatusTone('neutral');
        statusMsg.innerText = 'Load a puzzle first.';
        return;
    }

    hasAttemptedMoveOnCurrentPuzzle = true;
    updateNextPuzzleButtonAppearance();

    let blunders = getBlunders();
    const pIdx = blunders.findIndex((p) => p.id === currentPuzzle.id);
    if (pIdx < 0) {
        setStatusTone('neutral');
        statusMsg.innerText = 'Puzzle not found in storage.';
        return;
    }

    const renderToken = ++feedbackRenderToken;
    const finalResult = await setMoveFeedbackStatus(selectedMove, currentPuzzle, renderToken);

    if (renderToken !== feedbackRenderToken) return;

    if (finalResult === null) {
        setStatusTone('neutral');
        statusMsg.innerText = 'Could not evaluate this position.';
        return;
    }

    const finalTone = finalResult.tone;
    blunders[pIdx].attempts++;
    if (finalTone === 'red') {
        blunders[pIdx].failures++;
    }
    blunders[pIdx].bestMove = finalResult.bestMove;
    blunders[pIdx].bestMoveScore = finalResult.bestMoveScore;
    blunders[pIdx].playedMoveScore = finalResult.playedMoveScore;
    blunders = setBlunders(blunders);

    setStatusTone(finalTone === 'red' ? 'wrong' : 'correct');
    currentPuzzle = blunders[pIdx];
    renderCurrentPositionInfo(currentPuzzle);
    renderDebugInfo(currentPuzzle);
    updateStatusAreaPuzzleRow();
}

function setFeedbackAnswerTone(tone) {
    const answerLine = statusMsg.querySelector('.status-answer-line');
    if (!answerLine) return;

    if (tone === 'correct' || tone === 'green') answerLine.style.color = '#8ee49a';
    if (tone === 'warning' || tone === 'yellow') answerLine.style.color = '#ffd966';
    if (tone === 'wrong' || tone === 'red') answerLine.style.color = '#ff8f8f';
    if (tone === 'neutral') answerLine.style.color = '#f3f8ff';
}

// Handle clicks in the status area for state toggles.
function handleStatusAreaClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (handleDeleteButtonClick(target)) {
        return;
    }

    const toggle = target.closest('.position-state-toggle');
    if (toggle instanceof HTMLButtonElement) {
        const puzzleId = toggle.dataset.puzzleId;
        if (!puzzleId) return;

        const blunders = getBlunders();
        const puzzle = blunders.find((p) => p.id === puzzleId);
        if (!puzzle) return;

        const previousState = puzzleState_module.normalizePuzzleState(puzzle);
        puzzle.state = puzzleState_module.getNextPuzzleState(previousState);
        const updated = setBlunders(blunders);
        if (currentPuzzle && currentPuzzle.id === puzzleId) {
            currentPuzzle = updated.find((p) => p.id === puzzleId);
        }
        refreshPuzzleUi();
        return;
    }
}

// Delete a puzzle by id and refresh UI and selection state.
function deletePuzzleById(puzzleId) {
    const blunders = getBlunders();
    const puzzleIndex = blunders.findIndex((p) => p.id === puzzleId);
    if (puzzleIndex < 0) return;

    const deletingCurrentPuzzle = Boolean(currentPuzzle && currentPuzzle.id === puzzleId);
    blunders.splice(puzzleIndex, 1);
    const updated = setBlunders(blunders);

    if (updated.length === 0) {
        haltActiveEvaluation();
        currentPuzzle = null;
        hasAttemptedMoveOnCurrentPuzzle = false;
        board_module.reset();
        board_module.setBoardLastMoveHighlight(null, null);
        board_module.clearCurrentMoveHighlight();
        refreshPuzzleUi();
        metadataDisplay.innerHTML = '';
        setStatusTone('neutral');
        statusMsg.innerText = 'No puzzles loaded yet.';
        return;
    }

    if (deletingCurrentPuzzle) {
        const replacementIndex = Math.min(puzzleIndex, updated.length - 1);
        loadPuzzleById(updated[replacementIndex].id);
        return;
    }

    refreshPuzzleUi();
}

// Handle delete button clicks for puzzle rows.
function handleDeleteButtonClick(target) {
    const deleteButton = target.closest('.position-delete-btn');
    if (!(deleteButton instanceof HTMLButtonElement)) return false;

    const puzzleId = deleteButton.dataset.puzzleId;
    if (!puzzleId) return true;

    deletePuzzleById(puzzleId);
    return true;
}

// Handle max position changes and trim local puzzle storage.
function handleMaxPositionsChange() {
    const normalized = storage.setPositionLimit(maxPositionsInput.value);
    maxPositionsInput.value = String(normalized);

    const trimmed = setBlunders(getBlunders());
    if (trimmed.length === 0) {
        storage.removePositions();
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
            const extracted = gameData.extractBlunders(
                user,
                existingIds,
                format_module.normalizeUci,
                APP_PUZZLE_STATES.UNVETTED
            );
            blunders.push(...extracted);
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

// Fetch a single position from Lichess and add it to storage.
async function handleLoadSinglePositionFromUrl() {
    const urlValue = singlePositionUrlInput.value.trim();
    if (!urlValue) {
        throw new Error('Lichess URL is required to load a single position');
    }

    const parsed = lichess_module.parseSinglePositionUrl(urlValue);
    setStatusTone('neutral');
    statusMsg.innerText = 'Fetching position from Lichess...';

    try {
        const puzzleId = `${parsed.gameId}-${parsed.ply - 1}`;
        const existing = getBlunders();
        
        if (existing.some((p) => p.id === puzzleId)) {
            setStatusTone('neutral');
            statusMsg.innerText = 'Position already in storage.';
            return;
        }

        const gameData = await lichess_module.fetchSingleGameFromLichess(parsed.gameId);
        const position = gameData.extractSinglePosition(
            parsed.ply,
            format_module.normalizeUci,
            APP_PUZZLE_STATES.UNVETTED
        );
        const updatedBlunders = getBlunders();
        updatedBlunders.push(position);
        setBlunders(updatedBlunders);

        setStatusTone('neutral');
        statusMsg.innerText = `Position imported: ${position.whitePlayer} vs ${position.blackPlayer}`;
        displayPositionMetadataLink(position, parsed.canonicalUrl);
        refreshPuzzleUi();
        loadPuzzleById(puzzleId);
        singlePositionUrlInput.value = '';
    } catch (e) {
        console.error(e);
        setStatusTone('neutral');
        statusMsg.innerText = `Error: ${format_module.formatErrorMessage(e)}`;
    }
}

// Display game metadata link in metadata area.
function displayPositionMetadataLink(position, canonicalUrl) {
    metadataDisplay.innerHTML = '';
    const link = document.createElement('a');
    link.href = canonicalUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.innerText = `View on Lichess: ${position.gameFormat} (${position.gameDate})`;
    metadataDisplay.append(link);
}

// Handle clicks in the position list for state toggles and row selection.
function handlePositionsListClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (handleDeleteButtonClick(target)) {
        return;
    }

    const toggle = target.closest('.position-state-toggle');
    if (toggle instanceof HTMLButtonElement) {
        const puzzleId = toggle.dataset.puzzleId;
        if (!puzzleId) return;

        const blunders = getBlunders();
        const puzzle = blunders.find((p) => p.id === puzzleId);
        if (!puzzle) return;

        const previousState = puzzleState_module.normalizePuzzleState(puzzle);
        puzzle.state = puzzleState_module.getNextPuzzleState(previousState);
        const updated = setBlunders(blunders);
        if (currentPuzzle && currentPuzzle.id === puzzleId) {
            currentPuzzle = updated.find((p) => p.id === puzzleId);
        }
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
    storage.removePositions();
    currentPuzzle = null;
    hasAttemptedMoveOnCurrentPuzzle = false;
    board_module.reset();
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
        p.state,
        p.attempts,
        p.failures
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
    haltActiveEvaluation();

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

// Display puzzle info in the status area.
function displayPuzzleInfoInStatus(puzzle) {
    const puzzleRowDiv = document.createElement('div');
    puzzleRowDiv.innerHTML = buildPuzzleRow(puzzle, true, 0);
    const puzzleRow = puzzleRowDiv.firstElementChild;
    statusMsg.append(puzzleRow);
}

// Load a puzzle by id and refresh board and metadata displays.
function loadPuzzleById(puzzleId) {
    haltActiveEvaluation();

    if (!puzzleId) return;
    const blunders = getBlunders().slice(0, storage.getPositionLimit());
    const puzzle = blunders.find((p) => p.id === puzzleId);
    if (!puzzle) return;

    currentPuzzle = puzzle;
    hasAttemptedMoveOnCurrentPuzzle = false;
    board_module.clearCurrentMoveHighlight();
    updateNextPuzzleButtonAppearance();

    board_module.initializePuzzlePosition(currentPuzzle.fen, currentPuzzle.color);
    board_module.setBoardLastMoveHighlight(currentPuzzle.previousMoveFrom, currentPuzzle.previousMoveTo);
    renderCurrentPositionInfo(currentPuzzle);
    renderDebugInfo(currentPuzzle);

    const playerToMove = currentPuzzle.color === 'white' ? 'White' : 'Black';
    const metadata = `${currentPuzzle.gameFormat} (${currentPuzzle.gameDate}) | ${currentPuzzle.whitePlayer} vs ${currentPuzzle.blackPlayer}`;
    const lichessUrl = lichess_module.getPuzzleLichessUrl(currentPuzzle);

    setStatusTone('neutral');
    statusMsg.innerHTML = '';
    displayPuzzleInfoInStatus(currentPuzzle);
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

function haltActiveEvaluation() {
    feedbackRenderToken++;
    stockfishEngine_module.terminateEngine();
}

// Returns the final tone ('green', 'yellow', 'red') once evaluation completes, or null if stale/failed.
async function setMoveFeedbackStatus(selectedMove, puzzle, renderToken = 0) {
    statusMsg.innerHTML = '';
    displayPuzzleInfoInStatus(puzzle);

    const puzzleRow = statusMsg.querySelector('.position-row');
    if (puzzleRow) {
        puzzleRow.classList.add('is-pending');
    }

    const createStatusEvalRow = (rowClass, labelText, moveText) => {
        const line = document.createElement('div');
        line.className = `${rowClass} status-eval-row`;
        line.style.color = '#f3f8ff';

        const label = document.createElement('span');
        label.className = 'status-eval-label';
        label.innerText = labelText;

        const move = document.createElement('span');
        move.className = 'status-eval-move';
        move.innerText = moveText;

        const evalValue = document.createElement('span');
        evalValue.className = 'status-eval-value is-pending';
        evalValue.innerText = '(evaluating...)';

        line.append(label, move, evalValue);
        statusMsg.append(line);
        return { line, move, evalValue };
    };

    const answerRow = createStatusEvalRow('status-answer-line', 'Answer', selectedMove);
    const bestRow = createStatusEvalRow('status-detail-line', 'Best', '...');
    bestRow.move.classList.add('is-pending');
    const playedRow = createStatusEvalRow('status-detail-line', 'Game', puzzle.playedMove);

    const answerLine = answerRow.line;
    const answerEvalText = answerRow.evalValue;
    const bestMoveText = bestRow.move;
    const bestEvalText = bestRow.evalValue;
    const playedEvalText = playedRow.evalValue;

    const isStale = () => renderToken !== feedbackRenderToken;
    let latestAnswerScore = null;
    let latestBestScore = null;
    let latestPlayedMoveScore = null;

    const updateAnswerTone = () => {
        if (isStale()) return;
        if (!latestAnswerScore || !latestBestScore) return;
        setFeedbackAnswerTone(getAnswerToneFromScoreDifference(latestAnswerScore, latestBestScore));
    };

    const selectedTargetDepth = stockfishEngine_module.getTargetDepth();
    const hasDepthAtLeastTarget = (score) => {
        if (!score || typeof score !== 'object') return false;
        if (score.depth == null) return false;
        return Number(score.depth) >= selectedTargetDepth;
    };

    // Determine which evals are already cached
    const answerScoreCached = 
        (selectedMove === puzzle.bestMove && hasDepthAtLeastTarget(puzzle.bestMoveScore)) ||
        (selectedMove === puzzle.playedMove && hasDepthAtLeastTarget(puzzle.playedMoveScore));
    const bestMoveCached = Boolean(puzzle.bestMove && hasDepthAtLeastTarget(puzzle.bestMoveScore));
    const playedMoveCached = hasDepthAtLeastTarget(puzzle.playedMoveScore);

    // Build evaluation promises, skipping cached moves
    const [answerEval, bestResult, playedEval] = await Promise.all([
        // Answer eval: use cache if this move was already evaluated
        (async () => {
            if (answerScoreCached) {
                latestAnswerScore = selectedMove === puzzle.bestMove ? puzzle.bestMoveScore : puzzle.playedMoveScore;
                if (!isStale()) {
                    answerEvalText.classList.remove('is-pending');
                    answerEvalText.innerText = `(${formatEvaluationScore(latestAnswerScore)})`;
                    updateAnswerTone();
                }
                return formatEvaluationScore(latestAnswerScore);
            }
            try {
                const score = await eval_module.evaluateMoveFromFenStream(
                    puzzle.fen,
                    selectedMove,
                    (updatedScore) => {
                        latestAnswerScore = updatedScore;
                        if (isStale()) return;
                        answerEvalText.innerText = `(${formatEvaluationScore(updatedScore)})`;
                        updateAnswerTone();
                    }
                );
                latestAnswerScore = score;
                updateAnswerTone();
                return formatEvaluationScore(score);
            } catch (_) {
                return 'n/a';
            }
        })(),
        // Best move eval: use cache if available
        (async () => {
            if (bestMoveCached) {
                latestBestScore = puzzle.bestMoveScore;
                if (!isStale()) {
                    bestMoveText.innerText = puzzle.bestMove;
                    bestMoveText.classList.remove('is-pending');
                    bestEvalText.classList.remove('is-pending');
                    bestEvalText.innerText = `(${formatEvaluationScore(latestBestScore)})`;
                    updateAnswerTone();
                }
                return { move: puzzle.bestMove, eval: `(${formatEvaluationScore(puzzle.bestMoveScore)})` };
            }
            try {
                const { bestMove, score } = await eval_module.findBestMoveWithEvalStream(
                    puzzle.fen,
                    (updated) => {
                        if (!updated.bestMove) return;
                        if (updated.score) {
                            latestBestScore = updated.score;
                        }
                        if (isStale()) return;
                        bestMoveText.innerText = updated.bestMove;
                        const bestScoreText = updated.score
                            ? formatEvaluationScore(updated.score)
                            : 'evaluating...';
                        bestEvalText.innerText = `(${bestScoreText})`;
                        if (updated.score) {
                            updateAnswerTone();
                        }
                    }
                );
                latestBestScore = score;
                updateAnswerTone();
                if (!bestMove) return { move: '??', eval: '(n/a)' };
                return { move: bestMove, eval: `(${formatEvaluationScore(score)})` };
            } catch (_) {
                return { move: '??', eval: '(n/a)' };
            }
        })(),
        // Played move eval: use cache if available
        (async () => {
            if (playedMoveCached) {
                latestPlayedMoveScore = puzzle.playedMoveScore;
                if (!isStale()) {
                    playedEvalText.classList.remove('is-pending');
                    playedEvalText.innerText = `(${formatEvaluationScore(latestPlayedMoveScore)})`;
                }
                return formatEvaluationScore(puzzle.playedMoveScore);
            }
            try {
                const score = await eval_module.evaluateMoveFromFenStream(
                    puzzle.fen,
                    puzzle.playedMove,
                    (updatedScore) => {
                        if (isStale()) return;
                        playedEvalText.innerText = `(${formatEvaluationScore(updatedScore)})`;
                    }
                );
                latestPlayedMoveScore = score;
                return formatEvaluationScore(score);
            } catch (_) {
                return 'n/a';
            }
        })(),
    ]);

    if (isStale()) {
        return null;
    }

    if (puzzleRow) {
        puzzleRow.classList.remove('is-pending');
    }

    answerEvalText.classList.remove('is-pending');
    bestEvalText.classList.remove('is-pending');
    bestMoveText.classList.remove('is-pending');
    playedEvalText.classList.remove('is-pending');
    answerEvalText.innerText = `(${answerEval})`;
    bestMoveText.innerText = bestResult.move;
    bestEvalText.innerText = bestResult.eval;
    playedEvalText.innerText = `(${playedEval})`;
    updateAnswerTone();

    if (!latestAnswerScore || !latestBestScore) return null;
    return {
        tone: getAnswerToneFromScoreDifference(latestAnswerScore, latestBestScore),
        bestMove: bestResult.move !== '??' ? bestResult.move : null,
        bestMoveScore: latestBestScore,
        playedMoveScore: latestPlayedMoveScore,
    };
}

function getAnswerToneFromScoreDifference(answerScore, bestScore) {
    const difference = Math.abs(scoreToPawns(answerScore) - scoreToPawns(bestScore));
    if (difference > 2) return 'red';
    if (difference > 1) return 'yellow';
    return 'green';
}

function scoreToPawns(score) {
    if (!score || typeof score !== 'object') {
        throw new Error(`Invalid evaluation score: ${score}`);
    }

    if (score.mate !== undefined) {
        const mate = Number(score.mate);
        if (!Number.isFinite(mate)) {
            throw new Error(`Invalid mate evaluation score: ${score.mate}`);
        }
        const sign = mate > 0 ? 1 : -1;
        return sign * (1000 - Math.abs(mate));
    }

    const cp = Number(score.cp);
    if (!Number.isFinite(cp)) {
        throw new Error(`Invalid centipawn evaluation score: ${score.cp}`);
    }

    return cp / 100;
}

async function getMoveEvaluationText(fen, uciMove, onUpdate) {
    try {
        const score = await eval_module.evaluateMoveFromFenStream(
            fen,
            uciMove,
            onUpdate ? (updatedScore) => onUpdate(formatEvaluationScore(updatedScore)) : undefined
        );
        return formatEvaluationScore(score);
    } catch (_) {
        return 'n/a';
    }
}

async function getBestMoveText(fen, onUpdate) {
    try {
        const { bestMove, score } = await eval_module.findBestMoveWithEvalStream(
            fen,
            onUpdate
                ? (updated) => {
                    if (!updated.bestMove) return;
                    onUpdate(`${updated.bestMove} (${formatEvaluationScore(updated.score)})`);
                }
                : undefined
        );
        if (!bestMove) return '??';
        return `${bestMove} (${formatEvaluationScore(score)})`;
    } catch (_) {
        return '??';
    }
}

function formatEvaluationScore(score) {
    if (!score || typeof score !== 'object') {
        throw new Error(`Invalid evaluation score: ${score}`);
    }

    const depthSuffix = score.depth != null ? ` depth ${score.depth}` : '';

    if (score.mate !== undefined) {
        const mate = Number(score.mate);
        if (!Number.isFinite(mate)) {
            throw new Error(`Invalid mate evaluation score: ${score.mate}`);
        }
        if (mate > 0) return `M${mate}${depthSuffix}`;
        return `-M${Math.abs(mate)}${depthSuffix}`;
    }

    const cp = Number(score.cp);
    if (!Number.isFinite(cp)) {
        throw new Error(`Invalid centipawn evaluation score: ${score.cp}`);
    }

    const pawns = cp / 100;
    const sign = pawns > 0 ? '+' : '';
    return `${sign}${pawns.toFixed(1)}${depthSuffix}`;
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

// Update puzzle row in status area if displayed.
function updateStatusAreaPuzzleRow() {
    if (!currentPuzzle) return;
    const existingRow = statusMsg.querySelector('.position-row');
    if (!existingRow) return;
    
    const newRowDiv = document.createElement('div');
    newRowDiv.innerHTML = buildPuzzleRow(currentPuzzle, true, 0);
    const newRow = newRowDiv.firstElementChild;
    existingRow.replaceWith(newRow);
}

// Refresh all UI regions dependent on current puzzle/storage state.
function refreshPuzzleUi() {
    updateStats();
    renderCurrentPositionInfo(currentPuzzle);
    renderDebugInfo(currentPuzzle);
    updateStatusAreaPuzzleRow();
}

// Render the puzzle list with the current selection highlighted.
function renderCurrentPositionInfo(puzzle) {
    if (!puzzle) {
        renderAllPositions(null);
        return;
    }
    renderAllPositions(puzzle.id);
}

// Build a single puzzle row HTML element.
function buildPuzzleRow(puzzle, isCurrent, probability) {
    const attempts = puzzle.attempts;
    const failures = puzzle.failures;
    const correct = Math.max(0, attempts - failures);
    const accuracy = attempts > 0 ? `${Math.round((correct / attempts) * 100)}%` : '-';
    const state = puzzleState_module.normalizePuzzleState(puzzle);
    const stateLabel = puzzleState_module.getPuzzleStateLabel(state);
    const stateTitle = puzzleState_module.getPuzzleStateTooltip(state);
    const activeClass = isCurrent ? ' active' : '';
    const disabledClass = !puzzleState_module.isPuzzleActive(puzzle) ? ' disabled' : '';
    const unvettedClass = state === APP_PUZZLE_STATES.UNVETTED ? ' unvetted' : '';
    const probabilityText = probability > 0 ? ` [${probability}%]` : '';
    return `<div class="position-row${activeClass}${disabledClass}${unvettedClass}" data-puzzle-id="${puzzle.id}"><div class="position-toggle"><button class="position-state-toggle" type="button" data-puzzle-id="${puzzle.id}" data-puzzle-state="${state}" title="${stateTitle}" aria-label="${stateTitle}">${stateLabel}</button><span class="position-row-text">${puzzle.gameDate} | ${puzzle.id}: ${correct} / ${attempts} ${accuracy}${probabilityText}</span><button class="position-delete-btn" type="button" data-puzzle-id="${puzzle.id}" title="Delete puzzle from local storage" aria-label="Delete puzzle from local storage">&#128465;</button></div></div>`;
}

// Render puzzle rows with performance and probability metadata.
function renderAllPositions(currentId) {
    const blunders = getBlunders().slice(0, storage.getPositionLimit());
    if (blunders.length === 0) {
        positionsContentEl.innerText = 'No positions loaded';
        return;
    }

    blunders.sort((a, b) => b.gameTimestamp - a.gameTimestamp);

    const weights = blunders.map((p) => {
        if (!puzzleState_module.isPuzzleActive(p)) return 0;
        return (p.failures + 1) / (p.attempts + 1);
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    const rows = blunders.map((p, idx) => {
        const probability = totalWeight > 0 ? Math.round((weights[idx] / totalWeight) * 100) : 0;
        return buildPuzzleRow(p, currentId === p.id, probability);
    }).join('');
    positionsContentEl.innerHTML = rows;
}

// Render debug details for the selected puzzle.
function renderDebugInfo(puzzle) {
    debugCorrectMoveEl.innerText = '-';
    renderLocalStorageFullness();
    const raw = storage.getItem('positions');
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
    const parsed = storage.getRawPositions();
    return parsed.map(normalizePuzzleEntry);
}

// Persist normalized blunders constrained by current position limit.
function setBlunders(blunders) {
    const trimmed = blunders.slice(0, storage.getPositionLimit()).map(normalizePuzzleEntry);
    storage.setRawPositions(trimmed);
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
//    board = document.getElementById('board');
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
    targetDepthInput = document.getElementById('target-depth');
    singlePositionUrlInput = document.getElementById('single-position-url');
    loadUrlBtn = document.getElementById('load-url-btn');
//    board_module.ensureBoardHighlightStyles();
}
