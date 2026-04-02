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
const BACKUP_PREVIEW_BRANCH_SLUG = 'codex-backup-preview';
const BACKUP_PREVIEW_HOST_MARKER = `-git-${BACKUP_PREVIEW_BRANCH_SLUG}-`;

function normalizeHost(value) {
  if (Array.isArray(value)) {
    return normalizeHost(value[0]);
  }

  return String(value || '').trim().toLowerCase();
}

function getRequestHost(req) {
  if (!req || typeof req !== 'object') {
    return '';
  }

  return normalizeHost(req.headers?.['x-forwarded-host'] || req.headers?.host || req.host);
}

function isBackupPreviewHost(host) {
  return Boolean(host) && (
    host.includes(BACKUP_PREVIEW_HOST_MARKER)
    || host.includes(BACKUP_PREVIEW_BRANCH_SLUG)
  );
}

function isBackupPreviewNormalParticipationOverrideEnabled(req) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return false;
  }

  const branchRef = String(process.env.VERCEL_GIT_COMMIT_REF || '').trim();
  if (branchRef === BACKUP_PREVIEW_BRANCH || branchRef === BACKUP_PREVIEW_BRANCH_SLUG) {
    return true;
  }

  const branchUrl = normalizeHost(process.env.VERCEL_BRANCH_URL);
  if (isBackupPreviewHost(branchUrl)) {
    return true;
  }

  const deploymentUrl = normalizeHost(process.env.VERCEL_URL);
  if (isBackupPreviewHost(deploymentUrl)) {
    return true;
  }

  return isBackupPreviewHost(getRequestHost(req));
}

export function getServerLaunchState({ now = new Date(), req } = {}) {
  const launch = getLaunchState(now);
  if (!isBackupPreviewNormalParticipationOverrideEnabled(req)) {
    return launch;
  }

  return {
    ...launch,
    isNormalParticipationOpen: true,
  };
}

export function isNormalParticipationOpen({ now = new Date(), req } = {}) {
  return getServerLaunchState({ now, req }).isNormalParticipationOpen;
}

export function assertNormalParticipationOpen(req, now = new Date()) {
  if (!isNormalParticipationOpen({ now, req })) {
    throw new Error('Normal participation opens on 20 March.');
  }
}

export function normalizePageSlug(slug) {
  return String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/\.html$/, '');
}
