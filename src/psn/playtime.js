// -----------------------------------------------------------------------------
// Game sessions and play time, followed from successive presences.
//
// The PlayStation Network says what someone plays NOW, never since when nor
// for how long today. Both are measured here, from one presence to the next:
//   - a session starts when a game shows up, and ends when it disappears or
//     another game replaces it (one "stopped" then one "started");
//   - "played today" adds the time between two presences that both saw a game,
//     counted in the day of the configured time zone and reset at midnight.
//
// A gap between two presences longer than `maxGapMs` (Gladys down, Sony
// unreachable) only counts for `maxGapMs`: an hour without news is not an hour
// of play.
//
// The state is persisted (src/store.js): a restart while a game runs continues
// the same session instead of announcing it again, and keeps today's minutes.
// The first presence ever seen only primes the state: a game already running
// when the integration is installed is not "started".
// -----------------------------------------------------------------------------

const MINUTE_MS = 60 * 1000;

/** Date (YYYY-MM-DD) and milliseconds since midnight, in a time zone. */
export function localDay(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(now))
      .map((part) => [part.type, part.value]),
  );
  const sinceMidnight =
    (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000 +
    (now % 1000);
  return { day: `${parts.year}-${parts.month}-${parts.day}`, sinceMidnight };
}

const sameGame = (a, b) =>
  a.titleId && b.titleId ? a.titleId === b.titleId : a.titleName === b.titleName;

/**
 * @param {object} [options]
 * @param {object} [options.state] the persisted state, `{ [key]: entry }`
 * @param {string} [options.timeZone]
 */
export function createPlayTracker({ state = {}, timeZone = 'UTC' } = {}) {
  const entries = structuredClone(state);
  let zone = timeZone;

  return {
    setTimeZone(value) {
      zone = value;
    },

    /** The persisted form of the tracker. */
    toJSON() {
      return structuredClone(entries);
    },

    /**
     * Take a new presence into account.
     *
     * @param {string} key the player (an account id)
     * @param {import('./presence.js').Presence} presence
     * @param {number} now
     * @param {number} maxGapMs longest gap counted as play time
     * @returns {{ transitions: object[], sessionMinutes: number, todayMinutes: number }}
     */
    observe(key, presence, now, maxGapMs) {
      const { day, sinceMidnight } = localDay(now, zone);
      const entry = entries[key] ?? { day, todayMs: 0, lastSampleAt: null, session: null };
      const primed = key in entries;
      const transitions = [];

      if (entry.session && entry.lastSampleAt !== null) {
        let elapsed = Math.max(0, Math.min(now - entry.lastSampleAt, maxGapMs));
        if (entry.day !== day) {
          // Only the part after midnight belongs to today.
          elapsed = Math.min(elapsed, sinceMidnight);
        }
        entry.todayMs = (entry.day === day ? entry.todayMs : 0) + elapsed;
      } else if (entry.day !== day) {
        entry.todayMs = 0;
      }
      entry.day = day;

      const current = presence.inGame
        ? { titleId: presence.titleId, titleName: presence.titleName, platform: presence.platform }
        : null;

      if (!primed) {
        entry.session = current ? { ...current, startedAt: now } : null;
      } else {
        if (entry.session && (!current || !sameGame(entry.session, current))) {
          transitions.push({
            type: 'game_stopped',
            ...pickGame(entry.session),
            durationMinutes: Math.round((now - entry.session.startedAt) / MINUTE_MS),
          });
          entry.session = null;
        }
        if (current && !entry.session) {
          entry.session = { ...current, startedAt: now };
          transitions.push({ type: 'game_started', ...pickGame(current) });
        }
      }

      entry.lastSampleAt = now;
      entries[key] = entry;
      return { transitions, ...this.minutes(key, now) };
    },

    /** Current session and today's play time, in whole minutes. */
    minutes(key, now) {
      const entry = entries[key];
      if (!entry) {
        return { sessionMinutes: 0, todayMinutes: 0 };
      }
      const { day } = localDay(now, zone);
      return {
        sessionMinutes: entry.session ? Math.floor((now - entry.session.startedAt) / MINUTE_MS) : 0,
        todayMinutes: entry.day === day ? Math.floor(entry.todayMs / MINUTE_MS) : 0,
      };
    },

    /** The game session in progress, or null. */
    session(key) {
      return entries[key]?.session ?? null;
    },

    /** Forget the players no longer followed. */
    retain(keys) {
      for (const key of Object.keys(entries)) {
        if (!keys.includes(key)) {
          delete entries[key];
        }
      }
    },
  };
}

function pickGame(game) {
  return {
    titleId: game.titleId ?? null,
    titleName: game.titleName ?? null,
    platform: game.platform ?? null,
  };
}
