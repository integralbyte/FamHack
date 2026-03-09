import { getServiceClient } from './supabase.js';
import { assertAllowedEmail, normalizeEmail } from './teams.js';

export const SECRET_KEYRING_TOTAL = 10;

const SECRET_PAGE_SOURCE = 'R2FzdGVy==';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeSecretPageSource(source) {
  const normalizedSource = String(source || '').trim();
  return normalizedSource || SECRET_PAGE_SOURCE;
}

function parseInventory(total, claimed) {
  const normalizedTotal = Number(total) || SECRET_KEYRING_TOTAL;
  const normalizedClaimed = Math.max(0, Number(claimed) || 0);

  return {
    total: normalizedTotal,
    claimed: normalizedClaimed,
    remaining: Math.max(normalizedTotal - normalizedClaimed, 0),
  };
}

function mapClaimErrorMessage(message) {
  const normalizedMessage = String(message || '').trim();

  if (
    normalizedMessage === 'secret_keyring_email_required'
    || normalizedMessage === 'Enter an email address to claim a key ring.'
  ) {
    return 'Enter an email address to claim a key ring.';
  }

  if (
    normalizedMessage === 'secret_keyring_email_invalid'
    || normalizedMessage === 'Enter a valid email address.'
  ) {
    return 'Enter a valid email address.';
  }

  if (
    normalizedMessage === 'secret_keyring_already_claimed'
    || normalizedMessage.includes('secret_keyring_claims_email_idx')
    || normalizedMessage.includes('duplicate key value')
  ) {
    return 'That email has already claimed a key ring.';
  }

  if (normalizedMessage === 'secret_keyring_sold_out') {
    return 'All FamHack key rings have already been claimed.';
  }

  return normalizedMessage;
}

export async function getSecretKeyringStatus() {
  const supabase = getServiceClient();
  const { count, error } = await supabase
    .from('secret_keyring_claims')
    .select('id', { count: 'exact', head: true });

  if (error) {
    throw new Error(error.message);
  }

  return parseInventory(SECRET_KEYRING_TOTAL, count || 0);
}

export async function claimSecretKeyring(email, { acceptedTerms = false, source } = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error('Enter an email address to claim a key ring.');
  }

  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    throw new Error('Enter a valid email address.');
  }

  assertAllowedEmail(normalizedEmail);

  if (!acceptedTerms) {
    throw new Error('You must agree to attend and participate in FamHack to claim a key ring.');
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .rpc('claim_secret_keyring', {
      p_email: normalizedEmail,
      p_source: normalizeSecretPageSource(source),
    })
    .single();

  if (error) {
    throw new Error(mapClaimErrorMessage(error.message));
  }

  return {
    id: data.claim_id,
    email: data.email,
    source: data.source,
    inventory: parseInventory(data.total, data.claimed),
  };
}
