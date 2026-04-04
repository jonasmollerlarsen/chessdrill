import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import https from 'node:https';

function fetchChessJs() {
    return new Promise((resolve, reject) => {
        https.get('https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js', (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function loadGameModule() {
    const gamePath = path.resolve('game.js');
    const gameCode = fs.readFileSync(gamePath, 'utf8');
    const chessCode = await fetchChessJs();

    const sandbox = {
        window: {},
        console
    };

    vm.createContext(sandbox);
    vm.runInContext(chessCode, sandbox, { filename: 'chess.js' });
    vm.runInContext(gameCode, sandbox, { filename: 'game.js' });

    return sandbox.window.gameModule;
}

test('enrichGameWithChess parses valid PGN with all required headers', async () => {
    const gameModule = await loadGameModule();
    
    const pgn = `[Site "https://lichess.org/abc12def"]
[White "Alice"]
[Black "Bob"]
[UTCDate "2026.04.04"]
[UTCTime "14:30:45"]
[TimeControl "600+10"]

1. e4 e5 2. Nf3 Nc6`;

    const game = gameModule.enrichGameWithChess(pgn);

    assert.equal(game.id, undefined);
    assert.equal(game.chess, undefined);
    assert.equal(game.getHeaders().Site, 'https://lichess.org/abc12def');
    assert.equal(game.speed, undefined);
    assert.equal(game.players, undefined);
    assert.equal(game.moves, undefined);
    assert.deepEqual(game.getMoveHistory(), ['e4', 'e5', 'Nf3', 'Nc6']);
    assert.equal(game.getHeaders().White, 'Alice');
    assert.equal(game.getHeaders().Black, 'Bob');
    assert.equal(game.getHeaders().TimeControl, '600+10');
    assert.deepEqual(game.analysis, []);
    assert.equal(game.createdAt, undefined);
    assert.equal(typeof game.getHeaders(), 'object');
});

test('enrichGameWithChess throws when PGN missing [Site] header', async () => {
    const gameModule = await loadGameModule();
    
    const pgn = `[White "Alice"]
[Black "Bob"]
[UTCDate "2026.04.04"]
[UTCTime "14:30:45"]
[TimeControl "600+10"]

1. e4 e5`;

    assert.throws(
        () => gameModule.enrichGameWithChess(pgn),
        /PGN missing \[Site\] header/
    );
});

test('enrichGameWithChess throws with invalid [Site] format (no game ID)', async () => {
    const gameModule = await loadGameModule();
    
    const pgn = `[Site "https://example.com"]
[White "Alice"]
[Black "Bob"]
[UTCDate "2026.04.04"]
[UTCTime "14:30:45"]
[TimeControl "600+10"]

1. e4 e5`;

    assert.throws(
        () => gameModule.enrichGameWithChess(pgn),
        /Invalid \[Site\] header/
    );
});

test('enrichGameWithChess throws when PGN missing [White] header', async () => {
    const gameModule = await loadGameModule();
    
    const pgn = `[Site "https://lichess.org/abc12def"]
[Black "Bob"]
[UTCDate "2026.04.04"]
[UTCTime "14:30:45"]
[TimeControl "600+10"]

1. e4 e5`;

    assert.throws(
        () => gameModule.enrichGameWithChess(pgn),
        /PGN missing \[White\] header/
    );
});

test('enrichGameWithChess throws when PGN missing [Black] header', async () => {
    const gameModule = await loadGameModule();
    
    const pgn = `[Site "https://lichess.org/abc12def"]
[White "Alice"]
[UTCDate "2026.04.04"]
[UTCTime "14:30:45"]
[TimeControl "600+10"]

1. e4 e5`;

    assert.throws(
        () => gameModule.enrichGameWithChess(pgn),
        /PGN missing \[Black\] header/
    );
});

test('enrichGameWithChess throws when PGN missing [UTCDate] header', async () => {
    const gameModule = await loadGameModule();
    
    const pgn = `[Site "https://lichess.org/abc12def"]
[White "Alice"]
[Black "Bob"]
[UTCTime "14:30:45"]
[TimeControl "600+10"]

1. e4 e5`;

    assert.throws(
        () => gameModule.enrichGameWithChess(pgn),
        /PGN missing \[UTCDate\] header/
    );
});

test('enrichGameWithChess throws when PGN missing [UTCTime] header', async () => {
    const gameModule = await loadGameModule();
    
    const pgn = `[Site "https://lichess.org/abc12def"]
[White "Alice"]
[Black "Bob"]
[UTCDate "2026.04.04"]
[TimeControl "600+10"]

1. e4 e5`;

    assert.throws(
        () => gameModule.enrichGameWithChess(pgn),
        /PGN missing \[UTCTime\] header/
    );
});

test('enrichGameWithChess throws when PGN missing [TimeControl] header', async () => {
    const gameModule = await loadGameModule();
    
    const pgn = `[Site "https://lichess.org/abc12def"]
[White "Alice"]
[Black "Bob"]
[UTCDate "2026.04.04"]
[UTCTime "14:30:45"]

1. e4 e5`;

    assert.throws(
        () => gameModule.enrichGameWithChess(pgn),
        /PGN missing \[TimeControl\] header/
    );
});

test('enrichGameWithChess throws with invalid UTC timestamp', async () => {
    const gameModule = await loadGameModule();
    
    const pgn = `[Site "https://lichess.org/abc12def"]
[White "Alice"]
[Black "Bob"]
[UTCDate "2026-04-04"]
[UTCTime "14:30:45"]
[TimeControl "600+10"]

1. e4 e5`;

    assert.throws(
        () => gameModule.enrichGameWithChess(pgn),
        /Invalid timestamp/
    );
});

test('enrichGameWithChess handles anonymous players (name = "?")', async () => {
    const gameModule = await loadGameModule();
    
    const pgn = `[Site "https://lichess.org/xyz98765"]
[White "?"]
[Black "?"]
[UTCDate "2026.04.04"]
[UTCTime "10:00:00"]
[TimeControl "60+0"]

1. e4 c5`;

    const game = gameModule.enrichGameWithChess(pgn);

    assert.equal(game.getHeaders().White, '?');
    assert.equal(game.getHeaders().Black, '?');
});

test('enrichGameWithChess extracts game ID correctly from various Site formats', async () => {
    const gameModule = await loadGameModule();
    
    const pgnWithSlash = `[Site "https://lichess.org/game123456/"]
[White "A"]
[Black "B"]
[UTCDate "2026.01.01"]
[UTCTime "00:00:00"]
[TimeControl "-1"]

1. e4`;

    const game = gameModule.enrichGameWithChess(pgnWithSlash);
    const site = game.getHeaders().Site;
    const siteMatch = site.match(/\/([a-zA-Z0-9]+)\/?$/);
    assert.ok(siteMatch);
    assert.equal(siteMatch[1], 'game123456');
});

test('extractSinglePosition categorizes time controls correctly', async () => {
    const gameModule = await loadGameModule();
    const cases = [
        ['2000+0', 'classical'],
        ['1800+10', 'classical'],
        ['900+5', 'rapid'],
        ['600+10', 'rapid'],
        ['300+0', 'blitz'],
        ['180+2', 'blitz'],
        ['120+1', 'blitz'],
        ['60+0', 'blitz'],
        ['59+1', 'bullet'],
        ['30+0', 'bullet'],
        ['-1', 'correspondence']
    ];

    for (const [timeControl, expected] of cases) {
        const pgn = `[Site "https://lichess.org/test1234"]
[White "Alice"]
[Black "Bob"]
[UTCDate "2026.04.04"]
[UTCTime "14:30:45"]
[TimeControl "${timeControl}"]

1. e4`;

        const game = gameModule.enrichGameWithChess(pgn);
        const position = game.extractSinglePosition(1, (move) => move, 'unvetted');
        assert.equal(position.gameFormat, expected);
    }
});

test('extractSinglePosition throws with invalid time control', async () => {
    const gameModule = await loadGameModule();
    const pgn = `[Site "https://lichess.org/test1234"]
[White "Alice"]
[Black "Bob"]
[UTCDate "2026.04.04"]
[UTCTime "14:30:45"]
[TimeControl "invalid"]

1. e4`;

    const game = gameModule.enrichGameWithChess(pgn);
    assert.throws(
        () => game.extractSinglePosition(1, (move) => move, 'unvetted'),
        /Invalid \[TimeControl\]/
    );
});

test('enrichGameWithChess returns correct timestamp for UTC date/time', async () => {
    const gameModule = await loadGameModule();
    
    const pgn = `[Site "https://lichess.org/test1234"]
[White "Alice"]
[Black "Bob"]
[UTCDate "2026.04.04"]
[UTCTime "14:30:45"]
[TimeControl "600+10"]

1. e4`;

    const game = gameModule.enrichGameWithChess(pgn);

    const headers = game.getHeaders();
    const [year, month, day] = headers.UTCDate.split('.');
    const [hour, minute, second] = headers.UTCTime.split(':');
    const timestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).getTime();

    // Verify timestamp reconstructed from headers is in reasonable range.
    assert.equal(typeof timestamp, 'number');
    assert.ok(timestamp > 0);
    assert.ok(timestamp < Date.now() + 365 * 24 * 60 * 60 * 1000);
});
