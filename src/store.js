// -----------------------------------------------------------------------------
// Small JSON files under /data, the one writable volume of the container.
//
// Two things must survive a restart (an update of the integration, a reboot of
// Gladys):
//   - the PlayStation Network tokens: exchanging the NPSSO again on every start
//     is what Sony watches for, and the refresh token lives for two months;
//   - the play time counters: "played today" must not drop to zero because the
//     container restarted at 6 pm, and a game still running must not be seen as
//     "started" a second time.
//
// Writes go to a temporary file renamed over the real one, so a crash never
// leaves half a JSON document. The files hold secrets (tokens): owner-only.
// When /data cannot be written (a local `npm start` outside the container), the
// store keeps working in memory and says so once.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

/** The writable volume; DATA_DIR overrides it for a run outside the container. */
export const DATA_DIR = process.env.DATA_DIR || '/data';

/**
 * A JSON document kept in a file.
 *
 * @param {string} name file name, inside {@link DATA_DIR}
 * @param {object} [options]
 * @param {string} [options.dir] directory (tests)
 * @returns {{ load(): Promise<object>, save(value: object): Promise<void> }}
 */
export function createJsonStore(name, { dir = DATA_DIR } = {}) {
  const path = join(dir, name);
  let memory = {};
  let warned = false;
  let queue = Promise.resolve();

  return {
    async load() {
      try {
        memory = JSON.parse(await readFile(path, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Could not read ${name}, starting from scratch: ${err.message}`);
        }
        memory = {};
      }
      return structuredClone(memory);
    },

    save(value) {
      memory = structuredClone(value);
      const snapshot = JSON.stringify(memory, null, 2);
      // One write at a time, in call order: the last save always wins.
      queue = queue.then(async () => {
        try {
          await mkdir(dirname(path), { recursive: true });
          const tmp = `${path}.tmp`;
          await writeFile(tmp, snapshot, { mode: 0o600 });
          await rename(tmp, path);
        } catch (err) {
          if (!warned) {
            warned = true;
            logger.warn(`Cannot write ${path} (${err.code ?? err.message}): kept in memory only`);
          }
        }
      });
      return queue;
    },
  };
}

/** The same interface, in memory only (tests). */
export function createMemoryStore(initial = {}) {
  let memory = structuredClone(initial);
  return {
    saved: [],
    async load() {
      return structuredClone(memory);
    },
    async save(value) {
      memory = structuredClone(value);
      this.saved.push(structuredClone(value));
    },
  };
}
