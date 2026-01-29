import { assertServerEnv, getPublicConfig } from './_lib/env.js';
import { allowMethods, sendError } from './_lib/http.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) {
    return;
  }

  try {
    assertServerEnv();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(getPublicConfig());
  } catch (error) {
    sendError(res, 500, error.message);
  }
}
