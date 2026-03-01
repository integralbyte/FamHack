import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CTF_PDF_FILENAME } from '../_lib/ctf.js';
import { allowMethods, sendError } from '../_lib/http.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PDF_PATH = path.resolve(__dirname, '../../assets/ctf/washed-signal.pdf');

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) {
    return;
  }

  try {
    const fileBuffer = await readFile(PDF_PATH);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${CTF_PDF_FILENAME}"`);
    res.status(200).send(fileBuffer);
  } catch (error) {
    sendError(res, 500, error.message || 'Unable to load the handoff PDF');
  }
}
