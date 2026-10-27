// V2 model transforms run whenever the catalog is rebuilt, including refreshes.
// Do not enable allowed models: other provider/auth restrictions still apply.
export const allowedModels = new Set([
  'gpt-6.1-terra',
  'gpt-6.1-sol',
  'gpt-6-luna',
  'gpt-6-luna-fast',
  'gpt-6-astra',
]);

export default {
  id: 'local.openai-allowlist',
  async setup(ctx) {
    await ctx.model.transform(models => {
      for (const model of models.list('openai')) {
        if (allowedModels.has(model.id)) continue;
        models.update(model.providerID, model.id, draft => {
          draft.enabled = false;
        });
      }
    });
  },
};
