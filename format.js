// Formatting and display utilities
function normalizeUci(move) {
    const str = String(move).trim().toLowerCase();
    if (!str.match(/^[a-h][1-8][a-h][1-8][qrbn]?$/)) {
        throw new Error(`Invalid UCI move: ${move}`);
    }
    return str;
}

function formatErrorMessage(error) {
    if (error instanceof Error && error.message) return error.message;
    return String(error);
}

function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

window.formatModule = {
    normalizeUci,
    formatErrorMessage,
    formatBytes
};
