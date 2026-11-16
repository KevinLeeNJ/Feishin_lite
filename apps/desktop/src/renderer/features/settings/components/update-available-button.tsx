import { useTranslation } from 'react-i18next';

import { RELEASES_PAGE_BASE, toTag } from '/@/renderer/hooks';
import { useLatestVersion } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';

export const UpdateAvailableButton = () => {
    const { t } = useTranslation();
    const { currentVersion, isUpdateAvailable, latestVersion } = useLatestVersion();

    if (!isUpdateAvailable || !latestVersion) {
        return null;
    }

    return (
        <Button
            component="a"
            href={`${RELEASES_PAGE_BASE}/tag/${toTag(latestVersion || currentVersion)}`}
            size="compact-sm"
            target="_blank"
            variant="filled"
        >
            {t('common.newVersionAvailable')}: v{latestVersion}
        </Button>
    );
};
