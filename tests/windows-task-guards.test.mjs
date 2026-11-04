import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

for (const [directory, task] of [
  ['docker-setup', 'docker:setup'],
  ['docker-forward', 'docker:forward:setup'],
  ['azure-mnt-cache', 'azure-mnt-cache:setup'],
]) {
  test(`${task} fails explicitly on Windows before parsing arguments or running tools`, { skip: process.platform !== 'win32' }, () => {
    const script = fileURLToPath(new URL(`../dot_config/${directory}/setup.mjs`, import.meta.url));
    const result = spawnSync(process.execPath, [script, '--invalid-option'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.includes(`${task} is not supported on Windows yet.`));
  });
}
