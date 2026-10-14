import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayTracker, localDay } from '../src/psn/playtime.js';

const MIN = 60_000;
const T0 = Date.parse('2026-10-14T16:00:00.000Z'); // 18:00 in Paris
const GAP = 4 * MIN;
const playing = (titleName, titleId = titleName) => ({
  inGame: true,
  titleName,
  titleId,
  platform: 'PS5',
});
const idle = { inGame: false, titleName: null, titleId: null, platform: 'PS5' };

test('the local day follows the time zone', () => {
  const late = Date.parse('2026-10-14T22:30:00.000Z');
  assert.equal(localDay(late, 'UTC').day, '2026-10-14');
  assert.equal(localDay(late, 'Europe/Paris').day, '2026-10-15');
  assert.equal(localDay(late, 'Europe/Paris').sinceMidnight, 30 * MIN);
});

test('the first presence only primes: a game already running is not "started"', () => {
  const tracker = createPlayTracker({ timeZone: 'Europe/Paris' });
  const { transitions } = tracker.observe('p', playing('GT7'), T0, GAP);
  assert.deepEqual(transitions, []);
  assert.equal(tracker.session('p').titleName, 'GT7');
});

test('a session starts, is counted, then stops with its length', () => {
  const tracker = createPlayTracker({ timeZone: 'Europe/Paris' });
  tracker.observe('p', idle, T0, GAP);
  const start = tracker.observe('p', playing('GT7'), T0 + 2 * MIN, GAP);
  assert.deepEqual(start.transitions, [
    { type: 'game_started', titleId: 'GT7', titleName: 'GT7', platform: 'PS5' },
  ]);
  const during = tracker.observe('p', playing('GT7'), T0 + 4 * MIN, GAP);
  assert.equal(during.sessionMinutes, 2);
  assert.equal(during.todayMinutes, 2);
  const stop = tracker.observe('p', idle, T0 + 6 * MIN, GAP);
  assert.equal(stop.transitions[0].type, 'game_stopped');
  assert.equal(stop.transitions[0].durationMinutes, 4);
  assert.equal(stop.todayMinutes, 4);
  assert.equal(stop.sessionMinutes, 0);
});

test('switching games stops one session and starts the next', () => {
  const tracker = createPlayTracker();
  tracker.observe('p', playing('A'), T0, GAP);
  const { transitions } = tracker.observe('p', playing('B'), T0 + 2 * MIN, GAP);
  assert.deepEqual(
    transitions.map((t) => [t.type, t.titleName]),
    [
      ['game_stopped', 'A'],
      ['game_started', 'B'],
    ],
  );
});

test('a long gap without news counts for the maximum gap only', () => {
  const tracker = createPlayTracker();
  tracker.observe('p', playing('A'), T0, GAP);
  const { todayMinutes } = tracker.observe('p', playing('A'), T0 + 60 * MIN, GAP);
  assert.equal(todayMinutes, 4);
});

test('"played today" restarts at midnight, in the configured time zone', () => {
  const tracker = createPlayTracker({ timeZone: 'Europe/Paris' });
  const evening = Date.parse('2026-10-14T21:50:00.000Z'); // 23:50 in Paris
  tracker.observe('p', playing('A'), evening, 30 * MIN);
  assert.equal(tracker.observe('p', playing('A'), evening + 8 * MIN, 30 * MIN).todayMinutes, 8);
  // 00:10 the next day: only the 10 minutes after midnight belong to it.
  const next = tracker.observe('p', playing('A'), evening + 20 * MIN, 30 * MIN);
  assert.equal(next.todayMinutes, 10);
  assert.equal(next.sessionMinutes, 20);
});

test('idle across midnight resets the counter', () => {
  const tracker = createPlayTracker({ timeZone: 'UTC' });
  tracker.observe('p', playing('A'), T0, GAP);
  tracker.observe('p', idle, T0 + 3 * MIN, GAP);
  assert.equal(tracker.minutes('p', T0 + 3 * MIN).todayMinutes, 3);
  assert.equal(tracker.minutes('p', T0 + 24 * 60 * MIN).todayMinutes, 0);
  assert.equal(tracker.observe('p', idle, T0 + 24 * 60 * MIN, GAP).todayMinutes, 0);
});

test('the persisted state continues the session after a restart', () => {
  const before = createPlayTracker();
  before.observe('p', idle, T0, GAP);
  before.observe('p', playing('A'), T0 + MIN, GAP);
  const after = createPlayTracker({ state: JSON.parse(JSON.stringify(before.toJSON())) });
  const { transitions, sessionMinutes } = after.observe('p', playing('A'), T0 + 3 * MIN, GAP);
  assert.deepEqual(transitions, [], 'not announced a second time');
  assert.equal(sessionMinutes, 2);
});

test('players no longer followed are forgotten', () => {
  const tracker = createPlayTracker();
  tracker.observe('a', idle, T0, GAP);
  tracker.observe('b', idle, T0, GAP);
  tracker.retain(['a']);
  assert.deepEqual(Object.keys(tracker.toJSON()), ['a']);
});
