import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { options, catalogSkills, planInstall, applyPlan } from './setup.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optional-skills-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project with spaces');
  const catalog = path.join(home, '.local/share/my-opencode/optional-skills');
  fs.mkdirSync(project, { recursive: true });
  for (const name of ['ask-bun', 'ask-docker']) {
    fs.mkdirSync(path.join(catalog, name), { recursive: true });
    fs.writeFileSync(path.join(catalog, name, 'SKILL.md'), `name: ${name}`);
  }
  return { home, project, catalog, names: ['ask-bun', 'ask-docker'], scope: 'project' };
}

test('lists only valid skill directories', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.catalog, 'tests'));
  assert.deepEqual(catalogSkills(f.catalog), f.names);
});

for (const scope of ['global', 'project']) test(`${scope} links are idempotent`, t => {
  const f = { ...fixture(t), scope };
  applyPlan(planInstall(f));
  const second = planInstall(f);
  assert.ok(second.links.every(link => link.exists));
  applyPlan(second);
  for (const link of second.links) assert.equal(fs.realpathSync(link.target), link.source);
});

test('dry run writes nothing', t => {
  const f = fixture(t);
  applyPlan(planInstall(f), { dryRun: true });
  assert.equal(fs.existsSync(path.join(f.project, '.agents')), false);
});

test('validates all skills before making any changes', t => {
  const f = fixture(t);
  assert.throws(() => planInstall({ ...f, names: ['ask-bun', '../bad'] }), /Unknown skill/);
  assert.equal(fs.existsSync(path.join(f.project, '.agents')), false);
});

for (const kind of ['file', 'directory', 'symlink']) test(`refuses conflicting ${kind}`, t => {
  const f = fixture(t);
  const target = path.join(f.project, '.agents/skills/ask-docker');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (kind === 'file') fs.writeFileSync(target, 'preserve');
  if (kind === 'directory') fs.mkdirSync(target);
  if (kind === 'symlink') fs.symlinkSync('/missing-target', target);
  assert.throws(() => planInstall(f), /Refusing to replace/);
  assert.equal(fs.existsSync(path.join(path.dirname(target), 'ask-bun')), false);
});

test('refuses symlinked parent directories', t => {
  const f = fixture(t);
  fs.symlinkSync(f.home, path.join(f.project, '.agents'), 'dir');
  assert.throws(() => planInstall(f), /Refusing non-directory or symlink/);
});

test('relative project path resolves from supplied caller directory', t => {
  const f = fixture(t);
  assert.equal(planInstall({ ...f, project: '.', cwd: f.project }).root, f.project);
});

test('rolls back only links created by a failed invocation', t => {
  const f = fixture(t);
  const plan = planInstall(f);
  fs.mkdirSync(plan.destination, { recursive: true });
  fs.writeFileSync(plan.links[1].target, 'concurrent file');
  assert.throws(() => applyPlan(plan), /EEXIST/);
  assert.equal(fs.existsSync(plan.links[0].target), false);
  assert.equal(fs.readFileSync(plan.links[1].target, 'utf8'), 'concurrent file');
});

test('parses explicit scope and rejects ambiguous arguments', () => {
  assert.equal(options(['install', 'ask-bun', '--global']).scope, 'global');
  assert.throws(() => options(['--global', '--project', '/a']), /scope|combined/);
  assert.throws(() => options(['--project']), /requires/);
  assert.throws(() => options(['../bad']), /invalid/);
});

test('CLI lists installed catalog and refuses incomplete noninteractive requests', t => {
  const f = fixture(t);
  const script = new URL('./setup.mjs', import.meta.url);
  const run = args => spawnSync(process.execPath, [script.pathname, ...args], { env: { ...process.env, HOME: f.home }, encoding: 'utf8' });
  assert.equal(run(['list']).stdout.trim(), 'ask-bun\nask-docker');
  assert.match(run(['install']).stderr, /Noninteractive use requires/);
  assert.equal(run(['install', 'ask-bun', '--project', f.project, '--dry-run']).status, 0);
  assert.equal(fs.existsSync(path.join(f.project, '.agents')), false);
});
