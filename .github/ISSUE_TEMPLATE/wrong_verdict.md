---
name: Wrong verdict
about: Sigil said VERIFIED, SUPPORTED, UNVERIFIED or UNMET and reality disagreed. A wrong VERIFIED is the most important bug Sigil can have.
title: 'Wrong verdict: '
labels: wrong-verdict
assignees: ''
---

**The sanitized report** (from `sigil feedback wrong <c#> --report`, or paste the `--out bug.json` file; it contains statuses, evidence kinds and counts, never your code, prompts, diff, paths or repository name)

```json
paste here
```

**What was actually true** (your words; no need to paste code)

**Was this a wrong VERIFIED?** yes / no  (if yes, the report already carries the `false-verified` label; that is the class fixed first)

**Anything else** (agent, model, unusual test setup, a monorepo, a red suite at the base commit)

Versions, if not in the report: `sigil --version`, `claude --version`, OS.
