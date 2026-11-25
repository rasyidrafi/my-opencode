import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { modes } from './setup.mjs';

const marker = path.join(os.homedir(), '.config/rawroute/local-enabled');
const mode = fs.existsSync(marker) ? 'local' : 'default';
const { urlEnv } = modes[mode];
const baseURL = process.env[urlEnv]?.trim();
let endpoint;
try {
  endpoint = new URL(baseURL);
} catch {
  console.error(`${urlEnv} must contain an absolute HTTP or HTTPS URL to launch Codex.`);
  process.exit(1);
}
if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
  console.error(`${urlEnv} must contain an HTTP or HTTPS URL without embedded credentials.`);
  process.exit(1);
}

const result = spawnSync('codex', [
  '-c', `model_providers.rawroute.base_url=${JSON.stringify(baseURL)}`,
  ...process.argv.slice(2),
], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
