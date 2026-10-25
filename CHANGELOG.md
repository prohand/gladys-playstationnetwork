# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

## [0.1.0] - 2026-10-25

### Added

- Catalog: search keywords (PS5, PS4, PSN, Sony, gaming…) and the new `leisure` shelf of the Gladys store.

### Changed

- Gladys 5.3.0 or later is now required.
- Gladys integration SDK 0.16.

## [0.0.2] - 2026-10-23

- Maintenance release, no functional change.

## [0.0.1] - 2026-10-14

### Added

- PlayStation Network sign-in with an NPSSO token: the tokens are renewed on their own and kept in `/data`, the NPSSO itself is never written nor logged.
- A device for the PSN account: online, in game, current game, platform, current session, played today, trophy level and platinum / gold / silver / bronze counts.
- Up to 10 followed friends, each one a device with its presence, game and play time.
- PS4 and PS5 consoles found on the local network (DDP protocol, scan relayed by Gladys or the console IP typed in the configuration): on, rest mode or off.
- Cloud and local transport badges: the console state comes from the LAN or from the PSN presence, following the "Prefer the local connection" toggle, with a degraded badge when the preferred channel is silent.
- Scene triggers "A game started", "A game stopped" (with the session length) and "A trophy was earned" (filter by grade).
- Scene actions "Get a player's status" and "Get a console's state".
- A "PlayStation Network" dashboard widget: play time, trophies, who plays what with the game icons, consoles, and a refresh button.
- "Test the connection" and "Find my consoles" buttons in the configuration.
- English, French, German and Spanish everywhere: configuration, messages, widget and documentation.

[Unreleased]: https://github.com/prohand/gladys-playstationnetwork/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/prohand/gladys-playstationnetwork/compare/v0.0.2...v0.1.0
[0.0.2]: https://github.com/prohand/gladys-playstationnetwork/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/prohand/gladys-playstationnetwork/releases/tag/v0.0.1
