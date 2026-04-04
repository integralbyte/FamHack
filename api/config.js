import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  assertAdminConfigured,
  assertSameOriginAdminRequest,
  clearAdminSession,
  createAdminSession,
  delayAdminFailure,
  getAdminDashboardData,
  requireAdminSession,
  setAdminPageSecurityHeaders,
  setAdminSecurityHeaders,
  verifyAdminPassword,
} from './_lib/admin.js';
import { requireUser } from './_lib/auth.js';
import { assertServerEnv, getPublicConfig } from './_lib/env.js';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from './_lib/email.js';
import { allowMethods, readJsonBody, sendError, statusFromError } from './_lib/http.js';
import { claimSecretKeyring, getSecretKeyringStatus } from './_lib/keyring.js';
import { assertNormalParticipationOpen, getServerLaunchState, normalizePageSlug } from './_lib/launch.js';
import { getServiceClient } from './_lib/supabase.js';
import {
  assertAllowedEmail,
  assertRegisteredRole,
  cancelPendingParentInvitesForUser,
  createParentInvite,
  formatChildFocusDescription,
  formatChildFocusLabel,
  getApprovedMemberCount,
  getChildPoolEntryById,
  getChildPoolEntryByUserId,
  getMembershipByUserId,
  getParentInviteByToken,
  getPendingParentInviteByChildUserId,
  getProfileByUserId,
  getRegisteredRoleMessage,
  getTeamById,
  getTeamLimitMessage,
  isTeamLimitError,
  matchChildPoolEntryToTeam,
  MAX_TEAM_SIZE,
  sanitizeFullName,
  sanitizeStudyYear,
  serializeChildPoolEntry,
  serializeRegistration,
  upsertChildPoolEntry,
  upsertProfile,
  upsertRegistration,
  withdrawChildPoolEntryForUser,
} from './_lib/teams.js';

const publicPageFiles = new Map([
  ['admin', 'admin.html'],
  ['easter', 'secret-keyring.html'],
  ['gaster-secret', 'gaster-secret.html'],
]);

const protectedPageFiles = new Map([
  ['about', 'about.html'],
  ['tracks', 'tracks.html'],
  ['register', 'register.html'],
  ['join', 'join.html'],
  ['dashboard', 'dashboard.html'],
  ['ctf', 'ctf.html'],
]);

const pageFiles = new Map([
  ...publicPageFiles,
  ...protectedPageFiles,
]);

function renderComingSoonPage(slug) {
  const isFamilySetupPage = slug === 'join' || slug === 'dashboard';
  const isInfoPage = slug === 'about' || slug === 'tracks';
  const title = isFamilySetupPage ? 'Family setup opens on 20 March' : 'Coming soon';
  const copy = isFamilySetupPage
    ? 'Sign in, create a family, and join a family all unlock on 20 March 2026.'
    : isInfoPage
      ? 'This page unlocks at 11:00 AM on 28 March 2026.'
      : 'This page unlocks on 14 March 2026.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title} | FamHack</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <style>
    :root {
      color-scheme: dark;
      --bg: #171410;
      --panel: rgba(255, 233, 206, 0.08);
      --text: #ffe9ce;
      --muted: rgba(255, 233, 206, 0.72);
      --accent: #fc2f20;
      --border: rgba(255, 233, 206, 0.18);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background:
        radial-gradient(circle at top, rgba(252, 47, 32, 0.16), transparent 40%),
        linear-gradient(180deg, #1f1913 0%, var(--bg) 55%);
      color: var(--text);
      font-family: "Azeret Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    main {
      width: min(100%, 640px);
      padding: 40px 32px;
      border: 1px solid var(--border);
      background: var(--panel);
      backdrop-filter: blur(18px);
    }

    p {
      margin: 0;
      line-height: 1.6;
    }

    .eyebrow {
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.18em;
      font-size: 0.78rem;
      margin-bottom: 14px;
    }

    h1 {
      margin: 0 0 12px;
      font-size: clamp(2rem, 7vw, 3.8rem);
      line-height: 0.95;
      text-transform: uppercase;
    }

    .copy {
      color: var(--muted);
      max-width: 32rem;
    }

    a {
      display: inline-flex;
      margin-top: 24px;
      color: var(--text);
      text-decoration: none;
      border-bottom: 1px solid var(--accent);
      padding-bottom: 4px;
    }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">FamHack</p>
    <h1>${title}</h1>
    <p class="copy">${copy}</p>
    <a href="/">Back home</a>
  </main>
</body>
</html>`;
}

async function loadLaunchPage(fileName) {
  return readFile(new URL(`./_lib/launch-pages/${fileName}`, import.meta.url), 'utf8');
}

function resolvePageFile(slug, launch) {
  const publicPageFile = publicPageFiles.get(slug);
  if (publicPageFile) {
    return publicPageFile;
  }

  if (slug === 'register') {
    return launch.isRegistrationOpen ? 'register-prereg.html' : 'register.html';
  }

  if ((slug === 'about' || slug === 'tracks') && !launch.isInfoPagesOpen) {
    return null;
  }

  if ((slug === 'join' || slug === 'dashboard') && !launch.isNormalParticipationOpen) {
    return null;
  }

  if (!launch.isProtectedContentOpen) {
    return null;
  }

  return protectedPageFiles.get(slug) || null;
}

async function handlePageRequest(req, res) {
  const slug = normalizePageSlug(req.query.slug);
  if (!pageFiles.has(slug)) {
    res.status(404).send('Not found');
    return;
  }

  if (slug === 'admin') {
    assertAdminConfigured();
  }

  const launch = getServerLaunchState({ req });
  const fileName = resolvePageFile(slug, launch);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (!fileName) {
    res.status(200).send(renderComingSoonPage(slug));
    return;
  }

  const html = await loadLaunchPage(fileName);

  if (slug === 'admin') {
    setAdminPageSecurityHeaders(res, html);
  }

  res.status(200).send(html);
}

async function handleRegistrationStatus(req, res) {
  const user = await requireUser(req);
  assertAllowedEmail(user.email);

  const profile = await getProfileByUserId(user.id);
  const membership = await getMembershipByUserId(user.id);
  const childPoolEntry = await getChildPoolEntryByUserId(user.id);
  const parentInvite = await getPendingParentInviteByChildUserId(user.id);

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(200).json({
    launch: getServerLaunchState({ req }),
    registration: serializeRegistration(user),
    profile: profile
      ? {
          fullName: profile.full_name || '',
          studyYear: profile.study_year || '',
          childFocus: profile.child_focus || '',
          childFocusLabel: formatChildFocusLabel(profile.child_focus),
          childFocusDescription: formatChildFocusDescription(profile.child_focus),
        }
      : null,
    membership: membership
      ? {
          id: membership.id,
          teamId: membership.team_id,
          role: membership.role,
          status: membership.status,
        }
      : null,
    childPoolEntry: childPoolEntry?.status === 'open' ? serializeChildPoolEntry(childPoolEntry) : null,
    parentInvite: parentInvite
      ? {
          id: parentInvite.id,
          childName: parentInvite.child_name,
          parentEmail: parentInvite.parent_email,
          childFocus: parentInvite.child_focus,
          childFocusLabel: formatChildFocusLabel(parentInvite.child_focus),
          childFocusDescription: formatChildFocusDescription(parentInvite.child_focus),
          status: parentInvite.status,
          createdAt: parentInvite.created_at,
        }
      : null,
  });
}

async function handleRegistrationComplete(req, res) {
  const launch = getServerLaunchState({ req });
  if (!launch.isRegistrationOpen) {
    sendError(res, 403, 'Registration closed at 11:59 PM on 28 March 2026.');
    return;
  }

  const user = await requireUser(req);
  assertAllowedEmail(user.email);

  const body = readJsonBody(req);
  const requestedRole = String(body.role || '').trim().toLowerCase();
  const existingRegistration = serializeRegistration(user);

  if (existingRegistration?.role) {
    if (existingRegistration.role !== requestedRole) {
      sendError(
        res,
        409,
        getRegisteredRoleMessage(existingRegistration.role),
        { registration: existingRegistration }
      );
      return;
    }

    res.status(200).json({
      registration: existingRegistration,
    });
    return;
  }

  const registration = await upsertRegistration(user, requestedRole);
  res.status(200).json({
    registration,
  });
}

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

function buildParentInviteEmail({ childName, parentInviteLink, focusLabel, focusDescription }) {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0d0d0d;color:#ffe9ce;font-family:'Azeret Mono',ui-monospace,SFMono-Regular,Menlo,monospace;">
    <div style="margin:0 auto;max-width:640px;padding:32px 20px;">
      <div style="border:1px solid rgba(255,233,206,0.18);background:linear-gradient(180deg,rgba(255,233,206,0.05),rgba(255,233,206,0.02));padding:36px 28px;">
        <p style="margin:0 0 14px;color:#fc2f20;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;">FamHack Parent Invite</p>
        <h1 style="margin:0 0 16px;font-size:34px;line-height:1.02;color:#ffe9ce;text-transform:uppercase;">${childName} wants the family at FamHack.</h1>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.8;color:rgba(255,233,206,0.78);">
          ${childName} wants to attend this hackathon and needs you and the family to register so it can happen.
        </p>
        <p style="margin:0 0 24px;font-size:14px;line-height:1.8;color:rgba(255,233,206,0.78);">
          There will be free pizza, snacks, games, a scavenger hunt, coding, and awesome prizes for the whole family. ${childName} picked <strong style="color:#ffe9ce;">${focusLabel}</strong> and is ${focusDescription.toLowerCase()}.
        </p>
        <p style="margin:0 0 24px;font-size:14px;line-height:1.8;color:rgba(255,233,206,0.78);">
          Please register for FamHack on 28 March through the link below and FamHack will add ${childName} automatically when you create the family.
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

async function handleInvitePreview(req, res) {
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
}

async function handleChildPool(req, res) {
  assertNormalParticipationOpen(req);
  const user = await requireUser(req);
  assertAllowedEmail(user.email);
  await assertRegisteredRole(user, 'child');

  const body = readJsonBody(req);
  const fullName = sanitizeFullName(body.fullName);
  const studyYear = sanitizeStudyYear(body.studyYear);
  const childFocus = body.childFocus;
  const existingMembership = await getMembershipByUserId(user.id);

  if (!fullName) {
    sendError(res, 400, 'Your name is required');
    return;
  }

  if (!studyYear) {
    sendError(res, 400, 'Choose your year of study');
    return;
  }

  if (existingMembership?.status === 'approved') {
    sendError(res, 409, 'Leave your current family before joining the random family pool');
    return;
  }

  if (existingMembership?.status === 'pending') {
    sendError(res, 409, 'Cancel your current join request before joining the random family pool');
    return;
  }

  await upsertProfile(user, fullName, studyYear, {
    childFocus,
  });

  const poolEntry = await upsertChildPoolEntry(user.id, childFocus);
  try {
    await cancelPendingParentInvitesForUser(user.id);
  } catch (cleanupError) {
    console.error(cleanupError);
  }

  res.status(200).json({
    poolEntry: serializeChildPoolEntry(poolEntry),
    status: 'open',
  });
}

async function handleChildInviteParent(req, res) {
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
  try {
    await withdrawChildPoolEntryForUser(user.id);
  } catch (cleanupError) {
    console.error(cleanupError);
  }

  const origin = getRequestOrigin(req);
  const parentInviteLink = `${origin}/register?parentInvite=${encodeURIComponent(invite.token)}`;
  const focusLabel = formatChildFocusLabel(invite.child_focus);
  const focusDescription = formatChildFocusDescription(invite.child_focus) || 'focused on FamHack';

  await sendTransactionalEmail({
    to: invite.parent_email,
    subject: `${invite.child_name} wants the family at FamHack`,
    html: buildParentInviteEmail({
      childName: invite.child_name,
      parentInviteLink,
      focusLabel,
      focusDescription,
    }),
    text: `${invite.child_name} wants to attend FamHack and needs you and the family to register so it can happen.\n\nThere will be free pizza, snacks, games, a scavenger hunt, coding, and prizes for the whole family.\n\n${invite.child_name} picked ${focusLabel} and is ${focusDescription.toLowerCase()}.\n\nPlease register for FamHack on 28 March here: ${parentInviteLink}`,
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
}

async function handleTeamPoolAdd(req, res) {
  assertNormalParticipationOpen(req);
  const user = await requireUser(req);
  assertAllowedEmail(user.email);

  const actingMembership = await getMembershipByUserId(user.id);
  if (!actingMembership || actingMembership.role !== 'parent' || actingMembership.status !== 'approved') {
    sendError(res, 403, 'Only approved parents can add children from the pool');
    return;
  }

  const team = await getTeamById(actingMembership.team_id);
  if (!team || team.team_kind !== 'volunteer') {
    sendError(res, 403, 'Only volunteer parents can add children from the random family pool');
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

    if (error.message === getTeamLimitMessage()) {
      sendError(res, 409, error.message);
      return;
    }

    throw error;
  }

  res.status(200).json({
    added: {
      id: matchedPoolEntry.id,
      userId: matchedPoolEntry.userId,
    },
  });
}

async function handleSecretKeyringStatus(_req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(200).json({
    inventory: await getSecretKeyringStatus(),
  });
}

async function handleSecretKeyringClaim(req, res) {
  const body = readJsonBody(req);
  const claim = await claimSecretKeyring(body.email, {
    acceptedTerms: body.acceptedTerms === true || body.acceptedTerms === 'true',
    source: body.source,
  });

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(200).json({
    claim: {
      id: claim.id,
      email: claim.email,
      source: claim.source,
    },
    inventory: claim.inventory,
  });
}

async function handleAdminLogin(req, res) {
  assertSameOriginAdminRequest(req);
  const body = readJsonBody(req);
  setAdminSecurityHeaders(res);

  try {
    verifyAdminPassword(body.password);
  } catch (error) {
    await delayAdminFailure();
    throw error;
  }

  createAdminSession(res, req);

  res.status(200).json({
    ok: true,
  });
}

async function handleAdminLogout(req, res) {
  assertSameOriginAdminRequest(req);
  setAdminSecurityHeaders(res);
  clearAdminSession(res, req);

  res.status(200).json({
    ok: true,
  });
}

async function handleAdminDashboard(req, res) {
  setAdminSecurityHeaders(res);
  try {
    requireAdminSession(req);
  } catch (error) {
    clearAdminSession(res, req);
    throw error;
  }

  res.status(200).json(await getAdminDashboardData());
}

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) {
    return;
  }

  try {
    assertServerEnv();
    const mode = String(req.query.mode || '').trim().toLowerCase();

    if (mode === 'page') {
      await handlePageRequest(req, res);
      return;
    }

    if (mode === 'registration-status') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        res.status(405).json({ error: `Method ${req.method} not allowed` });
        return;
      }
      await handleRegistrationStatus(req, res);
      return;
    }

    if (mode === 'registration-complete') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ error: `Method ${req.method} not allowed` });
        return;
      }
      await handleRegistrationComplete(req, res);
      return;
    }

    if (mode === 'invite-preview') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        res.status(405).json({ error: `Method ${req.method} not allowed` });
        return;
      }
      await handleInvitePreview(req, res);
      return;
    }

    if (mode === 'child-pool') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ error: `Method ${req.method} not allowed` });
        return;
      }
      await handleChildPool(req, res);
      return;
    }

    if (mode === 'child-invite-parent') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ error: `Method ${req.method} not allowed` });
        return;
      }
      await handleChildInviteParent(req, res);
      return;
    }

    if (mode === 'team-pool-add') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ error: `Method ${req.method} not allowed` });
        return;
      }
      await handleTeamPoolAdd(req, res);
      return;
    }

    if (mode === 'secret-keyring-status') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        res.status(405).json({ error: `Method ${req.method} not allowed` });
        return;
      }
      await handleSecretKeyringStatus(req, res);
      return;
    }

    if (mode === 'secret-keyring-claim') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ error: `Method ${req.method} not allowed` });
        return;
      }
      await handleSecretKeyringClaim(req, res);
      return;
    }

    if (mode === 'admin-login') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ error: `Method ${req.method} not allowed` });
        return;
      }
      await handleAdminLogin(req, res);
      return;
    }

    if (mode === 'admin-logout') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ error: `Method ${req.method} not allowed` });
        return;
      }
      await handleAdminLogout(req, res);
      return;
    }

    if (mode === 'admin-dashboard') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        res.status(405).json({ error: `Method ${req.method} not allowed` });
        return;
      }
      await handleAdminDashboard(req, res);
      return;
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({
      ...getPublicConfig(),
      launch: getServerLaunchState({ req }),
    });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
