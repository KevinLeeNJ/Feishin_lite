// Chromium 43 denies Local Network Access without a permission handler, which
// blocks LAN servers (jeffvli/feishin#2430). The handlers therefore allow only
// the permissions the renderer actually uses and deny everything else.
// display-capture / media: visualizer system-audio loopback; Electron 43
// requests 'media' for getDisplayMedia audio. Source selection stays gated by
// setDisplayMediaRequestHandler (canHandleVisualizerDisplayMedia).
// notifications: scrobble track-change notifications.
// fullscreen: the fullscreen player toggle (requestFullscreen).
const ALLOWED_PERMISSIONS = new Set([
    'display-capture',
    'fullscreen',
    'local-fonts',
    'local-network',
    'local-network-access',
    'loopback-network',
    'media',
    'notifications',
]);

export const isPermissionAllowed = (permission: string): boolean =>
    ALLOWED_PERMISSIONS.has(permission);
