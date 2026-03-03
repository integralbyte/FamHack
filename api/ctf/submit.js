import { getOptionalUser } from '../_lib/auth.js';
import { readJsonBody, allowMethods, sendError } from '../_lib/http.js';
import { submitCtfAnswerForUser, submitGuestCtfAnswer } from '../_lib/ctf.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    const body = readJsonBody(req);
    const user = await getOptionalUser(req);
    const state = user
      ? await submitCtfAnswerForUser(user, body.challengeNumber, body.answer)
      : await submitGuestCtfAnswer(body.challengeNumber, body.answer, body.solvedChallenges);
    res.status(200).json(state);
  } catch (error) {
    sendError(res, error.status || 500, error.message);
  }
}
