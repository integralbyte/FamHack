import { requireUser } from '../_lib/auth.js';
import { allowMethods, readJsonBody, sendError, statusFromError } from '../_lib/http.js';
import { assertNormalParticipationOpen } from '../_lib/launch.js';
import {
  assertAllowedEmail,
  assertRegisteredRole,
  createUniqueJoinCode,
  getMembershipByUserId,
  sanitizeFullName,
  sanitizeStudyYear,
  sanitizeTeamName,
  upsertProfile,
} from '../_lib/teams.js';
import { getServiceClient } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    assertNormalParticipationOpen();
    const user = await requireUser(req);
    assertAllowedEmail(user.email);
    await assertRegisteredRole(user.id, 'parent');

    const body = readJsonBody(req);
    const fullName = sanitizeFullName(body.fullName);
    const studyYear = sanitizeStudyYear(body.studyYear);
    const teamName = sanitizeTeamName(body.teamName);

    if (!fullName) {
      sendError(res, 400, 'Your name is required');
      return;
    }

    if (teamName.length < 3) {
      sendError(res, 400, 'Team name must be at least 3 characters');
      return;
    }

    if (!studyYear) {
      sendError(res, 400, 'Choose your year of study');
      return;
    }

    const existingMembership = await getMembershipByUserId(user.id);
    if (existingMembership && existingMembership.status !== 'declined') {
      if (existingMembership.status === 'pending') {
        sendError(res, 409, 'Cancel your current join request before creating a family');
        return;
      }

      sendError(res, 409, 'Leave your current family before creating another one');
      return;
    }

    await upsertProfile(user, fullName, studyYear);

    const supabase = getServiceClient();
    const joinCode = await createUniqueJoinCode();
    const { data: team, error: teamError } = await supabase
      .from('teams')
      .insert({
        name: teamName,
        join_code: joinCode,
        created_by: user.id,
      })
      .select('id, name, join_code')
      .single();

    if (teamError) {
      throw new Error(teamError.message);
    }

    const { error: membershipError } = await supabase.from('team_memberships').upsert(
      {
        user_id: user.id,
        team_id: team.id,
        role: 'parent',
        status: 'approved',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      },
      {
        onConflict: 'user_id',
      }
    );

    if (membershipError) {
      await supabase.from('teams').delete().eq('id', team.id);
      throw new Error(membershipError.message);
    }

    res.status(201).json({
      team: {
        id: team.id,
        name: team.name,
        joinCode: team.join_code,
      },
    });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
