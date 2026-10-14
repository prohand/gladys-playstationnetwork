// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest itself; only these tests know which
// handlers the code registers, and that every text exists in four languages.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/actions.js';
import { SCENE_ACTIONS } from '../src/capabilities/scenes.js';
import { WIDGETS } from '../src/capabilities/widget.js';
import { DEFAULT_CONFIG, POLL_FREQUENCY_BOUNDS } from '../src/config.js';
import { DDP_PORTS } from '../src/console/ddp.js';
import { LANGUAGES } from '../src/i18n.js';
import { TRIGGERS } from '../src/service.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

const allFields = [
  ...manifest.config_schema,
  ...[...manifest.actions, ...manifest.scene_triggers, ...manifest.scene_actions].flatMap(
    (item) => item.fields ?? [],
  ),
  ...manifest.widgets.flatMap((widget) => widget.settings ?? []),
];

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

/** Every multi-language object of the manifest, with where it is. */
function texts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => texts(child, `${path}[${index}]`));
  }
  if (node === null || typeof node !== 'object') {
    return [];
  }
  return Object.entries(node).flatMap(([key, value]) =>
    ['label', 'description', 'placeholder'].includes(key) && typeof value === 'object'
      ? [{ path: `${path}.${key}`, value }]
      : texts(value, `${path}.${key}`),
  );
}

test('every text of the manifest exists in English, French, German and Spanish', () => {
  const all = texts(manifest);
  assert.ok(all.length > 50);
  for (const { path, value } of all) {
    assert.deepEqual(Object.keys(value), LANGUAGES, `${path} needs ${LANGUAGES.join(', ')}`);
    for (const [language, text] of Object.entries(value)) {
      assert.ok(typeof text === 'string' && text.trim().length > 0, `${path}.${language} is empty`);
    }
  }
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
});

test('every scene action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every widget has a content handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
});

test('the capability fields require Gladys >= 5.1.0', () => {
  const [major, minor] = minGladysVersion();
  assert.ok(major > 5 || (major === 5 && minor >= 1), manifest.gladys_version);
});

test('both transports are declared: the PSN (cloud) and the console on the LAN (local)', () => {
  assert.deepEqual(manifest.transports, ['local', 'cloud']);
  assert.ok(
    !manifest.config_schema.some((field) => field.key === 'GLADYS_PREFER_LOCAL'),
    'reserved key',
  );
});

test('the network scan covers the DDP ports of both consoles', () => {
  assert.deepEqual(manifest.network_discovery, [
    { type: 'udp-active-broadcast', ports: Object.values(DDP_PORTS) },
  ]);
});

test('config_schema defaults and bounds stay consistent with the code', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
  const poll = manifest.config_schema.find((field) => field.key === 'poll_frequency');
  assert.deepEqual({ min: poll.min, max: poll.max }, POLL_FREQUENCY_BOUNDS);
});

test('the NPSSO is a secret field', () => {
  const npsso = manifest.config_schema.find((field) => field.key === 'npsso');
  assert.equal(npsso.type, 'secret');
  assert.equal(npsso.required, true);
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const [language, text] of Object.entries(section.description ?? {})) {
      assert.ok(
        text.length <= 1000,
        `section ${section.key}.${language}: ${text.length} characters`,
      );
    }
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(
    manifest.docker_image,
    `ghcr.io/prohand/gladys-playstationnetwork:${manifest.version}`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${language}: ${text.length}`);
  }
});

test('1 to 3 catalog categories', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
});
