import { getEnv } from './env.js';
import { getServiceClient } from './supabase.js';

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 6;
export const MAX_TEAM_SIZE = 15;
export const TEAM_LIMIT_ERROR_CODE = 'team_member_limit_reached';
export const PARENT_TRANSFER_ERROR_CODE = 'parent_transfer_failed';
export const STUDY_YEAR_OPTIONS = ['year_1', 'year_2', 'year_3', 'year_4', 'masters', 'phd'];

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

export function sanitizeTeamName(teamName) {
  return String(teamName || '').trim().replace(/\s+/g, ' ');
}

export function makeInviteLink(origin, joinCode) {
  return `${origin.replace(/\/$/, '')}/join?code=${encodeURIComponent(joinCode)}`;
}

export async function upsertProfile(user, fullName, studyYear = '') {
  const supabase = getServiceClient();
  const payload = {
    id: user.id,
    email: normalizeEmail(user.email),
    full_name: sanitizeFullName(fullName) || null,
    study_year: sanitizeStudyYear(studyYear) || null,
  };

  const { error } = await supabase.from('profiles').upsert(payload, {
    onConflict: 'id',
  });

  if (error) {
    throw new Error(error.message);
  }
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
    .select('id, email, full_name, study_year')
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

export function serializeMembership(member) {
  return {
    id: member.id,
    role: member.role,
    status: member.status,
    reviewedAt: member.reviewed_at,
    createdAt: member.created_at,
    fullName: member.profile?.full_name || '',
    email: member.profile?.email || '',
    studyYear: member.profile?.study_year || '',
    studyYearLabel: formatStudyYearLabel(member.profile?.study_year),
  };
}
