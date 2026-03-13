import { readFile } from 'node:fs/promises';
import { assertCtfReleaseAccess, CTF_PDF_FILENAME, getPrivateCtfAssetPath } from '../_lib/ctf.js';
import { allowMethods, sendError } from '../_lib/http.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) {
    return;
  }

  try {
    assertCtfReleaseAccess(req);
    const fileBuffer = await readFile(getPrivateCtfAssetPath('ctf-handoff.pdf'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${CTF_PDF_FILENAME}"`);
    res.status(200).send(fileBuffer);
  } catch (error) {
    sendError(res, 500, error.message || 'Unable to load the handoff PDF');
  }
}
