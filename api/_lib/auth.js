import { getServiceClient } from './supabase.js';

export async function getOptionalUser(req) {
  const authorization = req.headers.authorization || '';

  if (!authorization.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length);
  const supabase = getServiceClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export async function requireUser(req) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) {
    throw new Error('Missing bearer token');
  }

  const user = await getOptionalUser(req);
  if (!user) {
    throw new Error('Invalid or expired session');
  }
  return user;
}
