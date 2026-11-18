import { describe, expect, it } from 'vitest';

import { isPermissionAllowed } from './permissions';

describe('isPermissionAllowed', () => {
    it('allows the permissions the renderer uses', () => {
        for (const permission of [
            'display-capture',
            'fullscreen',
            'local-fonts',
            'local-network',
            'local-network-access',
            'loopback-network',
            'media',
            'notifications',
        ]) {
            expect(isPermissionAllowed(permission), permission).toBe(true);
        }
    });

    it('denies permissions the renderer never requests', () => {
        for (const permission of ['geolocation', 'midi', 'pointerLock', 'unknown']) {
            expect(isPermissionAllowed(permission), permission).toBe(false);
        }
    });
});
