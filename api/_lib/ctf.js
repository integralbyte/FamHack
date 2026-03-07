import { createCipheriv, createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertAllowedEmail } from './teams.js';
import { getServiceClient } from './supabase.js';

export const CTF_CHALLENGE_COUNT = 6;
export const CTF_PDF_FILENAME = 'CTF.pdf';

const CTF_HANDOFF_FILENAME = 'ctf-handoff.pdf';
const CTF_IMAGE_FILENAME = 'CTF.jpg';
const CTF_TOKEN_PREFIX = 'famhack-ctf-v1';
const CTF_PROOF_SEED = 'famhack-ctf-seed';
const CTF_DEFAULT_ACCESS_SECRET = 'famhack-ctf-local-dev-secret';
const CTF_KONAMI_ITERATIONS = 6000;
const CTF_KONAMI_CODEPOINTS = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const CTF_PRIVATE_ASSET_DIR = path.resolve(__dirname, '../../private/ctf');
const CTF_HOMEPAGE_PATH = path.resolve(__dirname, '../../index.html');
let ctfHandoffPdfTitle = null;
let ctfHomeSecret = null;
let ctfImageAnswer = null;

const CTF_CHALLENGES = [
  {
    number: 1,
    title: 'Signal One',
    mode: 'text',
    prompt: '',
    body: 'Faintly Ancient Maps Hold A Coded Key.',
    inputLabel: 'Answer',
    placeholder: 'Enter answer',
    actionLabel: 'Submit',
    successTitle: 'Clean start.',
    successCopy: 'Nice spot. The next signal is ready.',
  },
  {
    number: 2,
    title: 'Signal Two',
    mode: 'konami',
    prompt: 'Konami was here.',
    inputLabel: 'Sequence',
    placeholder: '',
    actionLabel: 'Continue',
    successTitle: 'You found Konami.',
    successCopy: 'Cheeky, but fair. Keep going.',
  },
  {
    number: 3,
    title: 'Signal Three',
    mode: 'text',
    prompt: "I'm someone who holds places. I'm a...",
    inputLabel: 'Answer',
    placeholder: 'Enter answer',
    actionLabel: 'Submit',
    successTitle: 'That fits.',
    successCopy: 'You clocked the little trick there.',
  },
  {
    number: 4,
    title: 'Signal Four',
    mode: 'text',
    prompt: '',
    assetLabel: 'Download file',
    assetFile: CTF_IMAGE_FILENAME,
    assetContentType: 'image/jpeg',
    inputLabel: 'Answer',
    placeholder: 'Enter answer',
    actionLabel: 'Submit',
    successTitle: 'Signal decoded.',
    successCopy: 'You caught the clue, worked the dimensions, and nailed it.',
  },
  {
    number: 5,
    title: 'Signal Five',
    mode: 'text',
    prompt: '',
    assetLabel: 'Download file',
    assetFile: 'CTF.pdf',
    assetContentType: 'application/pdf',
    inputLabel: 'Answer',
    placeholder: 'Enter answer',
    actionLabel: 'Submit',
    successTitle: 'Paper trail found.',
    successCopy: 'That one was properly sneaky. One left.',
  },
  {
    number: 6,
    title: 'Signal Six',
    mode: 'password',
    prompt: 'Go home, look for me, and then 640 me please.',
    inputLabel: 'Password',
    placeholder: 'Enter password',
    actionLabel: 'Submit',
    successTitle: 'Board cleared.',
    successCopy: 'Every signal is done.',
  },
];

function createStatusError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeLooseAnswer(answer) {
  return String(answer || '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeExactAnswer(answer) {
  return String(answer || '').trim().replace(/\s+/g, '');
}

function normalizeBase64Answer(answer) {
  return normalizeExactAnswer(answer).replace(/=+$/g, '');
}

function encodeBase64Times(value, times) {
  let output = String(value);
  for (let index = 0; index < times; index += 1) {
    output = Buffer.from(output, 'utf8').toString('base64');
  }
  return output;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function getKonamiPassword() {
  return CTF_KONAMI_CODEPOINTS.map((codepoint) => {
    switch (codepoint) {
      case 37:
        return 'arrowleft';
      case 38:
        return 'arrowup';
      case 39:
        return 'arrowright';
      case 40:
        return 'arrowdown';
      default:
        return String.fromCharCode(codepoint).toLowerCase();
    }
  }).join('');
}

function createKonamiProof(accessToken, challengeNumber) {
  return createHmac('sha256', getAccessSecret())
    .update(`konami:${challengeNumber}:${accessToken}`)
    .digest('hex');
}

function createKonamiBundle(accessToken, challengeNumber) {
  const payload = JSON.stringify({
    challenge: challengeNumber,
    proof: createKonamiProof(accessToken, challengeNumber),
  });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(getKonamiPassword(), salt, CTF_KONAMI_ITERATIONS, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encrypted: Buffer.concat([iv, ciphertext, authTag]).toString('base64'),
    salt: salt.toString('base64'),
    iterations: CTF_KONAMI_ITERATIONS,
    hash: 'SHA-256',
  };
}

function safeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function getPrivateCtfAssetPath(filename) {
  return path.resolve(CTF_PRIVATE_ASSET_DIR, filename);
}

function getAccessSecret() {
  return process.env.CTF_ACCESS_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || CTF_DEFAULT_ACCESS_SECRET;
}

function signTokenPayload(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', getAccessSecret()).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifySignedToken(token) {
  const [encodedPayload, signature] = String(token || '').split('.');
  if (!encodedPayload || !signature) {
    throw createStatusError(403, 'This challenge gate is no longer valid. Refresh the page and try again.');
  }

  const expectedSignature = createHmac('sha256', getAccessSecret()).update(encodedPayload).digest('base64url');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const receivedBuffer = Buffer.from(signature, 'utf8');

  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw createStatusError(403, 'This challenge gate is no longer valid. Refresh the page and try again.');
  }

  try {
    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch (error) {
    throw createStatusError(403, 'This challenge gate is no longer valid. Refresh the page and try again.');
  }
}

function sanitizeSolvedChallengeNumbers(solvedChallenges) {
  const numbers = Array.isArray(solvedChallenges)
    ? solvedChallenges
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= CTF_CHALLENGE_COUNT)
    : [];

  const uniqueSorted = Array.from(new Set(numbers)).sort((left, right) => left - right);
  const contiguous = [];

  for (let expected = 1; expected <= CTF_CHALLENGE_COUNT; expected += 1) {
    if (uniqueSorted.includes(expected)) {
      contiguous.push(expected);
    } else {
      break;
    }
  }

  return contiguous;
}

function getChallengeDefinition(challengeNumber) {
  return CTF_CHALLENGES.find((challenge) => challenge.number === Number(challengeNumber)) || null;
}

function getChallengeProofMaterial(challengeNumber) {
  switch (challengeNumber) {
    case 1:
      return normalizeLooseAnswer('famhack');
    case 2:
      return sha256('signal-two-konami');
    case 3:
      return normalizeLooseAnswer('Enter answer');
    case 4:
      return normalizeBase64Answer(getImageChallengeAnswer());
    case 5:
      return normalizeLooseAnswer(getHandoffPdfTitle());
    case 6:
      return normalizeBase64Answer(encodeBase64Times(getHomeSecret(), 10));
    default:
      throw createStatusError(400, 'Unknown CTF challenge');
  }
}

function buildSolveProof(solvedChallengeNumbers) {
  const contiguousSolved = sanitizeSolvedChallengeNumbers(solvedChallengeNumbers);

  return contiguousSolved.reduce(
    (proof, challengeNumber) => sha256(`${proof}:${challengeNumber}:${getChallengeProofMaterial(challengeNumber)}`),
    CTF_PROOF_SEED,
  );
}

function verifyChallengeAnswer(challengeNumber, answer, accessToken) {
  const looseAnswer = normalizeLooseAnswer(answer);
  const base64Answer = normalizeBase64Answer(answer);

  switch (challengeNumber) {
    case 1:
      return looseAnswer === normalizeLooseAnswer('famhack');
    case 2:
      return safeEqualText(answer, createKonamiProof(accessToken, challengeNumber));
    case 3:
      return looseAnswer === normalizeLooseAnswer('Enter answer');
    case 4:
      return base64Answer === normalizeBase64Answer(getImageChallengeAnswer());
    case 5:
      return looseAnswer === normalizeLooseAnswer(getHandoffPdfTitle())
        || looseAnswer === normalizeLooseAnswer(getHandoffPdfTitle().replace(/\.pdf$/i, ''));
    case 6:
      return base64Answer === normalizeBase64Answer(encodeBase64Times(getHomeSecret(), 10));
    default:
      return false;
  }
}

function getHandoffPdfTitle() {
  if (ctfHandoffPdfTitle) {
    return ctfHandoffPdfTitle;
  }

  const pdfBuffer = readFileSync(getPrivateCtfAssetPath(CTF_HANDOFF_FILENAME));
  const pdfSource = pdfBuffer.toString('latin1');
  const titleMatch = pdfSource.match(/\/Title\s*\(([^)]*)\)/);

  if (!titleMatch?.[1]) {
    throw new Error('Unable to read the handoff PDF title');
  }

  ctfHandoffPdfTitle = titleMatch[1];
  return ctfHandoffPdfTitle;
}

function getHomeSecret() {
  if (ctfHomeSecret) {
    return ctfHomeSecret;
  }

  const homepageSource = readFileSync(CTF_HOMEPAGE_PATH, 'utf8');
  const secretMatch = homepageSource.match(/<span class="famhack-hero-orbit"[^>]*>([^<]+)<\/span>/i);

  if (!secretMatch?.[1]) {
    throw new Error('Unable to read the hidden homepage secret');
  }

  ctfHomeSecret = secretMatch[1].trim();
  return ctfHomeSecret;
}

function getImageChallengeAnswer() {
  if (ctfImageAnswer) {
    return ctfImageAnswer;
  }

  const { width, height } = getJpegDimensions(getPrivateCtfAssetPath(CTF_IMAGE_FILENAME));
  ctfImageAnswer = Buffer.from(String(width * height), 'utf8').toString('base64');
  return ctfImageAnswer;
}

function getJpegDimensions(filePath) {
  const buffer = readFileSync(filePath);

  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('Unable to read the CTF image dimensions');
  }

  let offset = 2;
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    const isStartOfFrame = [
      0xc0, 0xc1, 0xc2, 0xc3,
      0xc5, 0xc6, 0xc7,
      0xc9, 0xca, 0xcb,
      0xcd, 0xce, 0xcf,
    ].includes(marker);

    if (isStartOfFrame) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + segmentLength;
  }

  throw new Error('Unable to read the CTF image dimensions');
}

function getDisplayName(profile, fallbackEmail = '') {
  const fullName = String(profile?.full_name || '').trim();
  if (fullName) {
    return fullName;
  }

  const normalizedEmail = String(profile?.email || fallbackEmail || '').trim().toLowerCase();
  const localPart = normalizedEmail.split('@')[0] || 'FamHack Player';

  return localPart
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'FamHack Player';
}

function getCompletionMessage(viewer, leaderboard) {
  if (viewer.guest) {
    return {
      title: 'You cleared the FamHack CTF.',
      copy: 'Sign in if you want your finish to count on the board.',
      winner: false,
    };
  }

  const winningRow = leaderboard.find((row) => row.winner) || null;
  const viewerWon = Boolean(winningRow && winningRow.userId === viewer.id);

  if (viewerWon) {
    return {
      title: 'You won the FamHack CTF.',
      copy: 'You were first through every signal. Prize secured.',
      winner: true,
    };
  }

  return {
    title: 'You cleared the FamHack CTF.',
    copy: 'All six signals are done. Strong finish.',
    winner: false,
  };
}

function createAccessToken(viewer, solvedChallengeNumbers, currentChallengeNumber) {
  return signTokenPayload({
    v: CTF_TOKEN_PREFIX,
    challengeNumber: currentChallengeNumber,
    guest: Boolean(viewer.guest),
    userId: viewer.guest ? null : viewer.id,
    solvedChallengeNumbers: viewer.guest ? sanitizeSolvedChallengeNumbers(solvedChallengeNumbers) : undefined,
    proof: buildSolveProof(solvedChallengeNumbers),
  });
}

function serializeSolvedChallenge(challengeNumber) {
  const challenge = getChallengeDefinition(challengeNumber);

  return challenge
    ? {
      number: challenge.number,
      title: challenge.title,
    }
    : null;
}

function serializeCurrentChallenge(challenge, viewer, solvedChallengeNumbers) {
  const accessToken = createAccessToken(viewer, solvedChallengeNumbers, challenge.number);

  return {
    number: challenge.number,
    title: challenge.title,
    mode: challenge.mode,
    prompt: challenge.prompt,
    body: challenge.body,
    inputLabel: challenge.inputLabel,
    placeholder: challenge.placeholder,
    actionLabel: challenge.actionLabel,
    assetLabel: challenge.assetLabel,
    assetUrl: challenge.assetFile
      ? `/api/ctf/asset?challenge=${challenge.number}&token=${encodeURIComponent(accessToken)}`
      : null,
    konamiBundle: challenge.mode === 'konami'
      ? createKonamiBundle(accessToken, challenge.number)
      : null,
    accessToken,
  };
}

function buildCtfState({ viewer, solvedChallengeNumbers, leaderboard }) {
  const highestSolvedChallenge = solvedChallengeNumbers.at(-1) || 0;
  const currentChallengeNumber = highestSolvedChallenge >= CTF_CHALLENGE_COUNT
    ? null
    : Math.min(highestSolvedChallenge + 1, CTF_CHALLENGE_COUNT);
  const currentChallenge = currentChallengeNumber
    ? serializeCurrentChallenge(getChallengeDefinition(currentChallengeNumber), viewer, solvedChallengeNumbers)
    : null;

  return {
    viewer,
    challengeCount: CTF_CHALLENGE_COUNT,
    member: {
      solvedChallenges: solvedChallengeNumbers,
      highestSolvedChallenge,
      currentChallengeNumber: highestSolvedChallenge >= CTF_CHALLENGE_COUNT ? CTF_CHALLENGE_COUNT : currentChallengeNumber,
      completed: highestSolvedChallenge >= CTF_CHALLENGE_COUNT,
    },
    solvedChallenges: solvedChallengeNumbers
      .map((challengeNumber) => serializeSolvedChallenge(challengeNumber))
      .filter(Boolean),
    currentChallenge,
    leaderboard,
    completionMessage: highestSolvedChallenge >= CTF_CHALLENGE_COUNT
      ? getCompletionMessage(viewer, leaderboard)
      : null,
  };
}

async function ensureCtfProfile(user) {
  const supabase = getServiceClient();
  const payload = {
    id: user.id,
    email: String(user.email || '').trim().toLowerCase(),
  };

  const { error } = await supabase.from('profiles').upsert(payload, {
    onConflict: 'id',
  });

  if (error) {
    throw new Error(error.message);
  }
}

async function getProfileByUserId(userId) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function requireCtfParticipant(user) {
  assertAllowedEmail(user.email);
  await ensureCtfProfile(user);
  const profile = await getProfileByUserId(user.id);
  return {
    profile,
    displayName: getDisplayName(profile, user.email),
  };
}

export async function getMemberCtfSolves(userId) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('ctf_user_solves')
    .select('challenge_number, solved_at')
    .eq('user_id', userId)
    .order('challenge_number', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

export async function getCtfLeaderboard() {
  const supabase = getServiceClient();
  const { data: solves, error: solvesError } = await supabase
    .from('ctf_user_solves')
    .select('user_id, challenge_number, solved_at')
    .order('challenge_number', { ascending: false })
    .order('solved_at', { ascending: true });

  if (solvesError) {
    throw new Error(solvesError.message);
  }

  if (!solves?.length) {
    return [];
  }

  const profileIds = Array.from(new Set(solves.map((row) => row.user_id)));
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .in('id', profileIds);

  if (profilesError) {
    throw new Error(profilesError.message);
  }

  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const highestSolveByUser = new Map();

  (solves || []).forEach((solve) => {
    if (!highestSolveByUser.has(solve.user_id)) {
      highestSolveByUser.set(solve.user_id, solve);
    }
  });

  const rows = Array.from(highestSolveByUser.entries())
    .map(([userId, solve]) => {
      const profile = profileMap.get(userId) || null;
      return {
        userId,
        name: getDisplayName(profile),
        level: solve.challenge_number || 0,
        reachedAt: solve.solved_at || null,
      };
    })
    .sort((left, right) => {
      if (right.level !== left.level) {
        return right.level - left.level;
      }

      if (left.reachedAt && right.reachedAt) {
        return new Date(left.reachedAt).getTime() - new Date(right.reachedAt).getTime();
      }

      if (left.reachedAt) {
        return -1;
      }

      if (right.reachedAt) {
        return 1;
      }

      return left.name.localeCompare(right.name);
    });

  const winningUserId = rows.find((row) => row.level === CTF_CHALLENGE_COUNT)?.userId || null;

  return rows.map((row, index) => ({
    rank: index + 1,
    userId: row.userId,
    name: row.name,
    level: row.level,
    reachedAt: row.reachedAt,
    winner: Boolean(winningUserId && winningUserId === row.userId && row.level === CTF_CHALLENGE_COUNT),
  }));
}

export async function getCtfStateForUser(user) {
  const participant = await requireCtfParticipant(user);
  const [memberSolves, leaderboard] = await Promise.all([
    getMemberCtfSolves(user.id),
    getCtfLeaderboard(),
  ]);

  const solvedChallengeNumbers = memberSolves.map((row) => row.challenge_number).sort((left, right) => left - right);

  return buildCtfState({
    viewer: {
      id: user.id,
      email: user.email,
      name: participant.displayName,
      guest: false,
    },
    solvedChallengeNumbers,
    leaderboard,
  });
}

export async function getGuestCtfState(solvedChallenges = []) {
  const leaderboard = await getCtfLeaderboard();
  const solvedChallengeNumbers = sanitizeSolvedChallengeNumbers(solvedChallenges);

  return buildCtfState({
    viewer: {
      id: null,
      email: null,
      name: 'Guest Run',
      guest: true,
    },
    solvedChallengeNumbers,
    leaderboard,
  });
}

function validateGuestToken(accessToken, challengeNumber) {
  const payload = verifySignedToken(accessToken);

  if (payload?.v !== CTF_TOKEN_PREFIX || !payload.guest) {
    throw createStatusError(403, 'This challenge gate is no longer valid. Refresh the page and try again.');
  }

  const solvedChallengeNumbers = sanitizeSolvedChallengeNumbers(payload.solvedChallengeNumbers);
  const highestSolvedChallenge = solvedChallengeNumbers.at(-1) || 0;
  const expectedChallengeNumber = highestSolvedChallenge + 1;

  if (payload.challengeNumber !== expectedChallengeNumber || Number(challengeNumber) !== expectedChallengeNumber) {
    throw createStatusError(409, 'Solve your current challenge before moving on.');
  }

  if (payload.proof !== buildSolveProof(solvedChallengeNumbers)) {
    throw createStatusError(403, 'This challenge gate is no longer valid. Refresh the page and try again.');
  }

  return {
    solvedChallengeNumbers,
    expectedChallengeNumber,
  };
}

async function validateUserToken(user, accessToken, challengeNumber) {
  const payload = verifySignedToken(accessToken);

  if (payload?.v !== CTF_TOKEN_PREFIX || payload.guest || payload.userId !== user.id) {
    throw createStatusError(403, 'This challenge gate is no longer valid. Refresh the page and try again.');
  }

  await requireCtfParticipant(user);
  const memberSolves = await getMemberCtfSolves(user.id);
  const solvedChallengeNumbers = memberSolves.map((row) => row.challenge_number).sort((left, right) => left - right);
  const highestSolvedChallenge = solvedChallengeNumbers.at(-1) || 0;
  const expectedChallengeNumber = highestSolvedChallenge + 1;

  if (payload.challengeNumber !== expectedChallengeNumber || Number(challengeNumber) !== expectedChallengeNumber) {
    throw createStatusError(409, 'Solve your current challenge before moving on.');
  }

  if (payload.proof !== buildSolveProof(solvedChallengeNumbers)) {
    throw createStatusError(403, 'This challenge gate is no longer valid. Refresh the page and try again.');
  }

  return {
    solvedChallengeNumbers,
    expectedChallengeNumber,
  };
}

async function validateUserTokenById(userId, accessToken, challengeNumber) {
  const payload = verifySignedToken(accessToken);

  if (payload?.v !== CTF_TOKEN_PREFIX || payload.guest || payload.userId !== userId) {
    throw createStatusError(403, 'This challenge gate is no longer valid. Refresh the page and try again.');
  }

  const memberSolves = await getMemberCtfSolves(userId);
  const solvedChallengeNumbers = memberSolves.map((row) => row.challenge_number).sort((left, right) => left - right);
  const highestSolvedChallenge = solvedChallengeNumbers.at(-1) || 0;
  const expectedChallengeNumber = highestSolvedChallenge + 1;

  if (payload.challengeNumber !== expectedChallengeNumber || Number(challengeNumber) !== expectedChallengeNumber) {
    throw createStatusError(409, 'Solve your current challenge before moving on.');
  }

  if (payload.proof !== buildSolveProof(solvedChallengeNumbers)) {
    throw createStatusError(403, 'This challenge gate is no longer valid. Refresh the page and try again.');
  }

  return {
    solvedChallengeNumbers,
    expectedChallengeNumber,
  };
}

function buildSolveResponse(state, solvedChallengeNumber) {
  if (state.member.completed) {
    return state;
  }

  const challenge = getChallengeDefinition(solvedChallengeNumber);

  return {
    ...state,
    clearGate: {
      mode: challenge.mode,
      solvedChallengeNumber: challenge.number,
      successTitle: challenge.successTitle,
      successCopy: challenge.successCopy,
      ready: challenge.mode !== 'konami',
      delayMs: challenge.mode === 'konami' ? 2200 : 0,
    },
  };
}

export async function submitCtfAnswerForUser(user, challengeNumber, answer, accessToken) {
  const parsedChallengeNumber = Number(challengeNumber);

  if (!Number.isInteger(parsedChallengeNumber) || parsedChallengeNumber < 1 || parsedChallengeNumber > CTF_CHALLENGE_COUNT) {
    throw createStatusError(400, 'Unknown CTF challenge');
  }

  const { solvedChallengeNumbers, expectedChallengeNumber } = await validateUserToken(user, accessToken, parsedChallengeNumber);
  const highestSolvedChallenge = solvedChallengeNumbers.at(-1) || 0;

  if (parsedChallengeNumber <= highestSolvedChallenge) {
    return getCtfStateForUser(user);
  }

  if (parsedChallengeNumber !== expectedChallengeNumber) {
    throw createStatusError(409, 'Solve your current challenge before moving on.');
  }

  if (!verifyChallengeAnswer(parsedChallengeNumber, answer, accessToken)) {
    throw createStatusError(400, 'That answer is not correct yet.');
  }

  const supabase = getServiceClient();
  const solvedAt = new Date().toISOString();
  const { error: solveError } = await supabase
    .from('ctf_user_solves')
    .insert({
      user_id: user.id,
      challenge_number: parsedChallengeNumber,
      solved_at: solvedAt,
    });

  if (solveError && solveError.code !== '23505') {
    throw new Error(solveError.message);
  }

  const nextState = await getCtfStateForUser(user);
  return buildSolveResponse(nextState, parsedChallengeNumber);
}

export async function submitGuestCtfAnswer(challengeNumber, answer, accessToken) {
  const parsedChallengeNumber = Number(challengeNumber);

  if (!Number.isInteger(parsedChallengeNumber) || parsedChallengeNumber < 1 || parsedChallengeNumber > CTF_CHALLENGE_COUNT) {
    throw createStatusError(400, 'Unknown CTF challenge');
  }

  const { solvedChallengeNumbers, expectedChallengeNumber } = validateGuestToken(accessToken, parsedChallengeNumber);
  const highestSolvedChallenge = solvedChallengeNumbers.at(-1) || 0;

  if (parsedChallengeNumber <= highestSolvedChallenge) {
    return getGuestCtfState(solvedChallengeNumbers);
  }

  if (parsedChallengeNumber !== expectedChallengeNumber) {
    throw createStatusError(409, 'Solve your current challenge before moving on.');
  }

  if (!verifyChallengeAnswer(parsedChallengeNumber, answer, accessToken)) {
    throw createStatusError(400, 'That answer is not correct yet.');
  }

  const nextState = await getGuestCtfState([...solvedChallengeNumbers, parsedChallengeNumber]);
  return buildSolveResponse(nextState, parsedChallengeNumber);
}

export async function getCtfAssetForRequest({ user, challengeNumber, accessToken }) {
  const parsedChallengeNumber = Number(challengeNumber);

  if (!Number.isInteger(parsedChallengeNumber) || parsedChallengeNumber < 1 || parsedChallengeNumber > CTF_CHALLENGE_COUNT) {
    throw createStatusError(400, 'Unknown CTF challenge');
  }

  const payload = verifySignedToken(accessToken);
  if (payload?.v !== CTF_TOKEN_PREFIX) {
    throw createStatusError(403, 'This challenge gate is no longer valid. Refresh the page and try again.');
  }

  if (payload.guest) {
    validateGuestToken(accessToken, parsedChallengeNumber);
  } else {
    if (user && payload.userId !== user.id) {
      throw createStatusError(403, 'This challenge gate is no longer valid. Refresh the page and try again.');
    }

    await validateUserTokenById(payload.userId, accessToken, parsedChallengeNumber);
  }

  const challenge = getChallengeDefinition(parsedChallengeNumber);
  if (!challenge?.assetFile) {
    throw createStatusError(404, 'No downloadable clue exists for this challenge.');
  }

  return {
    filename: challenge.assetFile,
    contentType: challenge.assetContentType,
  };
}
