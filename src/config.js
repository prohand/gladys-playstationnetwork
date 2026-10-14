// -----------------------------------------------------------------------------
// Integration configuration.
//
// The values come from the `config_schema` of `gladys-assistant-integration.json`,
// filled in by the user in Gladys. This module only provides the defaults and
// normalizes the received object, so the rest of the code never deals with
// `undefined`, with numbers typed as strings, or with a token pasted along with
// the JSON around it.
// -----------------------------------------------------------------------------

/** How many friends can be followed: one batch presence request covers them all. */
export const MAX_FRIENDS = 10;

/** Bounds of the refresh interval, in seconds (mirrors the manifest). */
export const POLL_FREQUENCY_BOUNDS = { min: 60, max: 3600 };

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  npsso: '',
  friends: '',
  console_ip: '',
  // Seconds between two reads of the PlayStation Network. Sony throttles its
  // API (a few hundred requests per quarter of an hour): two minutes keeps an
  // account and ten friends far below that.
  poll_frequency: 120,
  // The day the "played today" counter belongs to is the day in this zone.
  timezone: 'Europe/Paris',
  // Reserved key (NOT in config_schema): the manifest declares both 'local' and
  // 'cloud', so Gladys shows its standard "Prefer the local connection" toggle
  // and sends the user's choice here. Read-only; defaults to true.
  GLADYS_PREFER_LOCAL: true,
};

// A PSN online ID: 3 to 16 letters, digits, hyphens and underscores.
const ONLINE_ID = /^[A-Za-z][A-Za-z0-9_-]{2,15}$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * The NPSSO token, from whatever the user pasted: the bare 64-character value,
 * or the whole `{"npsso":"..."}` answer of the Sony page that shows it.
 *
 * @param {unknown} raw
 * @returns {string} the token, or '' when there is none
 */
export function parseNpsso(raw) {
  const text = String(raw ?? '').trim();
  const fromJson = text.match(/"npsso"\s*:\s*"([^"]+)"/);
  return (fromJson ? fromJson[1] : text).trim();
}

/**
 * The online IDs of the friends to follow, from a free list (commas, spaces,
 * semicolons or new lines). Invalid names are reported, duplicates dropped, and
 * the list is cut at {@link MAX_FRIENDS}.
 *
 * @param {unknown} raw
 * @returns {{ ids: string[], invalid: string[], truncated: boolean }}
 */
export function parseFriends(raw) {
  const seen = new Set();
  const ids = [];
  const invalid = [];
  for (const entry of String(raw ?? '').split(/[\s,;]+/)) {
    const name = entry.trim();
    if (!name) {
      continue;
    }
    if (!ONLINE_ID.test(name)) {
      invalid.push(name);
      continue;
    }
    // Online IDs are case-insensitive on the PlayStation Network.
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      ids.push(name);
    }
  }
  return { ids: ids.slice(0, MAX_FRIENDS), invalid, truncated: ids.length > MAX_FRIENDS };
}

/** A time zone the runtime knows, or null. */
function knownTimeZone(zone) {
  const name = String(zone ?? '').trim();
  if (!name) {
    return null;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return name;
  } catch {
    return null;
  }
}

/**
 * Merge the user config with the defaults, and derive the parsed values.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const pollFrequency = Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency);
  const consoleIp = String(raw.console_ip ?? '').trim();
  const friends = parseFriends(raw.friends);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    npsso: parseNpsso(raw.npsso),
    friends: String(raw.friends ?? ''),
    friendIds: friends.ids,
    invalidFriends: friends.invalid,
    friendsTruncated: friends.truncated,
    console_ip: consoleIp,
    consoleIp: IPV4.test(consoleIp) ? consoleIp : null,
    poll_frequency: Number.isFinite(pollFrequency)
      ? Math.min(POLL_FREQUENCY_BOUNDS.max, Math.max(POLL_FREQUENCY_BOUNDS.min, pollFrequency))
      : DEFAULT_CONFIG.poll_frequency,
    timezone: knownTimeZone(raw.timezone) ?? DEFAULT_CONFIG.timezone,
    // The preference is a boolean; anything but an explicit false means true.
    GLADYS_PREFER_LOCAL: raw.GLADYS_PREFER_LOCAL !== false,
  };
}
