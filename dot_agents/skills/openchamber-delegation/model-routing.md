# Provisional model routing

These are starting points, not measured rankings or enforced configuration. Check available models when needed, honor the user's explicit choice, and adjust based on observed quality, latency, cost, and task requirements. Aliases may change backend models. Do not invent a fallback if a requested model is unavailable.

| Task | Candidate | Reason and limitation |
| --- | --- | --- |
| Focused discovery, inventory, or summarization | `rawroute/gpt-base` | Starting point for bounded work; escalate when evidence shows it is insufficient. |
| Typical implementation or debugging | `rawroute/gpt-core` | General starting point, not a proven quality or cost ranking. |
| Difficult review, design, or stalled debugging | `rawroute/gpt-peak` | Reserve for demanding work; measure whether the additional cost or latency is justified. |

Current RawRoute model metadata exposes no selectable variants. Omit `variant` unless the user requests one and it is actually available.
