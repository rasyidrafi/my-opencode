{{- /* chezmoi:modify-template */ -}}
{{- $policy := includeTemplate "dot_config/opencode/plugins/my-opencode/agent-policy.json" . | mustFromJson -}}
{{- includeTemplate "opencode-agent.tmpl" (dict "policy" $policy "name" "general") -}}
