import { setupAgentTransform } from './agents.js';

export async function setupToolTransform(ctx) {
  await ctx.tool.transform(editor => {
    editor.remove('opencode_worktree_remove');
  });
}

export default {
  id: 'local.my-opencode',
  async setup(ctx) {
    await setupAgentTransform(ctx);
    await setupToolTransform(ctx);
  },
};
