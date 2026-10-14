import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const REPO = 'https://github.com/prohand/gladys-playstationnetwork';

test('the Unreleased section moves under the version, links included', () => {
  const before = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Something.\n\n[Unreleased]: ${REPO}/commits/main\n`;
  const after = rollChangelog(before, '1.0.0', '2026-10-14');
  assert.match(
    after,
    /## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-10-14\n\n### Added\n\n- Something\./,
  );
  assert.match(after, new RegExp(`\\[Unreleased\\]: ${REPO}/compare/v1\\.0\\.0\\.\\.\\.HEAD`));
  assert.match(after, new RegExp(`\\[1\\.0\\.0\\]: ${REPO}/releases/tag/v1\\.0\\.0`));
});

test('the changelog of the repository can be rolled', async () => {
  const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.ok(text.includes('## [Unreleased]'), 'the Release workflow needs an Unreleased section');
  assert.notEqual(rollChangelog(text, '9.9.9', '2026-10-14'), text);
});
