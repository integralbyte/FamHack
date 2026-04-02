import crypto from 'node:crypto';

import { requireUser } from '../_lib/auth.js';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '../_lib/email.js';
import { allowMethods, readJsonBody, sendError, statusFromError } from '../_lib/http.js';
import { assertNormalParticipationOpen } from '../_lib/launch.js';
import {
  assertAllowedEmail,
  assertRegisteredRole,
  createParentInvite,
  formatChildFocusDescription,
  formatChildFocusLabel,
  getMembershipByUserId,
  upsertProfile,
} from '../_lib/teams.js';

function getRequestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || String(req.headers.host || '').trim();
  const proto = forwardedProto || 'https';

  if (!host) {
    return 'https://famhack.vercel.app';
  }

  return `${proto}://${host}`;
}

function buildInviteEmail({ childName, parentInviteLink, focusLabel, focusDescription }) {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0d0d0d;color:#ffe9ce;font-family:'Azeret Mono',ui-monospace,SFMono-Regular,Menlo,monospace;">
    <div style="margin:0 auto;max-width:640px;padding:32px 20px;">
      <div style="border:1px solid rgba(255,233,206,0.18);background:linear-gradient(180deg,rgba(255,233,206,0.05),rgba(255,233,206,0.02));padding:36px 28px;">
        <p style="margin:0 0 14px;color:#fc2f20;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;">FamHack Parent Invite</p>
        <h1 style="margin:0 0 16px;font-size:34px;line-height:1.02;color:#ffe9ce;text-transform:uppercase;">${childName} wants you on their FamHack family.</h1>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.8;color:rgba(255,233,206,0.78);">
          They picked <strong style="color:#ffe9ce;">${focusLabel}</strong> and are ${focusDescription.toLowerCase()}.
        </p>
        <p style="margin:0 0 24px;font-size:14px;line-height:1.8;color:rgba(255,233,206,0.78);">
          Register your family through the link below and FamHack will add them to it automatically when you create the family.
        </p>
        <a href="${parentInviteLink}" style="display:inline-block;padding:14px 20px;background:#fc2f20;color:#ffe9ce;text-decoration:none;text-transform:uppercase;letter-spacing:0.1em;font-size:12px;">Register A Family</a>
        <p style="margin:24px 0 0;font-size:12px;line-height:1.8;color:rgba(255,233,206,0.55);">
          If the button does not work, open this link:<br />
          <a href="${parentInviteLink}" style="color:#ffe9ce;word-break:break-all;">${parentInviteLink}</a>
        </p>
      </div>
    </div>
  </body>
</html>`;
}

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    assertNormalParticipationOpen(req);
    const user = await requireUser(req);
    assertAllowedEmail(user.email);
    await assertRegisteredRole(user, 'child');

    if (!isTransactionalEmailConfigured()) {
      sendError(res, 503, 'Parent invite email is not configured yet. Add RESEND_API_KEY and RESEND_FROM_EMAIL.');
      return;
    }

    const body = readJsonBody(req);
    const childName = String(body.childName || '');
    const parentEmail = String(body.parentEmail || '');
    const studyYear = String(body.studyYear || '');
    const childFocus = body.childFocus;
    const existingMembership = await getMembershipByUserId(user.id);

    if (existingMembership?.status === 'approved') {
      sendError(res, 409, 'You are already in a family');
      return;
    }

    if (existingMembership?.status === 'pending') {
      sendError(res, 409, 'Cancel your current join request before inviting a parent');
      return;
    }

    await upsertProfile(user, childName, studyYear, {
      childFocus,
    });

    const token = crypto.randomBytes(24).toString('base64url');
    const invite = await createParentInvite({
      childUserId: user.id,
      childName,
      parentEmail,
      childFocus,
      token,
    });

    const origin = getRequestOrigin(req);
    const parentInviteLink = `${origin}/register?parentInvite=${encodeURIComponent(invite.token)}`;
    const focusLabel = formatChildFocusLabel(invite.child_focus);
    const focusDescription = formatChildFocusDescription(invite.child_focus) || 'focused on FamHack';

    await sendTransactionalEmail({
      to: invite.parent_email,
      subject: `${invite.child_name} wants to join FamHack with you`,
      html: buildInviteEmail({
        childName: invite.child_name,
        parentInviteLink,
        focusLabel,
        focusDescription,
      }),
      text: `${invite.child_name} wants to join FamHack with you.\n\nThey picked ${focusLabel} and are ${focusDescription.toLowerCase()}.\n\nRegister your family here: ${parentInviteLink}`,
    });

    res.status(200).json({
      invite: {
        id: invite.id,
        parentEmail: invite.parent_email,
        childName: invite.child_name,
        childFocus: invite.child_focus,
        childFocusLabel: focusLabel,
        childFocusDescription: focusDescription,
        createdAt: invite.created_at,
      },
    });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
