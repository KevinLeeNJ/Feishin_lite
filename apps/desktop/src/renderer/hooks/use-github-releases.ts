import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

/**
 * Stub: this fork has not published its own releases yet. Point these at the
 * project's own repository once its release feed exists; every update check,
 * changelog fetch, and release link derives from them. While empty, all update
 * and changelog fetches stay disabled (no upstream contact).
 */
export const GITHUB_RELEASES_URL: string = '';
export const RELEASES_PAGE_BASE: string = '';
export const GITHUB_COMPARE_URL = GITHUB_RELEASES_URL
    ? `${GITHUB_RELEASES_URL.replace(/\/releases$/, '')}/compare`
    : '';
export const isReleaseFeedConfigured = GITHUB_RELEASES_URL.length > 0;
export const RELEASES_TO_FETCH = 30;

export interface GitHubRelease {
    body: null | string;
    name: null | string;
    prerelease: boolean;
    published_at: string;
    tag_name: string;
}

export function parseVersionFromTag(tagName: string): string {
    return tagName.startsWith('v') ? tagName.slice(1) : tagName;
}

export function toTag(version: string): string {
    return version.startsWith('v') ? version : `v${version}`;
}

export const useGithubReleasesList = (perPage = RELEASES_TO_FETCH) => {
    return useQuery({
        enabled: isReleaseFeedConfigured,
        queryFn: async () => {
            const response = await axios.get<GitHubRelease[]>(GITHUB_RELEASES_URL, {
                params: { per_page: perPage },
            });
            return response.data;
        },
        queryKey: ['github-releases-list', perPage],
        retry: 2,
    });
};

export const useGithubLatestRelease = (options?: {
    refetchInterval?: number;
    refetchIntervalInBackground?: boolean;
}) => {
    return useQuery({
        enabled: isReleaseFeedConfigured,
        queryFn: async () => {
            const response = await axios.get<GitHubRelease>(`${GITHUB_RELEASES_URL}/latest`);
            return response.data;
        },
        queryKey: ['github-latest-release'],
        retry: 2,
        ...options,
    });
};
