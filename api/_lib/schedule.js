import { getEnv } from './env.js';

const DEFAULT_FAMILY_FLOW_OPENS_AT = '2026-03-14T00:00:00Z';

function createStatusError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function getFamilyFlowOpensAt() {
  const value = getEnv('FAMILY_FLOW_OPENS_AT', DEFAULT_FAMILY_FLOW_OPENS_AT);
  const releaseDate = new Date(value);

  if (Number.isNaN(releaseDate.getTime())) {
    throw new Error('Invalid FAMILY_FLOW_OPENS_AT value');
  }

  return releaseDate;
}

export function getFamilyFlowGate() {
  const opensAt = getFamilyFlowOpensAt();
  const granted = Date.now() >= opensAt.getTime();

  return {
    granted,
    opensAt: opensAt.toISOString(),
  };
}

export function assertRegistrationInterestOpen() {
  const gate = getFamilyFlowGate();
  if (gate.granted) {
    throw createStatusError(423, 'Registration closed on 13 March 2026 at 11:59 PM.');
  }

  return gate;
}
