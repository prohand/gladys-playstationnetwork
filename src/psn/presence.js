// -----------------------------------------------------------------------------
// A PlayStation Network presence, reduced to what Gladys shows.
//
// Sony answers a `basicPresence` shaped like:
//   {
//     availability: 'availableToPlay' | 'unavailable',
//     primaryPlatformInfo: { onlineStatus: 'online' | 'offline', platform: 'PS5', lastOnlineDate },
//     gameTitleInfoList: [{ npTitleId, titleName, format, launchPlatform,
//                           conceptIconUrl (PS5) | npTitleIconUrl (PS4) }]
//   }
// Every field is optional in practice (privacy settings, PS3/Vita accounts,
// an app that is not a game): the reduction never throws.
// -----------------------------------------------------------------------------

/** The platforms Gladys names; anything else is shown as Sony spells it. */
const PLATFORMS = { PS5: 'PS5', PS4: 'PS4', PS3: 'PS3', PSVITA: 'PS Vita', PSPC: 'PC' };

function platformName(raw) {
  const key = String(raw ?? '')
    .toUpperCase()
    .replace(/\s+/g, '');
  return key ? (PLATFORMS[key] ?? String(raw)) : null;
}

/** An image URL the integration may fetch (http or https only). */
function imageUrl(raw) {
  try {
    const url = new URL(String(raw));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {object} Presence
 * @property {string|null} accountId
 * @property {boolean} online
 * @property {boolean} inGame
 * @property {string|null} platform   'PS5', 'PS4'…
 * @property {string|null} titleName
 * @property {string|null} titleId
 * @property {string|null} iconUrl
 * @property {string|null} lastOnline ISO date of the last time seen online
 */

/**
 * @param {object} raw a `basicPresence` (with its `accountId` when known)
 * @returns {Presence}
 */
export function normalizePresence(raw = {}) {
  const platformInfo = raw.primaryPlatformInfo ?? {};
  const status = platformInfo.onlineStatus ?? raw.onlineStatus;
  const online = status ? status === 'online' : raw.availability === 'availableToPlay';
  const game = Array.isArray(raw.gameTitleInfoList) ? raw.gameTitleInfoList[0] : undefined;
  const titleName = game?.titleName ? String(game.titleName) : null;
  return {
    accountId: raw.accountId ? String(raw.accountId) : null,
    online,
    inGame: online && titleName !== null,
    platform: platformName(platformInfo.platform ?? game?.launchPlatform ?? game?.format),
    titleName: online ? titleName : null,
    titleId: online && game?.npTitleId ? String(game.npTitleId) : null,
    iconUrl: online ? imageUrl(game?.conceptIconUrl ?? game?.npTitleIconUrl) : null,
    lastOnline: platformInfo.lastOnlineDate ?? raw.lastAvailableDate ?? null,
  };
}

/** The presence of an account that is not known to be anywhere. */
export const UNKNOWN_PRESENCE = Object.freeze(normalizePresence({}));
