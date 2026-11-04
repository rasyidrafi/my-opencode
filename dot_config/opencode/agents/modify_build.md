{{- /* chezmoi:modify-template */ -}}
{{- includeTemplate "opencode-agent.tmpl" (dict "defaults" (includeTemplate "opencode-agents/build.md" .)) -}}
