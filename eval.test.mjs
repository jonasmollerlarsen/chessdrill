import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import https from 'node:https';
import { Worker as NodeWorker } from 'node:worker_threads';

const CHESS_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js';
const STOCKFISH_JS_URL = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';

function fetchText(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

class WebWorkerBridge {
    #worker;

    constructor(scriptPath) {
        if (!scriptPath) {
            throw new Error('Worker script path is required');
        }

        const runnerCode = `
            const __fs = require('node:fs');
            const __vm = require('node:vm');
            const { parentPort, workerData } = require('node:worker_threads');

            globalThis.self = globalThis;
            globalThis.postMessage = (msg) => parentPort.postMessage(msg);
            globalThis.onmessage = null;

            parentPort.on('message', (msg) => {
                if (typeof globalThis.onmessage === 'function') {
                    globalThis.onmessage({ data: msg });
                }
            });

            const source = __fs.readFileSync(workerData.scriptPath, 'utf8');
            __vm.runInThisContext(source, { filename: workerData.scriptPath });
        `;

        this.#worker = new NodeWorker(runnerCode, {
            eval: true,
            workerData: { scriptPath },
        });

        this.onmessage = null;
        this.onerror = null;

        this.#worker.on('message', (msg) => {
            if (typeof this.onmessage === 'function') {
                this.onmessage({ data: msg });
            }
        });

        this.#worker.on('error', (error) => {
            if (typeof this.onerror === 'function') {
                this.onerror(error);
            }
        });
    }

    postMessage(msg) {
        this.#worker.postMessage(msg);
    }

    terminate() {
        return this.#worker.terminate();
    }
}

async function loadEvalModuleWithRealStockfish() {
    const evalPath = path.resolve('eval.js');
    const stockfishPath = path.resolve('stockfish.js');

    const evalCode = fs.readFileSync(evalPath, 'utf8');
    const stockfishCode = fs.readFileSync(stockfishPath, 'utf8');
    const chessCode = await fetchText(CHESS_JS_URL);
    const stockfishEngineCode = await fetchText(STOCKFISH_JS_URL);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockfish-real-'));
    const realEnginePath = path.join(tempDir, 'stockfish.js');
    fs.writeFileSync(realEnginePath, stockfishEngineCode, 'utf8');

    const sandbox = {
        window: {
            location: { search: '' },
        },
        console,
        URLSearchParams,
        Worker: WebWorkerBridge,
    };

    vm.createContext(sandbox);
    vm.runInContext(chessCode, sandbox, { filename: 'chess.js' });

    const patchedStockfishCode = stockfishCode
        .replace(
            /const STOCKFISH_WORKER_URL = '.*?';/,
            `const STOCKFISH_WORKER_URL = ${JSON.stringify(realEnginePath)};`
        )
        .replace(/const TARGET_DEPTH = \d+;/, 'const TARGET_DEPTH = 10;');

    vm.runInContext(patchedStockfishCode, sandbox, { filename: 'stockfish.js' });
    vm.runInContext(evalCode, sandbox, { filename: 'eval.js' });

    return {
        evalModule: sandbox.window.evalModule,
        stockfishModule: sandbox.window.stockfishModule,
        cleanup: () => {
            try {
                sandbox.window.stockfishModule.terminateEngine();
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        },
    };
}

test('eval module uses real Stockfish for FEN and move evaluation', async () => {
    const { evalModule, cleanup } = await loadEvalModuleWithRealStockfish();

    try {
        const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

        const streamedDepths = [];
        const streamScore = await evalModule.evaluateFenStream(startFen, (update) => {
            if (update.depth != null) streamedDepths.push(update.depth);
        });
        assert.equal(typeof streamScore, 'object');
        assert.ok(streamScore.cp !== undefined || streamScore.mate !== undefined);
        assert.ok(streamedDepths.length > 0);
        assert.ok(streamScore.depth !== null);

        const fenScore = await evalModule.evaluateFen(startFen);
        assert.equal(typeof fenScore, 'object');
        assert.ok(fenScore.cp !== undefined || fenScore.mate !== undefined);
        assert.ok(fenScore.depth !== null);

        const moveScore = await evalModule.evaluateMoveFromFen(startFen, 'e2e4');
        assert.equal(typeof moveScore, 'object');
        assert.ok(moveScore.cp !== undefined || moveScore.mate !== undefined);
        assert.ok(moveScore.depth !== null);

        const moveStreamDepths = [];
        const moveStreamScore = await evalModule.evaluateMoveFromFenStream(startFen, 'e2e4', (update) => {
            if (update.depth != null) moveStreamDepths.push(update.depth);
        });
        assert.equal(typeof moveStreamScore, 'object');
        assert.ok(moveStreamScore.cp !== undefined || moveStreamScore.mate !== undefined);
        assert.ok(moveStreamDepths.length > 0);
        assert.ok(moveStreamScore.depth !== null);

        const bestResult = await evalModule.findBestMoveWithEval(startFen);
        assert.equal(typeof bestResult, 'object');
        assert.equal(typeof bestResult.bestMove, 'string');
        assert.ok(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(bestResult.bestMove));
        assert.ok(bestResult.score.cp !== undefined || bestResult.score.mate !== undefined);
        assert.ok(bestResult.score.depth !== null);

        const bestStreamUpdates = [];
        const bestStreamResult = await evalModule.findBestMoveWithEvalStream(startFen, (update) => {
            bestStreamUpdates.push(update);
        });
        assert.equal(typeof bestStreamResult, 'object');
        assert.equal(typeof bestStreamResult.bestMove, 'string');
        assert.ok(bestStreamUpdates.length > 0);
        assert.ok(bestStreamResult.score.depth !== null);
    } finally {
        cleanup();
    }
});
