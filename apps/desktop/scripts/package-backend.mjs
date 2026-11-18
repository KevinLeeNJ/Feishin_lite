import { Arch } from 'electron-builder';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const platforms = {
    darwin: { suffix: 'apple-darwin' },
    linux: { suffix: 'unknown-linux-gnu' },
    win32: { extension: '.exe', suffix: 'pc-windows-msvc' },
};
const architectures = { arm64: 'aarch64', x64: 'x86_64' };

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export default function packageBackend({ appOutDir, arch, electronPlatformName, packager }) {
    const platform = platforms[electronPlatformName];
    const architecture = architectures[Arch[arch]];
    if (!platform || !architecture) {
        throw new Error(`Unsupported Rust backend target: ${electronPlatformName} ${Arch[arch]}`);
    }

    const target = `${architecture}-${platform.suffix}`;
    const targetDir = resolve(workspace, 'target');
    execFileSync(
        'cargo',
        [
            'build',
            '--locked',
            '--release',
            '--package',
            'music-desktop-core',
            '--target',
            target,
            '--target-dir',
            targetDir,
        ],
        { cwd: workspace, stdio: 'inherit' },
    );

    const resources = packager.getResourcesDir(appOutDir);
    const destination = join(resources, 'backend');
    const executable = `music-desktop-core${platform.extension ?? ''}`;
    mkdirSync(destination, { recursive: true });
    copyFileSync(join(targetDir, target, 'release', executable), join(destination, executable));
}
