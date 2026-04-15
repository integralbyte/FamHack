import { requireUser } from '../_lib/auth.js';
import { allowMethods, readJsonBody, sendError, statusFromError } from '../_lib/http.js';
import { assertNormalParticipationOpen } from '../_lib/launch.js';
import {
  assertAllowedEmail,
  cancelPendingParentInvitesForUser,
  getApprovedMemberCount,
  getMembershipByUserId,
  getProfileByUserId,
  getTeamLimitMessage,
  getTeamByCode,
  MAX_TEAM_SIZE,
  requireRegistration,
  sanitizeFullName,
  sanitizeChildFocus,
  sanitizeStudyYear,
  upsertProfile,
  withdrawChildPoolEntryForUser,
} from '../_lib/teams.js';
import { getServiceClient } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    assertNormalParticipationOpen(req);
    const user = await requireUser(req);
    assertAllowedEmail(user.email);
    const profile = await getProfileByUserId(user.id);
    const registration = requireRegistration(user, profile);

    const body = readJsonBody(req);
    const fullName = sanitizeFullName(body.fullName);
    const studyYear = sanitizeStudyYear(body.studyYear);
    const childFocus = sanitizeChildFocus(body.childFocus);
    const joinCode = String(body.joinCode || '').trim().toUpperCase();

    if (!fullName) {
      sendError(res, 400, 'Your name is required');
      return;
    }

    if (!joinCode) {
      sendError(res, 400, 'A join code is required');
      return;
    }

    if (!studyYear) {
      sendError(res, 400, 'Choose your year of study');
      return;
    }

    if (registration.role === 'child' && !childFocus) {
      sendError(res, 400, 'Choose Hunter or Hacker before continuing');
      return;
    }

    const team = await getTeamByCode(joinCode);
    if (!team) {
      sendError(res, 404, 'That team code is not valid');
      return;
    }

    const existingMembership = await getMembershipByUserId(user.id);

    if (existingMembership?.status === 'approved') {
      if (existingMembership.team_id === team.id) {
        sendError(res, 409, 'You are already in this family');
        return;
      }

      sendError(res, 409, 'Leave your current family before joining another one');
      return;
    }

    if (existingMembership?.status === 'pending') {
      if (existingMembership.team_id === team.id) {
        sendError(res, 409, 'Your request to join this family is already pending');
        return;
      }

      sendError(res, 409, 'Cancel your current join request before requesting another family');
      return;
    }

    const approvedCount = await getApprovedMemberCount(team.id);
    if (approvedCount >= MAX_TEAM_SIZE) {
      sendError(res, 409, getTeamLimitMessage());
      return;
    }

    await upsertProfile(user, fullName, studyYear, {
      ...(registration.role === 'child' ? { childFocus } : {}),
    });

    const supabase = getServiceClient();
    const { error } = await supabase.from('team_memberships').upsert(
      {
        user_id: user.id,
        team_id: team.id,
        role: registration.role,
        status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
      },
      {
        onConflict: 'user_id',
      }
    );

    if (error) {
      throw new Error(error.message);
    }

    if (registration.role === 'child') {
      try {
        await withdrawChildPoolEntryForUser(user.id);
        await cancelPendingParentInvitesForUser(user.id);
      } catch (cleanupError) {
        console.error(cleanupError);
      }
    }

    res.status(200).json({
      team: {
        id: team.id,
        name: team.name,
        joinCode: team.join_code,
        approvedCount,
        maxMembers: MAX_TEAM_SIZE,
      },
      requestedRole: registration.role,
      status: 'pending',
    });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
