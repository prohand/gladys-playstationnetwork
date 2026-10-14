// -----------------------------------------------------------------------------
// A PsnService wired to the SDK's fake Gladys, the fake PSN and a fake LAN.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { PsnService } from '../../src/service.js';
import { createMemoryStore } from '../../src/store.js';
import { createFakePsn, NPSSO } from './fakePsn.js';

export const T0 = Date.parse('2026-10-14T16:00:00.000Z'); // 18:00 in Paris

/** DDP replies of the fake LAN, by IP: set `lan.consoles.set(ip, reply)`. */
export function createFakeLan() {
  const lan = {
    consoles: new Map(),
    probes: [],
    async probe(ip) {
      lan.probes.push(ip);
      const reply = lan.consoles.get(ip);
      return reply ? { ...reply, ip } : null;
    },
    async scan() {
      return { consoles: [...lan.consoles].map(([ip, reply]) => ({ ...reply, ip })), errors: [] };
    },
  };
  return lan;
}

export const PS5_REPLY = {
  status: 'standby',
  hostId: 'A1B2C3D4E5F6',
  hostName: 'PS5-Salon',
  hostType: 'PS5',
};

/**
 * @param {object} [options]
 * @param {object} [options.config] raw configuration
 * @param {object[]} [options.devices] devices already created in Gladys
 */
export async function setup({ config = {}, devices = [], stateStore, tokenStore } = {}) {
  const psn = createFakePsn();
  const lan = createFakeLan();
  const gladys = createFakeGladys({ devices });
  // Connected, so `gladys.devices` holds the created devices like in production.
  await gladys.connect();
  const clock = { now: T0 };
  const service = new PsnService({
    gladys,
    fetch: psn.fetch,
    tokenStore: tokenStore ?? createMemoryStore(),
    stateStore: stateStore ?? createMemoryStore(),
    clock: () => clock.now,
    probe: lan.probe,
    scan: lan.scan,
  });
  await service.applyConfig({ npsso: NPSSO, ...config });
  return { psn, lan, gladys, service, clock };
}

/** Create every discovered device in the fake Gladys, like a user clicking "Add". */
export async function createAllDevices(gladys, service) {
  for (const device of service.buildDiscoveredDevices()) {
    if (!gladys.devices.some((known) => known.external_id === device.external_id)) {
      await gladys.fake.deviceCreated(device);
    }
  }
}
