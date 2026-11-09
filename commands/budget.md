---
description: The task's budget (from comparable past tasks, a cap, or repo policy); set a cap; lift a hard stop
argument-hint: [set <usd> | approve] [reason]
allowed-tools: Bash(node *)
---

Show the budget and any hard stop:

```!
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" budget status
```

- If the user named a cap ("cap this at $40", `/tally:budget set 40`), run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" budget set <usd> --note "<their words>"` with the Bash tool and confirm the number Tally reports (a repo policy budget is a ceiling it cannot raise).
- If a hard stop is active, ask the user to confirm they want to continue past the repo policy budget; if they confirm, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" budget approve --note "$ARGUMENTS"` and tell them tool calls are allowed again.
- If the status says there is no budget because no comparable past task priced this one, ask the user for a cap in one line and set it.
