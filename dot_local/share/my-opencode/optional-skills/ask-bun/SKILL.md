---
name: ask-bun
description: Ask Bun documentation questions. Use for guidance on its runtime, APIs, package manager, bundler, and test runner.
---

# Ask Bun

Requires Python 3.10+ and internet access; no third-party Python packages needed.
Questions are sent to the public Bun documentation AI service.

Resolve `scripts/ask_bun.py` relative to this `SKILL.md`, then run:

```bash
python3 "<skill-directory>/scripts/ask_bun.py" "YOUR QUESTION"
```

Supply just the question; relevant documentation is found automatically.
Return the answer with any source links. Report request failures rather than
inventing an answer. Hide raw stream events unless debugging is requested.
