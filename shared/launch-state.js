export const EVENT_TIME_ZONE = 'Europe/London';
export const REGISTRATION_CUTOFF_AT = '2026-03-28T23:59:59.999Z';
export const INFO_PAGES_UNLOCK_AT = '2026-03-28T11:00:00.000Z';
export const PROTECTED_CONTENT_UNLOCK_AT = '2026-03-14T00:00:00.000Z';
export const NORMAL_PARTICIPATION_UNLOCK_AT = '2026-03-20T00:00:00.000Z';
export const REGISTRATION_CONFIRMATION_TITLE = "You're registered";
export const REGISTRATION_CONFIRMATION_COPY = 'Come back on 20 March to sort your academic family. If you are unable to do that, we may assign you a team before the event.';

const registrationCutoffTime = Date.parse(REGISTRATION_CUTOFF_AT);
const infoPagesUnlockTime = Date.parse(INFO_PAGES_UNLOCK_AT);
const protectedContentUnlockTime = Date.parse(PROTECTED_CONTENT_UNLOCK_AT);
const normalParticipationUnlockTime = Date.parse(NORMAL_PARTICIPATION_UNLOCK_AT);

export function getLaunchState(now = new Date()) {
  const currentTime = now instanceof Date ? now.getTime() : Date.parse(now);

  return {
    now: new Date(currentTime).toISOString(),
    isRegistrationOpen: currentTime <= registrationCutoffTime,
    isInfoPagesOpen: currentTime >= infoPagesUnlockTime,
    isNormalParticipationOpen: currentTime >= normalParticipationUnlockTime,
    isProtectedContentOpen: currentTime >= protectedContentUnlockTime,
    registrationCutoffAt: REGISTRATION_CUTOFF_AT,
    infoPagesUnlockAt: INFO_PAGES_UNLOCK_AT,
    protectedContentUnlockAt: PROTECTED_CONTENT_UNLOCK_AT,
    normalParticipationUnlockAt: NORMAL_PARTICIPATION_UNLOCK_AT,
    eventTimeZone: EVENT_TIME_ZONE,
  };
}
