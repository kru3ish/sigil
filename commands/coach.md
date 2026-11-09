---
description: What Sigil Coach is waiting on you for in this session, numbered; `/sigil:coach apply 2` acts on one
argument-hint: [apply <n> | inject <n>]
allowed-tools: Bash(node *)
---

```!
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" coach --once --plain --plugin --from-args "$ARGUMENTS"
```

Show the "Waiting for you" items above to the user as a short numbered list: the title, what it saves, and the one-line "if you say yes" consequence. Do not paste the raw output. If the user answers with a number or "apply <n>", run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" coach --apply <n>` and report the one-line result. Everything listed is the user's decision; never apply without their answer.
