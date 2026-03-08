import { requireUser } from '../_lib/auth.js';
import { allowMethods, readJsonBody, sendError, statusFromError } from '../_lib/http.js';
import { assertAllowedEmail, getProfileByUserId, sanitizeRegistrationRole, upsertRegistrationInterest } from '../_lib/teams.js';
import { assertRegistrationInterestOpen, getFamilyFlowGate } from '../_lib/schedule.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) {
    return;
  }

  try {
    const user = await requireUser(req);
    assertAllowedEmail(user.email);

    if (req.method === 'GET') {
      const profile = await getProfileByUserId(user.id);
      const gate = getFamilyFlowGate();
      res.status(200).json({
        viewer: {
          email: user.email,
          role: sanitizeRegistrationRole(profile?.registration_role),
          registeredAt: profile?.registration_registered_at || null,
        },
        familyFlowOpensAt: gate.opensAt,
      });
      return;
    }

    assertRegistrationInterestOpen();
    const body = readJsonBody(req);
    const role = sanitizeRegistrationRole(body.role);

    if (!role) {
      sendError(res, 400, 'Choose whether you are registering as a parent or a child');
      return;
    }

    const result = await upsertRegistrationInterest(user, role);
    res.status(result.alreadyRegistered ? 200 : 201).json({
      viewer: {
        email: user.email,
        role: result.role,
        registeredAt: result.registeredAt,
      },
    });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
