import { assertAllowedEmail, getMembershipByUserId, getTeamById } from './teams.js';
import { getServiceClient } from './supabase.js';

export const CTF_CHALLENGE_COUNT = 5;
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
    prompt: '',
    assetLabel: 'Download file',
    assetUrl: '/assets/ctf/CTF.jpg',
    inputLabel: 'Answer',
    placeholder: 'Enter answer',
    actionLabel: 'Submit',
  },
  {
    number: 4,
    title: 'Signal Four',
    mode: 'password',
    prompt: 'go home, look for me and then 640 me please',
    inputLabel: 'Password',
    placeholder: 'Enter password',
    actionLabel: 'Submit',
  },
  {
    number: 5,
    title: 'Signal Five',
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
      return base64Answer === normalizeBase64Answer(CTF_IMAGE_ANSWER);
    case 4:
      return base64Answer === normalizeBase64Answer(encodeBase64Times(CTF_HOME_SECRET, 10));
    case 5:
      return looseAnswer === normalizeLooseAnswer(CTF_PDF_TITLE)
        || looseAnswer === normalizeLooseAnswer(CTF_PDF_TITLE.replace(/\.pdf$/i, ''));
    default:
      return false;
  }
}

function serializeChallenge(challenge, solvedChallengeNumbers, currentChallengeNumber) {
  return {
    ...challenge,
    solved: solvedChallengeNumbers.includes(challenge.number),
    active: challenge.number === currentChallengeNumber,
    locked: currentChallengeNumber == null ? false : challenge.number > currentChallengeNumber,
  };
}

function buildCtfState({ viewer, solvedChallengeNumbers, team, leaderboard }) {
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
    team,
    challenges: CTF_PUBLIC_CHALLENGES.map((challenge) => serializeChallenge(challenge, solvedChallengeNumbers, currentChallengeNumber)),
    leaderboard,
  };
}

export async function requireCtfParticipant(user) {
  assertAllowedEmail(user.email);

  const membership = await getMembershipByUserId(user.id);
  if (!membership) {
    throw createStatusError(404, 'Join or create a family before opening the CTF.');
  }

  if (membership.status !== 'approved') {
    throw createStatusError(403, 'The CTF unlocks after your family membership is approved.');
  }

  const team = await getTeamById(membership.team_id);
  if (!team) {
    throw createStatusError(404, 'Family not found');
  }

  return { membership, team };
}

export async function getMemberCtfSolves(teamId, userId) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('ctf_member_solves')
    .select('challenge_number, solved_at')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .order('challenge_number', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

export async function getTeamCheckpointRows(teamId) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('ctf_team_checkpoints')
    .select('challenge_number, reached_at, reached_by')
    .eq('team_id', teamId)
    .order('challenge_number', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

export async function getCtfLeaderboard() {
  const supabase = getServiceClient();
  const [{ data: checkpoints, error: checkpointsError }, { data: teams, error: teamsError }] = await Promise.all([
    supabase
      .from('ctf_team_checkpoints')
      .select('team_id, challenge_number, reached_at')
      .order('challenge_number', { ascending: false })
      .order('reached_at', { ascending: true }),
    supabase
      .from('teams')
      .select('id, name, created_at')
      .order('created_at', { ascending: true }),
  ]);

  if (checkpointsError) {
    throw new Error(checkpointsError.message);
  }

  if (teamsError) {
    throw new Error(teamsError.message);
  }

  if (!teams?.length) {
    return [];
  }

  const highestCheckpointByTeam = new Map();
  (checkpoints || []).forEach((checkpoint) => {
    if (!highestCheckpointByTeam.has(checkpoint.team_id)) {
      highestCheckpointByTeam.set(checkpoint.team_id, checkpoint);
    }
  });

  const rows = (teams || [])
    .map((team) => {
      const checkpoint = highestCheckpointByTeam.get(team.id);
      return {
        teamId: team.id,
        teamName: team.name,
        level: checkpoint?.challenge_number || 0,
        reachedAt: checkpoint?.reached_at || null,
        createdAt: team.created_at,
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

      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    })
    .map((row, index) => ({
      rank: index + 1,
      teamId: row.teamId,
      teamName: row.teamName,
      level: row.level,
      reachedAt: row.reachedAt,
    }));

  return rows;
}

export async function getCtfStateForUser(user) {
  const { membership, team } = await requireCtfParticipant(user);
  const [memberSolves, teamCheckpoints, leaderboard] = await Promise.all([
    getMemberCtfSolves(team.id, user.id),
    getTeamCheckpointRows(team.id),
    getCtfLeaderboard(),
  ]);

  const solvedChallengeNumbers = memberSolves.map((row) => row.challenge_number).sort((a, b) => a - b);
  const highestSolvedChallenge = solvedChallengeNumbers.at(-1) || 0;
  const teamLevel = teamCheckpoints.at(-1)?.challenge_number || 0;
  const teamReachedAt = teamCheckpoints.at(-1)?.reached_at || null;

  return buildCtfState({
    viewer: {
      id: user.id,
      email: user.email,
      role: membership.role,
      teamId: team.id,
      teamName: team.name,
      guest: false,
    },
    team: {
      id: team.id,
      name: team.name,
      level: teamLevel,
      reachedAt: teamReachedAt,
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
      role: 'guest',
      teamId: null,
      teamName: 'Guest Run',
      guest: true,
    },
    solvedChallengeNumbers,
    team: {
      id: null,
      name: 'Guest Run',
      level: 0,
      reachedAt: null,
    },
    leaderboard,
  });
}

export async function submitCtfAnswerForUser(user, challengeNumber, answer) {
  const parsedChallengeNumber = Number(challengeNumber);

  if (!Number.isInteger(parsedChallengeNumber) || parsedChallengeNumber < 1 || parsedChallengeNumber > CTF_CHALLENGE_COUNT) {
    throw createStatusError(400, 'Unknown CTF challenge');
  }

  const { membership, team } = await requireCtfParticipant(user);
  const memberSolves = await getMemberCtfSolves(team.id, user.id);
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
    .from('ctf_member_solves')
    .insert({
      team_id: team.id,
      user_id: user.id,
      challenge_number: parsedChallengeNumber,
      solved_at: solvedAt,
    });

  if (solveError && solveError.code !== '23505') {
    throw new Error(solveError.message);
  }

  const { error: checkpointError } = await supabase
    .from('ctf_team_checkpoints')
    .insert({
      team_id: team.id,
      challenge_number: parsedChallengeNumber,
      reached_by: user.id,
      reached_at: solvedAt,
    });

  if (checkpointError && checkpointError.code !== '23505') {
    throw new Error(checkpointError.message);
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
