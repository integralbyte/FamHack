import { getLaunchState } from '../../shared/launch-state.js';

export const PROTECTED_PAGE_SLUGS = new Set([
  'about',
  'tracks',
  'dashboard',
  'ctf',
  'join',
  'register',
]);

const BACKUP_PREVIEW_BRANCH = 'codex/backup-preview';

function isBackupPreviewNormalParticipationOverrideEnabled() {
  return process.env.VERCEL_ENV === 'preview'
    && String(process.env.VERCEL_GIT_COMMIT_REF || '').trim() === BACKUP_PREVIEW_BRANCH;
}

export function getServerLaunchState(now = new Date()) {
  const launch = getLaunchState(now);
  if (!isBackupPreviewNormalParticipationOverrideEnabled()) {
    return launch;
  }

  return {
    ...launch,
    isNormalParticipationOpen: true,
  };
}

export function isNormalParticipationOpen(now = new Date()) {
  return getServerLaunchState(now).isNormalParticipationOpen;
}

export function assertNormalParticipationOpen() {
  if (!isNormalParticipationOpen()) {
    throw new Error('Normal participation opens on 20 March.');
  }
}

export function normalizePageSlug(slug) {
  return String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/\.html$/, '');
}
