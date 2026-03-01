import { requireUser } from '../_lib/auth.js';
import { readJsonBody, allowMethods, sendError } from '../_lib/http.js';
import { submitCtfAnswerForUser } from '../_lib/ctf.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    const user = await requireUser(req);
    const body = readJsonBody(req);
    const state = await submitCtfAnswerForUser(user, body.challengeNumber, body.answer);
    res.status(200).json(state);
  } catch (error) {
    sendError(res, error.status || 500, error.message);
  }
}
