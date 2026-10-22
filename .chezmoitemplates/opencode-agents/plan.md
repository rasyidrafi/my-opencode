---
permissions:
  - action: "*"
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: allow
  - action: edit
    resource: "*"
    effect: deny
  - action: read
    resource: "*"
    effect: deny
  - action: glob
    resource: "*"
    effect: deny
  - action: grep
    resource: "*"
    effect: deny
  - action: patch
    resource: "*"
    effect: deny
  - action: webfetch
    resource: "*"
    effect: deny
  - action: websearch
    resource: "*"
    effect: deny
  - action: skill
    resource: "*"
    effect: allow
  - action: subagent
    resource: "*"
    effect: allow
  - action: question
    resource: "*"
    effect: deny
  - action: external_directory
    resource: "*"
    effect: allow
  - action: openchamber
    resource: "*"
    effect: deny
  - action: openchamber_web
    resource: "*"
    effect: deny
  - action: openchamber_memory
    resource: "*"
    effect: deny
  - action: openchamber_knowledge
    resource: "*"
    effect: deny
  - action: openchamber_notify
    resource: "*"
    effect: deny
  - action: openchamber_render
    resource: "*"
    effect: deny
---
