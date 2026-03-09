import { readFile } from 'node:fs/promises';

import { requireUser } from './_lib/auth.js';
import { assertServerEnv, getPublicConfig } from './_lib/env.js';
import { allowMethods, readJsonBody, sendError, statusFromError } from './_lib/http.js';
import { claimSecretKeyring, getSecretKeyringStatus } from './_lib/keyring.js';
import { getServerLaunchState, normalizePageSlug } from './_lib/launch.js';
import { assertAllowedEmail, getMembershipByUserId, getRegisteredRoleMessage, serializeRegistration, upsertRegistration } from './_lib/teams.js';

const publicPageFiles = new Map([
  ['easter', 'secret-keyring.html'],
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
  const title = slug === 'join' ? 'Family setup opens on 14 March' : 'Coming soon';
  const copy = slug === 'join'
    ? 'Sign in, create a family, and join a family all unlock on 14 March 2026.'
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

  const launch = getServerLaunchState();
  const fileName = resolvePageFile(slug, launch);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (!fileName) {
    res.status(200).send(renderComingSoonPage(slug));
    return;
  }

  const html = await loadLaunchPage(fileName);
  res.status(200).send(html);
}

async function handleRegistrationStatus(req, res) {
  const user = await requireUser(req);
  assertAllowedEmail(user.email);

  const membership = await getMembershipByUserId(user.id);

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(200).json({
    launch: getServerLaunchState(),
    registration: serializeRegistration(user),
    membership: membership
      ? {
          id: membership.id,
          teamId: membership.team_id,
          role: membership.role,
          status: membership.status,
        }
      : null,
  });
}

async function handleRegistrationComplete(req, res) {
  const launch = getServerLaunchState();
  if (!launch.isRegistrationOpen) {
    sendError(res, 403, 'Registration closed at 11:59 PM on 13 March 2026.');
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

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({
      ...getPublicConfig(),
      launch: getServerLaunchState(),
    });
  } catch (error) {
    sendError(res, statusFromError(error), error.message);
  }
}
