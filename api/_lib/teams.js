import { getEnv } from './env.js';
import { getServiceClient } from './supabase.js';

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 6;
export const MAX_TEAM_SIZE = 15;
export const TEAM_LIMIT_ERROR_CODE = 'team_member_limit_reached';
export const PARENT_TRANSFER_ERROR_CODE = 'parent_transfer_failed';
export const STUDY_YEAR_OPTIONS = ['year_1', 'year_2', 'year_3', 'year_4', 'masters', 'phd'];
export const JOIN_ROLE_OPTIONS = ['parent', 'child'];
export const CHILD_FOCUS_OPTIONS = ['hunter', 'hacker'];

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function assertAllowedEmail(email) {
  const domain = getEnv('ALLOWED_EMAIL_DOMAIN', 'ed.ac.uk').trim().toLowerCase();

  if (!domain) {
    return;
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail.endsWith(`@${domain}`)) {
    throw new Error(`Please use your @${domain} email address`);
  }
}

export function sanitizeFullName(fullName) {
  return String(fullName || '').trim().replace(/\s+/g, ' ');
}

export function sanitizeStudyYear(studyYear) {
  const normalizedStudyYear = String(studyYear || '').trim().toLowerCase();
  return STUDY_YEAR_OPTIONS.includes(normalizedStudyYear) ? normalizedStudyYear : '';
}

export function sanitizeJoinRole(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedRole === 'student') {
    return 'child';
  }
  return JOIN_ROLE_OPTIONS.includes(normalizedRole) ? normalizedRole : '';
}

export function sanitizeChildFocus(focus) {
  const normalizedFocus = String(focus || '').trim().toLowerCase();
  return CHILD_FOCUS_OPTIONS.includes(normalizedFocus) ? normalizedFocus : '';
}

export function formatStudyYearLabel(studyYear) {
  switch (sanitizeStudyYear(studyYear)) {
    case 'year_1':
      return 'Year 1';
    case 'year_2':
      return 'Year 2';
    case 'year_3':
      return 'Year 3';
    case 'year_4':
      return 'Year 4';
    case 'masters':
      return "Master's";
    case 'phd':
      return 'PhD';
    default:
      return '';
  }
}

export function formatMemberRoleLabel(role, { lead = false } = {}) {
  if (lead && role === 'parent') {
    return 'Primary Parent';
  }

  return role === 'parent' ? 'Parent' : 'Child';
}

export function formatChildFocusLabel(focus) {
  switch (sanitizeChildFocus(focus)) {
    case 'hunter':
      return 'Hunter';
    case 'hacker':
      return 'Hacker';
    default:
      return '';
  }
}

export function formatChildFocusDescription(focus) {
  switch (sanitizeChildFocus(focus)) {
    case 'hunter':
      return 'Focused on the scavenger hunt';
    case 'hacker':
      return 'Focused on building the best products';
    default:
      return '';
  }
}

export function sanitizeTeamName(teamName) {
  return String(teamName || '').trim().replace(/\s+/g, ' ');
}

export function makeInviteLink(origin, joinCode) {
  return `${origin.replace(/\/$/, '')}/join?code=${encodeURIComponent(joinCode)}`;
}

async function upsertProfileFields(user, fields = {}) {
  const supabase = getServiceClient();
  const payload = {
    id: user.id,
    email: normalizeEmail(user.email),
    ...fields,
  };

  const { error } = await supabase.from('profiles').upsert(payload, {
    onConflict: 'id',
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function upsertProfile(user, fullName, studyYear = '', options = {}) {
  const payload = {
    full_name: sanitizeFullName(fullName) || null,
    study_year: sanitizeStudyYear(studyYear) || null,
  };

  if (options.childFocus !== undefined) {
    payload.child_focus = sanitizeChildFocus(options.childFocus) || null;
  }

  await upsertProfileFields(user, payload);
}

export async function upsertChildFocus(user, childFocus) {
  const normalizedFocus = sanitizeChildFocus(childFocus);
  if (!normalizedFocus) {
    throw new Error('Choose Hunter or Hacker before continuing');
  }

  await upsertProfileFields(user, {
    child_focus: normalizedFocus,
  });
}

export function getRegisteredRoleMessage(role) {
  return `You already have an account registered as a ${role === 'parent' ? 'Parent' : 'Child'}.`;
}

export function serializeRegistration(source) {
  const registeredRole = sanitizeJoinRole(
    source?.registered_role
      || source?.user_metadata?.registered_role
      || source?.app_metadata?.registered_role
  );
  const registeredAt = source?.registration_completed_at
    || source?.user_metadata?.registration_completed_at
    || source?.app_metadata?.registration_completed_at
    || null;

  if (!registeredRole) {
    return null;
  }

  return {
    role: registeredRole,
    roleLabel: formatMemberRoleLabel(registeredRole),
    registeredAt,
  };
}

export async function assertRegisteredRole(user, expectedRole) {
  const registration = serializeRegistration(user);

  if (!registration?.role) {
    throw new Error('Registration has closed for this account.');
  }

  if (registration.role !== expectedRole) {
    throw new Error(
      expectedRole === 'parent'
        ? 'Only accounts registered as a Parent can create a Family.'
        : 'Only accounts registered as a Child can join a Family.'
    );
  }

  return registration;
}

export async function getProfileByUserId(userId) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, study_year, child_focus')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function upsertRegistration(user, role) {
  const normalizedRole = sanitizeJoinRole(role);
  if (!normalizedRole) {
    throw new Error('Choose whether you are registering as a Parent or Child');
  }

  const supabase = getServiceClient();
  const existingMetadata = user?.user_metadata && typeof user.user_metadata === 'object'
    ? user.user_metadata
    : {};
  const registrationCompletedAt = existingMetadata.registration_completed_at || new Date().toISOString();
  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...existingMetadata,
      registered_role: normalizedRole,
      registration_completed_at: registrationCompletedAt,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return serializeRegistration(data.user);
}

export async function getMembershipByUserId(userId) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('team_memberships')
    .select('id, team_id, user_id, role, status, reviewed_by, reviewed_at, created_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getMembershipById(membershipId) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('team_memberships')
    .select('id, team_id, user_id, role, status, reviewed_by, reviewed_at, created_at')
    .eq('id', membershipId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getTeamById(teamId) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, join_code, created_by, created_at')
    .eq('id', teamId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getTeamByCode(joinCode) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, join_code, created_by, created_at')
    .eq('join_code', String(joinCode || '').trim().toUpperCase())
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getTeamMembers(teamId) {
  const supabase = getServiceClient();
  const { data: memberships, error } = await supabase
    .from('team_memberships')
    .select('id, team_id, user_id, role, status, reviewed_by, reviewed_at, created_at')
    .eq('team_id', teamId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  if (!memberships.length) {
    return [];
  }

  const profileIds = memberships.map((membership) => membership.user_id);
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, email, full_name, study_year, child_focus')
    .in('id', profileIds);

  if (profilesError) {
    throw new Error(profilesError.message);
  }

  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));

  return memberships.map((membership) => ({
    ...membership,
    profile: profileMap.get(membership.user_id) || null,
  }));
}

export async function getApprovedMemberCount(teamId) {
  const supabase = getServiceClient();
  const { count, error } = await supabase
    .from('team_memberships')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', teamId)
    .eq('status', 'approved');

  if (error) {
    throw new Error(error.message);
  }

  return count || 0;
}

export function getTeamLimitMessage(maxTeamSize = MAX_TEAM_SIZE) {
  return `This family is full. Families can have at most ${maxTeamSize} people.`;
}

export function isTeamLimitError(error) {
  return String(error?.message || '') === TEAM_LIMIT_ERROR_CODE;
}

export function isParentTransferError(error) {
  return String(error?.message || '') === PARENT_TRANSFER_ERROR_CODE;
}

function generateJoinCode() {
  let code = '';
  for (let index = 0; index < JOIN_CODE_LENGTH; index += 1) {
    const randomIndex = Math.floor(Math.random() * JOIN_CODE_ALPHABET.length);
    code += JOIN_CODE_ALPHABET[randomIndex];
  }
  return code;
}

export async function createUniqueJoinCode() {
  const supabase = getServiceClient();

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const joinCode = generateJoinCode();
    const { data, error } = await supabase
      .from('teams')
      .select('id')
      .eq('join_code', joinCode)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return joinCode;
    }
  }

  throw new Error('Unable to generate a unique join code');
}

function mapProfilesToRecords(records, profiles) {
  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
  return (records || []).map((record) => ({
    ...record,
    profile: profileMap.get(record.user_id) || null,
  }));
}

async function hydratePoolEntries(entries) {
  if (!entries.length) {
    return [];
  }

  const supabase = getServiceClient();
  const profileIds = entries.map((entry) => entry.user_id);
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, study_year, child_focus')
    .in('id', profileIds);

  if (error) {
    throw new Error(error.message);
  }

  return mapProfilesToRecords(entries, profiles);
}

export async function getChildPoolEntryByUserId(userId) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('child_pool_entries')
    .select('id, user_id, focus, status, team_id, matched_by, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  const [entry] = await hydratePoolEntries([data]);
  return entry || null;
}

export async function getChildPoolEntryById(poolEntryId) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('child_pool_entries')
    .select('id, user_id, focus, status, team_id, matched_by, created_at, updated_at')
    .eq('id', poolEntryId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  const [entry] = await hydratePoolEntries([data]);
  return entry || null;
}

export async function listOpenChildPoolEntries() {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('child_pool_entries')
    .select('id, user_id, focus, status, team_id, matched_by, created_at, updated_at')
    .eq('status', 'open')
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return hydratePoolEntries(data || []);
}

export async function upsertChildPoolEntry(userId, focus) {
  const normalizedFocus = sanitizeChildFocus(focus);
  if (!normalizedFocus) {
    throw new Error('Choose Hunter or Hacker before continuing');
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('child_pool_entries')
    .upsert(
      {
        user_id: userId,
        focus: normalizedFocus,
        status: 'open',
        team_id: null,
        matched_by: null,
      },
      {
        onConflict: 'user_id',
      }
    )
    .select('id, user_id, focus, status, team_id, matched_by, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const [entry] = await hydratePoolEntries([data]);
  return entry || null;
}

export async function matchChildPoolEntryToTeam({ poolEntryId, teamId, matchedByUserId }) {
  const supabase = getServiceClient();
  const { data: poolEntry, error: lookupError } = await supabase
    .from('child_pool_entries')
    .select('id, user_id, focus, status, team_id, matched_by, created_at, updated_at')
    .eq('id', poolEntryId)
    .maybeSingle();

  if (lookupError) {
    throw new Error(lookupError.message);
  }

  if (!poolEntry || poolEntry.status !== 'open') {
    throw new Error('That child is no longer available in the pool.');
  }

  const { data, error } = await supabase
    .from('child_pool_entries')
    .update({
      status: 'matched',
      team_id: teamId,
      matched_by: matchedByUserId,
    })
    .eq('id', poolEntryId)
    .eq('status', 'open')
    .select('id, user_id, focus, status, team_id, matched_by, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const [entry] = await hydratePoolEntries([data]);
  return entry || null;
}

export async function resolveChildPoolEntryForUser(userId, teamId, matchedByUserId) {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from('child_pool_entries')
    .update({
      status: 'matched',
      team_id: teamId,
      matched_by: matchedByUserId,
    })
    .eq('user_id', userId)
    .eq('status', 'open');

  if (error) {
    throw new Error(error.message);
  }
}

export async function withdrawChildPoolEntryForUser(userId) {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from('child_pool_entries')
    .update({
      status: 'withdrawn',
      team_id: null,
      matched_by: null,
    })
    .eq('user_id', userId)
    .eq('status', 'open');

  if (error) {
    throw new Error(error.message);
  }
}

export async function getPendingParentInviteByChildUserId(userId) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('parent_registration_invites')
    .select('id, token, child_user_id, child_name, parent_email, child_focus, status, claimed_by, claimed_team_id, claimed_at, created_at, updated_at')
    .eq('child_user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getParentInviteByToken(token) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('parent_registration_invites')
    .select('id, token, child_user_id, child_name, parent_email, child_focus, status, claimed_by, claimed_team_id, claimed_at, created_at, updated_at')
    .eq('token', String(token || '').trim())
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function createParentInvite({ childUserId, childName, parentEmail, childFocus, token }) {
  const normalizedFocus = sanitizeChildFocus(childFocus);
  const normalizedParentEmail = normalizeEmail(parentEmail);
  const normalizedChildName = sanitizeFullName(childName);

  if (!normalizedChildName) {
    throw new Error('Your name is required');
  }

  if (!normalizedParentEmail) {
    throw new Error('Enter a parent email address');
  }

  if (!normalizedFocus) {
    throw new Error('Choose Hunter or Hacker before continuing');
  }

  const supabase = getServiceClient();
  const { error: cancelError } = await supabase
    .from('parent_registration_invites')
    .update({
      status: 'cancelled',
    })
    .eq('child_user_id', childUserId)
    .eq('status', 'pending');

  if (cancelError) {
    throw new Error(cancelError.message);
  }

  const { data, error } = await supabase
    .from('parent_registration_invites')
    .insert({
      token,
      child_user_id: childUserId,
      child_name: normalizedChildName,
      parent_email: normalizedParentEmail,
      child_focus: normalizedFocus,
      status: 'pending',
    })
    .select('id, token, child_user_id, child_name, parent_email, child_focus, status, claimed_by, claimed_team_id, claimed_at, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function claimParentInvite({ token, claimedByUserId, claimedTeamId }) {
  const invite = await getParentInviteByToken(token);
  if (!invite || invite.status !== 'pending') {
    throw new Error('That parent invite is no longer available.');
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('parent_registration_invites')
    .update({
      status: 'claimed',
      claimed_by: claimedByUserId,
      claimed_team_id: claimedTeamId,
      claimed_at: new Date().toISOString(),
    })
    .eq('id', invite.id)
    .eq('status', 'pending')
    .select('id, token, child_user_id, child_name, parent_email, child_focus, status, claimed_by, claimed_team_id, claimed_at, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export function serializeMembership(member) {
  return {
    id: member.id,
    userId: member.user_id,
    role: member.role,
    status: member.status,
    reviewedAt: member.reviewed_at,
    createdAt: member.created_at,
    fullName: member.profile?.full_name || '',
    email: member.profile?.email || '',
    studyYear: member.profile?.study_year || '',
    studyYearLabel: formatStudyYearLabel(member.profile?.study_year),
    childFocus: member.profile?.child_focus || '',
    childFocusLabel: formatChildFocusLabel(member.profile?.child_focus),
    childFocusDescription: formatChildFocusDescription(member.profile?.child_focus),
  };
}

export function serializeChildPoolEntry(entry) {
  return {
    id: entry.id,
    userId: entry.user_id,
    status: entry.status,
    teamId: entry.team_id || null,
    fullName: entry.profile?.full_name || '',
    email: entry.profile?.email || '',
    studyYear: entry.profile?.study_year || '',
    studyYearLabel: formatStudyYearLabel(entry.profile?.study_year),
    childFocus: entry.focus || entry.profile?.child_focus || '',
    childFocusLabel: formatChildFocusLabel(entry.focus || entry.profile?.child_focus),
    childFocusDescription: formatChildFocusDescription(entry.focus || entry.profile?.child_focus),
    createdAt: entry.created_at,
  };
}
