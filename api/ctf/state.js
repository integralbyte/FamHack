import { getOptionalUser } from '../_lib/auth.js';
import { getCtfStateForUser, getGuestCtfState } from '../_lib/ctf.js';
import { allowMethods, sendError } from '../_lib/http.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) {
    return;
  }

  try {
    const user = await getOptionalUser(req);
    const state = user ? await getCtfStateForUser(user) : await getGuestCtfState();
    res.status(200).json(state);
  } catch (error) {
    sendError(res, error.status || 500, error.message);
  }
}
