import { getServiceClient } from './supabase.js';

export async function requireUser(req) {
  const authorization = req.headers.authorization || '';

  if (!authorization.startsWith('Bearer ')) {
    throw new Error('Missing bearer token');
  }

  const token = authorization.slice('Bearer '.length);
  const supabase = getServiceClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new Error('Invalid or expired session');
  }

  return data.user;
}
