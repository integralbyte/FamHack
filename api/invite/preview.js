import { allowMethods, sendError } from '../_lib/http.js';
import {
  formatChildFocusDescription,
  formatChildFocusLabel,
  getParentInviteByToken,
} from '../_lib/teams.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) {
    return;
  }

  try {
    const parentInviteToken = String(req.query.parentInvite || '').trim();
    if (!parentInviteToken) {
      sendError(res, 400, 'A parent invite token is required');
      return;
    }

    const invite = await getParentInviteByToken(parentInviteToken);
    if (!invite) {
      sendError(res, 404, 'That parent invite was not found');
      return;
    }

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).json({
      invite: {
        childName: invite.child_name,
        childFocus: invite.child_focus,
        childFocusLabel: formatChildFocusLabel(invite.child_focus),
        childFocusDescription: formatChildFocusDescription(invite.child_focus),
        status: invite.status,
      },
    });
  } catch (error) {
    sendError(res, 500, error.message);
  }
}
