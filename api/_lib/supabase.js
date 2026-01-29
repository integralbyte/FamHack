import { createClient } from '@supabase/supabase-js';
import { getEnv } from './env.js';

let serviceClient;

export function getServiceClient() {
  if (!serviceClient) {
    serviceClient = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return serviceClient;
}
