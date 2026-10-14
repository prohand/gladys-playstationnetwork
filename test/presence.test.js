import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePresence } from '../src/psn/presence.js';
import { rawPresence } from './helpers/fakePsn.js';

test('an online player in a PS5 game', () => {
  const presence = normalizePresence({
    accountId: 42,
    ...rawPresence({ online: true, game: 'Astro Bot', titleId: 'PPSA01325_00' }),
  });
  assert.deepEqual(presence, {
    accountId: '42',
    online: true,
    inGame: true,
    platform: 'PS5',
    titleName: 'Astro Bot',
    titleId: 'PPSA01325_00',
    iconUrl: 'https://image.api.playstation.com/icons/Astro%20Bot.png',
    lastOnline: '2026-10-14T18:00:00.000Z',
  });
});

test('an offline player shows no game, even if Sony still lists one', () => {
  const presence = normalizePresence(rawPresence({ online: false, game: 'Astro Bot' }));
  assert.equal(presence.online, false);
  assert.equal(presence.inGame, false);
  assert.equal(presence.titleName, null);
  assert.equal(presence.iconUrl, null);
});

test('a PS4 game: the icon is the npTitleIconUrl, the platform is named', () => {
  const presence = normalizePresence({
    primaryPlatformInfo: { onlineStatus: 'online', platform: 'ps4' },
    gameTitleInfoList: [
      {
        titleName: 'Bloodborne',
        npTitleId: 'CUSA00900_00',
        npTitleIconUrl: 'http://x.invalid/i.png',
      },
    ],
  });
  assert.equal(presence.platform, 'PS4');
  assert.equal(presence.iconUrl, 'http://x.invalid/i.png');
});

test('availability alone is enough, and nothing throws on an empty presence', () => {
  assert.equal(normalizePresence({ availability: 'availableToPlay' }).online, true);
  const empty = normalizePresence();
  assert.equal(empty.online, false);
  assert.equal(empty.platform, null);
  assert.equal(
    normalizePresence({
      gameTitleInfoList: [{ conceptIconUrl: 'javascript:alert(1)' }],
      availability: 'availableToPlay',
    }).iconUrl,
    null,
  );
});
