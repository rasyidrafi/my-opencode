import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { centralized } from '../shell/integration.mjs';

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

function authenticateGitHub(token) {
  const env = { ...process.env };
  // Environment tokens override stored credentials and prevent gh auth login.
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  for (const args of [
    ['auth', 'login', '--hostname', 'github.com', '--with-token'],
    ['auth', 'status', '--hostname', 'github.com'],
    ['auth', 'setup-git', '--hostname', 'github.com'],
  ]) {
    const result = spawnSync('gh', args, {
      env, input: args[1] === 'login' ? `${token}\n` : undefined,
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`GitHub CLI ${args[1]} failed. Check gh installation, token permissions and connectivity; secret output hidden.`);
    }
  }
  // Migrate the previous Windows environment-based GitHub configuration.
  if (windows) {
    powershell("[Environment]::SetEnvironmentVariable('GH_TOKEN', $null, 'User')", '', 'GitHub environment cleanup');
  }
  console.log('GitHub CLI authenticated for github.com; Git configured to use its credentials for HTTPS.');
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    console.warn('Your shell already has GH_TOKEN/GITHUB_TOKEN set; unset it to use the saved GitHub login.');
  }
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
      # Read/change only the DACL. A fresh descriptor can request owner/audit
      # changes and fail with SeSecurityPrivilege on an existing directory.
      $acl = [System.IO.Directory]::GetAccessControl($target, [System.Security.AccessControl.AccessControlSections]::Access)
      $acl.SetAccessRuleProtection($true, $false)
      foreach ($existingRule in @($acl.Access)) {
        $acl.RemoveAccessRuleSpecific($existingRule)
      }
      $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
      $acl.AddAccessRule($rule)
      [System.IO.Directory]::SetAccessControl($target, $acl)
    `;
    powershell(script, path.join(directory, 'generated'), 'directory permissions');
  } else {
    fs.chmodSync(path.join(directory, 'generated'), 0o700);
  }
}

function powershell(script, input, operation = 'user environment') {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.code ?? `exit ${result.status}`;
    throw new Error(`Windows ${operation} update failed (${reason}); no secret output was printed.`);
  }
}

export function installShellLoader(homeDirectory = home, secretsDirectory = directory, zdotdir = process.env.ZDOTDIR) {
  const loader = path.join(secretsDirectory, 'load.sh');
  const line = `[ ! -r ${shellQuote(loader)} ] || . ${shellQuote(loader)}`;
  const marker = '# Managed secrets loader (chezmoi secrets helper)';
  const profiles = centralized(homeDirectory) ? ['.zshrc', '.zprofile'] : ['.profile', '.bashrc', '.zshrc', '.zprofile'];
  // Bash ignores .profile when one of these exists.
  for (const name of ['.bash_profile', '.bash_login']) {
    if (!centralized(homeDirectory) && fs.existsSync(path.join(homeDirectory, name))) profiles.push(name);
  }
  if (zdotdir && path.resolve(zdotdir) !== homeDirectory) {
    console.warn('Custom ZDOTDIR detected: source ~/.config/secrets/load.sh from your custom zsh profile.');
  }
  for (const name of profiles) {
    const target = path.join(homeDirectory, name);
    const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (!previous.split(/\r?\n/).includes(line)) {
      fs.appendFileSync(target, `\n${marker}\n${line}\n`, { mode: 0o600 });
    }
  }
}

export function renderEnvironment(environment) {
  return '# Generated locally. Do not commit. Caller-provided values take precedence.\n' +
    Object.entries(environment).map(([name, value]) => {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) throw new Error('Invalid environment identifier.');
      return `if [ "\${${name}+x}" != x ]; then export ${name}=${shellQuote(value)}; fi\n`;
    }).join('');
}

// Fish twin of renderEnvironment: same caller-precedence semantics, because
// set -q also holds for empty values, and Fish single-quote escaping.
const fishQuote = value => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
export function renderEnvironmentFish(environment) {
  return '# Generated locally. Do not commit. Caller-provided values take precedence.\n' +
    Object.entries(environment).map(([name, value]) => {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) throw new Error('Invalid environment identifier.');
      return `if not set -q ${name}; set -gx ${name} ${fishQuote(value)}; end\n`;
    }).join('');
}

function validate(manifest) {
  if (manifest.version !== 1 || !Array.isArray(manifest.secrets)) throw new Error('Invalid manifest version or secrets list.');
  const names = new Set();
  for (const entry of manifest.secrets) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(entry.name) || names.has(entry.name)) throw new Error('Secret names must be unique uppercase environment identifiers.');
    if (entry.name.startsWith('BW_') || ['PATH', 'HOME', 'SHELL', 'NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH'].includes(entry.name)) throw new Error(`Reserved secret name: ${entry.name}`);
    if (typeof entry.item !== 'string' || !entry.item || typeof entry.field !== 'string') throw new Error(`Missing item/field for ${entry.name}.`);
    if (!['login.password', 'login.username', 'notes'].includes(entry.field) && !/^custom:.+/.test(entry.field)) throw new Error(`Unsupported field for ${entry.name}.`);
    if (!['env', 'file', 'gh-auth'].includes(entry.output)) throw new Error(`Unsupported output for ${entry.name}.`);
    if (entry.output === 'gh-auth' && entry.name !== 'GH_TOKEN') throw new Error('gh-auth output requires the name GH_TOKEN.');
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
      privateWrite(path.join(generated, 'env.sh'), renderEnvironment(environment));
      privateWrite(path.join(generated, 'env.fish'), renderEnvironmentFish(environment));
      privateWrite(path.join(generated, 'names'), Object.keys(environment).map(name => `${name}\n`).join(''));
      installShellLoader();
    }
    for (const entry of resolved.filter(e => e.output === 'file')) {
      privateWrite(path.join(generated, entry.name), entry.value);
    }
    for (const entry of resolved.filter(e => e.output === 'gh-auth')) {
      authenticateGitHub(entry.value);
    }
    console.log(`Installed ${resolved.length} secret(s); values hidden.`);
    console.log(windows
      ? 'Other secrets: user ENV saved. Restart applications; sign out/in if their launcher still has the old environment.'
      : 'Other secrets: ENV loader installed for bash/zsh, plus env.fish for the Fish loader from shell:setup. Open a new terminal or SSH login. Services need their own environment configuration.');
  } finally {
    if (lockRequired) {
      try { bw(['lock']); console.log('Bitwarden locked.'); }
      catch { console.error('Could not lock Bitwarden. Run bw lock manually.'); process.exitCode = 1; }
    }
    delete bwEnv.BW_SESSION;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
