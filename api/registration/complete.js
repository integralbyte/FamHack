import { requireUser } from '../_lib/auth.js';
import { allowMethods, readJsonBody, sendError, statusFromError } from '../_lib/http.js';
import { assertAllowedEmail, getProfileByUserId, getRegisteredRoleMessage, serializeRegistration, upsertRegistrationProfile } from '../_lib/teams.js';
import { getServerLaunchState } from '../_lib/launch.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    const launch = getServerLaunchState();
    if (!launch.isRegistrationOpen) {
      sendError(res, 403, 'Registration closed at 11:59 PM on 13 March 2026.');
      return;
    }

    const user = await requireUser(req);
    assertAllowedEmail(user.email);

    const body = readJsonBody(req);
    const requestedRole = String(body.role || '').trim().toLowerCase();
    const existingProfile = await getProfileByUserId(user.id);
    const existingRegistration = serializeRegistration(existingProfile);

    if (existingRegistration?.role) {
      if (existingRegistration.role !== requestedRole) {
        sendError(
          res,
          409,
          getRegisteredRoleMessage(existingRegistration.role),
          { registration: existingRegistration }
        );
        return;
      }

      res.status(200).json({
        registration: existingRegistration,
      });
      return;
    }

    const profile = await upsertRegistrationProfile(user, requestedRole);

    res.status(200).json({
      registration: serializeRegistration(profile),
    });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
