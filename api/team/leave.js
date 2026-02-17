import { requireUser } from '../_lib/auth.js';
import { allowMethods, sendError, statusFromError } from '../_lib/http.js';
import { assertAllowedEmail, getMembershipByUserId, getTeamMembers } from '../_lib/teams.js';
import { getServiceClient } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    const user = await requireUser(req);
    assertAllowedEmail(user.email);

    const membership = await getMembershipByUserId(user.id);
    if (!membership) {
      sendError(res, 404, 'No family found for this account');
      return;
    }

    if (membership.role === 'parent' && membership.status === 'approved') {
      const members = await getTeamMembers(membership.team_id);
      const approvedChildren = members.filter((member) => member.role === 'child' && member.status === 'approved');

      if (!approvedChildren.length) {
        sendError(res, 409, 'You must transfer parent ownership to an approved child before leaving this family');
        return;
      }

      sendError(res, 409, 'Transfer parent ownership before leaving this family');
      return;
    }

    const supabase = getServiceClient();
    const { error } = await supabase.from('team_memberships').delete().eq('id', membership.id);

    if (error) {
      throw new Error(error.message);
    }

    res.status(200).json({
      status: membership.status === 'pending' ? 'cancelled' : 'left',
    });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
