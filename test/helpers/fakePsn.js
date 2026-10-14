// -----------------------------------------------------------------------------
// An in-memory PlayStation Network, behind a `fetch` the code under test uses.
//
// It answers the endpoints the integration calls, from a state the tests edit
// (`psn.presences`, `psn.trophies`…), and records every request. No network.
// -----------------------------------------------------------------------------

export const NPSSO = 'a'.repeat(64);
export const ME = { accountId: '1111111111111111111', onlineId: 'Player_One' };

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A `basicPresence` as Sony sends it. */
export function rawPresence({ online = true, platform = 'PS5', game = null, titleId = null } = {}) {
  return {
    availability: online ? 'availableToPlay' : 'unavailable',
    primaryPlatformInfo: {
      onlineStatus: online ? 'online' : 'offline',
      platform,
      lastOnlineDate: '2026-10-14T18:00:00.000Z',
    },
    ...(game
      ? {
          gameTitleInfoList: [
            {
              npTitleId: titleId ?? `PPSA0${game.length}_00`,
              titleName: game,
              format: platform.toLowerCase(),
              launchPlatform: platform,
              conceptIconUrl: `https://image.api.playstation.com/icons/${encodeURIComponent(game)}.png`,
            },
          ],
        }
      : {}),
  };
}

export function createFakePsn() {
  const psn = {
    npsso: NPSSO,
    me: { ...ME },
    isPlusMember: true,
    // accountId -> raw basicPresence
    presences: new Map([[ME.accountId, rawPresence({ online: false })]]),
    // onlineId (lowercase) -> accountId
    accounts: new Map([[ME.onlineId.toLowerCase(), ME.accountId]]),
    trophies: {
      trophyLevel: 312,
      progress: 40,
      earnedTrophies: { platinum: 5, gold: 40, silver: 120, bronze: 600 },
    },
    batchSupported: true,
    down: false,
    throttled: false,
    refreshRevoked: false,
    tokenCount: 0,
    requests: [],

    addFriend(onlineId, accountId, presence = rawPresence({ online: false })) {
      psn.accounts.set(onlineId.toLowerCase(), accountId);
      psn.presences.set(accountId, presence);
    },

    count(fragment) {
      return psn.requests.filter((request) => request.url.includes(fragment)).length;
    },

    async fetch(input, init = {}) {
      const url = new URL(String(input));
      psn.requests.push({ url: url.href, method: init.method ?? 'GET' });
      if (psn.down) {
        throw new TypeError('fetch failed');
      }

      // --- sign-in ----------------------------------------------------------
      if (url.pathname.endsWith('/oauth/authorize')) {
        const cookie = init.headers?.Cookie ?? '';
        if (cookie !== `npsso=${psn.npsso}`) {
          return new Response('', {
            status: 302,
            headers: {
              Location: 'com.scee.psxandroid.scecompcall://redirect/?error=login_required',
            },
          });
        }
        return new Response('', {
          status: 302,
          headers: { Location: 'com.scee.psxandroid.scecompcall://redirect/?code=v3.CODE&cid=x' },
        });
      }
      if (url.pathname.endsWith('/oauth/token')) {
        const form = new URLSearchParams(init.body);
        const grant = form.get('grant_type');
        if (grant === 'authorization_code' && form.get('code') !== 'v3.CODE') {
          return json(400, { error: 'invalid_grant' });
        }
        if (
          grant === 'refresh_token' &&
          (psn.refreshRevoked || form.get('refresh_token') !== 'refresh-token')
        ) {
          return json(400, { error: 'invalid_grant' });
        }
        psn.tokenCount += 1;
        return json(200, {
          access_token: `access-${psn.tokenCount}`,
          expires_in: 3600,
          refresh_token: 'refresh-token',
          refresh_token_expires_in: 5_184_000,
        });
      }

      // --- the API ----------------------------------------------------------
      const auth = init.headers?.Authorization ?? '';
      if (!auth.startsWith('Bearer access-')) {
        return json(401, { error: 'unauthorized' });
      }
      if (psn.throttled) {
        return json(429, { error: 'too many requests' });
      }
      if (url.hostname === 'dms.api.playstation.com') {
        return json(200, { accountId: psn.me.accountId, accountDevices: [] });
      }
      const profile2 = url.pathname.match(/\/userProfile\/v1\/users\/([^/]+)\/profile2$/);
      if (profile2) {
        const onlineId = decodeURIComponent(profile2[1]);
        const accountId = psn.accounts.get(onlineId.toLowerCase());
        return accountId
          ? json(200, { profile: { onlineId, accountId } })
          : json(404, { error: { message: 'Not found' } });
      }
      const profiles = url.pathname.match(/\/internal\/users\/([^/]+)\/profiles$/);
      if (profiles) {
        return json(200, {
          onlineId: psn.me.onlineId,
          avatars: [{ size: 'l', url: 'https://example.invalid/avatar.png' }],
          isPlusMember: psn.isPlusMember,
        });
      }
      if (url.pathname.endsWith('/internal/users/basicPresences')) {
        if (!psn.batchSupported) {
          return json(404, { error: 'not found' });
        }
        const ids = (url.searchParams.get('accountIds') ?? '').split(',');
        return json(200, {
          basicPresences: ids
            .filter((id) => psn.presences.has(id))
            .map((id) => ({ accountId: id, ...psn.presences.get(id) })),
        });
      }
      const presence = url.pathname.match(/\/internal\/users\/([^/]+)\/basicPresences$/);
      if (presence) {
        const raw = psn.presences.get(presence[1]);
        return raw ? json(200, { basicPresence: raw }) : json(403, { error: 'forbidden' });
      }
      if (url.pathname.endsWith('/trophySummary')) {
        return json(200, { accountId: psn.me.accountId, tier: 3, ...psn.trophies });
      }
      return json(404, { error: `no route for ${url.pathname}` });
    },
  };
  psn.fetch = psn.fetch.bind(psn);
  return psn;
}
