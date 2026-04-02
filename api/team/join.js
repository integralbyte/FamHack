import { requireUser } from '../_lib/auth.js';
import { allowMethods, readJsonBody, sendError, statusFromError } from '../_lib/http.js';
import { assertNormalParticipationOpen } from '../_lib/launch.js';
import {
  assertAllowedEmail,
  assertRegisteredRole,
  getApprovedMemberCount,
  getMembershipByUserId,
  getTeamLimitMessage,
  getTeamByCode,
  MAX_TEAM_SIZE,
  sanitizeFullName,
  sanitizeStudyYear,
  upsertProfile,
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
    await assertRegisteredRole(user, 'child');

    const body = readJsonBody(req);
    const fullName = sanitizeFullName(body.fullName);
    const studyYear = sanitizeStudyYear(body.studyYear);
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

    await upsertProfile(user, fullName, studyYear);

    const supabase = getServiceClient();
    const { error } = await supabase.from('team_memberships').upsert(
      {
        user_id: user.id,
        team_id: team.id,
        role: 'child',
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

    res.status(200).json({
      team: {
        id: team.id,
        name: team.name,
        joinCode: team.join_code,
        approvedCount,
        maxMembers: MAX_TEAM_SIZE,
      },
      status: 'pending',
    });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
