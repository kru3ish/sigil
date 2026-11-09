---
description: Show the Sigil status for this session (linked task, spend so far, coach state)
allowed-tools: Bash(node *)
---

Sigil status for this session:

```!
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" status --plain --plugin
```

Summarize the status above for the user in two or three lines. If there is no linked task, suggest `/sigil:task <url|path|text>`.
