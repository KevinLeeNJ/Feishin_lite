// Stub: this fork has not published its own release feed yet. Auto-update stays
// disabled until the project points at its own repository/releases (see the
// updater configs in main/index.ts and renderer use-github-releases.ts).
export const disableAutoUpdates = (): boolean => {
    return true;
};

export const isMacOS = () => {
    return process.platform === 'darwin';
};

export const isWindows = () => {
    return process.platform === 'win32';
};

export const isLinux = () => {
    return process.platform === 'linux';
};
