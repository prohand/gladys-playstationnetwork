import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  MAX_FRIENDS,
  normalizeConfig,
  parseFriends,
  parseNpsso,
} from '../src/config.js';

const TOKEN = 'Ab1'.repeat(21) + 'x';

test('the NPSSO is read bare or from the JSON page that shows it', () => {
  assert.equal(parseNpsso(`  ${TOKEN}  `), TOKEN);
  assert.equal(parseNpsso(`{"npsso":"${TOKEN}"}`), TOKEN);
  assert.equal(parseNpsso(`{ "npsso" : "${TOKEN}" }\n`), TOKEN);
  assert.equal(parseNpsso(undefined), '');
});

test('friends: any separator, duplicates dropped, invalid names reported', () => {
  const { ids, invalid, truncated } = parseFriends(
    'Alice_1, bob-2;alice_1\n  Carol  , 4bad, x, ok@no',
  );
  assert.deepEqual(ids, ['Alice_1', 'bob-2', 'Carol']);
  assert.deepEqual(invalid, ['4bad', 'x', 'ok@no']);
  assert.equal(truncated, false);
});

test(`friends: at most ${MAX_FRIENDS} are followed`, () => {
  const names = Array.from({ length: MAX_FRIENDS + 3 }, (_, i) => `Friend${i}`);
  const { ids, truncated } = parseFriends(names.join(','));
  assert.equal(ids.length, MAX_FRIENDS);
  assert.equal(truncated, true);
});

test('defaults apply to an empty configuration', () => {
  const config = normalizeConfig();
  assert.equal(config.npsso, '');
  assert.deepEqual(config.friendIds, []);
  assert.equal(config.consoleIp, null);
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
  assert.equal(config.timezone, 'Europe/Paris');
  assert.equal(config.GLADYS_PREFER_LOCAL, true);
});

test('the refresh interval is a number kept within its bounds', () => {
  assert.equal(normalizeConfig({ poll_frequency: '300' }).poll_frequency, 300);
  assert.equal(normalizeConfig({ poll_frequency: 5 }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 99999 }).poll_frequency, 3600);
  assert.equal(normalizeConfig({ poll_frequency: 'abc' }).poll_frequency, 120);
});

test('the console IP must be an IPv4 address', () => {
  assert.equal(normalizeConfig({ console_ip: ' 192.168.1.20 ' }).consoleIp, '192.168.1.20');
  assert.equal(normalizeConfig({ console_ip: '192.168.1.300' }).consoleIp, null);
  assert.equal(normalizeConfig({ console_ip: 'ps5.local' }).consoleIp, null);
});

test('an unknown time zone falls back to the default', () => {
  assert.equal(normalizeConfig({ timezone: 'Europe/Berlin' }).timezone, 'Europe/Berlin');
  assert.equal(normalizeConfig({ timezone: 'Mars/Olympus' }).timezone, 'Europe/Paris');
});

test('only an explicit false turns the local preference off', () => {
  assert.equal(normalizeConfig({ GLADYS_PREFER_LOCAL: false }).GLADYS_PREFER_LOCAL, false);
  assert.equal(normalizeConfig({ GLADYS_PREFER_LOCAL: undefined }).GLADYS_PREFER_LOCAL, true);
});
