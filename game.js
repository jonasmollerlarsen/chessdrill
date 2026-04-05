// Game object construction and validation

// Parse raw PGN and construct an EnrichedGame instance.
function enrichGameWithChess(pgn) {
    return new EnrichedGame(pgn);
}

class Puzzle {
    /** @type {string} Unique puzzle id: `<gameId>-<plyIndex>` */
    id;
    /** @type {string} FEN of the position before the move to find */
    fen;
    /** @type {string} Move actually played in the game, in UCI notation */
    playedMove;
    /** @type {'white'|'black'} Side to move */
    color;
    /** @type {string} Square the previous move came from (for board highlight) */
    previousMoveFrom;
    /** @type {string} Square the previous move landed on (for board highlight) */
    previousMoveTo;
    /** @type {string} Vetting state of this puzzle */
    state;
    /** @type {number} Total number of attempts */
    attempts;
    /** @type {number} Number of incorrect attempts */
    failures;
    /** @type {number} Unix timestamp (ms) of the source game */
    gameTimestamp;
    /** @type {string} Locale-formatted date string of the source game */
    gameDate;
    /** @type {string} Time control category (e.g. 'blitz', 'rapid') */
    gameFormat;
    /** @type {string} Username of the white player */
    whitePlayer;
    /** @type {string} Username of the black player */
    blackPlayer;

    constructor({ id, fen, playedMove, color, previousMoveFrom, previousMoveTo, state, attempts, failures, gameTimestamp, gameDate, gameFormat, whitePlayer, blackPlayer }) {
        this.id = id;
        this.fen = fen;
        this.playedMove = playedMove;
        this.color = color;
        this.previousMoveFrom = previousMoveFrom;
        this.previousMoveTo = previousMoveTo;
        this.state = state;
        this.attempts = attempts;
        this.failures = failures;
        this.gameTimestamp = gameTimestamp;
        this.gameDate = gameDate;
        this.gameFormat = gameFormat;
        this.whitePlayer = whitePlayer;
        this.blackPlayer = blackPlayer;
    }
}

class EnrichedGame {
    #chess;

    constructor(pgn) {
        const chess = new Chess();
        if (!chess.load_pgn(pgn)) {
            throw new Error('Failed to load PGN');
        }
        
        // Validate required PGN headers and time control format.
        const headers = chess.header();
        if (!headers.Site) throw new Error('PGN missing [Site] header (game URL)');
        
        const siteMatch = headers.Site.match(/\/([a-zA-Z0-9]+)\/?$/);
        if (!siteMatch) throw new Error(`Invalid [Site] header: ${headers.Site}`);
        
        if (!headers.White) throw new Error('PGN missing [White] header');
        if (!headers.Black) throw new Error('PGN missing [Black] header');
        if (!headers.UTCDate) throw new Error('PGN missing [UTCDate] header');
        if (!headers.UTCTime) throw new Error('PGN missing [UTCTime] header');
        
        const [year, month, day] = headers.UTCDate.split('.');
        const [hour, minute, second] = headers.UTCTime.split(':');
        const timestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).getTime();
        if (!Number.isFinite(timestamp)) {
            throw new Error(`Invalid timestamp from [UTCDate] ${headers.UTCDate} [UTCTime] ${headers.UTCTime}`);
        }
        
        if (!headers.TimeControl) throw new Error('PGN missing [TimeControl] header');
        
        this.#chess = chess;
        this.analysis = [];
    }

    /** Extract blunders from game analysis for the given player. Returns array of position records. */
    extractBlunders(username, existingIds, normalizeUci, unvettedState) {
        const headers = this.getHeaders();
        const gameId = getGameIdFromSite(headers.Site);
        const whitePlayer = headers.White;
        const blackPlayer = headers.Black;
        const gameTimestamp = getGameTimestampFromUtc(headers.UTCDate, headers.UTCTime);
        const gameDate = new Date(gameTimestamp).toLocaleDateString();
        const gameFormat = parseGameSpeed(headers.TimeControl);
        
        const whiteName = whitePlayer.toLowerCase();
        const blackName = blackPlayer.toLowerCase();
        const userLower = username.toLowerCase();

        if (whiteName !== userLower && blackName !== userLower) {
            return [];
        }

        const extracted = [];
        const isWhite = whiteName === userLower;
        const tempGame = new Chess();
        tempGame.load(getInitialFen());
        const moveList = this.#chess.history({ verbose: true });
        let previousMoveFrom = '';
        let previousMoveTo = '';

        this.analysis.forEach((moveEval, i) => {
            const turn = i % 2 === 0 ? 'white' : 'black';
            const move = moveList[i];

            if (!move) throw new Error(`Analysis index ${i} has no corresponding move in game ${gameId}`);

            const isUserTurn = (isWhite && turn === 'white') || (!isWhite && turn === 'black');
            if (isUserTurn && moveEval.judgment?.name === 'Blunder') {
                const id = `${gameId}-${i}`;
                if (!existingIds.has(id)) {
                    const playedMove = normalizeUci(`${move.from}${move.to}${move.promotion || ''}`);
                    extracted.push(new Puzzle({
                        id,
                        fen: tempGame.fen(),
                        playedMove,
                        color: turn,
                        previousMoveFrom,
                        previousMoveTo,
                        state: unvettedState,
                        attempts: 0,
                        failures: 0,
                        gameTimestamp,
                        gameDate,
                        gameFormat,
                        whitePlayer,
                        blackPlayer
                    }));
                    existingIds.add(id);
                }
            }

            const parsedMove = tempGame.move(move.san);
            if (!parsedMove) throw new Error(`Unexpected: failed to replay move ${move.san} at index ${i} in game ${gameId}`);
            previousMoveFrom = parsedMove.from;
            previousMoveTo = parsedMove.to;
        });

        return extracted;
    }

    /** Extract a single position at the given ply as a puzzle record. */
    extractSinglePosition(targetPly, normalizeUci, unvettedState) {
        const { fen, previousMoveFrom, previousMoveTo } = this.replayMovesToPly(targetPly);
        const headers = this.getHeaders();
        const gameId = getGameIdFromSite(headers.Site);
        const gameTimestamp = getGameTimestampFromUtc(headers.UTCDate, headers.UTCTime);
        const gameDate = new Date(gameTimestamp).toLocaleDateString();
        const gameFormat = parseGameSpeed(headers.TimeControl);
        const whitePlayer = headers.White;
        const blackPlayer = headers.Black;
        const playedMove = this.extractPlayedMoveForPly(targetPly, normalizeUci);
        const colorToMove = targetPly % 2 === 0 ? 'white' : 'black';

        return new Puzzle({
            id: `${gameId}-${targetPly - 1}`,
            fen,
            playedMove,
            color: colorToMove,
            previousMoveFrom,
            previousMoveTo,
            state: unvettedState,
            attempts: 0,
            failures: 0,
            gameTimestamp,
            gameDate,
            gameFormat,
            whitePlayer,
            blackPlayer
        });
    }

    /** Replay moves to reach targetPly and return FEN and previous move squares. */
    replayMovesToPly(targetPly) {
        const moveList = this.getMoveHistory();
        if (targetPly < 1 || targetPly > moveList.length) {
            throw new Error(`Invalid ply: ${targetPly}. Game has ${moveList.length} moves.`);
        }

        const tempGame = new Chess();
        tempGame.load(getInitialFen());
        let previousMoveFrom = '';
        let previousMoveTo = '';

        for (let i = 0; i < targetPly; i++) {
            const parsedMove = tempGame.move(moveList[i]);
            if (!parsedMove) {
                throw new Error(`Invalid move at ply ${i + 1}: ${moveList[i]}`);
            }
            previousMoveFrom = parsedMove.from;
            previousMoveTo = parsedMove.to;
        }

        return { fen: tempGame.fen(), previousMoveFrom, previousMoveTo };
    }

    /** Return the played move from the position at targetPly in UCI notation. */
    extractPlayedMoveForPly(targetPly, normalizeUci) {
        const moveList = this.#chess.history({ verbose: true });
        if (targetPly < 1 || targetPly >= moveList.length) {
            throw new Error(`Invalid ply: ${targetPly}. Game has ${moveList.length} moves.`);
        }
        const moveObj = moveList[targetPly];
        return normalizeUci(`${moveObj.from}${moveObj.to}${moveObj.promotion || ''}`);
    }

    /** Return the PGN headers object. */
    getHeaders() {
        return this.#chess.header();
    }

    /** Return SAN move history array. */
    getMoveHistory() {
        return this.#chess.history();
    }
}

function getGameIdFromSite(site) {
    if (!site) throw new Error('PGN missing [Site] header (game URL)');

    const siteMatch = site.match(/\/([a-zA-Z0-9]+)\/?$/);
    if (!siteMatch) throw new Error(`Invalid [Site] header: ${site}`);
    return siteMatch[1];
}

function getGameTimestampFromUtc(dateStr, timeStr) {
    if (!dateStr) throw new Error('PGN missing [UTCDate] header');
    if (!timeStr) throw new Error('PGN missing [UTCTime] header');

    const [year, month, day] = dateStr.split('.');
    const [hour, minute, second] = timeStr.split(':');
    const timestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).getTime();
    if (!Number.isFinite(timestamp)) {
        throw new Error(`Invalid timestamp from [UTCDate] ${dateStr} [UTCTime] ${timeStr}`);
    }
    return timestamp;
}

// Parse time control string and return speed category.
function parseGameSpeed(timeControl) {
    if (timeControl === '-1') return 'correspondence';
    if (timeControl == "-") return 'correspondence';

    const parts = timeControl.split('+');
    const mainTime = Number(parts[0]);

    if (!Number.isFinite(mainTime)) throw new Error(`Invalid [TimeControl]: ${timeControl}`);

    if (mainTime >= 1800) return 'classical';
    if (mainTime >= 600) return 'rapid';
    if (mainTime >= 60) return 'blitz';
    return 'bullet';
}

function getInitialFen() {
    return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
}

window.gameModule = {
    enrichGameWithChess
};
