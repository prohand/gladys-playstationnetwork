import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, accountIds, consoleIds, friendIds } from '../src/devices/index.js';
import { linkMessage, NO_TEXT, TROPHY_INTERVAL_MS } from '../src/service.js';
import { createMemoryStore } from '../src/store.js';
import { ME, rawPresence } from './helpers/fakePsn.js';
import { createAllDevices, PS5_REPLY, setup } from './helpers/setup.js';

const MIN = 60_000;

/** Signed in, devices created, a first refresh done. */
async function ready(options) {
  const env = await setup(options);
  await env.service.refresh();
  await createAllDevices(env.gladys, env.service);
  return env;
}

test('the discovered devices are accepted by Gladys', async () => {
  const { psn, lan, gladys, service } = await setup({ config: { friends: 'Buddy, Ghost' } });
  psn.addFriend('Buddy', '222');
  lan.consoles.set('192.168.1.20', PS5_REPLY);
  await service.discover();
  const names = gladys.fake.discoveredDevices.map((device) => device.name);
  assert.deepEqual(names, [`PSN ${ME.onlineId}`, 'PSN Buddy', 'PS5-Salon']);
  const console = gladys.fake.discoveredDevices[2];
  assert.deepEqual(console.params, [
    { name: 'HOST_TYPE', value: 'PS5' },
    { name: 'IP_ADDRESS', value: '192.168.1.20' },
  ]);
  for (const device of gladys.fake.discoveredDevices) {
    for (const feature of device.features) {
      assert.equal(feature.read_only, true, `${feature.external_id} is read-only`);
      assert.ok(
        feature.min !== undefined && feature.max !== undefined,
        'min/max are NOT NULL in Gladys',
      );
    }
    assert.equal(device.should_poll, undefined, 'refreshed by the integration timers');
  }
});

test('the states of the created devices are published, the others never', async () => {
  const { psn, gladys, service } = await setup({ config: { friends: 'Buddy' } });
  psn.addFriend('Buddy', '222', rawPresence({ online: true, game: 'Astro Bot' }));
  await service.refresh();
  assert.equal(gladys.fake.states.length, 0, 'nothing is created yet');

  await gladys.fake.deviceCreated(service.buildDiscoveredDevices()[1]); // the friend only
  await service.refresh();
  const buddy = friendIds(gladys, '222');
  assert.equal(gladys.fake.lastState(buddy.feature(FEATURES.ONLINE)), 1);
  assert.equal(gladys.fake.lastState(buddy.feature(FEATURES.GAME)), 'Astro Bot');
  assert.equal(gladys.fake.lastState(buddy.feature(FEATURES.PLATFORM)), 'PS5');
  const account = accountIds(gladys, ME.accountId);
  assert.equal(gladys.fake.lastState(account.feature(FEATURES.ONLINE)), undefined);
});

test('an offline account: no game, a dash instead of an empty text', async () => {
  const { gladys, service } = await ready();
  await service.refresh();
  const ids = accountIds(gladys, ME.accountId);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.ONLINE)), 0);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.IN_GAME)), 0);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.GAME)), NO_TEXT);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.TROPHY_LEVEL)), 312);
});

test('a game session fires game_started then game_stopped, with its length', async () => {
  const { psn, gladys, service, clock } = await ready();
  const ids = accountIds(gladys, ME.accountId);
  psn.presences.set(
    ME.accountId,
    rawPresence({ online: true, game: 'Gran Turismo 7', titleId: 'PPSA01316_00' }),
  );
  clock.now += 2 * MIN;
  await service.refresh();
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.IN_GAME)), 1);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.GAME)), 'Gran Turismo 7');

  for (let i = 0; i < 15; i += 1) {
    clock.now += 2 * MIN;
    await service.refresh();
  }
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.SESSION)), 30);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.TODAY)), 30);

  psn.presences.set(ME.accountId, rawPresence({ online: true }));
  clock.now += 2 * MIN;
  await service.refresh();
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.GAME)), NO_TEXT);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.SESSION)), 0);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.TODAY)), 32);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => [
      event.key,
      event.data.game,
      event.data.duration_minutes,
    ]),
    [
      ['game_started', 'Gran Turismo 7', undefined],
      ['game_stopped', 'Gran Turismo 7', 32],
    ],
  );
  assert.deepEqual(gladys.fake.sceneEvents[0].data, {
    device: ids.device,
    online_id: ME.onlineId,
    game: 'Gran Turismo 7',
    title_id: 'PPSA01316_00',
    platform: 'PS5',
  });
});

test('the trophy summary is read every quarter of an hour, and new trophies fire events', async () => {
  const { psn, gladys, service, clock } = await ready();
  const ids = accountIds(gladys, ME.accountId);
  assert.equal(psn.count('trophySummary'), 1);
  clock.now += 2 * MIN;
  await service.refresh();
  assert.equal(psn.count('trophySummary'), 1, 'not again within 15 minutes');
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.TROPHY_LEVEL)), 312);

  psn.trophies = {
    trophyLevel: 313,
    progress: 2,
    earnedTrophies: { platinum: 6, gold: 41, silver: 120, bronze: 600 },
  };
  clock.now += TROPHY_INTERVAL_MS;
  await service.refresh();
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.PLATINUM)), 6);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => event.data),
    [
      {
        device: ids.device,
        online_id: ME.onlineId,
        grade: 'platinum',
        count: 1,
        total: 6,
        level: 313,
      },
      {
        device: ids.device,
        online_id: ME.onlineId,
        grade: 'gold',
        count: 1,
        total: 41,
        level: 313,
      },
    ],
  );
});

test('the end of a game reads the trophies at once', async () => {
  const { psn, service, clock } = await ready();
  psn.presences.set(ME.accountId, rawPresence({ online: true, game: 'Astro Bot' }));
  clock.now += 2 * MIN;
  await service.refresh();
  psn.presences.set(ME.accountId, rawPresence({ online: false }));
  clock.now += 2 * MIN;
  await service.refresh();
  assert.equal(psn.count('trophySummary'), 2);
});

test('the connection status and the badges follow the PSN link', async () => {
  const { psn, gladys, service, clock } = await setup({ config: { friends: 'Buddy' } });
  psn.addFriend('Buddy', '222');
  await service.refresh();
  await createAllDevices(gladys, service);
  await service.refresh();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(gladys.fake.transports.some((t) => t.transport === 'cloud'));

  psn.down = true;
  clock.now += 2 * MIN;
  await service.refresh();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /unreachable/);
  const last = gladys.fake.transports.slice(-2).map((t) => t.transport);
  assert.deepEqual(last, ['unreachable', 'unreachable']);
});

test('an expired NPSSO says what to do, in four languages', async () => {
  const { psn, gladys, service } = await setup();
  psn.npsso = 'z'.repeat(64);
  await service.refresh();
  const { connected, message } = gladys.fake.connectionStatus;
  assert.equal(connected, false);
  assert.deepEqual(Object.keys(message), ['en', 'fr', 'de', 'es']);
  assert.match(message.fr, /NPSSO/);
});

test('every failure has a message in four languages', () => {
  for (const error of [
    { code: 'NPSSO_MISSING' },
    { code: 'NPSSO_INVALID' },
    { status: 429 },
    { code: 'NETWORK' },
    { status: 500 },
    { message: 'boom' },
  ]) {
    assert.deepEqual(Object.keys(linkMessage(error)), ['en', 'fr', 'de', 'es']);
  }
});

test('the connection status is only sent when it changes', async () => {
  const { gladys, service, clock } = await ready();
  const before = gladys.fake.connectionStatuses.length;
  clock.now += 2 * MIN;
  await service.refresh();
  assert.equal(gladys.fake.connectionStatuses.length, before);
});

test('a friend nobody has is not looked up at every refresh', async () => {
  const { psn, service, clock } = await setup({ config: { friends: 'Ghost' } });
  await service.refresh();
  clock.now += 2 * MIN;
  await service.refresh();
  assert.equal(psn.count('/Ghost/profile2'), 1);
  clock.now += 61 * MIN;
  await service.refresh();
  assert.equal(psn.count('/Ghost/profile2'), 2);
});

test('a changed NPSSO reads the account again', async () => {
  const { psn, service } = await ready();
  assert.equal(psn.count('dms.api'), 1);
  psn.npsso = 'b'.repeat(64);
  await service.applyConfig({ npsso: 'b'.repeat(64) });
  assert.equal(service.account, null);
  await service.refresh();
  assert.equal(psn.count('dms.api'), 2);
});

test('the state survives a restart: same session, no second "started"', async () => {
  const stateStore = createMemoryStore();
  const first = await ready({ stateStore });
  first.psn.presences.set(ME.accountId, rawPresence({ online: true, game: 'Astro Bot' }));
  first.clock.now += 2 * MIN;
  await first.service.refresh();
  assert.equal(first.gladys.fake.sceneEvents.length, 1);

  const second = await setup({ stateStore, devices: first.gladys.devices });
  second.psn.presences.set(ME.accountId, rawPresence({ online: true, game: 'Astro Bot' }));
  second.clock.now = first.clock.now + 2 * MIN;
  await second.service.refresh();
  assert.equal(second.gladys.fake.sceneEvents.length, 0);
  assert.equal(second.psn.count('dms.api'), 0, 'the account id was remembered');
  const ids = accountIds(second.gladys, ME.accountId);
  assert.equal(second.gladys.fake.lastState(ids.feature(FEATURES.SESSION)), 2);
});

// --- consoles -------------------------------------------------------------------

async function withConsole(config = {}) {
  const env = await ready({ config: { console_ip: '192.168.1.20', ...config } });
  env.lan.consoles.set('192.168.1.20', PS5_REPLY);
  await env.service.refreshConsoles();
  await createAllDevices(env.gladys, env.service);
  return { ...env, ids: consoleIds(env.gladys, PS5_REPLY.hostId) };
}

test('the configured console IP is probed and becomes a device', async () => {
  const { gladys, service, ids } = await withConsole();
  assert.ok(gladys.fake.discoveredDevices.some((device) => device.external_id === ids.device));
  await service.refreshConsoles();
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.POWER)), 0, 'rest mode is off');
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: ids.device,
    transport: 'local',
  });
});

test('a console turned on is seen on the LAN', async () => {
  const { lan, gladys, service, ids } = await withConsole();
  lan.consoles.set('192.168.1.20', { ...PS5_REPLY, status: 'on' });
  await service.refreshConsoles();
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.POWER)), 1);
  assert.equal(service.consoleView().status, 'on');
});

test('local preferred but silent: the PSN presence, with a degraded badge', async () => {
  const { psn, lan, gladys, service, ids } = await withConsole();
  lan.consoles.clear();
  psn.presences.set(ME.accountId, rawPresence({ online: true, platform: 'PS5' }));
  await service.refresh();
  await service.refreshConsoles();
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.POWER)), 1);
  const badge = gladys.fake.transports.at(-1);
  assert.equal(badge.transport, 'cloud');
  assert.equal(badge.degraded, true);
  assert.deepEqual(Object.keys(badge.message), ['en', 'fr', 'de', 'es']);
});

test('cloud preferred: the PSN presence first, the LAN as the fallback', async () => {
  const { psn, lan, gladys, service, ids } = await withConsole({ GLADYS_PREFER_LOCAL: false });
  lan.consoles.set('192.168.1.20', { ...PS5_REPLY, status: 'on' });
  await service.refreshConsoles();
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.POWER)), 0, 'the PSN says offline');
  assert.equal(gladys.fake.transports.at(-1).transport, 'cloud');

  psn.down = true;
  await service.refresh();
  await service.refreshConsoles();
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.POWER)), 1);
  assert.deepEqual(
    {
      transport: gladys.fake.transports.at(-1).transport,
      degraded: gladys.fake.transports.at(-1).degraded,
    },
    { transport: 'local', degraded: true },
  );
});

test('nothing answers: unreachable, and no state invented', async () => {
  const { psn, lan, gladys, service, ids } = await withConsole();
  const states = gladys.fake.states.length;
  lan.consoles.clear();
  psn.down = true;
  await service.refresh();
  await service.refreshConsoles();
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(
    gladys.fake.states
      .slice(states)
      .filter((s) => s.device_feature_external_id === ids.feature(FEATURES.POWER)).length,
    0,
  );
});

test('a created console keeps its IP from the device params after a restart', async () => {
  const first = await withConsole();
  const second = await setup({ devices: first.gladys.devices });
  second.lan.consoles.set('192.168.1.20', { ...PS5_REPLY, status: 'on' });
  await second.service.refreshConsoles();
  assert.deepEqual(second.lan.probes, ['192.168.1.20']);
  assert.equal(second.gladys.fake.lastState(first.ids.feature(FEATURES.POWER)), 1);
});

test('a state refused by Gladys is not a PSN failure', async (t) => {
  const { gladys, service, clock } = await ready();
  t.mock.method(gladys, 'publishChangedStates', async () => {
    throw new Error('429 TOO_MANY_REQUESTS');
  });
  clock.now += 2 * MIN;
  const link = await service.refresh();
  assert.equal(link.ok, true);
});

test('following oneself does not count the play time twice', async () => {
  const { service } = await setup({ config: { friends: ME.onlineId } });
  await service.refresh();
  assert.deepEqual(service.resolvedFriends(), []);
  assert.deepEqual(service.playerAccountIds(), [ME.accountId]);
});
