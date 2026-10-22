{{- /* chezmoi:modify-template */ -}}
{{- includeTemplate "opencode-agent.tmpl" (dict "existing" .chezmoi.stdin "defaults" (includeTemplate "opencode-agents/reviewer.md" .)) -}}
