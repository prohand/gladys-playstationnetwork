// -----------------------------------------------------------------------------
// The local channel: the PlayStation "Device Discovery Protocol" (DDP).
//
// A PS4 or a PS5 answers a small text request on UDP — port 987 for a PS4,
// 9302 for a PS5 — even in rest mode, as long as "Stay connected to the
// internet" (and on a PS5 "Enable turning on PS5 from the network") is on in
// its power saving settings. The answer says whether it is on or resting:
//
//   SRCH * HTTP/1.1                     HTTP/1.1 200 Ok           (or 620 Server Standby)
//   device-discovery-protocol-version:  host-id:A1B2C3D4E5F6
//     00030010                          host-type:PS5
//                                       host-name:PS5-123
//                                       system-version:09400000
//
// This is read-only: waking a console needs the Remote Play pairing key, which
// this integration does not ask for.
//
// Two ways to send the request:
//   - unicast, from the container, to a known IP: crosses the Docker NAT both
//     ways, used for the periodic status of a known console;
//   - broadcast, to find the consoles: a broadcast cannot leave the container,
//     so the Gladys core emits it for us (`scanNetwork('udp-active-broadcast')`,
//     declared in the manifest `network_discovery`) and relays the answers.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'ddp' });

/** DDP ports: the PS5 one first, it is the console most people have now. */
export const DDP_PORTS = Object.freeze({ PS5: 9302, PS4: 987 });

const DDP_VERSION = '00030010';

/** The core accepts one active scan every 10 seconds per integration. */
export const SCAN_INTERVAL_MS = 10_000;

/** The search request, the same for both consoles. */
export function buildSearchPacket() {
  return Buffer.from(`SRCH * HTTP/1.1\ndevice-discovery-protocol-version:${DDP_VERSION}\n`);
}

/**
 * @typedef {object} ConsoleReply
 * @property {'on'|'standby'|'unknown'} status
 * @property {string} hostId     stable id of the console (its MAC, in hex)
 * @property {string} hostName
 * @property {string} hostType   'PS5' | 'PS4'
 * @property {string|null} ip
 * @property {string|null} runningAppName   PS4 only
 * @property {string|null} runningAppTitleId PS4 only
 * @property {string|null} systemVersion
 */

/**
 * Parse a DDP answer. Anything that is not one (another device answering on
 * the port, a truncated datagram) is null.
 *
 * @param {Buffer|string} payload
 * @param {string|null} [ip] where it came from
 * @returns {ConsoleReply|null}
 */
export function parseDdpReply(payload, ip = null) {
  const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload ?? '');
  const lines = text.split(/\r?\n/);
  const statusLine = lines[0]?.match(/^HTTP\/1\.1\s+(\d{3})/);
  if (!statusLine) {
    return null;
  }
  const headers = {};
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(':');
    if (separator > 0) {
      headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }
  }
  const hostId = headers['host-id'];
  if (!hostId) {
    return null;
  }
  const code = statusLine[1];
  return {
    status: code === '200' ? 'on' : code === '620' ? 'standby' : 'unknown',
    hostId,
    hostName: headers['host-name'] || null,
    hostType: (headers['host-type'] || 'PS').toUpperCase(),
    ip,
    runningAppName: headers['running-app-name'] || null,
    runningAppTitleId: headers['running-app-titleid'] || null,
    systemVersion: headers['system-version'] || null,
  };
}

/**
 * Ask one console, by unicast, how it is. Resolves null when nothing answers
 * in time (console off or unplugged, wrong IP, network settings).
 *
 * @param {string} ip
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {typeof dgram.createSocket} [options.createSocket] (tests)
 * @returns {Promise<ConsoleReply|null>}
 */
export function probeConsole(ip, { timeoutMs = 2000, createSocket = dgram.createSocket } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let socket;
    const finish = (value) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Already closed.
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      socket = createSocket('udp4');
      socket.on('error', (err) => {
        logger.debug(`DDP probe of ${ip} failed: ${err.message}`);
        finish(null);
      });
      socket.on('message', (message, remote) => {
        const reply = parseDdpReply(message, remote?.address ?? ip);
        if (reply) {
          finish(reply);
        }
      });
      socket.bind(0, () => {
        const packet = buildSearchPacket();
        for (const port of Object.values(DDP_PORTS)) {
          socket.send(packet, port, ip, (err) => {
            if (err) {
              logger.debug(`DDP request to ${ip}:${port} failed: ${err.message}`);
            }
          });
        }
      });
    } catch (err) {
      logger.debug(`DDP probe of ${ip} failed: ${err.message}`);
      finish(null);
    }
  });
}

/**
 * Find the consoles of the LAN through the Gladys core (broadcast on both DDP
 * ports, one scan per port, spaced by the core's rate limit).
 *
 * @param {object} gladys the SDK instance
 * @param {object} [options]
 * @param {number} [options.timeoutSeconds]
 * @param {(ms: number) => Promise<void>} [options.sleep] (tests)
 * @returns {Promise<{ consoles: ConsoleReply[], errors: string[] }>}
 */
export async function scanConsoles(
  gladys,
  { timeoutSeconds = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {},
) {
  const found = new Map();
  const errors = [];
  let lastScanAt = 0;
  for (const port of Object.values(DDP_PORTS)) {
    const wait = lastScanAt + SCAN_INTERVAL_MS - Date.now();
    if (lastScanAt && wait > 0) {
      await sleep(wait);
    }
    lastScanAt = Date.now();
    try {
      const replies = await gladys.scanNetwork('udp-active-broadcast', {
        port,
        payload: buildSearchPacket(),
        timeoutSeconds,
      });
      for (const { source_ip: ip, payload_base64: payload } of replies ?? []) {
        const reply = parseDdpReply(Buffer.from(String(payload ?? ''), 'base64'), ip);
        if (reply && !found.has(reply.hostId)) {
          found.set(reply.hostId, reply);
        }
      }
    } catch (err) {
      logger.warn(`Network scan on port ${port} failed: ${err.message}`);
      errors.push(err.message);
    }
  }
  return { consoles: [...found.values()], errors };
}
