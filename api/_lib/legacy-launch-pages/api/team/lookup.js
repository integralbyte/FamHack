import { allowMethods, sendError } from '../_lib/http.js';
import { getTeamByCode } from '../_lib/teams.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) {
    return;
  }

  const joinCode = String(req.query.code || '').trim().toUpperCase();
  if (!joinCode) {
    sendError(res, 400, 'A team code is required');
    return;
  }

  try {
    const team = await getTeamByCode(joinCode);
    if (!team) {
      sendError(res, 404, 'No team found for that code');
      return;
    }

    res.status(200).json({
      team: {
        id: team.id,
        name: team.name,
        joinCode: team.join_code,
      },
    });
  } catch (error) {
    sendError(res, 500, error.message);
  }
}
