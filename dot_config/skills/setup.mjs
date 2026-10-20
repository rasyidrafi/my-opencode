import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const defaultCatalog = home => path.join(home, '.local/share/my-opencode/optional-skills');
const validName = name => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);

function stat(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function catalogSkills(catalog) {
  if (!stat(catalog)?.isDirectory()) throw new Error(`Skill catalog missing: ${catalog}. Run chezmoi apply first.`);
  return fs.readdirSync(catalog).filter(name => validName(name)
    && stat(path.join(catalog, name))?.isDirectory()
    && stat(path.join(catalog, name, 'SKILL.md'))?.isFile()).sort();
}

export function options(argv) {
  const result = { names: [], command: 'install' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (i === 0 && ['install', 'list'].includes(arg)) result.command = arg;
    else if (arg === '--global') {
      if (result.scope) throw new Error('Choose exactly one scope.');
      result.scope = 'global';
    } else if (arg === '--project') {
      if (result.scope || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--project requires a directory and cannot be combined with --global.');
      result.scope = 'project';
      result.project = argv[++i];
    } else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--help') result.help = true;
    else if (validName(arg)) result.names.push(arg);
    else throw new Error(`Unknown option or invalid skill name: ${arg}`);
  }
  return result;
}

// Only the explicitly selected project/home root may itself resolve through a
// symlink. Refuse redirected .agents/skills paths and conflicting destinations.
function safeDirectories(root, destination) {
  let current = root;
  for (const part of path.relative(root, destination).split(path.sep)) {
    current = path.join(current, part);
    const entry = stat(current);
    if (entry && !entry.isDirectory()) throw new Error(`Refusing non-directory or symlink: ${current}`);
  }
}

export function planInstall({ names, scope, project, home = os.homedir(), catalog = defaultCatalog(home), cwd = process.cwd() }) {
  if (!['global', 'project'].includes(scope)) throw new Error('Select --global or --project DIRECTORY.');
  if (!names.length) throw new Error('Select at least one skill.');
  const available = catalogSkills(catalog);
  for (const name of names) if (!available.includes(name)) throw new Error(`Unknown skill: ${name}`);
  if (scope === 'project' && !project) throw new Error('Project directory is required.');
  const root = fs.realpathSync(scope === 'global' ? home : path.resolve(cwd, project));
  if (!fs.statSync(root).isDirectory()) throw new Error(`Not a directory: ${root}`);
  const destination = path.join(root, '.agents/skills');
  safeDirectories(root, destination);
  const links = [...new Set(names)].map(name => {
    const source = fs.realpathSync(path.join(catalog, name));
    const target = path.join(destination, name);
    const entry = stat(target);
    if (entry && (!entry.isSymbolicLink() || path.resolve(path.dirname(target), fs.readlinkSync(target)) !== source)) {
      throw new Error(`Refusing to replace existing path: ${target}`);
    }
    return { source, target, exists: Boolean(entry) };
  });
  return { root, destination, links };
}

export function applyPlan(plan, { dryRun = false } = {}) {
  if (dryRun) return;
  safeDirectories(plan.root, plan.destination);
  fs.mkdirSync(plan.destination, { recursive: true });
  const created = [];
  try {
    for (const link of plan.links) {
      if (link.exists) continue;
      fs.symlinkSync(link.source, link.target, 'dir');
      created.push(link);
    }
  } catch (error) {
    // Roll back only links created by this invocation and still owned by it.
    for (const link of created.reverse()) {
      if (stat(link.target)?.isSymbolicLink() && fs.readlinkSync(link.target) === link.source) fs.unlinkSync(link.target);
    }
    throw error;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = options(argv);
  if (args.help) {
    console.log('Usage: skills:install [SKILL ...] [--global | --project DIRECTORY] [--dry-run]\nWithout complete arguments, prompts on a terminal. Use skills:list to list skills.');
    return;
  }
  const catalog = defaultCatalog(os.homedir());
  const available = catalogSkills(catalog);
  if (args.command === 'list') { console.log(available.join('\n')); return; }
  let prompt;
  try {
    const interactive = !args.names.length || !args.scope;
    if (interactive) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Noninteractive use requires skill names and --global or --project DIRECTORY.');
      prompt = createInterface({ input: process.stdin, output: process.stdout });
      if (!args.names.length) {
        console.log(available.map((name, i) => `${i + 1}. ${name}`).join('\n'));
        const answer = await prompt.question('Select skills (names or numbers, comma/space separated): ');
        args.names = answer.trim().split(/[\s,]+/).filter(Boolean).map(value => /^\d+$/.test(value) ? available[Number(value) - 1] ?? value : value);
      }
      if (!args.scope) {
        const scope = (await prompt.question('Scope: project or global? [project]: ')).trim().toLowerCase();
        if (!['', 'project', 'global'].includes(scope)) throw new Error('Invalid scope.');
        args.scope = scope || 'project';
        if (args.scope === 'project') {
          // mise can execute global tasks from the config directory. Never
          // mistake that directory for the original invoking project.
          const caller = process.env.MISE_ORIGINAL_CWD;
          args.project = (await prompt.question(`Project directory${caller ? ` [${caller}]` : ' (required)'}: `)).trim() || caller;
        }
      }
    }
    const plan = planInstall({ ...args, catalog, cwd: process.env.MISE_ORIGINAL_CWD || process.cwd() });
    for (const link of plan.links) console.log(`${link.exists ? 'Already linked' : args.dryRun ? 'Would link' : 'Link'}: ${link.target} -> ${link.source}`);
    if (interactive && !args.dryRun && (await prompt.question('Create these links? [y/N]: ')).trim().toLowerCase() !== 'y') {
      console.log('Cancelled.');
      return;
    }
    applyPlan(plan, args);
    if (args.scope === 'project') console.log('Local absolute symlinks should not be committed. Optionally add their paths to this project’s .git/info/exclude.');
  } finally { prompt?.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`skills: ${error.message}`); process.exitCode = 1; });
}
