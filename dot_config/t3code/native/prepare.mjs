import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('Source directory required');
// Parse only the simple catalog section of this pinned upstream workspace.
const catalog = {};
const catalogText = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')
  .split('catalog:\n')[1].split('\nminimumReleaseAgeExclude:')[0];
for (const line of catalogText.split('\n')) {
  const match = /^  (?:"([^"]+)"|([\w@/.-]+)): (.+)$/.exec(line);
  if (match) catalog[match[1] || match[2]] = match[3].replace(/^"|"$/g, '');
}
const packages = new Map();
for (const base of ['packages', 'apps']) {
  for (const directory of fs.readdirSync(path.join(root, base))) {
    const dir = path.join(root, base, directory);
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json')));
    packages.set(manifest.name, {manifest, dir});
  }
}
const dependencies = {esbuild: '0.25.12'};
const visited = new Set();
function visit(name) {
  if (visited.has(name)) return;
  visited.add(name);
  const {manifest} = packages.get(name);
  const entries = {...manifest.dependencies};
  // Several source-only workspace imports are marked devDependencies upstream.
  if (name === 't3') {
    for (const [key, value] of Object.entries(manifest.devDependencies || {})) {
      if (value.startsWith('workspace:')) entries[key] = value;
    }
  }
  for (let [key, value] of Object.entries(entries)) {
    if (value.startsWith('workspace:')) {
      if (key !== '@t3tools/web') visit(key); // Native app supplies its own UI.
      continue;
    }
    if (value === 'catalog:') value = catalog[key];
    if (!value || value === 'catalog:') throw new Error('Unresolved dependency: ' + key);
    dependencies[key] = value;
  }
}
visit('t3');
delete dependencies['vite-plus']; // esbuild supplies the native Android bundler.
delete dependencies['@napi-rs/keyring']; // Desktop-only, no server runtime imports.
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
  name: 't3-termux-build', private: true, type: 'module', dependencies,
}, null, 2));
fs.writeFileSync(path.join(root, 'termux-workspaces.json'), JSON.stringify(
  [...visited].map(name => [name, path.relative(root, packages.get(name).dir)]),
));
// The release tag still contains the previous development manifest version.
const serverFile = path.join(root, 'apps/server/package.json');
const server = JSON.parse(fs.readFileSync(serverFile));
server.version = '0.1.7';
fs.writeFileSync(serverFile, JSON.stringify(server, null, 2));
console.log(`${Object.keys(dependencies).length} dependencies; ${visited.size} workspaces`);
