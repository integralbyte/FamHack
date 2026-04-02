import { requireUser } from '../_lib/auth.js';
import { allowMethods, readJsonBody, sendError, statusFromError } from '../_lib/http.js';
import { assertNormalParticipationOpen } from '../_lib/launch.js';
import {
  assertAllowedEmail,
  getApprovedMemberCount,
  getChildPoolEntryById,
  getMembershipByUserId,
  getTeamLimitMessage,
  isTeamLimitError,
  matchChildPoolEntryToTeam,
  MAX_TEAM_SIZE,
} from '../_lib/teams.js';
import { getServiceClient } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    assertNormalParticipationOpen(req);
    const user = await requireUser(req);
    assertAllowedEmail(user.email);

    const actingMembership = await getMembershipByUserId(user.id);
    if (!actingMembership || actingMembership.role !== 'parent' || actingMembership.status !== 'approved') {
      sendError(res, 403, 'Only approved parents can add children from the pool');
      return;
    }

    const body = readJsonBody(req);
    const poolEntryId = String(body.poolEntryId || '').trim();
    if (!poolEntryId) {
      sendError(res, 400, 'Choose a child from the pool first');
      return;
    }

    const poolEntry = await getChildPoolEntryById(poolEntryId);
    if (!poolEntry || poolEntry.status !== 'open') {
      sendError(res, 404, 'That child is no longer available in the pool.');
      return;
    }

    const existingMembership = await getMembershipByUserId(poolEntry.userId);
    if (existingMembership?.status === 'approved') {
      sendError(res, 409, 'That child is already in a family.');
      return;
    }

    if (existingMembership?.status === 'pending') {
      sendError(res, 409, 'That child already has a pending family request.');
      return;
    }

    const approvedCount = await getApprovedMemberCount(actingMembership.team_id);
    if (approvedCount >= MAX_TEAM_SIZE) {
      sendError(res, 409, getTeamLimitMessage());
      return;
    }

    const matchedPoolEntry = await matchChildPoolEntryToTeam({
      poolEntryId,
      teamId: actingMembership.team_id,
      matchedByUserId: user.id,
    });

    const supabase = getServiceClient();

    try {
      const { error } = await supabase.from('team_memberships').upsert(
        {
          user_id: matchedPoolEntry.userId,
          team_id: actingMembership.team_id,
          role: 'child',
          status: 'approved',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id',
        }
      );

      if (error) {
        if (isTeamLimitError(error)) {
          throw new Error(getTeamLimitMessage());
        }

        throw new Error(error.message);
      }
    } catch (error) {
      await supabase
        .from('child_pool_entries')
        .update({
          status: 'open',
          team_id: null,
          matched_by: null,
        })
        .eq('id', poolEntryId)
        .eq('status', 'matched')
        .eq('team_id', actingMembership.team_id);

      throw error;
    }

    res.status(200).json({
      added: {
        id: matchedPoolEntry.id,
        userId: matchedPoolEntry.userId,
      },
    });
  } catch (error) {
    if (error.message === getTeamLimitMessage()) {
      sendError(res, 409, error.message);
      return;
    }
    sendError(res, statusFromError(error), error.message);
  }
}
