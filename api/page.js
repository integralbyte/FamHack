import { readFile } from 'node:fs/promises';

import { allowMethods } from './_lib/http.js';
import { getServerLaunchState, normalizePageSlug } from './_lib/launch.js';

const pageFiles = new Map([
  ['about', 'about.html'],
  ['tracks', 'tracks.html'],
  ['register', 'register.html'],
  ['join', 'join.html'],
  ['dashboard', 'dashboard.html'],
  ['ctf', 'ctf.html'],
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

async function loadPage(fileName) {
  return readFile(new URL(`./_lib/launch-pages/${fileName}`, import.meta.url), 'utf8');
}

function resolvePageFile(slug, launch) {
  if (slug === 'register') {
    return launch.isRegistrationOpen ? 'register-prereg.html' : 'register.html';
  }

  if (!launch.isProtectedContentOpen) {
    return null;
  }

  return pageFiles.get(slug) || null;
}

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) {
    return;
  }

  const slug = normalizePageSlug(req.query.slug);
  if (!pageFiles.has(slug)) {
    res.status(404).send('Not found');
    return;
  }

  const launch = getServerLaunchState();

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const fileName = resolvePageFile(slug, launch);
  if (!fileName) {
    res.status(200).send(renderComingSoonPage(slug));
    return;
  }

  const html = await loadPage(fileName);
  res.status(200).send(html);
}
