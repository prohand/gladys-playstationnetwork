# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for the **PlayStation Network**: presence,
current game, play time and trophies of the PSN account and of up to 10 friends, plus the
power state of the PS4 / PS5 consoles of the LAN. Gladys 5.1+ adds scene triggers (game
started, game stopped, trophy earned), scene actions (player status, console state) and a
"PlayStation Network" widget.

Started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js); the CI and
release workflows are the ones of [gladys-devmel](https://github.com/prohand/gladys-devmel).

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/service.test.js            # one file
node --test --test-name-pattern "trophy"    # tests whose name matches
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI runs `format:check`, `lint`, `test` on Node 22 and 24, and on pull requests the store checks
and a Docker build. Releases: **Actions → Release** only (bumps `package.json`, manifest
`version` + `docker_image`, rolls `CHANGELOG.md`, re-runs Prettier, tags, builds, publishes the
GitHub Release).

## Architecture

```
index.js                  builds the SDK client and connects it (nothing else)
src/app.js                every SDK handler, registered before connect()
src/service.js            the state + the two loops (PSN every poll_frequency, consoles every 30 s),
                          states, scene events, transport badges, connection status
src/config.js             DEFAULT_CONFIG (mirrors the manifest) + normalization (NPSSO, friends, IP)
src/store.js              JSON files in /data (tokens.json, state.json), atomic, owner-only
src/i18n.js               LANGUAGES (en, fr, de, es) + localize/pick
src/psn/auth.js           NPSSO -> authorization code -> access/refresh tokens
src/psn/api.js            read-only PSN endpoints (account id, profile, presence, trophies, lookup)
src/psn/presence.js       Sony's basicPresence reduced to { online, inGame, platform, title… }
src/psn/playtime.js       game sessions + "played today" from successive presences
src/console/ddp.js        PlayStation Device Discovery Protocol: unicast probe, scan via the core
src/devices/index.js      the Gladys devices (account, friend, console) and their external ids
src/capabilities/         scenes.js, widget.js, images.js (game icons for the widget)
src/actions.js            "Test the connection" and "Find my consoles"
```

### Invariants worth knowing

- **The NPSSO is a password.** Never log it, never write it: `tokens.json` holds the tokens and
  a sha256 of the NPSSO only. Never log tokens either.
- **External ids are forever**: account and friends by PSN account id, consoles by DDP host id
  (the MAC). Never by online ID or console name (both can be renamed). Trigger, action, widget,
  feature and config keys are stored by users: never rename them.
- **The integration's own timers drive the refresh** (no `should_poll`): one PSN request serves
  every player. States go only to created devices (`publishChangedStates`, 30 min heartbeat).
- **Sony throttles**: ~300 requests per 15 min. One cycle = 1 presence + 1 batch presence for
  the friends + the trophy summary every 15 min (or at the end of a game). Friends' online IDs
  are resolved once and cached; an unknown one is retried after an hour. A 429 is reported,
  never retried in a loop.
- **Play time is measured, not read**: from one presence to the next, gaps capped at twice the
  refresh interval, reset at midnight in the configured time zone, persisted in `state.json`.
  The first presence ever seen only primes (no "game started" for a game already running).
- **Two transports**: consoles are `local` (DDP answered) or `cloud` (PSN presence on the same
  platform), following `GLADYS_PREFER_LOCAL`; the other channel is the fallback, flagged
  `degraded`. Players are always `cloud` (or `unreachable`).
- **A broadcast never leaves the container**: the LAN scan goes through
  `gladys.scanNetwork('udp-active-broadcast')` (ports declared in the manifest
  `network_discovery`, 1 scan / 10 s); the periodic probe is unicast to a known IP.
- **Gladys refuses an empty text state**: "no game" is published as `-` (`NO_TEXT`).
- **Every feature declares `min`/`max`** (NOT NULL in Gladys) and is read-only.

### Manifest

`test/manifest.test.js` keeps `gladys-assistant-integration.json` in sync with the code
(defaults, handlers, triggers, DDP ports) and checks that **every text exists in en, fr, de and
es**. Capability fields require `gladys_version >= 5.1.0`.

## Testing

No network, no console: `test/helpers/fakePsn.js` is an in-memory PlayStation Network behind
`fetch`, `test/helpers/setup.js` a fake LAN and a `PsnService` wired to the SDK's
`createFakeGladys()`.

## Conventions

- Prettier formats, ESLint catches mistakes. Comments explain **why**, in English.
- User-facing text is `{ en, fr, de, es }`: action messages, connection status, widget, manifest,
  and `docs/en.md`, `docs/fr.md`, `docs/de.md`, `docs/es.md`, kept in sync.
- **Versions belong to the Release workflow**: never edit `version` in `package.json` or the
  manifest, nor the `docker_image` tag, by hand.
- **Changelog**: every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a version
  heading: the Release workflow does.
- The container rootfs is read-only: write only under `/data`.
