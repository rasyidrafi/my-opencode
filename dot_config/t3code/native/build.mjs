import fs from 'node:fs';
import path from 'node:path';
const {build}=await import(process.argv[2]+'/node_modules/esbuild/lib/main.js');
const root=process.argv[2];
if (!root) throw new Error('Source directory required');
for (const [name, relativeDir] of JSON.parse(fs.readFileSync(root + '/termux-workspaces.json'))) {
  const target = path.join(root, 'node_modules', name);
  const source = path.join(root, relativeDir);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  try {
    if (fs.lstatSync(target).isSymbolicLink()) fs.unlinkSync(target);
    else throw new Error('Unexpected existing workspace package: ' + target);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  fs.symlinkSync(source, target);
}
const external=['@cursor/sdk','playwright-core','node-pty','ffi-rs','@yuuang/*','@ff-labs/*','@napi-rs/keyring','@clerk/electron-passkeys','node-gyp-build','node-addon-api','bufferutil','utf-8-validate','@bufbuild/protobuf','@connectrpc/*','@statsig/*','zod','undici','@fastify/busboy'];
const define={__T3CODE_BUILD_CHANNEL__:'"latest"',__T3CODE_TELEMETRY_CHANNEL__:'"dev"'};
for(const key of ['RELAY_URL','CLERK_PUBLISHABLE_KEY','CLERK_CLI_OAUTH_CLIENT_ID']) {
 const match=fs.readFileSync(root+'/.env.example','utf8').match(new RegExp('^T3CODE_'+key+'=(.+)$','m'));
 if(!match)throw new Error('Missing public T3 configuration: '+key);
 define['__T3CODE_BUILD_'+key+'__']=JSON.stringify(match[1].trim());
}
await build({entryPoints:['apps/server/src/bin.ts','apps/server/src/claude-history-worker.ts'],absWorkingDir:root,outdir:'apps/server/dist',outExtension:{'.js':'.mjs'},bundle:true,platform:'node',format:'esm',target:'node26',external,banner:{js:'import { createRequire as __t3CreateRequire } from "node:module"; const require = __t3CreateRequire(import.meta.url);'},loader:{'.html':'text','.svg':'text'},define,logLevel:'info'});
