import { join } from 'node:path';

export function backendExecutablePath(directory: string): string {
    return join(
        directory,
        process.platform === 'win32' ? 'music-desktop-core.exe' : 'music-desktop-core',
    );
}
