// Puzzle state management and labeling
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
    if (state === PUZZLE_STATES.ENABLED) return 'Enabled';
    if (state === PUZZLE_STATES.UNVETTED) return 'Unvetted';
    return 'Disabled';
}

function getPuzzleStateTooltip(state) {
    return `Cycle puzzle state. Current: ${getPuzzleStateTitle(state)}`;
}

window.puzzleStateModule = {
    PUZZLE_STATES,
    isPuzzleActive,
    normalizePuzzleState,
    getNextPuzzleState,
    getPuzzleStateLabel,
    getPuzzleStateTooltip
};
