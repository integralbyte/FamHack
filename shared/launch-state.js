export const EVENT_TIME_ZONE = 'Europe/London';
export const REGISTRATION_CUTOFF_AT = '2026-03-13T23:59:59.999Z';
export const NORMAL_PARTICIPATION_UNLOCK_AT = '2026-03-14T00:00:00.000Z';
export const REGISTRATION_CONFIRMATION_TITLE = "You're registered";
export const REGISTRATION_CONFIRMATION_COPY = 'Come back on 14 March to team up with your academic family. If you are unable to do that, we may assign you a team.';

const registrationCutoffTime = Date.parse(REGISTRATION_CUTOFF_AT);
const normalParticipationUnlockTime = Date.parse(NORMAL_PARTICIPATION_UNLOCK_AT);

export function getLaunchState(now = new Date()) {
  const currentTime = now instanceof Date ? now.getTime() : Date.parse(now);

  return {
    now: new Date(currentTime).toISOString(),
    isRegistrationOpen: currentTime <= registrationCutoffTime,
    isNormalParticipationOpen: currentTime >= normalParticipationUnlockTime,
    isProtectedContentOpen: currentTime >= normalParticipationUnlockTime,
    registrationCutoffAt: REGISTRATION_CUTOFF_AT,
    normalParticipationUnlockAt: NORMAL_PARTICIPATION_UNLOCK_AT,
    eventTimeZone: EVENT_TIME_ZONE,
  };
}
