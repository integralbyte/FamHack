import { requireUser } from '../_lib/auth.js';
import { allowMethods, readJsonBody, sendError, statusFromError } from '../_lib/http.js';
import {
  assertAllowedEmail,
  getMembershipByUserId,
  getTeamByCode,
  sanitizeFullName,
  upsertProfile,
} from '../_lib/teams.js';
import { getServiceClient } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    const user = await requireUser(req);
    assertAllowedEmail(user.email);

    const body = readJsonBody(req);
    const fullName = sanitizeFullName(body.fullName);
    const joinCode = String(body.joinCode || '').trim().toUpperCase();

    if (!fullName) {
      sendError(res, 400, 'Your name is required');
      return;
    }

    if (!joinCode) {
      sendError(res, 400, 'A join code is required');
      return;
    }

    const team = await getTeamByCode(joinCode);
    if (!team) {
      sendError(res, 404, 'That team code is not valid');
      return;
    }

    const existingMembership = await getMembershipByUserId(user.id);
    if (existingMembership?.role === 'parent' && existingMembership.status === 'approved') {
      sendError(res, 409, 'Parents cannot join another team');
      return;
    }

    if (existingMembership?.status === 'approved') {
      sendError(res, 409, 'You already belong to a team');
      return;
    }

    await upsertProfile(user, fullName);

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
      },
      status: 'pending',
    });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
