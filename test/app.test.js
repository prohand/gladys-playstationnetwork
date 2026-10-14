// -----------------------------------------------------------------------------
// The whole integration, wired by src/app.js, against the SDK's fake Gladys:
// what a real Gladys would see from the first connection on.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createIntegration } from '../src/app.js';
import { PSN_WIDGET } from '../src/capabilities/widget.js';
import { createMemoryStore } from '../src/store.js';
import { createFakePsn, ME, NPSSO, rawPresence } from './helpers/fakePsn.js';
import { createFakeLan, PS5_REPLY } from './helpers/setup.js';

async function start(config = { npsso: NPSSO }) {
  const psn = createFakePsn();
  const lan = createFakeLan();
  const gladys = createFakeGladys({ config });
  const { service } = createIntegration(gladys, {
    fetch: psn.fetch,
    tokenStore: createMemoryStore(),
    stateStore: createMemoryStore(),
    probe: lan.probe,
    scan: lan.scan,
  });
  await gladys.connect();
  return { psn, lan, gladys, service };
}

test('on connection: signed in, devices published, status reported, timers armed', async (t) => {
  const { gladys, service } = await start();
  t.after(() => service.stop());
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    [`PSN ${ME.onlineId}`],
  );
  assert.equal(service.timers.length, 2);
  assert.ok(gladys.fake.widgetRefreshes.includes(PSN_WIDGET));
  await gladys.disconnect();
  assert.equal(service.timers.length, 0, 'stopped while Gladys is away');
});

test('without an NPSSO the Configuration screen says what to do', async (t) => {
  const { gladys, service } = await start({});
  t.after(() => service.stop());
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /NPSSO/);
});

test('a created device receives its states at once', async (t) => {
  const { psn, gladys, service } = await start();
  t.after(() => service.stop());
  psn.presences.set(ME.accountId, rawPresence({ online: true, game: 'Astro Bot' }));
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  const ids = gladys.externalIds('account', ME.accountId);
  assert.equal(gladys.fake.lastState(ids.feature('online')), 1);
  assert.equal(gladys.fake.lastState(ids.feature('game')), 'Astro Bot');
});

test('the Discovery scan finds the consoles', async (t) => {
  const { lan, gladys, service } = await start();
  t.after(() => service.stop());
  lan.consoles.set('192.168.1.20', PS5_REPLY);
  await gladys.fake.scanRequest();
  assert.ok(gladys.fake.discoveredDevices.some((device) => device.name === 'PS5-Salon'));
});

test('the handlers answer through the SDK', async (t) => {
  const { gladys, service } = await start();
  t.after(() => service.stop());

  const action = await gladys.fake.action('test_connection', {});
  assert.equal(action.success, true);
  assert.match(action.data.message.en, /Connected as Player_One/);

  const scene = await gladys.fake.sceneAction('get_player_status', {});
  assert.equal(scene.success, true);

  const widget = await gladys.fake.widgetGet(PSN_WIDGET, {
    settings: {},
    language: 'en',
    units: 'metric',
  });
  assert.equal(widget.success, true);

  const tap = await gladys.fake.widgetAction(PSN_WIDGET, 'refresh', {}, { settings: {} });
  assert.equal(tap.success, true);

  const image = await gladys.fake.widgetGetImage('game-unknown');
  assert.equal(image.success, false);

  const command = await gladys.fake.setValue(
    { external_id: 'x' },
    { external_id: gladys.externalId('account:1:online') },
    1,
  );
  assert.equal(command.success, false, 'nothing is controllable');
});

test('a configuration change restarts the loops with the new interval', async (t) => {
  const { psn, gladys, service } = await start();
  t.after(() => service.stop());
  psn.addFriend('Buddy', '222');
  await gladys.fake.configUpdated({ npsso: NPSSO, friends: 'Buddy', poll_frequency: 300 });
  assert.equal(service.config.poll_frequency, 300);
  assert.equal(service.timers.length, 2);
  assert.ok(gladys.fake.discoveredDevices.some((device) => device.name === 'PSN Buddy'));
});
