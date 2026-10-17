import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const home = os.homedir();
const windows = process.platform === 'win32';
const bwEnv = { ...process.env };
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;

function bw(args, interactive = false) {
  const result = spawnSync('bw', args, {
    env: bwEnv,
    encoding: 'utf8',
    stdio: interactive ? 'inherit' : ['inherit', 'pipe', 'inherit'],
    // Allow human input without a deadline; bound network operations.
    timeout: interactive || args[0] === 'unlock' ? undefined : 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    // Do not include captured output: it may contain credentials.
    throw new Error(`bw ${args[0]} failed. Check connectivity/login and retry.`);
  }
  return result.stdout ?? '';
}

function privateWrite(target, content) {
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new Error(`Refusing to overwrite a symbolic link: ${target}`);
  }
  if (!windows && fs.existsSync(target)) fs.chmodSync(target, 0o600);
  fs.writeFileSync(target, content, { mode: 0o600 });
  if (!windows) fs.chmodSync(target, 0o600);
}

function restrictDirectory() {
  if (windows) {
    // Restrict the generated directory to this Windows account, using its SID.
    const script = `
      $ErrorActionPreference = 'Stop'
      $target = [Console]::In.ReadToEnd()
      $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
      $acl = New-Object System.Security.AccessControl.DirectorySecurity
      $acl.SetOwner($sid)
      $acl.SetAccessRuleProtection($true, $false)
      $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
      $acl.AddAccessRule($rule)
      Set-Acl -LiteralPath $target -AclObject $acl
    `;
    powershell(script, path.join(directory, 'generated'));
  } else {
    fs.chmodSync(path.join(directory, 'generated'), 0o700);
  }
}

function powershell(script, input) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Windows environment/permission update failed; no secret output was printed.');
  }
}

function installShellLoader() {
  const loader = path.join(directory, 'generated', 'env.sh');
  const line = `[ ! -r ${shellQuote(loader)} ] || . ${shellQuote(loader)}`;
  const marker = '# Managed secrets loader (chezmoi secrets helper)';
  const profiles = ['.profile', '.bashrc', '.zshrc', '.zprofile'];
  // Bash ignores .profile when one of these exists.
  for (const name of ['.bash_profile', '.bash_login']) {
    if (fs.existsSync(path.join(home, name))) profiles.push(name);
  }
  if (process.env.ZDOTDIR && path.resolve(process.env.ZDOTDIR) !== home) {
    console.warn('Custom ZDOTDIR detected: source generated/env.sh from your custom zsh profile.');
  }
  for (const name of profiles) {
    const target = path.join(home, name);
    const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (!previous.split(/\r?\n/).includes(line)) {
      fs.appendFileSync(target, `\n${marker}\n${line}\n`, { mode: 0o600 });
    }
  }
}

function validate(manifest) {
  if (manifest.version !== 1 || !Array.isArray(manifest.secrets)) throw new Error('Invalid manifest version or secrets list.');
  const names = new Set();
  for (const entry of manifest.secrets) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(entry.name) || names.has(entry.name)) throw new Error('Secret names must be unique uppercase environment identifiers.');
    if (entry.name.startsWith('BW_') || ['PATH', 'HOME', 'SHELL', 'NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH'].includes(entry.name)) throw new Error(`Reserved secret name: ${entry.name}`);
    if (typeof entry.item !== 'string' || !entry.item || typeof entry.field !== 'string') throw new Error(`Missing item/field for ${entry.name}.`);
    if (!['login.password', 'login.username', 'notes'].includes(entry.field) && !/^custom:.+/.test(entry.field)) throw new Error(`Unsupported field for ${entry.name}.`);
    if (!['env', 'file'].includes(entry.output)) throw new Error(`Unsupported output for ${entry.name}.`);
    names.add(entry.name);
  }
}

function extract(item, field) {
  if (field.startsWith('custom:')) return item.fields?.find(f => f.name === field.slice(7))?.value;
  return field.split('.').reduce((value, key) => value?.[key], item);
}

function main() {
  if (!windows && process.platform !== 'linux') throw new Error('This helper currently supports Windows and Linux.');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  validate(manifest);
  if (process.argv.includes('--check')) {
    console.log(`Manifest valid: ${manifest.secrets.length} secret reference(s). No vault access or changes.`);
    return;
  }
  if (!process.stdin.isTTY) throw new Error('Run interactively: mise run secrets:setup (a real terminal is required).');

  let lockRequired = false;
  try {
    let status = JSON.parse(bw(['status'])).status;
    lockRequired = true;
    if (status === 'unauthenticated') {
      bw(['login'], true);
      status = 'locked';
    }
    if (status !== 'unlocked') {
      bwEnv.BW_SESSION = bw(['unlock', '--raw']).trim();
      if (!bwEnv.BW_SESSION) throw new Error('Bitwarden did not return a session.');
    }
    bw(['sync']);

    // Fetch and validate everything before writing any secrets.
    const items = new Map();
    const resolved = manifest.secrets.map(entry => {
      if (!items.has(entry.item)) items.set(entry.item, JSON.parse(bw(['get', 'item', entry.item])));
      const value = extract(items.get(entry.item), entry.field);
      if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error(`Missing or invalid value for ${entry.name}.`);
      return { ...entry, value };
    });

    const generated = path.join(directory, 'generated');
    if (fs.existsSync(generated) && fs.lstatSync(generated).isSymbolicLink()) {
      throw new Error('Refusing to write secrets into a symbolic link directory.');
    }
    fs.mkdirSync(generated, { recursive: true, mode: 0o700 });
    restrictDirectory();
    const environment = Object.fromEntries(resolved.filter(e => e.output === 'env').map(e => [e.name, e.value]));
    if (windows) {
      // Send values over stdin, never command-line arguments or printed output.
      powershell(`
        $ErrorActionPreference = 'Stop'
        $values = [Console]::In.ReadToEnd() | ConvertFrom-Json
        foreach ($property in $values.PSObject.Properties) {
          [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'User')
        }
      `, JSON.stringify(environment));
    } else {
      privateWrite(path.join(generated, 'env.sh'), '# Generated locally. Do not commit.\n' +
        Object.entries(environment).map(([name, value]) => `export ${name}=${shellQuote(value)}\n`).join(''));
      installShellLoader();
    }
    for (const entry of resolved.filter(e => e.output === 'file')) {
      privateWrite(path.join(generated, entry.name), entry.value);
    }
    console.log(`Installed ${resolved.length} secret(s); values hidden.`);
    console.log(windows
      ? 'User ENV saved. Restart applications; sign out/in if their launcher still has the old environment.'
      : 'ENV loader installed for bash/zsh. Open a new terminal or SSH login. Services need their own environment configuration.');
  } finally {
    if (lockRequired) {
      try { bw(['lock']); console.log('Bitwarden locked.'); }
      catch { console.error('Could not lock Bitwarden. Run bw lock manually.'); process.exitCode = 1; }
    }
    delete bwEnv.BW_SESSION;
  }
}

try { main(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
