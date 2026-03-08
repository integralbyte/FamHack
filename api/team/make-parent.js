import { requireUser } from '../_lib/auth.js';
import { allowMethods, readJsonBody, sendError, statusFromError } from '../_lib/http.js';
import {
  assertAllowedEmail,
  getMembershipById,
  getMembershipByUserId,
} from '../_lib/teams.js';
import { getServiceClient } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    const user = await requireUser(req);
    assertAllowedEmail(user.email);

    const actingMembership = await getMembershipByUserId(user.id);
    if (!actingMembership || actingMembership.role !== 'parent' || actingMembership.status !== 'approved') {
      sendError(res, 403, 'Only an approved parent can change family roles');
      return;
    }

    const body = readJsonBody(req);
    const membershipId = String(body.membershipId || '').trim();
    if (!membershipId) {
      sendError(res, 400, 'An approved family member must be selected');
      return;
    }

    const targetMembership = await getMembershipById(membershipId);
    if (!targetMembership || targetMembership.team_id !== actingMembership.team_id) {
      sendError(res, 404, 'That family member was not found');
      return;
    }

    if (targetMembership.user_id === user.id) {
      sendError(res, 409, 'Choose another approved family member');
      return;
    }

    if (targetMembership.status !== 'approved') {
      sendError(res, 409, 'Only approved family members can become a parent');
      return;
    }

    if (targetMembership.role === 'parent') {
      sendError(res, 409, 'This family member is already a parent');
      return;
    }

    const supabase = getServiceClient();
    const { error } = await supabase
      .from('team_memberships')
      .update({
        role: 'parent',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', membershipId);

    if (error) {
      throw new Error(error.message);
    }

    res.status(200).json({
      status: 'promoted',
      membershipId,
    });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
