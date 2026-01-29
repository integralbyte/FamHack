export function allowMethods(req, res, methods) {
  if (methods.includes(req.method)) {
    return true;
  }

  res.setHeader('Allow', methods.join(', '));
  res.status(405).json({ error: `Method ${req.method} not allowed` });
  return false;
}

export function sendError(res, status, message, details = undefined) {
  const payload = { error: message };

  if (details !== undefined) {
    payload.details = details;
  }

  return res.status(status).json(payload);
}

export function readJsonBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return {};
    }
  }

  return req.body;
}

export function statusFromError(error) {
  const message = error?.message || '';

  if (message === 'Missing bearer token' || message === 'Invalid or expired session') {
    return 401;
  }

  if (message.startsWith('Please use your @')) {
    return 400;
  }

  return 500;
}
