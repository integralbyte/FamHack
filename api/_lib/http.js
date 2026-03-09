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

  if (
    message === 'Choose whether you are registering as a Parent or Child'
    || message === 'Normal participation opens on 14 March.'
    || message === 'Registration has closed for this account.'
    || message === 'Only accounts registered as a Parent can create a Family.'
    || message === 'Only accounts registered as a Child can join a Family.'
    || message === 'Enter an email address to claim a key ring.'
    || message === 'Enter a valid email address.'
    || message === 'You must agree to attend and participate in FAMHack to claim a key ring.'
  ) {
    return (
      message === 'Normal participation opens on 14 March.'
      || message === 'Registration has closed for this account.'
      || message.startsWith('Only accounts registered as a ')
    ) ? 403 : 400;
  }

  if (
    message === 'That email has already claimed a key ring.'
    || message === 'All FAMHack key rings have already been claimed.'
  ) {
    return 409;
  }

  return 500;
}
