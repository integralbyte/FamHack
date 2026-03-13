import { getLaunchState } from '../../shared/launch-state.js';

export const PROTECTED_PAGE_SLUGS = new Set([
  'about',
  'tracks',
  'dashboard',
  'ctf',
  'join',
  'register',
]);

export function getServerLaunchState(now = new Date()) {
  return getLaunchState(now);
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
