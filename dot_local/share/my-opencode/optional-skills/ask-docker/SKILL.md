---
name: ask-docker
description: Ask Docker documentation questions. Use for guidance on containers, images, builds, Compose, and other Docker products.
---

# Ask Docker

Requires Python 3.10+ and internet access; no third-party Python packages needed.
Questions are sent to the public Docker documentation AI service.

Resolve `scripts/ask_docker.py` relative to this `SKILL.md`, then run:

```bash
python3 "<skill-directory>/scripts/ask_docker.py" "YOUR QUESTION"
```

Supply just the question; relevant documentation is found automatically.
Return the answer with any source links. Report request failures rather than
inventing an answer. Hide raw stream events unless debugging is requested.
