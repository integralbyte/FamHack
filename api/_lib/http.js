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
    || message === 'Normal participation opens on 20 March.'
    || message === 'Registration has closed for this account.'
    || message === 'Only accounts registered as a Parent can create a Family.'
    || message === 'Only accounts registered as a Child can join a Family.'
    || message === 'Choose Hunter or Hacker before continuing'
    || message === 'Enter an email address to claim a key ring.'
    || message === 'Enter a valid email address.'
    || message === 'You must agree to attend and participate in FAMHack to claim a key ring.'
    || message === 'You must agree to attend and participate in FamHack to claim a key ring.'
  ) {
    return (
      message === 'Normal participation opens on 20 March.'
      || message === 'Registration has closed for this account.'
      || message.startsWith('Only accounts registered as a ')
    ) ? 403 : 400;
  }

  if (
    message === 'That email has already claimed a key ring.'
    || message === 'All FAMHack key rings have already been claimed.'
    || message === 'All FamHack key rings have already been claimed.'
    || message === 'That parent invite is no longer available.'
    || message === 'That child is no longer available in the pool.'
    || message === 'That child is already in a family.'
    || message === 'That child already has a pending family request.'
  ) {
    return 409;
  }

  if (message === 'Admin password required') {
    return 400;
  }

  if (message === 'Invalid admin password' || message === 'Admin login required') {
    return 401;
  }

  if (message === 'Invalid admin origin') {
    return 403;
  }

  if (message === 'Admin dashboard unavailable') {
    return 404;
  }

  return 500;
}
