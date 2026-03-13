import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const port = Number(process.env.PORT || 4020);
const host = process.env.HOST || '127.0.0.1';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, 404, 'Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function buildPreviewConfig() {
  return {
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'preview-only-key',
    allowedEmailDomain: 'ed.ac.uk',
    otpLength: 6,
    otpResendDelay: 30,
    maxTeamSize: 15,
    ctfChallengeCount: 6,
  };
}

function buildPreviewCtfState() {
  return {
    locked: false,
    releaseAt: null,
    viewer: {
      id: 'preview-player',
      email: 'preview.player@ed.ac.uk',
      name: 'Preview Player',
      guest: false,
    },
    challengeCount: 6,
    member: {
      solvedChallenges: [],
      highestSolvedChallenge: 0,
      currentChallengeNumber: 1,
      completed: false,
    },
    solvedChallenges: [],
    currentChallenge: {
      number: 1,
      title: 'Signal One',
      mode: 'text',
      prompt: 'Local preview mode.',
      body: 'This stub exists only so you can verify the challenge panel spacing against a crowded leaderboard without touching the live CTF.',
      inputLabel: 'Answer',
      placeholder: 'Preview only',
      actionLabel: 'Submit',
      accessToken: 'preview-token',
    },
    leaderboard: [
      {
        rank: 1,
        userId: 'preview-winner',
        name: 'Nyx Calder',
        reachedAt: new Date('2026-03-14T15:14:00.000Z').toISOString(),
        level: 6,
        winner: true,
      },
      {
        rank: 2,
        userId: 'preview-runner-up-a',
        name: 'Iris Vale',
        reachedAt: new Date('2026-03-14T15:19:00.000Z').toISOString(),
        level: 6,
        winner: false,
      },
      {
        rank: 3,
        userId: 'preview-runner-up-b',
        name: 'Milo Hart',
        reachedAt: new Date('2026-03-14T15:27:00.000Z').toISOString(),
        level: 5,
        winner: false,
      },
      {
        rank: 4,
        userId: 'preview-runner-up-c',
        name: 'Tara Quinn',
        reachedAt: new Date('2026-03-14T15:31:00.000Z').toISOString(),
        level: 4,
        winner: false,
      },
      {
        rank: 5,
        userId: 'preview-player',
        name: 'Preview Player',
        reachedAt: new Date('2026-03-14T15:36:00.000Z').toISOString(),
        level: 4,
        winner: false,
      },
      {
        rank: 6,
        userId: 'preview-runner-up-d',
        name: 'Ezra Bloom',
        reachedAt: new Date('2026-03-14T15:43:00.000Z').toISOString(),
        level: 3,
        winner: false,
      },
      {
        rank: 7,
        userId: 'preview-runner-up-e',
        name: 'June Mercer',
        reachedAt: new Date('2026-03-14T15:51:00.000Z').toISOString(),
        level: 2,
        winner: false,
      },
    ],
    prizeClaim: {
      recorded: false,
      studyYear: '',
      studyYearLabel: '',
      eligible: false,
    },
    completionMessage: null,
  };
}

function resolveStaticPath(urlPath) {
  if (urlPath === '/ctf' || urlPath === '/ctf.html') {
    return path.join(rootDir, 'api/_lib/launch-pages/ctf.html');
  }

  if (urlPath === '/') {
    return path.join(rootDir, 'index.html');
  }

  const cleanPath = decodeURIComponent(urlPath).replace(/^\/+/, '');
  return path.join(rootDir, cleanPath);
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', `http://${host}:${port}`);

  if (method === 'GET' && url.pathname === '/api/config') {
    sendJson(res, 200, buildPreviewConfig());
    return;
  }

  if (method === 'GET' && url.pathname === '/api/ctf/state') {
    sendJson(res, 200, buildPreviewCtfState());
    return;
  }

  if (method === 'POST' && url.pathname === '/api/ctf/submit') {
    sendJson(res, 400, { error: 'Preview server only supports the intro flow.' });
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed');
    return;
  }

  const filePath = resolveStaticPath(url.pathname);
  sendFile(res, filePath);
});

server.listen(port, host, () => {
  console.log(`CTF preview running at http://${host}:${port}/ctf`);
});
