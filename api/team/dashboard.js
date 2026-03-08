import { requireUser } from '../_lib/auth.js';
import { allowMethods, sendError, statusFromError } from '../_lib/http.js';
import {
  assertAllowedEmail,
  getMembershipByUserId,
  getTeamById,
  getTeamMembers,
  MAX_TEAM_SIZE,
  serializeMembership,
} from '../_lib/teams.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) {
    return;
  }

  try {
    const user = await requireUser(req);
    assertAllowedEmail(user.email);

    const membership = await getMembershipByUserId(user.id);
    if (!membership) {
      sendError(res, 404, 'No team found for this account');
      return;
    }

    const team = await getTeamById(membership.team_id);
    if (!team) {
      sendError(res, 404, 'Team not found');
      return;
    }

    const members = await getTeamMembers(team.id);
    const approvedMembers = members.filter((member) => member.status === 'approved').map(serializeMembership);
    const pendingMembers = members.filter((member) => member.status === 'pending').map(serializeMembership);

    res.status(200).json({
      viewer: {
        id: user.id,
        email: user.email,
        role: membership.role,
        status: membership.status,
      },
      team: {
        id: team.id,
        name: team.name,
        ownerId: team.created_by,
        joinCode: team.join_code,
        createdAt: team.created_at,
        maxMembers: MAX_TEAM_SIZE,
        approvedCount: approvedMembers.length,
        slotsRemaining: Math.max(0, MAX_TEAM_SIZE - approvedMembers.length),
        isFull: approvedMembers.length >= MAX_TEAM_SIZE,
      },
      members: approvedMembers,
      pendingRequests: pendingMembers,
    });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
