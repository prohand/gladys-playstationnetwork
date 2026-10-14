import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../src/psn/auth.js';
import { createPsnApi, PsnApiError } from '../src/psn/api.js';
import { createMemoryStore } from '../src/store.js';
import { createFakePsn, ME, NPSSO, rawPresence } from './helpers/fakePsn.js';

function build() {
  const psn = createFakePsn();
  const auth = createAuth({ fetch: psn.fetch, store: createMemoryStore() });
  auth.setNpsso(NPSSO);
  return { psn, auth, api: createPsnApi({ fetch: psn.fetch, auth }) };
}

test('the account id and the profile of the signed-in user', async () => {
  const { api } = build();
  assert.equal(await api.getMyAccountId(), ME.accountId);
  assert.deepEqual(await api.getProfile('me'), {
    onlineId: ME.onlineId,
    avatarUrl: 'https://example.invalid/avatar.png',
    isPlusMember: true,
  });
});

test('online IDs are looked up, an unknown one is null', async () => {
  const { psn, api } = build();
  psn.addFriend('Buddy', '222');
  assert.deepEqual(await api.lookupOnlineId('buddy'), { onlineId: 'buddy', accountId: '222' });
  assert.equal(await api.lookupOnlineId('Nobody'), null);
});

test('the presences of several accounts in one request', async () => {
  const { psn, api } = build();
  psn.addFriend('A', '1', rawPresence({ online: true, game: 'Astro Bot' }));
  psn.addFriend('B', '2');
  const presences = await api.getPresences(['1', '2', '3']);
  assert.equal(psn.count('/internal/users/basicPresences'), 1);
  assert.equal(presences.get('1').titleName, 'Astro Bot');
  assert.equal(presences.get('2').online, false);
  assert.equal(presences.has('3'), false, 'hidden presences are missing');
});

test('one request per account when Sony refuses the batch', async () => {
  const { psn, api } = build();
  psn.batchSupported = false;
  psn.addFriend('A', '1', rawPresence({ online: true }));
  const presences = await api.getPresences(['1', '9']);
  assert.equal(presences.get('1').online, true);
  assert.equal(presences.has('9'), false);
});

test('a 401 renews the token once and retries', async () => {
  const { psn, auth, api } = build();
  await auth.getAccessToken();
  let first = true;
  const original = psn.fetch;
  const flaky = createPsnApi({
    auth,
    fetch: async (url, init) => {
      if (first && String(url).includes('trophySummary')) {
        first = false;
        return new Response('{}', { status: 401 });
      }
      return original(url, init);
    },
  });
  const summary = await flaky.getTrophySummary(ME.accountId);
  assert.deepEqual(summary, {
    level: 312,
    progress: 40,
    platinum: 5,
    gold: 40,
    silver: 120,
    bronze: 600,
  });
  assert.ok(psn.tokenCount >= 2, 'the token was renewed');
  assert.ok(api);
});

test('throttling and network errors keep their status', async () => {
  const { psn, api } = build();
  psn.throttled = true;
  await assert.rejects(
    api.getPresence(ME.accountId),
    (err) => err instanceof PsnApiError && err.status === 429,
  );
  psn.throttled = false;
  await api.getMyAccountId();
  psn.down = true;
  await assert.rejects(api.getPresence(ME.accountId), { status: 0 });
});
