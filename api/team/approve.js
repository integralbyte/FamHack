import { requireUser } from '../_lib/auth.js';
import { allowMethods, readJsonBody, sendError, statusFromError } from '../_lib/http.js';
import { assertAllowedEmail, getMembershipByUserId } from '../_lib/teams.js';
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
      sendError(res, 403, 'Only approved parents can review join requests');
      return;
    }

    const body = readJsonBody(req);
    const membershipId = String(body.membershipId || '').trim();
    const decision = body.decision === 'declined' ? 'declined' : body.decision === 'approved' ? 'approved' : null;

    if (!membershipId || !decision) {
      sendError(res, 400, 'A membership id and valid decision are required');
      return;
    }

    const supabase = getServiceClient();
    const { data: targetMembership, error: targetError } = await supabase
      .from('team_memberships')
      .select('id, team_id, role, status')
      .eq('id', membershipId)
      .maybeSingle();

    if (targetError) {
      throw new Error(targetError.message);
    }

    if (!targetMembership || targetMembership.team_id !== actingMembership.team_id) {
      sendError(res, 404, 'Join request not found');
      return;
    }

    if (targetMembership.role !== 'child' || targetMembership.status !== 'pending') {
      sendError(res, 409, 'Only pending child requests can be reviewed');
      return;
    }

    const { error } = await supabase
      .from('team_memberships')
      .update({
        status: decision,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', membershipId);

    if (error) {
      throw new Error(error.message);
    }

    res.status(200).json({ status: decision });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
