// Lichess API integration
const game_module = window.gameModule;
if (!game_module) throw new Error('gameModule not loaded. Ensure game.js is loaded before lichess.js.');

function getPuzzleLichessUrl(puzzle) {
    const id = String(puzzle?.id);
    if (!id) throw new Error('Puzzle missing id');
    
    const dash = id.lastIndexOf('-');
    if (dash <= 0) throw new Error(`Invalid puzzle id format: ${id}`);

    const gameId = id.slice(0, dash);
    const plyIndex = Number(id.slice(dash + 1));
    if (!gameId || !Number.isFinite(plyIndex)) {
        throw new Error(`Invalid puzzle id components: gameId=${gameId}, plyIndex=${plyIndex}`);
    }

    const orientation = puzzle?.color === 'black' ? 'black' : 'white';
    const queriedPly = Math.max(1, plyIndex);
    return `https://lichess.org/${gameId}/${orientation}#${queriedPly}`;
}

// enrichGameWithChess and parseGameSpeed are in game.js

async function fetchGamesFromLichess(username, onGameData) {
    const response = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=20&moves=true`, {
        headers: { 'Accept': 'application/x-chess-pgn' }
    });

    if (!response.ok) {
        throw new Error(`Lichess API error: ${response.status}`);
    }
    if (!response.body) {
        throw new Error('No response stream available');
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            buffer += decoder.decode();
            const remainder = buffer.trim();
            if (remainder) {
                const enrichedGame = game_module.enrichGameWithChess(remainder);
                onGameData(enrichedGame);
            }
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const pgnBlocks = buffer.split(/\n\n(?=\[)/);
        buffer = pgnBlocks.pop() || '';

        for (const block of pgnBlocks) {
            const trimmed = block.trim();
            if (!trimmed) continue;
            const enrichedGame = game_module.enrichGameWithChess(trimmed);
            onGameData(enrichedGame);
        }
    }
}

// Fetch a single game from Lichess by game ID.
async function fetchSingleGameFromLichess(gameId) {
    const requestUrl = `https://lichess.org/game/export/${encodeURIComponent(gameId)}?moves=true`;
    const response = await fetch(requestUrl, {
        headers: { 'Accept': 'application/x-chess-pgn' }
    });

    if (!response.ok) {
        throw new Error(`Lichess request failed (${response.status}): ${requestUrl}`);
    }

    const pgn = await response.text();
    return game_module.enrichGameWithChess(pgn);
}

// Parse a single-position Lichess URL into game id, orientation, and ply.
function parseSinglePositionUrl(urlValue) {
    const parsedUrl = new URL(urlValue);
    if (parsedUrl.hostname !== 'lichess.org') {
        throw new Error(`Invalid host for Lichess URL: ${parsedUrl.hostname}`);
    }

    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
    if (pathParts.length === 0) {
        throw new Error(`Invalid Lichess URL path: ${parsedUrl.pathname}`);
    }

    const gameId = pathParts[0];
    if (!/^[a-zA-Z0-9]{8}$/.test(gameId)) {
        throw new Error(`Invalid Lichess game id: ${gameId}. Expected 8 alphanumeric characters.`);
    }

    // Orientation from URL path, or extract from ply to determine whose turn (default: white)
    const pathOrientation = pathParts[1];
    if (pathOrientation && pathOrientation !== 'white' && pathOrientation !== 'black') {
        throw new Error(`Invalid orientation in Lichess URL: ${pathOrientation}`);
    }

    const plyToken = parsedUrl.hash.replace('#', '').trim();
    const ply = Number.parseInt(plyToken, 10);
    if (!Number.isFinite(ply) || ply <= 0) {
        throw new Error(`Invalid ply in Lichess URL hash: ${parsedUrl.hash}. Expected positive integer.`);
    }

    // Determine orientation: use path orientation if provided, otherwise derive from ply
    const orientation = pathOrientation || ((ply - 1) % 2 === 0 ? 'white' : 'black');

    return { gameId, orientation, ply, canonicalUrl: parsedUrl.toString() };
}

window.lichessModule = {
    getPuzzleLichessUrl,
    fetchGamesFromLichess,
    fetchSingleGameFromLichess,
    parseSinglePositionUrl
};
