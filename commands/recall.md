---
description: What past sessions in this repo already produced for a task like this (local, no model call)
argument-hint: [query | session-prefix]
allowed-tools: Bash(node *)
---

Run with the Bash tool and show the user the result:

```!
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" recall $ARGUMENTS
```

If a card matches the current task, read its outcome and files before doing new work, and say what you reused. Do not re-derive something the card already answers.
