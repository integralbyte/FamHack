import { assertAllowedEmail } from './teams.js';
import { getServiceClient } from './supabase.js';

export const CTF_CHALLENGE_COUNT = 6;
export const CTF_HOME_SECRET = 'FAMILY-ORBIT';
export const CTF_PDF_FILENAME = 'CTF.pdf';
export const CTF_PDF_TITLE = 'pale-echo.pdf';
const CTF_IMAGE_WIDTH = 96;
const CTF_IMAGE_HEIGHT = 64;
const CTF_IMAGE_ANSWER = Buffer.from(String(CTF_IMAGE_WIDTH * CTF_IMAGE_HEIGHT), 'utf8').toString('base64');

const CTF_PUBLIC_CHALLENGES = [
  {
    number: 1,
    title: 'Signal One',
    mode: 'text',
    prompt: '',
    body: 'Faintly Ancient Maps Hold A Coded Key.',
    inputLabel: 'Answer',
    placeholder: 'Enter answer',
    actionLabel: 'Submit',
  },
  {
    number: 2,
    title: 'Signal Two',
    mode: 'konami',
    prompt: 'Konami was here.',
    successText: 'You found Konami.',
    actionLabel: 'Continue',
  },
  {
    number: 3,
    title: 'Signal Three',
    mode: 'text',
    prompt: "I'm someone who holds places. I'm a...",
    inputLabel: 'Answer',
    placeholder: 'Enter answer',
    actionLabel: 'Submit',
  },
  {
    number: 4,
    title: 'Signal Four',
    mode: 'text',
    prompt: '',
    assetLabel: 'Download file',
    assetUrl: '/assets/ctf/CTF.jpg',
    inputLabel: 'Answer',
    placeholder: 'Enter answer',
    actionLabel: 'Submit',
  },
  {
    number: 5,
    title: 'Signal Five',
    mode: 'password',
    prompt: 'Go home, look for me, and then 640 me please.',
    inputLabel: 'Password',
    placeholder: 'Enter password',
    actionLabel: 'Submit',
  },
  {
    number: 6,
    title: 'Signal Six',
    mode: 'text',
    prompt: '',
    assetLabel: 'Download file',
    assetUrl: '/assets/ctf/CTF.pdf',
    inputLabel: 'Answer',
    placeholder: 'Enter answer',
    actionLabel: 'Submit',
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

function verifyChallengeAnswer(challengeNumber, answer) {
  const looseAnswer = normalizeLooseAnswer(answer);
  const exactAnswer = normalizeExactAnswer(answer);
  const base64Answer = normalizeBase64Answer(answer);

  switch (challengeNumber) {
    case 1:
      return looseAnswer === 'famhack';
    case 2:
      return looseAnswer === 'upupdowndownleftrightleftrightba';
    case 3:
      return looseAnswer === normalizeLooseAnswer('Enter answer');
    case 4:
      return base64Answer === normalizeBase64Answer(CTF_IMAGE_ANSWER);
    case 5:
      return base64Answer === normalizeBase64Answer(encodeBase64Times(CTF_HOME_SECRET, 10));
    case 6:
      return looseAnswer === normalizeLooseAnswer(CTF_PDF_TITLE)
        || looseAnswer === normalizeLooseAnswer(CTF_PDF_TITLE.replace(/\.pdf$/i, ''));
    default:
      return false;
  }
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

function serializeChallenge(challenge, solvedChallengeNumbers, currentChallengeNumber) {
  return {
    ...challenge,
    solved: solvedChallengeNumbers.includes(challenge.number),
    active: challenge.number === currentChallengeNumber,
    locked: currentChallengeNumber == null ? false : challenge.number > currentChallengeNumber,
  };
}

function buildCtfState({ viewer, solvedChallengeNumbers, leaderboard }) {
  const highestSolvedChallenge = solvedChallengeNumbers.at(-1) || 0;
  const currentChallengeNumber = highestSolvedChallenge >= CTF_CHALLENGE_COUNT
    ? null
    : Math.min(highestSolvedChallenge + 1, CTF_CHALLENGE_COUNT);

  return {
    viewer,
    member: {
      solvedChallenges: solvedChallengeNumbers,
      highestSolvedChallenge,
      currentChallengeNumber: highestSolvedChallenge >= CTF_CHALLENGE_COUNT ? CTF_CHALLENGE_COUNT : currentChallengeNumber,
      completed: highestSolvedChallenge >= CTF_CHALLENGE_COUNT,
    },
    challenges: CTF_PUBLIC_CHALLENGES.map((challenge) => serializeChallenge(challenge, solvedChallengeNumbers, currentChallengeNumber)),
    leaderboard,
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
    })
    .map((row, index) => ({
      rank: index + 1,
      userId: row.userId,
      name: row.name,
      level: row.level,
      reachedAt: row.reachedAt,
    }));

  return rows;
}

export async function getCtfStateForUser(user) {
  const participant = await requireCtfParticipant(user);
  const [memberSolves, leaderboard] = await Promise.all([
    getMemberCtfSolves(user.id),
    getCtfLeaderboard(),
  ]);

  const solvedChallengeNumbers = memberSolves.map((row) => row.challenge_number).sort((a, b) => a - b);

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

export async function submitCtfAnswerForUser(user, challengeNumber, answer) {
  const parsedChallengeNumber = Number(challengeNumber);

  if (!Number.isInteger(parsedChallengeNumber) || parsedChallengeNumber < 1 || parsedChallengeNumber > CTF_CHALLENGE_COUNT) {
    throw createStatusError(400, 'Unknown CTF challenge');
  }

  await requireCtfParticipant(user);
  const memberSolves = await getMemberCtfSolves(user.id);
  const highestSolvedChallenge = memberSolves.at(-1)?.challenge_number || 0;
  const expectedChallengeNumber = highestSolvedChallenge + 1;

  if (parsedChallengeNumber <= highestSolvedChallenge) {
    return getCtfStateForUser(user);
  }

  if (parsedChallengeNumber !== expectedChallengeNumber) {
    throw createStatusError(409, 'Solve your current challenge before moving on.');
  }

  if (!verifyChallengeAnswer(parsedChallengeNumber, answer)) {
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

  return getCtfStateForUser(user);
}

export async function submitGuestCtfAnswer(challengeNumber, answer, solvedChallenges = []) {
  const parsedChallengeNumber = Number(challengeNumber);

  if (!Number.isInteger(parsedChallengeNumber) || parsedChallengeNumber < 1 || parsedChallengeNumber > CTF_CHALLENGE_COUNT) {
    throw createStatusError(400, 'Unknown CTF challenge');
  }

  const solvedChallengeNumbers = sanitizeSolvedChallengeNumbers(solvedChallenges);
  const highestSolvedChallenge = solvedChallengeNumbers.at(-1) || 0;
  const expectedChallengeNumber = highestSolvedChallenge + 1;

  if (parsedChallengeNumber <= highestSolvedChallenge) {
    return getGuestCtfState(solvedChallengeNumbers);
  }

  if (parsedChallengeNumber !== expectedChallengeNumber) {
    throw createStatusError(409, 'Solve your current challenge before moving on.');
  }

  if (!verifyChallengeAnswer(parsedChallengeNumber, answer)) {
    throw createStatusError(400, 'That answer is not correct yet.');
  }

  return getGuestCtfState([...solvedChallengeNumbers, parsedChallengeNumber]);
}
