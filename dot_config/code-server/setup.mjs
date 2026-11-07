import { requireTaskPlatform } from '../my-opencode/platform.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const installUrl = 'https://code-server.dev/install.sh';

export function normalizeConfig(config) {
  const keys = new Set(['auth', 'bind-addr', 'password', 'hashed-password']);
  const lines = config.replace(/^\uFEFF/, '').split(/\r?\n/);
  const rootIndent = lines
    .filter((line) => line.trim() && !/^\s*#/.test(line) && !/^\s*---\s*(?:#.*)?$/.test(line))
    .reduce((indent, line) => Math.min(indent, line.match(/^ */)[0].length), Infinity);
  const indentation = Number.isFinite(rootIndent) ? ' '.repeat(rootIndent) : '';
  const retained = [];
  let removingValue = false;
  for (const line of lines) {
    const isContinuation = !line.trim() || /^\s*#/.test(line) || line.match(/^ */)[0].length > rootIndent;
    if (removingValue && isContinuation) continue;
    removingValue = false;
    const match = line.match(new RegExp(`^${indentation}(?:([A-Za-z0-9_-]+)|"([A-Za-z0-9_-]+)"|'([A-Za-z0-9_-]+)')\\s*:`));
    if (match && keys.has((match[1] || match[2] || match[3]).toLowerCase())) {
      removingValue = true;
      continue;
    }
    retained.push(line);
  }
  while (retained.length && retained.at(-1) === '') retained.pop();
  retained.push(`${indentation}auth: none`, `${indentation}bind-addr: 127.0.0.1:8080`, '');
  return retained.join('\n');
}

function systemdQuote(value) {
  if (/[\r\n]/.test(value)) throw new Error('Unsupported newline in systemd path.');
  return `"${value.replaceAll('%', '%%').replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function systemdPath(value) {
  if (/[\r\n]/.test(value)) throw new Error('Unsupported newline in systemd path.');
  return value.replaceAll('%', '%%').replaceAll('\\', '\\x5c').replaceAll(' ', '\\x20').replaceAll('"', '\\x22');
}

export function renderUnit(binary, home) {
  return `# Managed by mise run code-server:setup\n[Unit]\nDescription=code-server (localhost)\nAfter=network.target\n\n[Service]\nType=simple\nEnvironment=${systemdQuote(`HOME=${home}`)}\nWorkingDirectory=${systemdPath(home)}\nExecStart=${systemdQuote(binary)} --bind-addr 127.0.0.1:8080 --auth none\nRestart=on-failure\nRestartSec=3\n\n[Install]\nWantedBy=default.target\n`;
}

function run(command, args, { execute = spawnSync, ...options } = {}) {
  const result = execute(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}.`);
  return result;
}

function writeAtomic(filename, contents, mode) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporary, contents, { mode });
    fs.renameSync(temporary, filename);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export function setup({ env = process.env, platform = process.platform, execute = spawnSync } = {}) {
  requireTaskPlatform('code-server:setup', ['linux'], platform, env);
  const home = env.HOME || os.homedir();
  const prefix = path.join(home, '.local');
  const binary = path.join(prefix, 'bin', 'code-server');
  const unitDir = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'systemd', 'user');
  const unitPath = path.join(unitDir, 'code-server.service');
  const configPath = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'code-server', 'config.yaml');

  if (!fs.existsSync(binary)) {
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-server-install-'));
    const installer = path.join(installDir, 'install.sh');
    try {
      run('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '120', installUrl, '--output', installer], { execute });
      run('sh', [installer, '--method', 'standalone', '--prefix', prefix], { execute });
    } finally {
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  }
  if (!fs.existsSync(binary) || !fs.statSync(binary).isFile()) {
    throw new Error(`Official installer did not create ${binary}.`);
  }
  if (!fs.existsSync(configPath)) fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const previousConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const configMode = fs.existsSync(configPath) ? fs.statSync(configPath).mode & 0o777 : 0o600;
  const config = normalizeConfig(previousConfig);
  if (config !== previousConfig) writeAtomic(configPath, config, configMode);

  const unit = renderUnit(binary, home);
  const previousUnit = fs.existsSync(unitPath) ? fs.readFileSync(unitPath, 'utf8') : '';
  if (unit !== previousUnit) writeAtomic(unitPath, unit, 0o644);

  run('systemctl', ['--user', 'daemon-reload'], { execute });
  run('systemctl', ['--user', 'enable', 'code-server.service'], { execute });
  run('systemctl', ['--user', 'restart', 'code-server.service'], { execute });
  console.log('code-server is enabled and restarted at http://127.0.0.1:8080 (authentication disabled; localhost only).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    setup();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
