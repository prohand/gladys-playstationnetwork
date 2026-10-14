// -----------------------------------------------------------------------------
// Scene actions (Gladys 5.1+).
//
// Two questions a scene can ask, each answered with fresh data and returned as
// outputs the next actions of the scene can test or print:
//   - `get_player_status`: is this player online, in which game, for how long
//     today? (the account, or a followed friend);
//   - `get_console_state`: is the console on, resting or off?
//
// The triggers (game started / stopped, trophy earned) are fired by the PSN
// loop, see src/service.js. Never fire one from here: a scene bound to it
// would loop through the integration.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'scenes' });

/** Data younger than this is fresh enough for a scene: no new request. */
export const FRESH_MS = 30_000;

export const SCENE_ACTIONS = {
  async get_player_status(service, fields) {
    logger.info(`Scene action get_player_status <- ${fields.device ?? 'account'}`);
    if (service.clock() - service.link.checkedAt > FRESH_MS) {
      await service.refresh();
    }
    const player = service.player(fields.device);
    if (!player) {
      throw new Error('Unknown player: pick the PSN account or a followed friend');
    }
    const presence = player.presence;
    return {
      online: presence?.online ?? false,
      in_game: presence?.inGame ?? false,
      game: presence?.titleName ?? '',
      platform: presence?.platform ?? '',
      session_minutes: player.sessionMinutes,
      today_minutes: player.todayMinutes,
      online_id: player.onlineId,
    };
  },

  async get_console_state(service, fields) {
    logger.info(`Scene action get_console_state <- ${fields.device ?? 'first console'}`);
    if (service.clock() - service.consolesCheckedAt > FRESH_MS / 3) {
      await service.refreshConsoles();
    }
    const console = service.consoleView(fields.device);
    if (!console) {
      throw new Error('No console known: run "Find my consoles" in the configuration');
    }
    return {
      power: console.power === 1,
      status: console.status ?? 'unknown',
      name: console.hostName ?? console.hostType,
    };
  },
};
