# PlayStation Network — Gladys Assistant integration

External integration connecting [Gladys Assistant](https://gladysassistant.com) to the
**PlayStation Network** and to the **PS4 / PS5 consoles** of your home: who is online, which
game is running, how long it has been played today, trophies, and whether the console is on,
in rest mode or off.

Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

User documentation: [English](./docs/en.md) · [Français](./docs/fr.md) · [Deutsch](./docs/de.md) ·
[Español](./docs/es.md).

> Unofficial integration, not affiliated with nor endorsed by Sony Interactive Entertainment.
> "PlayStation", "PS4", "PS5" and "PlayStation Network" are trademarks of their owners. Sony
> offers no public API: the integration reads the same data as the PlayStation App, and may
> stop working if Sony changes it.

## What it does

| Device                | Features                                                                                        | Transport          |
| --------------------- | ----------------------------------------------------------------------------------------------- | ------------------ |
| PSN account           | Online, in game, current game, platform, current session, played today, trophy level and counts | cloud              |
| Followed friend (≤10) | Online, in game, current game, platform, current session, played today                          | cloud              |
| PS4 / PS5 console     | Power (on = 1, rest mode or off = 0)                                                            | local **or** cloud |

**Cloud and local.** The manifest declares both transports. The PSN data is cloud-only. A
console answers on the LAN (PlayStation discovery protocol, UDP 987 / 9302): that is the `local`
channel; without it, its state follows the PSN presence of the account on the same platform —
the `cloud` channel. The standard **"Prefer the local connection"** toggle of Gladys picks the
channel; the other one is the fallback, and the badge of the device then shows a **degraded**
dot with the reason.

Gladys capabilities (the integration requires Gladys **5.3.0** or later):

| Capability                         | Key                 | What it gives                                                               |
| ---------------------------------- | ------------------- | --------------------------------------------------------------------------- |
| Scene trigger: a game started      | `game_started`      | `online_id`, `game`, `title_id`, `platform`; filter by player               |
| Scene trigger: a game stopped      | `game_stopped`      | the same + `duration_minutes`                                               |
| Scene trigger: a trophy was earned | `trophy_earned`     | `grade`, `count`, `total`, `level`; filter by grade                         |
| Scene action: player status        | `get_player_status` | `online`, `in_game`, `game`, `platform`, `session_minutes`, `today_minutes` |
| Scene action: console state        | `get_console_state` | `power`, `status` (`on`, `standby`, `off`, `unknown`), `name`               |
| Dashboard widget                   | `psn_status`        | play time, trophies, who plays what (with game icons), consoles             |

The "played today" and "current session" features are ordinary device states, so the standard
Gladys triggers work on them: _"when played today goes above 120 minutes, send me a message"_.

Configuration buttons: **Test the connection** (account, presence, trophies, friends — in plain
words) and **Find my consoles** (LAN scan relayed by Gladys).

## How it works

- **Sign-in**: an NPSSO token (a cookie of a signed-in playstation.com session) is traded for an
  access token and a refresh token, like the PlayStation App does. The tokens are renewed on
  their own and kept in `/data/tokens.json`; the NPSSO is never written nor logged. It lasts
  about two months, then the Configuration screen asks for a new one.
- **Refresh**: every `poll_frequency` seconds (2 minutes by default, 1 minute minimum), one
  presence request for the account, one for all the friends, and the trophy summary every
  15 minutes or at the end of a game. Sony throttles its API: this stays far below.
- **Play time** is measured by the integration from one presence to the next (Sony does not
  give it), reset at midnight in the configured time zone, and survives restarts.
- **Consoles**: probed every 30 seconds on the LAN. A console only answers when "Stay connected
  to the internet" is on in its power saving settings (PS5: also "Enable turning on PS5 from
  network"). The integration never turns a console on or controls it.

## Project structure

```
.
├─ index.js                          # builds the SDK client and connects it
├─ src/
│  ├─ app.js                         # every SDK handler (scan, actions, scenes, widget, lifecycle)
│  ├─ service.js                     # state + PSN and console loops, states, events, badges
│  ├─ config.js                      # defaults + normalization (NPSSO, friends, IP, time zone)
│  ├─ store.js                       # JSON files in /data (tokens, play time), atomic
│  ├─ i18n.js                        # en / fr / de / es helpers
│  ├─ actions.js                     # "Test the connection", "Find my consoles"
│  ├─ psn/                           # auth (NPSSO), api, presence, playtime
│  ├─ console/ddp.js                 # PlayStation discovery protocol (LAN)
│  ├─ devices/index.js               # Gladys devices and external ids
│  └─ capabilities/                  # scenes, widget, game icons
├─ docs/{en,fr,de,es}.md             # user documentation, re-hosted by Gladys
├─ test/                             # node --test, fake PSN + fake LAN + SDK fake Gladys
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs, non-root
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                         # rules for coding assistants and contributors
├─ SECURITY.md                       # private vulnerability reporting, how the NPSSO is handled
└─ .github/                          # CI, release, build, GitHub releases, Dependabot
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="playstation-network" \
DATA_DIR=./data \
LOG_LEVEL=debug \
npm start
```

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test: no network, no console needed
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs the first three on Node 22 and 24 for every push and
pull request; pull requests also run the store checks and a Docker build.

> The store check of a pull request also verifies that the `docker_image` of the manifest
> exists: it stays red until the first release has published one.

## Publish

1. Add the GitHub topic `gladys-assistant-integration` to the repository, and turn on
   **Private vulnerability reporting** (Settings → Security): [`SECURITY.md`](SECURITY.md)
   sends reporters there.
2. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
3. **Actions → Release → Run workflow**, pick `major` for the first release (`0.0.0` → `1.0.0`),
   then `patch` / `minor` / `major`. The workflow bumps `package.json` and the manifest
   (`version` + `docker_image`), rolls the changelog, tags, builds the `linux/amd64` +
   `linux/arm64` image to `ghcr.io` and publishes the GitHub Release.
4. Make the `ghcr.io` package public (first release only), then the store indexer offers the
   new version to Gladys.

## License

Apache-2.0
