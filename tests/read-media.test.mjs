import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readMediaTool, MAX_MEDIA_BYTES } from '../dot_config/opencode/plugins/my-opencode/read-media.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'read-media-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const permissions = [];
  const ctx = {
    location: { directory, project: { directory } },
    permission: { assert: async input => permissions.push(input) },
  };
  const context = { sessionID: 'ses_test', agent: 'build', messageID: 'msg_test', id: 'call_test', signal: new AbortController().signal };
  const tool = readMediaTool(ctx);
  return { directory, permissions, ctx, tool, run: name => tool.execute({ path: name }, context) };
}

const formats = [
  ['image/png', Buffer.from('89504e470d0a1a0a', 'hex')],
  ['image/jpeg', Buffer.from('ffd8ff', 'hex')],
  ['image/gif', Buffer.from('GIF89a')],
  ['image/webp', Buffer.from('RIFF0000WEBP')],
  ['application/pdf', Buffer.from('%PDF-1.7')],
];

for (const [mime, bytes] of formats) {
  test(`read_media emits native ${mime} attachment based on signature, not extension`, async t => {
    const f = await fixture(t);
    await writeFile(path.join(f.directory, 'media.txt'), bytes);
    const result = await f.run('media.txt');
    assert.deepEqual(result, {
      content: [
        { type: 'text', text: mime === 'application/pdf' ? 'PDF read successfully' : 'Image read successfully' },
        { type: 'file', uri: `data:${mime};base64,${bytes.toString('base64')}`, mime, name: 'media.txt' },
      ],
      metadata: { truncated: false },
    });
    assert.deepEqual(f.permissions.map(p => p.action), ['read_media']);
    assert.deepEqual(f.permissions[0].source, { type: 'tool', messageID: 'msg_test', id: 'call_test' });
  });
}

test('rejects text, other binary formats, directories, and missing files as failures', async t => {
  const f = await fixture(t);
  for (const bytes of [Buffer.from('hello'), Buffer.from('<svg/>'), Buffer.from('BM\0\0'), Buffer.from('0000ftypavif'), Buffer.from('RIFF0000WAVE'), Buffer.from('0000ftypisom')]) {
    await writeFile(path.join(f.directory, 'fake.png'), bytes);
    await assert.rejects(f.run('fake.png'), /Unsupported media file:.*Use shell/);
  }
  await assert.rejects(f.run('.'), /Path is not a file:.*Use shell/);
  await assert.rejects(f.run('missing.png'), /File not found: missing.png/);
});

test('accepts exactly 20 MiB and rejects larger media', async t => {
  const f = await fixture(t);
  const file = await open(path.join(f.directory, 'large.pdf'), 'w');
  try {
    await file.write(Buffer.from('%PDF-'));
    await file.truncate(MAX_MEDIA_BYTES);
    assert.equal((await f.run('large.pdf')).content[1].mime, 'application/pdf');
    await file.truncate(MAX_MEDIA_BYTES + 1);
    await assert.rejects(f.run('large.pdf'), /Media exceeds 20971520 byte ingestion limit/);
  } finally {
    await file.close();
  }
});

test('external access checks external_directory and read_media, preserving denial', async t => {
  const f = await fixture(t);
  const external = path.join(path.dirname(f.directory), 'not-opened.pdf');
  const denied = new Error('permission denied');
  f.ctx.permission.assert = async input => {
    f.permissions.push(input);
    if (input.action === 'read_media') throw denied;
  };
  await assert.rejects(f.run(external), error => error === denied);
  assert.deepEqual(f.permissions.map(p => p.action), ['external_directory', 'read_media']);
});

test('tool definition is static, direct, path-only and does not use read permission', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.tool.options, { codemode: false, permission: 'read_media' });
  assert.deepEqual(Object.keys(f.tool.input.properties), ['path']);
  assert.match(f.tool.description, /Images and PDFs are presented directly to the model/);
  f.ctx.location.workspaceID = 'remote';
  await assert.rejects(f.run('image.png'), /local workspaces only/);
});
