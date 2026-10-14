import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, PsnAuthError } from '../src/psn/auth.js';
import { createMemoryStore } from '../src/store.js';
import { createFakePsn, NPSSO } from './helpers/fakePsn.js';

const HOUR = 3600_000;

function build({ store = createMemoryStore(), npsso = NPSSO } = {}) {
  const psn = createFakePsn();
  const clock = { now: Date.parse('2026-10-14T16:00:00Z') };
  const auth = createAuth({ fetch: psn.fetch, store, clock: () => clock.now });
  auth.setNpsso(npsso);
  return { psn, auth, store, clock };
}

test('the NPSSO is traded for tokens, which are reused until they expire', async () => {
  const { psn, auth, clock } = build();
  assert.equal(await auth.getAccessToken(), 'access-1');
  assert.equal(psn.count('/oauth/authorize'), 1);
  clock.now += HOUR / 2;
  assert.equal(await auth.getAccessToken(), 'access-1', 'still valid: no request');
  assert.equal(psn.count('/oauth/token'), 1);
});

test('an expired access token is renewed with the refresh token, not the NPSSO', async () => {
  const { psn, auth, clock } = build();
  await auth.getAccessToken();
  clock.now += HOUR;
  assert.equal(await auth.getAccessToken(), 'access-2');
  assert.equal(psn.count('/oauth/authorize'), 1, 'the NPSSO was not used again');
});

test('the tokens survive a restart, and never store the NPSSO itself', async () => {
  const store = createMemoryStore();
  const first = build({ store });
  await first.auth.getAccessToken();
  assert.ok(!JSON.stringify(store.saved).includes(NPSSO), 'the NPSSO is never written');

  const second = build({ store });
  assert.equal(await second.auth.getAccessToken(), 'access-1');
  assert.equal(second.psn.count('/oauth/'), 0, 'no sign-in after a restart');
});

test('a new NPSSO drops the tokens of the previous one', async () => {
  const store = createMemoryStore();
  await build({ store }).auth.getAccessToken();
  const other = build({ store, npsso: 'b'.repeat(64) });
  other.psn.npsso = 'b'.repeat(64);
  await other.auth.getAccessToken();
  assert.equal(other.psn.count('/oauth/authorize'), 1);
});

test('an expired NPSSO is reported as such', async () => {
  const { psn, auth } = build();
  psn.npsso = 'c'.repeat(64);
  await assert.rejects(
    auth.getAccessToken(),
    (err) => err instanceof PsnAuthError && err.code === 'NPSSO_INVALID',
  );
});

test('no NPSSO, or no network, are told apart', async () => {
  const { auth, psn } = build({ npsso: '' });
  await assert.rejects(auth.getAccessToken(), { code: 'NPSSO_MISSING' });
  auth.setNpsso(NPSSO);
  psn.down = true;
  await assert.rejects(auth.getAccessToken(), { code: 'NETWORK' });
});

test('a revoked refresh token falls back to the NPSSO', async () => {
  const { psn, auth, clock } = build();
  await auth.getAccessToken();
  clock.now += HOUR;
  psn.refreshRevoked = true; // password changed, signed out everywhere…
  assert.equal(await auth.getAccessToken(), 'access-2');
  assert.equal(psn.count('/oauth/authorize'), 2, 'signed in again with the NPSSO');
});

test('concurrent callers share one sign-in', async () => {
  const { psn, auth } = build();
  const tokens = await Promise.all([
    auth.getAccessToken(),
    auth.getAccessToken(),
    auth.getAccessToken(),
  ]);
  assert.deepEqual(new Set(tokens), new Set(['access-1']));
  assert.equal(psn.count('/oauth/authorize'), 1);
});
