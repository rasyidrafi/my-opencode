import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export const tailnet = 'qilin-elver.ts.net';
export const account = 'muhammand.rafi25@gmail.com';
const normalize = value => String(value ?? '').toLowerCase().replace(/\.$/, '');
const onTarget = status => normalize(status.CurrentTailnet?.MagicDNSSuffix || status.MagicDNSSuffix) === tailnet;
const connected = status => onTarget(status) && status.BackendState === 'Running';
const psQuote = value => `'${value.replaceAll("'", "''")}'`;
const encode = script => Buffer.from(script, 'utf16le').toString('base64');

// Keep the decision flow independent of OS commands so account transitions can
// be verified without changing a developer's real Tailscale connection.
export async function setup(io) {
  let status = io.status();
  if (connected(status)) return io.log(`Done: connected to ${tailnet}.`);
  io.requireTerminal();
  io.log(`Target: ${tailnet}. Complete browser login with ${account} if prompted.`);
  io.log('Other saved accounts are preserved; switching changes the active connection.');

  if (onTarget(status)) {
    io.change(['up']);
  } else {
    const profiles = io.profiles();
    const profile = profiles.find(p => normalize(p.tailnet) === tailnet)
      ?? profiles.find(p => p.account === account && p.tailnet === account);
    if (profile) {
      io.change(['switch', profile.id]);
      status = io.status();
      if (status.BackendState !== 'Running') io.change(['up']);
      status = io.status();
    }
    if (!onTarget(status)) {
      // login adds/selects an account, unlike logout or up --force-reauth.
      // The CLI has no email-selection flag; identity is chosen in the browser.
      io.change(['login']);
    }
  }

  for (let attempt = 0; attempt < 30; attempt++) {
    status = io.status();
    if (connected(status)) return io.log(`Done: connected to ${tailnet}.`);
    if (status.BackendState === 'Running' && !onTarget(status)) {
      throw new Error(`Connected to a different tailnet. Run setup again and select ${account} / ${tailnet} in the browser.`);
    }
    await io.wait(1000);
  }
  throw new Error(`Not connected to ${tailnet} (state: ${status.BackendState}). Check Tailscale connectivity or pending device approval, then retry.`);
}

function runtime() {
  const windows = process.platform === 'win32';
  if (!windows && process.platform !== 'linux') throw new Error('This helper supports Windows and Linux only.');
  const candidates = ['tailscale'];
  if (windows) {
    for (const root of [process.env.ProgramFiles, process.env['ProgramW6432'], process.env['ProgramFiles(x86)']]) {
      if (root) candidates.push(path.join(root, 'Tailscale', 'tailscale.exe'));
    }
  } else {
    candidates.push('/usr/bin/tailscale', '/usr/local/bin/tailscale');
  }
  let executable;
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['version'], { encoding: 'utf8', timeout: 15_000 });
    if (result.error?.code === 'ENOENT') continue;
    if (result.error || result.status !== 0) throw new Error('Tailscale was found but could not run. Repair the installation and retry.');
    executable = candidate;
    break;
  }
  if (!executable) throw new Error('Tailscale is not installed or not on PATH. Install Tailscale first: https://tailscale.com/download');

  function json(args) {
    const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 30_000 });
    if (result.error || result.status !== 0) {
      throw new Error(`tailscale ${args[0]} failed. Ensure the Tailscale service is running and accessible.\n${result.stderr?.trim() || result.error?.message || ''}`);
    }
    try { return JSON.parse(result.stdout); }
    catch { throw new Error(`Invalid JSON from tailscale ${args[0]}. Update Tailscale and retry.`); }
  }

  function change(args) {
    let result;
    if (windows) {
      // Resolve the executable before elevation, which may have a different PATH.
      const invocation = `& ${psQuote(executable)} ${args.map(psQuote).join(' ')}`;
      const child = `$ErrorActionPreference = 'Stop'
        try {
          Write-Host ${psQuote(`Tailscale setup: login with ${account}, select ${tailnet}.`)}
          ${invocation}
          $code = $LASTEXITCODE
          if ($code -ne 0) { Read-Host 'Tailscale failed. Press Enter to close' }
          exit $code
        } catch { Write-Host $_; Read-Host 'Press Enter to close'; exit 1 }`;
      const script = `$ErrorActionPreference = 'Stop'
        try {
          $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
          if ($admin) { ${invocation}; exit $LASTEXITCODE }
          $process = Start-Process -FilePath "$PSHOME\\powershell.exe" -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile -EncodedCommand ${encode(child)}'
          exit $process.ExitCode
        } catch { Write-Error $_; exit 1 }`;
      console.log('Approve the Windows UAC prompt if shown; the login link appears in the Administrator window.');
      result = spawnSync('powershell.exe', ['-NoProfile', '-EncodedCommand', encode(script)], { stdio: 'inherit' });
    } else {
      result = process.getuid() === 0
        ? spawnSync(executable, args, { stdio: 'inherit' })
        : spawnSync('sudo', ['--', executable, ...args], { stdio: 'inherit' });
    }
    if (result.error || result.status !== 0) {
      throw new Error(`tailscale ${args[0]} failed or elevation/login was cancelled.${result.error ? ` ${result.error.message}` : ''}`);
    }
  }

  // Use an absolute executable for sudo/UAC, avoiding their different PATHs.
  if (executable === 'tailscale') {
    const resolved = windows
      ? spawnSync('where.exe', ['tailscale.exe'], { encoding: 'utf8' })
      : spawnSync('sh', ['-c', 'command -v tailscale'], { encoding: 'utf8' });
    const location = resolved.stdout?.trim().split(/\r?\n/)[0];
    if (resolved.status !== 0 || !location || !path.isAbsolute(location) || !fs.existsSync(location)) {
      throw new Error('Could not resolve the Tailscale executable. Check PATH and retry.');
    }
    executable = location;
  }
  return {
    status: () => json(['status', '--json', '--peers=false']),
    profiles: () => {
      const profiles = json(['switch', '--list', '--json']);
      if (!Array.isArray(profiles) || profiles.some(p => typeof p.id !== 'string' || !p.id)) {
        throw new Error('Unexpected saved-account format. Update Tailscale and retry.');
      }
      return profiles;
    },
    change,
    requireTerminal: () => {
      if (!process.stdin.isTTY) throw new Error('Run interactively: mise run tailscale:setup (a real terminal is required).');
    },
    log: console.log,
    wait: delay,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await setup(runtime()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
