import { getOptionalUser } from '../_lib/auth.js';
import { readJsonBody, allowMethods, sendError } from '../_lib/http.js';
import { assertCtfReleaseAccess, submitCtfAnswerForUser, submitGuestCtfAnswer } from '../_lib/ctf.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    assertCtfReleaseAccess(req);
    const body = readJsonBody(req);
    const user = await getOptionalUser(req);
    const state = user
      ? await submitCtfAnswerForUser(user, body.challengeNumber, body.answer, body.accessToken)
      : await submitGuestCtfAnswer(body.challengeNumber, body.answer, body.accessToken);
    res.status(200).json(state);
  } catch (error) {
    sendError(res, error.status || 500, error.message);
  }
}
