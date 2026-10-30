import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { AppError } from './errors.mjs';

export const hashToken = (value) => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export function equalToken(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length)
    return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}
export function cookieValue(header, name) {
  if (typeof header !== 'string') return null;
  const values = header
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null;
}
export function sessionCookie(value, seconds, explicitSyntheticLoopback = false) {
  return `local_session=${value}; Path=/; Max-Age=${seconds}; HttpOnly; SameSite=Lax${explicitSyntheticLoopback ? '' : '; Secure'}`;
}
export function csrfCookie(value, seconds, explicitSyntheticLoopback = false) {
  return `local_csrf=${value}; Path=/; Max-Age=${seconds}; HttpOnly; SameSite=Lax${explicitSyntheticLoopback ? '' : '; Secure'}`;
}

export async function verifyGoogleIdToken(
  token,
  { keys, clientId, nonce, now = Date.now() / 1000 },
) {
  if (
    typeof token !== 'string' ||
    token.length > 16384 ||
    !Array.isArray(keys) ||
    keys.length > 10 ||
    typeof clientId !== 'string' ||
    typeof nonce !== 'string'
  )
    throw new AppError(401, 'AUTH_FAILED', 'Google identity could not be verified.');
  try {
    const { payload } = await jwtVerify(token, createLocalJWKSet({ keys }), {
      algorithms: ['RS256'],
      issuer: 'https://accounts.google.com',
      audience: clientId,
      currentDate: new Date(now * 1000),
      requiredClaims: ['iss', 'aud', 'sub', 'iat', 'exp', 'nonce', 'email_verified'],
    });
    if (
      payload.aud !== clientId ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      payload.sub.length > 255 ||
      payload.nonce !== nonce ||
      payload.email_verified !== true ||
      !Number.isFinite(payload.iat) ||
      payload.iat > now ||
      payload.exp <= payload.iat ||
      (payload.azp !== undefined && payload.azp !== clientId)
    )
      throw new Error('Invalid identity claims.');
    return payload;
  } catch {
    throw new AppError(401, 'AUTH_FAILED', 'Google identity could not be verified.');
  }
}

// Fixed endpoints verified from Google's discovery document on 2026-10-13.
// The integration launcher supplies transport only after explicit Google configuration.
const endpoints = Object.freeze({
  authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  keys: 'https://www.googleapis.com/oauth2/v3/certs',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
});
async function withAbort(operation, signal) {
  signal.throwIfAborted();
  let onAbort;
  const aborted = new Promise((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
async function boundedJson(response, signal) {
  if (!response?.ok || !response.body) throw new Error('Identity endpoint refused the request.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > 65536) throw new Error('Identity response exceeded its bound.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

export function createGoogleOAuth({ db, settings, transport }) {
  if (
    !settings?.enabled ||
    typeof settings.clientId !== 'string' ||
    !settings.clientId ||
    typeof settings.clientSecret !== 'string' ||
    !settings.clientSecret ||
    typeof transport !== 'function' ||
    !Number.isInteger(settings.stateSeconds) ||
    settings.stateSeconds < 1 ||
    settings.stateSeconds > 600 ||
    !Number.isInteger(settings.timeoutMs) ||
    settings.timeoutMs < 1 ||
    settings.timeoutMs > 10000 ||
    typeof settings.legalVersion !== 'string' ||
    !settings.legalVersion
  )
    throw new Error('Google OAuth requires explicit complete configuration and transport.');
  const redirect = new URL(settings.redirectUri);
  const localCallback =
    settings.allowLocalLoopback === true &&
    redirect.protocol === 'http:' &&
    redirect.hostname === '127.0.0.1' &&
    redirect.port &&
    redirect.pathname === '/api/auth/google/callback';
  if (
    (redirect.protocol !== 'https:' && !localCallback) ||
    redirect.username ||
    redirect.password ||
    redirect.hash ||
    redirect.search
  )
    throw new Error('Google callback requires HTTPS or explicit exact loopback configuration.');
  return {
    async start({ browserToken, acceptedLegalVersion }) {
      if (
        typeof browserToken !== 'string' ||
        browserToken.length < 32 ||
        acceptedLegalVersion !== settings.legalVersion
      ) {
        throw new AppError(
          403,
          'LEGAL_ACCEPTANCE_REQUIRED',
          'Accept the current notices before signing in.',
        );
      }
      const state = newToken();
      const verifier = newToken();
      const nonce = newToken();
      await db.query('DELETE FROM oauth_states WHERE expires_at<CURRENT_TIMESTAMP');
      await db.query(
        'INSERT INTO oauth_states(state_hash,verifier,nonce,browser_hash,expires_at) VALUES($1,$2,$3,$4,$5)',
        [
          hashToken(state),
          verifier,
          nonce,
          hashToken(browserToken),
          new Date(Date.now() + settings.stateSeconds * 1000).toISOString(),
        ],
      );
      const url = new URL(endpoints.authorization);
      url.search = new URLSearchParams({
        client_id: settings.clientId,
        response_type: 'code',
        scope: 'openid email profile',
        redirect_uri: redirect.href,
        state,
        nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      }).toString();
      return { authorizationUrl: url.href };
    },
    async complete({ state, code, browserToken }) {
      if (
        typeof state !== 'string' ||
        state.length > 256 ||
        typeof browserToken !== 'string' ||
        typeof code !== 'string' ||
        !code ||
        code.length > 4096
      )
        throw new AppError(401, 'AUTH_FAILED', 'Invalid sign-in response.');
      const record = (
        await db.query(
          'DELETE FROM oauth_states WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>CURRENT_TIMESTAMP RETURNING *',
          [hashToken(state), hashToken(browserToken)],
        )
      ).rows[0];
      if (!record)
        throw new AppError(
          401,
          'AUTH_FAILED',
          'This sign-in request has expired or was already used.',
        );
      const signal = AbortSignal.timeout(settings.timeoutMs);
      const requestJson = async (url, options = {}) =>
        boundedJson(
          await withAbort(transport(url, { ...options, redirect: 'error', signal }), signal),
          signal,
        );
      try {
        const tokens = await requestJson(endpoints.token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: settings.clientId,
            client_secret: settings.clientSecret,
            grant_type: 'authorization_code',
            redirect_uri: redirect.href,
            code,
            code_verifier: record.verifier,
          }).toString(),
        });
        if (
          typeof tokens.access_token !== 'string' ||
          !tokens.access_token ||
          tokens.access_token.length > 16384 ||
          tokens.token_type !== 'Bearer' ||
          !Number.isFinite(tokens.expires_in) ||
          tokens.expires_in <= 0
        )
          throw new Error('Invalid token response.');
        const keySet = await requestJson(endpoints.keys);
        const identity = await verifyGoogleIdToken(tokens.id_token, {
          keys: keySet.keys,
          clientId: settings.clientId,
          nonce: record.nonce,
        });
        const profile = await requestJson(endpoints.userinfo, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (profile.sub !== identity.sub || profile.email_verified !== true)
          throw new Error('Identity profile mismatch.');
        const name =
          typeof profile.name === 'string'
            ? profile.name
                .replace(/[\u0000-\u001f\u007f]/g, '')
                .slice(0, 120)
                .trim()
            : '';
        const user = await db.transaction(async (tx) => {
          const deleted = await tx.query(
            "SELECT id FROM users WHERE identity_provider='google' AND status='deleted' AND provider_subject=$1 LIMIT 1",
            [hashToken(identity.sub)],
          );
          if (deleted.rows.length)
            throw new Error('Deleted account remains subject to retained usage.');
          return (
            await tx.query(
              `INSERT INTO users(id,identity_provider,provider_subject,google_sub,display_name,legal_version,legal_accepted_at)
          VALUES($1,'google',$2,$2,$3,$4,CURRENT_TIMESTAMP)
          ON CONFLICT(identity_provider,provider_subject) DO UPDATE SET legal_version=$4,legal_accepted_at=CURRENT_TIMESTAMP
          WHERE users.status='active' RETURNING *`,
              [randomUUID(), identity.sub, name || 'Google account', settings.legalVersion],
            )
          ).rows[0];
        });
        if (!user) throw new Error('Account unavailable.');
        return user;
      } catch {
        throw new AppError(
          401,
          'AUTH_FAILED',
          'Google sign-in could not be completed. Start again.',
        );
      }
    },
  };
}
