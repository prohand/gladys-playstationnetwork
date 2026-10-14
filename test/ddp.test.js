import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  buildSearchPacket,
  DDP_PORTS,
  parseDdpReply,
  probeConsole,
  scanConsoles,
} from '../src/console/ddp.js';

const STANDBY =
  'HTTP/1.1 620 Server Standby\nhost-id:A1B2C3D4E5F6\nhost-type:PS5\nhost-name:PS5-Salon\nhost-request-port:997\nsystem-version:09400000\n';
const ON_PS4 =
  'HTTP/1.1 200 Ok\r\nhost-id:0011AABBCCDD\r\nhost-type:PS4\r\nhost-name:PS4-Chambre\r\nrunning-app-name:Bloodborne\r\nrunning-app-titleid:CUSA00900\r\n';

test('the search request is the DDP one', () => {
  assert.equal(
    buildSearchPacket().toString(),
    'SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00030010\n',
  );
  assert.ok(buildSearchPacket().length <= 512, 'fits the core active scan limit');
});

test('a PS5 in rest mode and a PS4 running a game', () => {
  assert.deepEqual(parseDdpReply(Buffer.from(STANDBY), '192.168.1.20'), {
    status: 'standby',
    hostId: 'A1B2C3D4E5F6',
    hostName: 'PS5-Salon',
    hostType: 'PS5',
    ip: '192.168.1.20',
    runningAppName: null,
    runningAppTitleId: null,
    systemVersion: '09400000',
  });
  const ps4 = parseDdpReply(ON_PS4);
  assert.equal(ps4.status, 'on');
  assert.equal(ps4.runningAppName, 'Bloodborne');
});

test('anything else is not a console', () => {
  assert.equal(parseDdpReply('hello'), null);
  assert.equal(parseDdpReply('HTTP/1.1 200 Ok\nserver:printer\n'), null, 'no host-id');
  assert.equal(parseDdpReply(''), null);
});

function fakeSocketFactory(answer) {
  const sent = [];
  const socket = new EventEmitter();
  socket.bind = (_port, cb) => cb();
  socket.send = (packet, port, ip, cb) => {
    sent.push({ port, ip });
    cb?.();
    if (answer && port === answer.port) {
      setImmediate(() => socket.emit('message', Buffer.from(answer.text), { address: ip }));
    }
  };
  socket.close = () => {
    socket.closed = true;
  };
  return { sent, socket, createSocket: () => socket };
}

test('the unicast probe asks both ports and resolves the first answer', async () => {
  const { sent, socket, createSocket } = fakeSocketFactory({ port: DDP_PORTS.PS5, text: STANDBY });
  const reply = await probeConsole('192.168.1.20', { createSocket, timeoutMs: 500 });
  assert.equal(reply.hostId, 'A1B2C3D4E5F6');
  assert.equal(reply.ip, '192.168.1.20');
  assert.deepEqual(
    sent.map((s) => s.port).sort((a, b) => a - b),
    [987, 9302],
  );
  assert.equal(socket.closed, true);
});

test('the probe resolves null when nothing answers', async () => {
  const { createSocket } = fakeSocketFactory(null);
  assert.equal(await probeConsole('192.168.1.99', { createSocket, timeoutMs: 20 }), null);
});

test('the LAN scan goes through the core, on both ports, spaced by its rate limit', async () => {
  const gladys = createFakeGladys({
    scanResults: {
      'udp-active-broadcast': [
        {
          source_ip: '192.168.1.20',
          source_port: 9302,
          payload_base64: Buffer.from(STANDBY).toString('base64'),
        },
        {
          source_ip: '192.168.1.30',
          source_port: 987,
          payload_base64: Buffer.from(ON_PS4).toString('base64'),
        },
        {
          source_ip: '192.168.1.40',
          source_port: 9302,
          payload_base64: Buffer.from('junk').toString('base64'),
        },
      ],
    },
  });
  await gladys.connect();
  const waits = [];
  const { consoles, errors } = await scanConsoles(gladys, { sleep: async (ms) => waits.push(ms) });
  assert.deepEqual(errors, []);
  assert.deepEqual(
    consoles.map((c) => [c.hostType, c.ip]),
    [
      ['PS5', '192.168.1.20'],
      ['PS4', '192.168.1.30'],
    ],
  );
  assert.deepEqual(
    gladys.fake.scans.map((scan) => scan.port),
    [9302, 987],
  );
  assert.equal(waits.length, 1, 'the second scan waits for the core rate limit');
});

test('a refused scan is reported, not thrown', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  gladys.scanNetwork = async () => {
    throw new Error('403 network_discovery not declared');
  };
  const { consoles, errors } = await scanConsoles(gladys, { sleep: async () => {} });
  assert.deepEqual(consoles, []);
  assert.equal(errors.length, 2);
});
