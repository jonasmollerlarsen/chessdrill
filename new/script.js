const board = document.getElementById('board');
const statusMsg = document.getElementById('status-msg');
const nextBtn = document.getElementById('next-btn');
const fetchBtn = document.getElementById('fetch-btn');
const clearBtn = document.getElementById('clear-btn');
const debugToggleBtn = document.getElementById('debug-toggle-btn');
const debugPanel = document.getElementById('debug-panel');
const debugCorrectMoveEl = document.getElementById('debug-correct-move');
const localstorageStateEl = document.getElementById('localstorage-state');
const positionsContentEl = document.getElementById('positions-content');

const DRILL_LIMIT = 3;

let chess = new Chess();
let currentPuzzle = null;

function normalizeUci(move) {
    return String(move || '').trim().toLowerCase().replace(/[^a-h1-8qrbn]/g, '');
}

function formatErrorMessage(error) {
    if (error instanceof Error && error.message) return error.message;
    return String(error || 'Unknown error');
}

function getBlunders() {
    return JSON.parse(localStorage.getItem('blunders') || '[]');
}

function setBlunders(blunders) {
    const trimmed = blunders.slice(0, DRILL_LIMIT);
    localStorage.setItem('blunders', JSON.stringify(trimmed));
    return trimmed;
}

function renderDebugInfo(puzzle) {
    debugCorrectMoveEl.innerText = puzzle?.bestMove || '-';
    const raw = localStorage.getItem('blunders');
    localstorageStateEl.innerText = raw || '[]';
}

function renderAllPositions(currentId) {
    const blunders = getBlunders().slice(0, DRILL_LIMIT);
    if (blunders.length === 0) {
        positionsContentEl.innerText = 'No positions loaded';
        return;
    }

    // Calculate weights and total for probability display
    const weights = blunders.map(p => (Number(p.failures || 0) + 1) / (Number(p.attempts || 0) + 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    const rows = blunders.map((p, idx) => {
        const attempts = Number(p.attempts || 0);
        const failures = Number(p.failures || 0);
        const correct = Math.max(0, attempts - failures);
        const accuracy = attempts > 0 ? `${Math.round((correct / attempts) * 100)}%` : '-';
        const probability = Math.round((weights[idx] / totalWeight) * 100);
        return `<div class="position-row${currentId === p.id ? ' active' : ''}">${p.id}: ${correct} / ${attempts} ${accuracy} [${probability}%]</div>`;
    }).join('');
    positionsContentEl.innerHTML = rows;
}

function renderCurrentPositionInfo(puzzle) {
    if (!puzzle) {
        renderAllPositions(null);
        return;
    }
    renderAllPositions(puzzle.id);
}

// Initialize app
window.onload = () => {
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
        statusMsg.innerText = "Enter username to start";
        renderCurrentPositionInfo(null);
        renderDebugInfo(null);
    }
};

fetchBtn.onclick = async () => {
    const user = document.getElementById('username').value.trim();
    if (!user) return alert("Enter a username");
    localStorage.setItem('username', user);
    
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
        renderDebugInfo(currentPuzzle);
        statusMsg.innerText = "Sync complete!";
        nextBtn.disabled = false;
    } catch (e) {
        console.error(e);
        statusMsg.innerText = `Error: ${formatErrorMessage(e)}`;
    }
};

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

        tempGame.move(move);
    });
}

function selectWeightedPuzzle() {
    const puzzles = getBlunders().slice(0, DRILL_LIMIT);
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
    currentPuzzle = selectWeightedPuzzle();
    if (!currentPuzzle) {
        statusMsg.innerText = "No puzzles loaded yet.";
        renderCurrentPositionInfo(null);
        renderDebugInfo(null);
        return;
    }

    chess.load(currentPuzzle.fen);
    board.setAttribute('position', currentPuzzle.fen);
    board.setAttribute('orientation', currentPuzzle.color);
    renderCurrentPositionInfo(currentPuzzle);
    renderDebugInfo(currentPuzzle);
    const playerToMove = currentPuzzle.color === 'white' ? 'White' : 'Black';
    const source = `${playerToMove} to move | ${currentPuzzle.gameFormat} (${currentPuzzle.gameDate}) | ${currentPuzzle.whitePlayer} vs ${currentPuzzle.blackPlayer}`;
    statusMsg.innerText = source;
}

board.addEventListener('drop', (e) => {
    if (!currentPuzzle) {
        statusMsg.innerText = "Load a puzzle first.";
        return 'snapback';
    }

    const { source, target } = e.detail;
    const move = chess.move({ from: source, to: target, promotion: 'q' });

    if (!move) {
        statusMsg.innerText = "Illegal move.";
        return 'snapback';
    }

    let blunders = getBlunders();
    let pIdx = blunders.findIndex(p => p.id === currentPuzzle.id);
    if (pIdx < 0) {
        statusMsg.innerText = "Puzzle not found in storage.";
        return 'snapback';
    }

    const playedMove = normalizeUci(`${move.from}${move.to}${move.promotion || ''}`);

    if (playedMove === currentPuzzle.bestMove) {
        statusMsg.innerText = "Correct!";
        blunders[pIdx].attempts++;
        blunders = setBlunders(blunders);
    } else {
        statusMsg.innerText = "Wrong. Try again!";
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
});

nextBtn.onclick = loadNextPuzzle;

clearBtn.onclick = () => {
    localStorage.removeItem('blunders');
    currentPuzzle = null;
    updateStats();
    renderCurrentPositionInfo(null);
    renderDebugInfo(null);
    statusMsg.innerText = "Local data cleared.";
    nextBtn.disabled = true;
};

function updateStats() {
    const count = getBlunders().slice(0, DRILL_LIMIT).length;
    document.getElementById('puzzle-count').innerText = count;
    nextBtn.disabled = count === 0;
}

debugToggleBtn.onclick = () => {
    debugPanel.classList.toggle('visible');
    debugToggleBtn.innerText = debugPanel.classList.contains('visible') ? 'Hide Debug' : 'Show Debug';
};
