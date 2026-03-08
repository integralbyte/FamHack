import { requireUser } from '../_lib/auth.js';
import { allowMethods, readJsonBody, sendError, statusFromError } from '../_lib/http.js';
import {
  assertAllowedEmail,
  getApprovedMemberCount,
  getMembershipByUserId,
  getTeamLimitMessage,
  isTeamLimitError,
  MAX_TEAM_SIZE,
  sanitizeJoinRole,
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
      sendError(res, 403, 'Only approved parents can review join requests');
      return;
    }

    const body = readJsonBody(req);
    const membershipId = String(body.membershipId || '').trim();
    const decision = body.decision === 'declined' ? 'declined' : body.decision === 'approved' ? 'approved' : null;
    const approvedRole = sanitizeJoinRole(body.role);

    if (!membershipId || !decision) {
      sendError(res, 400, 'A membership id and valid decision are required');
      return;
    }

    if (decision === 'approved' && !approvedRole) {
      sendError(res, 400, 'Choose whether this person is joining as a parent or a student');
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

    if (targetMembership.status !== 'pending') {
      sendError(res, 409, 'Only pending join requests can be reviewed');
      return;
    }

    if (decision === 'approved') {
      const approvedCount = await getApprovedMemberCount(actingMembership.team_id);
      if (approvedCount >= MAX_TEAM_SIZE) {
        sendError(res, 409, getTeamLimitMessage());
        return;
      }
    }

    const { error } = await supabase
      .from('team_memberships')
      .update({
        ...(decision === 'approved' ? { role: approvedRole } : {}),
        status: decision,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', membershipId);

    if (error) {
      if (isTeamLimitError(error)) {
        sendError(res, 409, getTeamLimitMessage());
        return;
      }
      throw new Error(error.message);
    }

    res.status(200).json({ status: decision });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
