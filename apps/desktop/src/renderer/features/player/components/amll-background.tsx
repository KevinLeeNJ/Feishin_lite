import { BackgroundRender } from '@applemusic-like-lyrics/react';
import { memo } from 'react';

import styles from './amll-background.module.css';

import { useItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { usePlayerSong, usePlayerStoreBase } from '/@/renderer/store';
import { LibraryItem } from '/@/shared/types/domain-types';
import { PlayerStatus } from '/@/shared/types/types';

/**
 * Cover-driven Apple Music fluid background for the fullscreen player.
 * Replaces the static cover + blur stack when dynamic background is enabled.
 * AMLL pauses the fluid motion while playback is paused and disposes its
 * WebGL resources on unmount (fullscreen exit). Reduced-motion / low-perf
 * callers fall back to the static cover instead of mounting this component.
 */
export const AmllBackground = memo(() => {
    const currentSong = usePlayerSong();
    const status = usePlayerStoreBase((state) => state.player.status);
    const albumUrl = useItemImageUrl({
        id: currentSong?.imageId || undefined,
        itemType: LibraryItem.SONG,
        type: 'itemCard',
    });

    return (
        <div className={styles.background}>
            <BackgroundRender album={albumUrl} playing={status === PlayerStatus.PLAYING} />
        </div>
    );
});

AmllBackground.displayName = 'AmllBackground';
