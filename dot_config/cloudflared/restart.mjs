import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manage } from './service.mjs';

export const restart = options => manage('restart', options);

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { restart(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
