import { requireUser } from '../_lib/auth.js';
import { getCtfStateForUser } from '../_lib/ctf.js';
import { allowMethods, sendError } from '../_lib/http.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) {
    return;
  }

  try {
    const user = await requireUser(req);
    const state = await getCtfStateForUser(user);
    res.status(200).json(state);
  } catch (error) {
    sendError(res, error.status || 500, error.message);
  }
}
