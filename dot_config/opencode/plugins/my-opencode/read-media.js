import { open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const slash = value => value.replaceAll('\\', '/');
const contains = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

// Match the signatures and media whitelist of OpenCode v2.3.0's read tool.
export function mediaMime(bytes) {
  const starts = signature => signature.every((byte, index) => bytes[index] === byte);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (starts([0x52, 0x49, 0x46, 0x46]) && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
}

export function readMediaTool(ctx) {
  return {
    name: 'read_media',
    description: 'Read an image or PDF file. Supports PNG, JPEG, GIF, WebP, and PDF. Images and PDFs are presented directly to the model. Other files and directories are rejected; use shell to read text files or list directories.',
    options: { codemode: false, permission: 'read_media' },
    input: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Image or PDF file to read' } },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(input, context) {
      // Node filesystem access is local to the server, not a remote workspace.
      if (ctx.location.workspaceID) throw new Error('read_media supports local workspaces only.');
      const absolute = path.resolve(ctx.location.directory,
        input.path.startsWith('~/') ? path.join(os.homedir(), input.path.slice(2)) : input.path);
      const internal = contains(ctx.location.directory, absolute) ||
        (ctx.location.project.directory !== path.parse(ctx.location.project.directory).root &&
          contains(ctx.location.project.directory, absolute));
      const invocation = {
        sessionID: context.sessionID,
        agent: context.agent,
        source: { type: 'tool', messageID: context.messageID, id: context.id },
      };
      if (!internal) {
        const resource = slash(path.join(path.dirname(absolute), '*'));
        await ctx.permission.assert({ ...invocation, action: 'external_directory', resources: [resource], save: [resource] });
      }
      await ctx.permission.assert({
        ...invocation, action: 'read_media',
        resources: [slash(internal ? path.relative(ctx.location.directory, absolute) || '.' : absolute)],
        save: ['*'],
      });

      let file;
      try {
        file = await open(absolute, 'r');
        const info = await file.stat();
        if (!info.isFile()) throw new Error(`Path is not a file: ${input.path}. Use shell to list directories.`);
        const header = Buffer.alloc(12);
        const { bytesRead } = await file.read(header, 0, header.length, 0);
        const mime = mediaMime(header.subarray(0, bytesRead));
        if (!mime) throw new Error(`Unsupported media file: ${input.path}. Supports PNG, JPEG, GIF, WebP, and PDF only. Use shell to read text files or list directories.`);
        if (info.size > MAX_MEDIA_BYTES) throw new Error(`Media exceeds ${MAX_MEDIA_BYTES} byte ingestion limit: ${input.path}`);
        // Bound the read even if the file grows after stat; readFile would be unbounded.
        const bytes = Buffer.alloc(MAX_MEDIA_BYTES + 1);
        let length = 0;
        while (length < bytes.length) {
          context.signal.throwIfAborted();
          const result = await file.read(bytes, length, bytes.length - length, length);
          if (result.bytesRead === 0) break;
          length += result.bytesRead;
        }
        if (length > MAX_MEDIA_BYTES) throw new Error(`Media exceeds ${MAX_MEDIA_BYTES} byte ingestion limit: ${input.path}`);
        return {
          content: [
            { type: 'text', text: mime === 'application/pdf' ? 'PDF read successfully' : 'Image read successfully' },
            { type: 'file', uri: `data:${mime};base64,${bytes.subarray(0, length).toString('base64')}`, mime, name: input.path },
          ],
          metadata: { truncated: false },
        };
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new Error(`File not found: ${input.path}`);
        if (error.code === 'EISDIR') throw new Error(`Path is not a file: ${input.path}. Use shell to list directories.`);
        if (error.code) throw new Error(`Unable to read ${input.path}`, { cause: error });
        throw error;
      } finally {
        await file?.close();
      }
    },
  };
}
