// -----------------------------------------------------------------------------
// PlayStation Network authentication: NPSSO -> access token.
//
// Sony offers no public API, so this follows what the PlayStation App does
// (the same flow as the `psn-api` and `PSNAWP` libraries):
//   1. the NPSSO (a 64-character cookie of a signed-in sony.com session) is
//      traded for a one-time authorization code;
//   2. the code is traded for an access token (one hour) and a refresh token
//      (about two months);
//   3. the refresh token renews the access token until it expires itself, and
//      only then is the NPSSO used again.
//
// The tokens are kept in /data (see src/store.js) so a restart does not trade
// the NPSSO again. A new NPSSO in the configuration (another account, or the
// old one expired) throws the stored tokens away: they are tied to the NPSSO
// by its hash, never by the value itself.
//
// Never log any of these values: the NPSSO is as good as the account password.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'psn-auth' });

const AUTH_BASE = 'https://ca.account.sony.com/api/authz/v3/oauth';
// The public client of the PlayStation App, as every PSN library uses it.
const CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
const CLIENT_BASIC =
  'Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=';
const REDIRECT_URI = 'com.scee.psxandroid.scecompcall://redirect';
const SCOPE = 'psn:mobile.v2.core psn:clientapp';

/** Renew a token this long before it expires. */
const EXPIRY_MARGIN_MS = 2 * 60 * 1000;

/** Why authentication failed: `code` drives the message shown to the user. */
export class PsnAuthError extends Error {
  /**
   * @param {'NPSSO_MISSING'|'NPSSO_INVALID'|'NETWORK'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'PsnAuthError';
    this.code = code;
  }
}

const hashOf = (value) => createHash('sha256').update(value).digest('hex');

/**
 * @param {object} deps
 * @param {typeof fetch} deps.fetch
 * @param {{ load(): Promise<object>, save(value: object): Promise<void> }} deps.store
 * @param {() => number} [deps.clock]
 */
export function createAuth({ fetch, store, clock = Date.now }) {
  let npsso = '';
  let tokens = null;
  let loaded = false;
  let inFlight = null;

  async function ensureLoaded() {
    if (!loaded) {
      tokens = (await store.load()).tokens ?? null;
      loaded = true;
    }
  }

  async function persist() {
    await store.save({ tokens });
  }

  async function call(url, init) {
    try {
      return await fetch(url, init);
    } catch (err) {
      throw new PsnAuthError('NETWORK', `Sony sign-in unreachable: ${err.message}`);
    }
  }

  async function exchangeNpsso() {
    if (!npsso) {
      throw new PsnAuthError('NPSSO_MISSING', 'No NPSSO token in the configuration');
    }
    const query = new URLSearchParams({
      access_type: 'offline',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPE,
    });
    const response = await call(`${AUTH_BASE}/authorize?${query}`, {
      headers: { Cookie: `npsso=${npsso}` },
      redirect: 'manual',
    });
    // A valid NPSSO is answered with a redirect to the app, carrying the code;
    // an expired one with a redirect carrying an error, or the sign-in page.
    const location = response.headers.get('location') ?? '';
    const code = location.match(/[?&]code=([^&]+)/)?.[1];
    if (!code) {
      if (response.status >= 500) {
        throw new PsnAuthError('NETWORK', `Sony sign-in answered ${response.status}`);
      }
      throw new PsnAuthError('NPSSO_INVALID', 'The NPSSO token was refused (expired or wrong)');
    }
    return requestTokens({
      code: decodeURIComponent(code),
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      token_format: 'jwt',
    });
  }

  async function requestTokens(form) {
    const response = await call(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: {
        Authorization: CLIENT_BASIC,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    });
    if (!response.ok) {
      if (response.status >= 500) {
        throw new PsnAuthError('NETWORK', `Sony token endpoint answered ${response.status}`);
      }
      throw new PsnAuthError(
        'NPSSO_INVALID',
        `Sony refused the token request (${response.status})`,
      );
    }
    const body = await response.json();
    const now = clock();
    tokens = {
      npssoHash: hashOf(npsso),
      accessToken: body.access_token,
      accessExpiresAt: now + Number(body.expires_in ?? 3600) * 1000,
      refreshToken: body.refresh_token ?? tokens?.refreshToken ?? null,
      refreshExpiresAt: body.refresh_token
        ? now + Number(body.refresh_token_expires_in ?? 0) * 1000
        : (tokens?.refreshExpiresAt ?? 0),
    };
    await persist();
    return tokens.accessToken;
  }

  async function renew() {
    await ensureLoaded();
    if (tokens && tokens.npssoHash !== hashOf(npsso)) {
      // Another NPSSO: the stored tokens belong to the previous one.
      tokens = null;
      await persist();
    }
    const now = clock();
    if (tokens?.accessToken && tokens.accessExpiresAt - EXPIRY_MARGIN_MS > now) {
      return tokens.accessToken;
    }
    if (tokens?.refreshToken && tokens.refreshExpiresAt - EXPIRY_MARGIN_MS > now) {
      try {
        logger.debug('Renewing the access token');
        return await requestTokens({
          refresh_token: tokens.refreshToken,
          grant_type: 'refresh_token',
          token_format: 'jwt',
          scope: SCOPE,
        });
      } catch (err) {
        if (err.code === 'NETWORK') {
          throw err;
        }
        // Revoked (password changed, signed out everywhere): try the NPSSO.
        logger.warn('The refresh token was refused, signing in again with the NPSSO');
      }
    }
    logger.info('Signing in to the PlayStation Network with the NPSSO');
    return exchangeNpsso();
  }

  return {
    /** Use this NPSSO from now on (the stored tokens are dropped if it changed). */
    setNpsso(value) {
      npsso = String(value ?? '');
    },

    hasNpsso() {
      return npsso.length > 0;
    },

    /** A valid access token; concurrent callers share one renewal. */
    getAccessToken() {
      if (!inFlight) {
        inFlight = renew().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },

    /** Forget the access token (the API answered 401): the next call renews it. */
    invalidate() {
      if (tokens) {
        tokens = { ...tokens, accessExpiresAt: 0 };
      }
    },
  };
}
