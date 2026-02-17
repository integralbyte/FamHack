import { requireUser } from '../_lib/auth.js';
import { allowMethods, readJsonBody, sendError, statusFromError } from '../_lib/http.js';
import {
  assertAllowedEmail,
  getMembershipById,
  getMembershipByUserId,
  isParentTransferError,
} from '../_lib/teams.js';
import { getServiceClient } from '../_lib/supabase.js';

async function transferParentFallback(supabase, actingMembership, targetMembership, actingUserId) {
  const { error: promoteError } = await supabase
    .from('team_memberships')
    .update({
      role: 'parent',
      reviewed_by: actingUserId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', targetMembership.id);

  if (promoteError) {
    throw new Error(promoteError.message);
  }

  const { error: demoteError } = await supabase
    .from('team_memberships')
    .update({
      role: 'child',
      reviewed_by: actingUserId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', actingMembership.id);

  if (demoteError) {
    await supabase
      .from('team_memberships')
      .update({
        role: 'child',
        reviewed_by: actingUserId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', targetMembership.id);

    throw new Error(demoteError.message);
  }

  const { error: teamError } = await supabase
    .from('teams')
    .update({
      created_by: targetMembership.user_id,
    })
    .eq('id', actingMembership.team_id);

  if (teamError) {
    await supabase
      .from('team_memberships')
      .update({
        role: 'parent',
        reviewed_by: actingUserId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', actingMembership.id);

    await supabase
      .from('team_memberships')
      .update({
        role: 'child',
        reviewed_by: actingUserId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', targetMembership.id);

    throw new Error(teamError.message);
  }
}

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    const user = await requireUser(req);
    assertAllowedEmail(user.email);

    const actingMembership = await getMembershipByUserId(user.id);
    if (!actingMembership || actingMembership.role !== 'parent' || actingMembership.status !== 'approved') {
      sendError(res, 403, 'Only the current parent can assign a new parent');
      return;
    }

    const body = readJsonBody(req);
    const membershipId = String(body.membershipId || '').trim();
    if (!membershipId) {
      sendError(res, 400, 'An approved child must be selected');
      return;
    }

    const targetMembership = await getMembershipById(membershipId);
    if (!targetMembership || targetMembership.team_id !== actingMembership.team_id) {
      sendError(res, 404, 'That family member was not found');
      return;
    }

    if (targetMembership.role !== 'child' || targetMembership.status !== 'approved') {
      sendError(res, 409, 'Only approved children can become the new parent');
      return;
    }

    const supabase = getServiceClient();
    const { error: rpcError } = await supabase.rpc('transfer_team_parent', {
      p_team_id: actingMembership.team_id,
      p_current_parent_id: user.id,
      p_new_parent_membership_id: membershipId,
    });

    if (rpcError) {
      if (String(rpcError.message || '').includes('Could not find the function')) {
        await transferParentFallback(supabase, actingMembership, targetMembership, user.id);
      } else if (isParentTransferError(rpcError)) {
        sendError(res, 409, 'Unable to transfer parent ownership right now');
        return;
      } else {
        throw new Error(rpcError.message);
      }
    }

    res.status(200).json({
      status: 'transferred',
      newParentUserId: targetMembership.user_id,
    });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
