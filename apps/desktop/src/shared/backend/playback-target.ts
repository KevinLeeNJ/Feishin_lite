import { PlayerType } from '/@/shared/types/types';

export function isClientPlayback(type: PlayerType): boolean {
    return type === PlayerType.WEB || type === PlayerType.LOCAL;
}
