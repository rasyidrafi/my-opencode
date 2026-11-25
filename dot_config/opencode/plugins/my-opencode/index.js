import { readMediaTool } from './read-media.js';

export default {
  id: 'local.my-opencode',
  async setup(ctx) {
    await ctx.tool.transform(editor => {
      editor.remove('opencode_worktree_remove');
      editor.add(readMediaTool(ctx));
    });
  },
};
