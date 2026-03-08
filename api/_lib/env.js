const requiredVariables = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

export function getEnv(name, fallback = undefined) {
  const value = process.env[name];
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(`Missing environment variable: ${name}`);
}

export function getPublicConfig() {
  return {
    supabaseUrl: getEnv('SUPABASE_URL'),
    supabaseAnonKey: getEnv('SUPABASE_ANON_KEY'),
    allowedEmailDomain: getEnv('ALLOWED_EMAIL_DOMAIN', 'ed.ac.uk'),
    familyFlowOpensAt: getEnv('FAMILY_FLOW_OPENS_AT', '2026-03-14T00:00:00Z'),
  };
}

export function assertServerEnv() {
  requiredVariables.forEach((name) => getEnv(name));
}
