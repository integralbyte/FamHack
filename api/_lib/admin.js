import { createHash, createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

import { getServiceClient } from './supabase.js';
import { normalizeEmail, serializeRegistration } from './teams.js';

const ADMIN_SESSION_COOKIE = 'famhack_admin_session';
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 2;
const SIGNUP_BIN_MS = 1000 * 60 * 60 * 12;
const EMPTY_SERIES_POINTS = 12;

function requireAdminEnv(name) {
  const value = process.env[name];
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  throw new Error('Admin dashboard unavailable');
}

export function isAdminConfigured() {
  try {
    requireAdminEnv('ADMIN_DASHBOARD_PASSWORD_SALT');
    requireAdminEnv('ADMIN_DASHBOARD_PASSWORD_HASH');
    requireAdminEnv('ADMIN_DASHBOARD_SESSION_SECRET');
    return true;
  } catch {
    return false;
  }
}

export function assertAdminConfigured() {
  if (!isAdminConfigured()) {
    throw new Error('Admin dashboard unavailable');
  }
}

function getAdminPasswordSalt() {
  return requireAdminEnv('ADMIN_DASHBOARD_PASSWORD_SALT');
}

function getAdminPasswordHash() {
  return requireAdminEnv('ADMIN_DASHBOARD_PASSWORD_HASH');
}

function getAdminSessionSecret() {
  return requireAdminEnv('ADMIN_DASHBOARD_SESSION_SECRET');
}

function safeStringCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function hashPassword(password, salt) {
  return scryptSync(String(password || ''), salt, 64).toString('hex');
}

function signSessionValue(payload) {
  return createHmac('sha256', getAdminSessionSecret()).update(payload).digest('base64url');
}

function parseCookieHeader(headerValue) {
  return String(headerValue || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, cookiePart) => {
      const separatorIndex = cookiePart.indexOf('=');
      if (separatorIndex === -1) {
        return cookies;
      }

      const name = cookiePart.slice(0, separatorIndex).trim();
      const value = cookiePart.slice(separatorIndex + 1).trim();

      if (name) {
        cookies[name] = decodeURIComponent(value);
      }

      return cookies;
    }, {});
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').trim().toLowerCase();
  return forwardedProto === 'https' || process.env.NODE_ENV === 'production';
}

function buildCookieHeader(value, { expiresAt = null, maxAge = null } = {}, req) {
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
  ];

  if (isSecureRequest(req)) {
    parts.push('Secure');
  }

  if (typeof maxAge === 'number') {
    parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  }

  if (expiresAt) {
    parts.push(`Expires=${new Date(expiresAt).toUTCString()}`);
  }

  return parts.join('; ');
}

function getRequestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').trim().toLowerCase();
  const proto = forwardedProto || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
  return host ? `${proto}://${host}` : '';
}

function getInlineTagHashes(html, tagName) {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'g');
  const hashes = [];

  for (const match of html.matchAll(pattern)) {
    const content = match[1];
    const digest = createHash('sha256').update(content, 'utf8').digest('base64');
    hashes.push(`'sha256-${digest}'`);
  }

  return hashes;
}

function floorToSignupBin(timestampMs) {
  return Math.floor(timestampMs / SIGNUP_BIN_MS) * SIGNUP_BIN_MS;
}

function buildSignupSeries(signupRows) {
  const timestamps = signupRows
    .map((row) => Date.parse(row.registeredAt))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (!timestamps.length) {
    const end = floorToSignupBin(Date.now());
    return Array.from({ length: EMPTY_SERIES_POINTS }, (_, index) => {
      const binStart = end - (EMPTY_SERIES_POINTS - index - 1) * SIGNUP_BIN_MS;
      return {
        binStart: new Date(binStart).toISOString(),
        total: 0,
      };
    });
  }

  const start = floorToSignupBin(timestamps[0]);
  const end = floorToSignupBin(Math.max(Date.now(), timestamps[timestamps.length - 1]));
  const series = [];
  let pointer = 0;
  let total = 0;

  for (let binStart = start; binStart <= end; binStart += SIGNUP_BIN_MS) {
    const binEnd = binStart + SIGNUP_BIN_MS;
    while (pointer < timestamps.length && timestamps[pointer] < binEnd) {
      total += 1;
      pointer += 1;
    }

    series.push({
      binStart: new Date(binStart).toISOString(),
      total,
    });
  }

  return series;
}

export function verifyAdminPassword(password) {
  assertAdminConfigured();
  const adminPassword = String(password || '').trim();
  if (!adminPassword) {
    throw new Error('Admin password required');
  }

  const candidateHash = hashPassword(adminPassword, getAdminPasswordSalt());
  const expectedHash = getAdminPasswordHash();

  if (!safeStringCompare(candidateHash, expectedHash)) {
    throw new Error('Invalid admin password');
  }

  return true;
}

export function createAdminSession(res, req) {
  assertAdminConfigured();
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({
    exp: expiresAt,
    iat: Date.now(),
    scope: 'admin',
  }), 'utf8').toString('base64url');
  const signature = signSessionValue(payload);

  res.setHeader('Set-Cookie', buildCookieHeader(`${payload}.${signature}`, {
    expiresAt,
    maxAge: ADMIN_SESSION_TTL_MS / 1000,
  }, req));
}

export function clearAdminSession(res, req) {
  res.setHeader('Set-Cookie', buildCookieHeader('', {
    expiresAt: new Date(0),
    maxAge: 0,
  }, req));
}

export function requireAdminSession(req) {
  assertAdminConfigured();
  const cookies = parseCookieHeader(req.headers.cookie);
  const sessionValue = cookies[ADMIN_SESSION_COOKIE];

  if (!sessionValue) {
    throw new Error('Admin login required');
  }

  const separatorIndex = sessionValue.lastIndexOf('.');
  if (separatorIndex === -1) {
    throw new Error('Admin login required');
  }

  const payload = sessionValue.slice(0, separatorIndex);
  const signature = sessionValue.slice(separatorIndex + 1);

  if (!safeStringCompare(signature, signSessionValue(payload))) {
    throw new Error('Admin login required');
  }

  let parsedPayload;
  try {
    parsedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Admin login required');
  }

  if (!parsedPayload || parsedPayload.scope !== 'admin' || Number(parsedPayload.exp || 0) <= Date.now()) {
    throw new Error('Admin login required');
  }

  return parsedPayload;
}

export function assertSameOriginAdminRequest(req) {
  const expectedOrigin = getRequestOrigin(req);
  if (!expectedOrigin) {
    throw new Error('Invalid admin origin');
  }

  const origin = String(req.headers.origin || '').trim();
  const referer = String(req.headers.referer || '').trim();

  if (origin && origin !== expectedOrigin) {
    throw new Error('Invalid admin origin');
  }

  if (!origin && referer && !referer.startsWith(`${expectedOrigin}/`)) {
    throw new Error('Invalid admin origin');
  }
}

export function setAdminSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
}

export function setAdminPageSecurityHeaders(res, html) {
  setAdminSecurityHeaders(res);

  const scriptHashes = getInlineTagHashes(html, 'script');
  const styleHashes = getInlineTagHashes(html, 'style');
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "font-src https://fonts.gstatic.com",
    `style-src https://fonts.googleapis.com ${styleHashes.join(' ')}`.trim(),
    `script-src ${scriptHashes.join(' ')}`.trim(),
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
}

export async function delayAdminFailure(ms = 900) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function listAllUsers() {
  const supabase = getServiceClient();
  const users = [];
  const perPage = 500;
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(error.message);
    }

    const batch = Array.isArray(data?.users) ? data.users : [];
    users.push(...batch);

    if (!batch.length || batch.length < perPage) {
      break;
    }

    page += 1;
  }

  return users;
}

function mapSignupRow(user) {
  const registration = serializeRegistration(user);
  const registeredAt = registration?.registeredAt || user?.created_at || null;

  return {
    id: user.id,
    email: normalizeEmail(user.email),
    role: registration?.role || '',
    roleLabel: registration?.roleLabel || 'Signed Up',
    registeredAt,
  };
}

export async function getAdminDashboardData() {
  const allowedDomain = String(process.env.ALLOWED_EMAIL_DOMAIN || 'ed.ac.uk').trim().toLowerCase();
  const domainSuffix = allowedDomain ? `@${allowedDomain}` : '';
  const authUsers = await listAllUsers();
  const allowedUsers = authUsers.filter((user) => {
    const email = normalizeEmail(user.email);
    return email && (!domainSuffix || email.endsWith(domainSuffix));
  });
  const signupRows = allowedUsers
    .map((user) => mapSignupRow(user))
    .filter((row) => row.role)
    .sort((left, right) => Date.parse(right.registeredAt || '') - Date.parse(left.registeredAt || ''));

  const totalSignups = signupRows.length;
  const parentSignups = signupRows.filter((row) => row.role === 'parent').length;
  const childSignups = signupRows.filter((row) => row.role === 'child').length;
  const latestSignupAt = signupRows[0]?.registeredAt || null;

  return {
    generatedAt: new Date().toISOString(),
    metrics: {
      totalUsers: allowedUsers.length,
      totalSignups,
      parentSignups,
      childSignups,
      latestSignupAt,
      completionRate: allowedUsers.length
        ? Math.round((totalSignups / allowedUsers.length) * 100)
        : 0,
    },
    signups: signupRows,
    cumulativeSeries: buildSignupSeries(signupRows),
  };
}
