import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Only launch the agent here; the prompt owns host-specific shell decisions.
try {
  if (!['linux', 'darwin'].includes(process.platform)) {
    throw new Error('shell:setup supports Linux and macOS Bash environments only.');
  }
  const home = os.homedir();
  const config = path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'config.toml');
  if (!fs.existsSync(config)) {
    throw new Error('Set up Codex first: configure your model/provider in $CODEX_HOME/config.toml (default ~/.codex/config.toml) and its authentication.');
  }
  const available = spawnSync('codex', ['exec', '--help'], { stdio: 'ignore', timeout: 30_000 });
  if (available.error || available.status !== 0) {
    throw new Error('Codex CLI is unavailable. Run mise install and finish Codex setup before running shell:setup.');
  }
  const prompt = fs.readFileSync(new URL('./PROMPT.txt', import.meta.url), 'utf8');
  console.error('Running Codex to inspect, standardize, and verify your user shell configuration.');
  const result = spawnSync('codex', [
    'exec', '--cd', home, '--skip-git-repo-check',
    '--sandbox', 'workspace-write', '-c', 'approval_policy="never"',
    '--ephemeral', '-',
  ], {
    cwd: home,
    input: prompt,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.error) throw new Error(`Could not start Codex: ${result.error.message}`);
  if (result.signal) throw new Error(`Codex terminated by ${result.signal}.`);
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
