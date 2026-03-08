import { readFile } from 'node:fs/promises';

import { getOptionalUser } from '../_lib/auth.js';
import { assertCtfReleaseAccess, getCtfAssetForRequest, getPrivateCtfAssetPath } from '../_lib/ctf.js';
import { allowMethods, sendError } from '../_lib/http.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) {
    return;
  }

  try {
    assertCtfReleaseAccess(req);
    const user = await getOptionalUser(req);
    const asset = await getCtfAssetForRequest({
      user,
      challengeNumber: req.query.challenge,
      accessToken: req.query.token,
    });

    const fileBuffer = await readFile(getPrivateCtfAssetPath(asset.filename));
    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${asset.filename}"`);
    res.status(200).send(fileBuffer);
  } catch (error) {
    sendError(res, error.status || 500, error.message || 'Unable to load this clue file');
  }
}
