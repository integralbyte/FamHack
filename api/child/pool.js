import { requireUser } from '../_lib/auth.js';
import { allowMethods, readJsonBody, sendError, statusFromError } from '../_lib/http.js';
import { assertNormalParticipationOpen } from '../_lib/launch.js';
import {
  assertAllowedEmail,
  assertRegisteredRole,
  getMembershipByUserId,
  sanitizeFullName,
  sanitizeStudyYear,
  serializeChildPoolEntry,
  upsertChildPoolEntry,
  upsertProfile,
} from '../_lib/teams.js';

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
    const childFocus = body.childFocus;
    const existingMembership = await getMembershipByUserId(user.id);

    if (!fullName) {
      sendError(res, 400, 'Your name is required');
      return;
    }

    if (!studyYear) {
      sendError(res, 400, 'Choose your year of study');
      return;
    }

    if (existingMembership?.status === 'approved') {
      sendError(res, 409, 'Leave your current family before joining the child pool');
      return;
    }

    if (existingMembership?.status === 'pending') {
      sendError(res, 409, 'Cancel your current join request before joining the child pool');
      return;
    }

    await upsertProfile(user, fullName, studyYear, {
      childFocus,
    });

    const poolEntry = await upsertChildPoolEntry(user.id, childFocus);

    res.status(200).json({
      poolEntry: serializeChildPoolEntry(poolEntry),
      status: 'open',
    });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
