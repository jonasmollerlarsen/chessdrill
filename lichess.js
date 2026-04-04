// Lichess API integration
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

async function fetchGamesFromLichess(username, onGameData) {
    const response = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=20&moves=true&evals=true&analysed=true`, {
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
    let remainder = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            remainder += decoder.decode();
            const tail = remainder.trim();
            if (tail) {
                const gameData = JSON.parse(tail);
                onGameData(gameData);
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
            onGameData(gameData);
        }
    }
}

window.lichessModule = {
    getPuzzleLichessUrl,
    fetchGamesFromLichess
};
