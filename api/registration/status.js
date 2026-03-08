import { requireUser } from '../_lib/auth.js';
import { allowMethods, sendError, statusFromError } from '../_lib/http.js';
import { assertAllowedEmail, getMembershipByUserId, getProfileByUserId, serializeRegistration } from '../_lib/teams.js';
import { getServerLaunchState } from '../_lib/launch.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) {
    return;
  }

  try {
    const user = await requireUser(req);
    assertAllowedEmail(user.email);

    const [profile, membership] = await Promise.all([
      getProfileByUserId(user.id),
      getMembershipByUserId(user.id),
    ]);

    res.status(200).json({
      launch: getServerLaunchState(),
      registration: serializeRegistration(profile),
      membership: membership
        ? {
            id: membership.id,
            teamId: membership.team_id,
            role: membership.role,
            status: membership.status,
          }
        : null,
    });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
