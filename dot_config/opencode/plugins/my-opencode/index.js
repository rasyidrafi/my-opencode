import { readMediaTool } from './read-media.js';

// Runtime tool registration only; agent policy stays in chezmoi-managed files.
// Agent configuration (mode, prompts, permissions, models, default agent) is
// applied by `chezmoi apply` through the native OpenCode agent files and
// opencode.json, so the plugin must not transform agents at runtime.
export async function setupToolTransform(ctx) {
  await ctx.tool.transform(editor => {
    editor.remove('opencode_worktree_remove');
    editor.add(readMediaTool(ctx));
  });
}

export default {
  id: 'local.my-opencode',
  async setup(ctx) {
    await setupToolTransform(ctx);
  },
};
