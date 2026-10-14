// -----------------------------------------------------------------------------
// The Gladys devices of the integration.
//
//   - the PSN account (the player whose NPSSO is configured): online, in game,
//     current game, platform, session and daily play time, trophies;
//   - each followed friend: the same presence, without the trophies (one more
//     request per friend for a number nobody automates on);
//   - each console found on the LAN: powered on or not.
//
// External ids are forever: they are built from the ids Sony gives (the
// account id of a player, the host id — the MAC — of a console), never from a
// name, which a player can change on the PlayStation Network.
//
// Nothing here is controllable: every feature is read-only. The states are
// refreshed by the integration's own timers (see src/service.js), not by
// Gladys polling, because one PSN request serves every player at once.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';

/** Device types, the first part of the external ids. */
export const DEVICE_TYPES = Object.freeze({
  ACCOUNT: 'account',
  FRIEND: 'friend',
  CONSOLE: 'console',
});

/** Feature keys, the last part of the external ids. Never renamed. */
export const FEATURES = Object.freeze({
  ONLINE: 'online',
  IN_GAME: 'in-game',
  GAME: 'game',
  PLATFORM: 'platform',
  SESSION: 'session-duration',
  TODAY: 'played-today',
  TROPHY_LEVEL: 'trophy-level',
  PLATINUM: 'platinum',
  GOLD: 'gold',
  SILVER: 'silver',
  BRONZE: 'bronze',
  POWER: 'power',
});

/** A console host id, as an id part: lowercase hex only. */
export function consoleKey(hostId) {
  return String(hostId ?? '')
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
}

export function accountIds(gladys, accountId) {
  return gladys.externalIds(DEVICE_TYPES.ACCOUNT, String(accountId));
}

export function friendIds(gladys, accountId) {
  return gladys.externalIds(DEVICE_TYPES.FRIEND, String(accountId));
}

export function consoleIds(gladys, hostId) {
  return gladys.externalIds(DEVICE_TYPES.CONSOLE, consoleKey(hostId));
}

const binary = (ids, key, name, category = CATEGORIES.PRESENCE_SENSOR) => ({
  name,
  external_id: ids.feature(key),
  category,
  type: category === CATEGORIES.TELEVISION ? TYPES.TELEVISION.BINARY : TYPES.SENSOR.BINARY,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 1,
});

const text = (ids, key, name) => ({
  name,
  external_id: ids.feature(key),
  category: CATEGORIES.TEXT,
  type: TYPES.TEXT.TEXT,
  read_only: true,
  has_feedback: false,
  keep_history: false,
  min: 0,
  max: 255,
});

const minutes = (ids, key, name) => ({
  name,
  external_id: ids.feature(key),
  category: CATEGORIES.DURATION,
  type: TYPES.DURATION.INTEGER,
  unit: UNITS.MINUTES,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 1440,
});

const counter = (ids, key, name, max = 100000) => ({
  name,
  external_id: ids.feature(key),
  category: CATEGORIES.COUNTER_SENSOR,
  type: TYPES.SENSOR.INTEGER,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max,
});

function presenceFeatures(ids) {
  return [
    binary(ids, FEATURES.ONLINE, 'Online'),
    binary(ids, FEATURES.IN_GAME, 'In game'),
    text(ids, FEATURES.GAME, 'Current game'),
    text(ids, FEATURES.PLATFORM, 'Platform'),
    minutes(ids, FEATURES.SESSION, 'Current session'),
    minutes(ids, FEATURES.TODAY, 'Played today'),
  ];
}

/**
 * @param {object} gladys
 * @param {{ accountId: string, onlineId: string }} account
 */
export function buildAccountDevice(gladys, account) {
  const ids = accountIds(gladys, account.accountId);
  return {
    name: `PSN ${account.onlineId}`,
    external_id: ids.device,
    model: 'PlayStation Network account',
    params: [{ name: 'ONLINE_ID', value: account.onlineId }],
    features: [
      ...presenceFeatures(ids),
      counter(ids, FEATURES.TROPHY_LEVEL, 'Trophy level', 999),
      counter(ids, FEATURES.PLATINUM, 'Platinum trophies'),
      counter(ids, FEATURES.GOLD, 'Gold trophies'),
      counter(ids, FEATURES.SILVER, 'Silver trophies'),
      counter(ids, FEATURES.BRONZE, 'Bronze trophies'),
    ],
  };
}

/**
 * @param {object} gladys
 * @param {{ accountId: string, onlineId: string }} friend
 */
export function buildFriendDevice(gladys, friend) {
  const ids = friendIds(gladys, friend.accountId);
  return {
    name: `PSN ${friend.onlineId}`,
    external_id: ids.device,
    model: 'PlayStation Network friend',
    params: [{ name: 'ONLINE_ID', value: friend.onlineId }],
    features: presenceFeatures(ids),
  };
}

/**
 * @param {object} gladys
 * @param {{ hostId: string, hostName: string|null, hostType: string, ip: string|null }} console
 */
export function buildConsoleDevice(gladys, console) {
  const ids = consoleIds(gladys, console.hostId);
  const params = [{ name: 'HOST_TYPE', value: console.hostType }];
  if (console.ip) {
    params.push({ name: 'IP_ADDRESS', value: console.ip });
  }
  return {
    name: console.hostName || console.hostType,
    external_id: ids.device,
    model: console.hostType,
    params,
    features: [binary(ids, FEATURES.POWER, 'Power', CATEGORIES.TELEVISION)],
  };
}

/** The value of a device param, from a device as Gladys sends it back. */
export function deviceParam(device, name) {
  return (device?.params ?? []).find((param) => param.name === name)?.value ?? null;
}

/** Which kind of device an external id belongs to, and its platform id. */
export function parseDeviceExternalId(gladys, externalId) {
  const prefix = gladys.externalId('');
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const [type, id] = externalId.slice(prefix.length).split(':');
  return Object.values(DEVICE_TYPES).includes(type) && id ? { type, id } : null;
}
