import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { ACTIONS } from '../src/actions.js';
import { SCENE_ACTIONS } from '../src/capabilities/scenes.js';
import { buildPsnWidget, PSN_WIDGET, WIDGETS, WIDGET_ACTIONS } from '../src/capabilities/widget.js';
import {
  fetchWidgetImage,
  isSupportedImage,
  MAX_IMAGE_BYTES,
  sizedUrl,
} from '../src/capabilities/images.js';
import { accountIds, friendIds } from '../src/devices/index.js';
import { ME, rawPresence } from './helpers/fakePsn.js';
import { createAllDevices, PS5_REPLY, setup } from './helpers/setup.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** Every widget content the integration can produce, from a few situations. */
async function situations() {
  const contents = {};
  const empty = await setup({ config: { npsso: '' } });
  contents.noToken = buildPsnWidget(empty.service);

  const broken = await setup();
  broken.psn.down = true;
  await broken.service.refresh();
  contents.unreachable = buildPsnWidget(broken.service);

  const full = await setup({ config: { friends: 'Buddy, Pal', console_ip: '192.168.1.20' } });
  full.psn.addFriend('Buddy', '222', rawPresence({ online: true, game: 'Astro Bot' }));
  full.psn.addFriend('Pal', '333', rawPresence({ online: true }));
  full.psn.presences.set(ME.accountId, rawPresence({ online: true, game: 'Gran Turismo 7' }));
  full.lan.consoles.set('192.168.1.20', { ...PS5_REPLY, status: 'on' });
  await full.service.refresh();
  await full.service.refreshConsoles();
  contents.computed = buildPsnWidget(full.service, { language: 'fr' });
  await createAllDevices(full.gladys, full.service);
  contents.live = buildPsnWidget(full.service);
  contents.friend = buildPsnWidget(full.service, {
    settings: { player: friendIds(full.gladys, '222').device },
  });

  const alone = await setup();
  alone.psn.presences.set(ME.accountId, rawPresence({ online: true, game: 'Astro Bot' }));
  await alone.service.refresh();
  contents.gameImage = buildPsnWidget(alone.service);
  alone.psn.presences.set(ME.accountId, rawPresence({ online: false }));
  await alone.service.refresh();
  contents.offline = buildPsnWidget(alone.service, { language: 'de' });
  return { contents, full };
}

const { contents, full } = await situations();

test('every widget content is rendered exactly as sent', () => {
  for (const [name, content] of Object.entries(contents)) {
    assert.deepEqual(validateWidgetContent(content), [], name);
  }
});

test('the widget says what is missing', () => {
  const caption = (content) => content.components.find((c) => c.type === 'text')?.text;
  assert.match(caption(contents.noToken).en, /NPSSO/);
  assert.match(caption(contents.unreachable).en, /unreachable/);
  assert.equal(caption(contents.live), undefined);
});

test('the tiles are live once the devices exist', () => {
  const ids = accountIds(full.gladys, ME.accountId);
  const tiles = (content) => content.components.filter((c) => c.type === 'value');
  assert.ok(tiles(contents.computed).every((tile) => tile.device_feature === undefined));
  assert.ok(tiles(contents.live).every((tile) => tile.device_feature?.startsWith(ids.device)));
  assert.equal(tiles(contents.live).length, 4, 'play time + trophies for the account');
  assert.equal(tiles(contents.friend).length, 2, 'no trophies for a friend');
});

test('the followed players are listed with their game icon', () => {
  const list = contents.live.components.find((c) => c.type === 'card-list');
  assert.deepEqual(
    list.items.map((item) => [item.title, item.subtitle]),
    [
      [ME.onlineId, 'Gran Turismo 7'],
      ['Buddy', 'Astro Bot'],
      ['Pal', 'PS5'],
    ],
  );
  assert.ok(list.items[0].image.startsWith('game-'));
  assert.ok(full.service.images.has(list.items[0].image), 'onWidgetGetImage can serve it');
});

test('without friends, the game icon is the focal image', () => {
  assert.ok(contents.gameImage.components.some((c) => c.type === 'image'));
  assert.ok(!contents.offline.components.some((c) => c.type === 'image'));
});

test('the consoles are in the status list', () => {
  const status = contents.live.components.find((c) => c.type === 'status');
  assert.ok(status.items.some((item) => item.label === 'PS5-Salon' && item.value.en === 'On'));
});

test('every button action of the widget is handled', async () => {
  const widget = WIDGETS[PSN_WIDGET];
  const keys = contents.live.components.filter((c) => c.action).map((c) => c.action.key);
  assert.deepEqual(keys, [WIDGET_ACTIONS.REFRESH]);
  const toast = await widget.action(full.service, { actionKey: WIDGET_ACTIONS.REFRESH });
  assert.deepEqual(Object.keys(toast), LANGUAGES);
  await assert.rejects(widget.action(full.service, { actionKey: 'nope' }));
});

test('game icons: resized by the PlayStation server, checked before the core', async () => {
  assert.equal(
    sizedUrl('https://image.api.playstation.com/a.png'),
    'https://image.api.playstation.com/a.png?w=320',
  );
  assert.equal(sizedUrl('http://other.invalid/a.png'), 'http://other.invalid/a.png');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(isSupportedImage(png), true);
  assert.equal(isSupportedImage(Buffer.from('<html>')), false);

  const serve = (body) => async () => new Response(body, { status: 200 });
  assert.equal(
    await fetchWidgetImage(serve(png), 'https://image.api.playstation.com/a.png'),
    png.toString('base64'),
  );
  await assert.rejects(
    fetchWidgetImage(serve(Buffer.alloc(MAX_IMAGE_BYTES + 1, 0xff)), 'https://x.invalid/a'),
    /too large/,
  );
  await assert.rejects(fetchWidgetImage(serve('<html>'), 'https://x.invalid/a'), /format/);
  await assert.rejects(
    fetchWidgetImage(async () => new Response('', { status: 404 }), 'https://x.invalid/a'),
    /404/,
  );
});

// --- scene actions --------------------------------------------------------------

const declaredOutputs = (key) =>
  manifest.scene_actions.find((a) => a.key === key).outputs.map((o) => o.key);

test('get_player_status returns exactly the declared outputs', async () => {
  const outputs = await SCENE_ACTIONS.get_player_status(full.service, {});
  assert.deepEqual(Object.keys(outputs).sort(), declaredOutputs('get_player_status').sort());
  assert.equal(outputs.in_game, true);
  assert.equal(outputs.game, 'Gran Turismo 7');
  const friend = await SCENE_ACTIONS.get_player_status(full.service, {
    device: friendIds(full.gladys, '222').device,
  });
  assert.equal(friend.online_id, 'Buddy');
  assert.equal(friend.game, 'Astro Bot');
});

test('get_player_status reads the PSN only when its data is old', async () => {
  const env = await setup();
  await env.service.refresh();
  const before = env.psn.count('basicPresences');
  await SCENE_ACTIONS.get_player_status(env.service, {});
  assert.equal(env.psn.count('basicPresences'), before, 'fresh enough');
  env.clock.now += 60_000;
  await SCENE_ACTIONS.get_player_status(env.service, {});
  assert.equal(env.psn.count('basicPresences'), before + 1);
});

test('get_console_state returns exactly the declared outputs', async () => {
  const outputs = await SCENE_ACTIONS.get_console_state(full.service, {});
  assert.deepEqual(Object.keys(outputs).sort(), declaredOutputs('get_console_state').sort());
  assert.deepEqual(outputs, { power: true, status: 'on', name: 'PS5-Salon' });
  const none = await setup();
  await assert.rejects(SCENE_ACTIONS.get_console_state(none.service, {}), /No console/);
});

// --- configuration actions --------------------------------------------------------

test('test_connection reports the account, the trophies and the friends', async () => {
  const env = await setup({ config: { friends: 'Buddy, Ghost, 9bad' } });
  env.psn.addFriend('Buddy', '222', rawPresence({ online: true, game: 'Astro Bot' }));
  const report = await ACTIONS.test_connection(env.service);
  assert.deepEqual(Object.keys(report), LANGUAGES);
  assert.match(report.en, /Connected as Player_One \(PlayStation Plus: yes\)/);
  assert.match(report.en, /Trophy level 312/);
  assert.match(report.en, /Buddy: playing Astro Bot/);
  assert.match(report.en, /Ghost: no account with this name/);
  assert.match(report.en, /Ignored \(not an online ID\): 9bad/);
  assert.match(report.fr, /Connecté en tant que Player_One/);
});

test('test_connection explains a failure', async () => {
  const env = await setup();
  env.psn.npsso = 'z'.repeat(64);
  const report = await ACTIONS.test_connection(env.service);
  assert.match(report.en, /expired/);
});

test('find_consoles lists what answered, or how to fix it', async () => {
  const env = await setup();
  const nothing = await ACTIONS.find_consoles(env.service);
  assert.match(nothing.en, /No console answered/);
  env.lan.consoles.set('192.168.1.20', PS5_REPLY);
  const found = await ACTIONS.find_consoles(env.service);
  assert.match(found.en, /PS5-Salon — PS5, 192\.168\.1\.20, rest mode/);
  assert.match(found.es, /Descubrimiento/);
  assert.ok(env.gladys.fake.discoveredDevices.some((d) => d.name === 'PS5-Salon'));
  const wrong = await setup({ config: { console_ip: 'my-ps5' } });
  assert.match((await ACTIONS.find_consoles(wrong.service)).en, /not an IPv4 address/);
});
