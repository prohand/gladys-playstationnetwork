// -----------------------------------------------------------------------------
// PlayStation Network REST client: the few endpoints this integration reads.
//
//   - account id of the signed-in user ......... dms.api.playstation.com
//   - profile (online ID, avatar, PS Plus) ..... m.np.playstation.com/userProfile
//   - presence (online, platform, game) ........ m.np.playstation.com/userProfile
//   - trophy summary (level, counts) ........... m.np.playstation.com/trophy
//   - online ID -> account id (friends) ........ us-prof.np.community.playstation.net
//
// Read-only on purpose: nothing here can send a message, a friend request or a
// purchase, so a leaked token cannot do more than read what the PlayStation
// App shows.
//
// A 401 renews the access token once and retries; a 429 is Sony's throttle and
// is reported as such, never retried in a loop.
// -----------------------------------------------------------------------------

import { normalizePresence } from './presence.js';

const M_BASE = 'https://m.np.playstation.com/api';
const DMS_ME = 'https://dms.api.playstation.com/api/v1/devices/accounts/me';
const LEGACY_PROFILE = 'https://us-prof.np.community.playstation.net/userProfile/v1/users';

/** An error answered by the PlayStation Network. */
export class PsnApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PsnApiError';
    this.status = status;
  }
}

/**
 * @param {object} deps
 * @param {typeof fetch} deps.fetch
 * @param {{ getAccessToken(): Promise<string>, invalidate(): void }} deps.auth
 */
export function createPsnApi({ fetch, auth }) {
  async function get(url, { retried = false } = {}) {
    const token = await auth.getAccessToken();
    let response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Accept-Language': 'en-US',
        },
      });
    } catch (err) {
      throw new PsnApiError(0, `PlayStation Network unreachable: ${err.message}`);
    }
    if (response.status === 401 && !retried) {
      auth.invalidate();
      return get(url, { retried: true });
    }
    if (!response.ok) {
      const what = new URL(url).pathname.split('/').slice(-2).join('/');
      throw new PsnApiError(
        response.status,
        `PlayStation Network answered ${response.status} (${what})`,
      );
    }
    return response.json();
  }

  const api = {
    /** The account id of the signed-in user. */
    async getMyAccountId() {
      try {
        const body = await get(DMS_ME);
        if (body?.accountId) {
          return String(body.accountId);
        }
      } catch (err) {
        if (err.status === 0 || err.status === 429) {
          throw err;
        }
      }
      // Fallback: the online ID of "me", then its account id.
      const profile = await api.getProfile('me');
      const found = await api.lookupOnlineId(profile.onlineId);
      if (!found) {
        throw new PsnApiError(404, 'Could not find the account id of the signed-in user');
      }
      return found.accountId;
    },

    /**
     * @param {string} accountId an account id, or 'me'
     * @returns {Promise<{ onlineId: string, avatarUrl: string|null, isPlusMember: boolean }>}
     */
    async getProfile(accountId) {
      const body = await get(`${M_BASE}/userProfile/v1/internal/users/${accountId}/profiles`);
      const avatars = Array.isArray(body?.avatars) ? body.avatars : [];
      const avatar = ['xl', 'l', 'm', 's']
        .map((size) => avatars.find((entry) => entry.size === size))
        .find(Boolean);
      return {
        onlineId: String(body?.onlineId ?? ''),
        avatarUrl: avatar?.url ?? null,
        isPlusMember: body?.isPlusMember === true,
      };
    },

    /**
     * The account id behind an online ID, or null when nobody has it.
     * @returns {Promise<{ onlineId: string, accountId: string }|null>}
     */
    async lookupOnlineId(onlineId) {
      try {
        const body = await get(
          `${LEGACY_PROFILE}/${encodeURIComponent(onlineId)}/profile2?fields=onlineId,accountId`,
        );
        const profile = body?.profile;
        return profile?.accountId
          ? { onlineId: String(profile.onlineId ?? onlineId), accountId: String(profile.accountId) }
          : null;
      } catch (err) {
        if (err.status === 404) {
          return null;
        }
        throw err;
      }
    },

    /** The normalized presence of one account (see presence.js). */
    async getPresence(accountId) {
      const body = await get(
        `${M_BASE}/userProfile/v1/internal/users/${accountId}/basicPresences?type=primary`,
      );
      return normalizePresence({ accountId, ...(body?.basicPresence ?? {}) });
    },

    /**
     * The presences of several accounts, in one request when Sony accepts it,
     * one by one otherwise. An account whose presence is hidden (privacy, no
     * longer a friend) is simply missing from the map.
     *
     * @param {string[]} accountIds
     * @returns {Promise<Map<string, object>>}
     */
    async getPresences(accountIds) {
      const result = new Map();
      if (accountIds.length === 0) {
        return result;
      }
      try {
        const body = await get(
          `${M_BASE}/userProfile/v1/internal/users/basicPresences?type=primary&accountIds=${accountIds.join(',')}`,
        );
        for (const raw of body?.basicPresences ?? []) {
          if (raw?.accountId) {
            result.set(String(raw.accountId), normalizePresence(raw));
          }
        }
        return result;
      } catch (err) {
        if (err.status === 0 || err.status === 429) {
          throw err;
        }
      }
      for (const accountId of accountIds) {
        try {
          result.set(accountId, await api.getPresence(accountId));
        } catch (err) {
          if (err.status === 0 || err.status === 429) {
            throw err;
          }
        }
      }
      return result;
    },

    /**
     * @returns {Promise<{ level: number, progress: number, platinum: number, gold: number, silver: number, bronze: number }>}
     */
    async getTrophySummary(accountId) {
      const body = await get(`${M_BASE}/trophy/v1/users/${accountId}/trophySummary`);
      const earned = body?.earnedTrophies ?? {};
      return {
        level: Number(body?.trophyLevel) || 0,
        progress: Number(body?.progress) || 0,
        platinum: Number(earned.platinum) || 0,
        gold: Number(earned.gold) || 0,
        silver: Number(earned.silver) || 0,
        bronze: Number(earned.bronze) || 0,
      };
    },
  };
  return api;
}
