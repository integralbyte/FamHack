import { requireUser } from '../_lib/auth.js';
import { allowMethods, sendError, statusFromError } from '../_lib/http.js';
import { assertAllowedEmail, getMembershipByUserId, getTeamById, getTeamMembers } from '../_lib/teams.js';
import { getServiceClient } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    const user = await requireUser(req);
    assertAllowedEmail(user.email);

    const supabase = getServiceClient();
    const membership = await getMembershipByUserId(user.id);
    if (!membership) {
      sendError(res, 404, 'No family found for this account');
      return;
    }

    const team = await getTeamById(membership.team_id);
    const isLeadParent = Boolean(
      team
      && membership.role === 'parent'
      && membership.status === 'approved'
      && team.created_by === user.id
    );

    if (isLeadParent) {
      const members = await getTeamMembers(membership.team_id);
      const otherActiveMembers = members.filter(
        (member) => member.user_id !== user.id && member.status !== 'declined'
      );

      if (!otherActiveMembers.length) {
        const { error: deleteTeamError } = await supabase
          .from('teams')
          .delete()
          .eq('id', membership.team_id);

        if (deleteTeamError) {
          throw new Error(deleteTeamError.message);
        }

        res.status(200).json({
          status: 'deleted',
        });
        return;
      }

      sendError(res, 409, 'Transfer primary parent ownership before leaving this family');
      return;
    }

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
