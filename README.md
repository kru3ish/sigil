# Sigil

**Know what a story will cost before the agent starts. When it's done, see what it actually cost, why, and the one line that makes the next one cheaper.**

```bash
npm i -g sigil && sigil install      # or in Claude Code:  /plugin marketplace add kru3ish/sigil  then  /plugin install sigil@sigil
sigil estimate --backtest                      # how well it would have priced your own past sessions (no model call, nothing sent)
```

## The loop

**1. Paste the story.** Put the Jira, GitHub or Linear link (or a `.md` file, or plain text) in your first prompt as usual. Sigil reads the ticket and compares it with every session already on your machine. At the end of the first turn you see something like this (the numbers here are illustrative):

```
Sigil: stories like this have cost ~$50.00 here (typical $38.00–$65.00, from 6 similar past stories, medium confidence). $0.42 so far.
```

**2. Work as usual.** The status line keeps the number in front of you: `$31.20 / ~$50.00 est (62%)`.

**3. Go over, and you hear about it in the same session**, at the end of the turn where it happens, not in a report next week:

```
Sigil: this story has cost $75.00, 150% of the ~$50.00 estimate from 6 similar past stories (+$25.00).
Biggest lever: main model claude-opus-5-5 (~$30.00) → sigil fix model-sonnet. Breakdown and fixes: /sigil:cost
```

**4. See where it went.** `/sigil:cost` (or `sigil cost`). This is a real session from the author's machine:

```
Sigil cost check

Story:     read plan.md that is the task
Estimate:  none (no similar past story yet; your median session costs $0.25)
Actual:    $156.52  on claude-opus-5-5

Where it could be cheaper next time (up to $114.60 combined; the lines overlap, so they do not add up):
    $55.08  Main model claude-opus-5-5 (estimate)
            the main loop cost $91.79; the same tokens at Sonnet prices cost $36.72. Sonnet may need more turns, so treat this as the most it could save.
    $51.69  One long conversation
            207 call(s) carried more than 80k tokens of history; re-sending the part above 80k cost $51.69. Part of this is the work itself; a fresh session per sub-task avoids most of it.
    $38.84  Subagents on an expensive model (estimate)
            subagents cost $64.73 (41% of the session); at Sonnet prices $25.89.

Apply for the next similar story (one line each; undo with `sigil undo`):
  sigil fix model-sonnet       Default this repo to Sonnet (sets "model": "sonnet" in .claude/settings.json; use /model opus for a story that needs it)
  ·  Split stories this size: run /clear (or a new session) between sub-tasks, with the plan in a file so nothing is lost; Sigil cannot apply this for you
  sigil fix subagent-sonnet    Run subagents on Sonnet (sets env CLAUDE_CODE_SUBAGENT_MODEL=sonnet in .claude/settings.json, so subagents without their own model stop inheriting the main one (Explore keeps its own default))
```

**5. Apply it in one line,** from the page (every change has a Copy button), in the terminal, or inside the session: `/sigil:cost` lists the changes by number and asks which to apply, and `/sigil:fix <id>` (or `/sigil:fix all`) applies them.

**What it writes.** `sigil fix model-sonnet` edits the repo's `.claude/settings.json`, so committing it gives the whole team the change; `--global` writes `~/.claude/settings.json` instead. `sigil undo` puts the file back byte for byte.

What the cost check can find, each with its dollar figure from the session's own transcript:

| Driver | Fix | Applied by |
|---|---|---|
| Expensive main model (same tokens repriced at Sonnet) | `"model": "sonnet"` in `.claude/settings.json` | `sigil fix model-sonnet` |
| Subagents inheriting an expensive model | `env.CLAUDE_CODE_SUBAGENT_MODEL=sonnet` | `sigil fix subagent-sonnet` |
| Failing commands retried unchanged, files re-read again and again | the working commands and the re-read files written into `CLAUDE.md` | `sigil fix claude-md` |
| MCP servers and plugins loaded but never used | `disabledMcpjsonServers`, or the `claude mcp remove` / `claude plugin disable` commands | `sigil fix drop-unused-mcp` |
| One long conversation, compactions | a fresh session per sub-task | advice only |

And what to **add**, each suggested only when the transcript shows the pattern it fixes (main loop and subagents), with the dollars that pattern cost:

| Pattern in the session | Add | Applied by |
|---|---|---|
| Context ran far past 200k tokens without compacting | `"autoCompactWindow": 200000` | `sigil fix compact-window` |
| Exploration (Read/Grep/Glob before the first edit) on an expensive model | a read-only **Haiku scout subagent**, `.claude/agents/scout.md` | `sigil fix scout` |
| The story had to discover its files and commands | a **project skill** from this session: files involved, commands that worked | `sigil fix story-skill` |
| Test or lint output flooding the context | a **run-tests skill** with the quiet reporter (`--reporter=dot`, `-q`, `--silent`) | `sigil fix run-tests-skill` |
| Command output above 15k characters | `BASH_MAX_OUTPUT_LENGTH=15000` | `sigil fix bash-output-cap` |
| Library docs fetched from the web or read out of `node_modules` | the best docs server in the catalog (today: **Context7**, official plugin) | its install line, printed |
| Large source files read whole | the **language server plugin for the repo's language** (`typescript-lsp`, `pyright-lsp`, `gopls-lsp`…), Serena, lumen | its install line, printed |
| MCP tool results above 10k tokens | `MAX_MCP_OUTPUT_TOKENS=10000` | `sigil fix mcp-output-cap` |
| Output and thinking over 45% of the main loop | `"effortLevel": "medium"` | `sigil fix effort-medium` |

### Already built by others: the catalog

Most of what a session needs already exists. Before suggesting a file of its own, Sigil looks for the best existing plugin, skill, subagent or MCP server for each pattern in a catalog it keeps of:

| Source | What | Trust |
|---|---|---|
| [Anthropic's plugin marketplace](https://github.com/anthropics/claude-plugins-official) | 315 plugins: language servers, Context7, Serena, GitHub, Playwright, Sentry, Supabase, Stripe… | official |
| [Anthropic's skills](https://github.com/anthropics/skills) | skill bundles | official |
| [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code), [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers), [awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) | thousands of community skills, agents, tools and MCP servers | curated lists; GitHub stars shown, under 50 not recommended |

Each pattern is a search with its own terms, personalised to the repo: its languages pick the right language server and push tools for other languages down, its dependencies find official plugins built for its stack (a repo using `playwright-core` is shown the Playwright plugin). Installed tools are skipped. The best official pick replaces Sigil's own suggestion when it does the job; Sigil's setting or generated file stays when nothing in the catalog beats it (nothing beats `autoCompactWindow` for a context that never compacts). Install lines are shown, never run.

```bash
sigil catalog update               # fetch the lists (plain GETs; nothing about you is sent); weekly by itself when online
sigil catalog search pull request review     # code-review, github (official), …
sigil catalog                      # what is cached, and the official plugins for this repo's stack
```

The open MCP registry is not used for ranking: it has no quality signal, and a search for "documentation" there returned vendor-specific servers ahead of Context7. `sigil config cost.catalog_online false` keeps Sigil off the network; the check then uses whatever was cached, or its own suggestions.

On the $156.52 session above, that adds: compacting at 200k would have saved about $37 (the session never compacted; its main loop ran at a median 626k tokens of context per call), plus a project skill, an output cap and Serena for five large source reads in subagents. Small stories show no add-ons when none of these patterns is there; the 13 issue #3 stories had none beyond an unused plugin.

## The budget: what a task like this should cost

A weekly dollar limit per person is the wrong unit. The work comes in tasks, and a task has a price history. Every Claude Code (and Codex) session already on your disk is an example with a price. A session Sigil linked to a ticket is described by the ticket; any other by its first prompts, plus the `.md` file it names if that is where the story lives. Sigil finds the most similar past tasks (TF-IDF over their words, a small bonus for the same repo, teammates' stories from the repo ledger included) and takes the similarity-weighted median of their cost; the range is their 25th–75th percentile. No model call, nothing leaves the machine, and every finished task becomes another example.

**The budget is that history.** When comparable past tasks exist, the task's budget is their upper range ("a task like this should not take more than"), and everything runs against it: the status line, the Stop notices at 100%, 150% and 200%, the Coach's burn-rate rule, the repo policy's hard stop, the receipt. When nothing comparable exists, Sigil invents nothing. The status line shows spend with "no cap", and the first Stop after 50¢ asks once: tell Claude "cap this at $40" (it calls the `sigil_budget` tool), or `sigil budget set 40`. A repo policy's fixed `budget.usd` is a ceiling a cap cannot raise. Every cap is recorded and appears in `sigil audit`.

**Over or under, Sigil says why.** The over notice names the largest single reason in dollars (the main model, a context that grew past 200k and was re-sent 900 times, a tool that errored in a loop) and the fix for next time. The ship notice says how far under or over the budget the task landed. One transcript is not one task: a session resumed over days carries every task it held, so the cost check says "across 13 days and 8 compactions" when that is what it is reading.

**Reuse before re-deriving.** The Coach writes a recall card for every session it watches: what was asked, the final outcome, the files touched, the tests run, the cost. On each new prompt the hook ranks this repository's cards by the same word similarity, and when one is close enough it hands Claude that card's outcome before any token is spent re-deriving it, once per past task per session. `sigil recall` lists the cards; `sigil recall <session>` prints one; `recall.dir` in `sigil config` points them at a synced folder (a notes vault works) so a team shares them. The receipt shows what was offered and what it cost the first time; Sigil does not claim a saving it cannot measure.

**How good is the estimate?** Run `sigil estimate --backtest`: it prices each of your past tasks from all the others. On the author's machine (123 past tasks): median error 49%, 76% within 2× of the actual cost, 26% inside the stated range; among the 101 with similar neighbours, median error 44% and 87% within 2×. Read it as "about this much", not a quote, and it is why the budget is the upper range rather than the middle. The numbers are in [`docs/BENCHMARK.md`](docs/BENCHMARK.md).

```bash
sigil estimate https://github.com/acme/app/issues/42   # before you start: the number and the tasks behind it
sigil budget                                          # this task's budget and where it came from; budget set 40 to cap it
sigil cost                                            # during or after: budget, estimate vs actual, span, drivers, fixes
sigil recall "rate limit the login endpoint"          # what past sessions here already produced for a task like this
sigil fix --list                                      # the fixes for this session; sigil fix <id> [--global]; sigil undo
```

## For a team: the ledger, the dashboard, OpenTelemetry

**The ledger travels with the repo.** When a session ends, the story is appended to `.sigil/ledger.jsonl` in the repository: title and ticket key, author (`git user.name`), model, estimate, actual, the cost drivers and which fixes were applied. Commit it, and everyone who clones the repo gets the team's history: a new teammate's first story is estimated from the stories everyone else already did. With nothing similar, a ticket with story points is priced at the team's median cost per point. No prompts, code or paths are in it.

**The dashboard opens when the story ends.** At the end of an interactive session (and on `/sigil:cost`, `sigil cost --open`, `sigil estimate ... --open`, `sigil dashboard`) Sigil writes one self-contained HTML page to the temp directory and opens it: this story's estimate range, actual cost and drivers with the fix commands, then the team's estimate-vs-actual chart, where the money goes across all stories, spend by person and by model, and every story in a table. No scripts, no network, overwritten each time. `sigil config cost.dashboard_on_end false` keeps it closed.

![The Sigil dashboard: this story's estimate, actual and drivers, then the team's estimate-vs-actual chart, where the money goes, by person, by model, and every story](docs/dashboard.png)

*The dashboard after the issue #3 runs: 13 real stories, low to high complexity. The six "Implement the story in STORY.md" rows were recorded before the bug those runs found was fixed.*

**OpenTelemetry for the dashboards a company already has.** If an OTLP endpoint is set (`OTEL_EXPORTER_OTLP_ENDPOINT`, `SIGIL_OTEL_ENDPOINT`, or `sigil config cost.otel_endpoint`), each finished story is sent as OTLP/HTTP JSON gauges: `sigil.story.cost`, `sigil.story.estimate`, `sigil.story.overage`, `sigil.story.avoidable` and `sigil.story.driver.cost`, labelled with repo, ticket key, model, status, author and `OTEL_RESOURCE_ATTRIBUTES` (team, cost centre). Claude Code removes `OTEL_*` variables from the environment hooks run in, so Sigil reads them from Claude Code's settings files instead (managed, user, project, local): an organisation that already rolled out Claude Code's own OpenTelemetry through managed settings gets Sigil's story metrics at the same collector without touching anyone's machine. `SIGIL_OTEL_ENDPOINT` (and `_HEADERS`, `_RESOURCE_ATTRIBUTES`) override it, also from settings `env`; a gRPC-only collector needs `SIGIL_OTEL_ENDPOINT` pointing at its OTLP/HTTP port. Verified end to end with Claude Code 2.1.302 and a local collector. Claude Code's own metrics answer "how much did we spend"; these answer "which stories went over, by how much, and what would fix it".

**The number a platform team asks for.** When a session is judged, the receipt summary is written onto the story's ledger line next to its cost: criteria verified, supported, unverified and unmet, the mutation check, whether the contract was confirmed, linked or inferred. `sigil dashboard --org <root>` reads every repository's ledger under a root and answers, by repository, agent and model: how many stories ended **verified** (every criterion verified or supported, none unmet or unverified), and what a verified story cost. Claude Code's `/usage` and the Analytics API report spend, lines and merges per person; nobody else reports whether the work was done. Terminal table, a self-contained HTML page, `--json`.

**The audit trail.** `sigil audit [--since 30d] [--repo <path>] [--json]` lists every decision Sigil recorded on the machine: receipts, pull-request checks, disputes (who overrode which criterion), budget approvals, hard stops and done-gate blocks. It reads the session records already on disk and writes nothing; `--json` is the export for a SIEM.

**The fleet install.** `sigil install --managed` writes the hooks into Claude Code's managed settings (the file an administrator controls and no user or project setting can override), so a platform team can roll Sigil out through device management and know every session on every machine is recorded. `sigil uninstall --managed` restores the file byte for byte.

```bash
sigil dashboard                    # the team page from .sigil/ledger.jsonl
sigil dashboard --org ~/work       # every repo under a root: verified completion, cost per verified story
sigil audit --since 7d             # receipts, checks, disputes, approvals, blocks this week
sigil cost --record                # record this story now instead of at session end
sigil config cost.otel_endpoint http://collector:4318   # or OTEL_EXPORTER_OTLP_ENDPOINT in Claude Code's settings env
```

## Also in the box

Sigil started as a receipt for agent work and still does that: it freezes the ticket's acceptance criteria, re-runs your tests itself, and marks each criterion VERIFIED, SUPPORTED, UNVERIFIED or UNMET with the evidence (`sigil verify`, below). `sigil demo` replays a recorded session through all of it in a temp directory in two minutes.

![sigil demo: a recorded session replayed through the real hooks, the Judge, sigil verify, and a test that agrees with its own mistake](docs/demo.svg)

- **Agents:** Claude Code (hooks and plugin), Codex CLI, Gemini CLI, Cursor. `sigil adapters` shows what each one can and cannot tell Sigil. The end-of-turn cost notice shows in Claude Code, Codex and Gemini; Cursor gets the status and `sigil cost`.
- **Known limitations and published mistakes:** [`docs/EVALUATION.md`](docs/EVALUATION.md).
- Maintained in spare time by one person. Tell me what you'd need in [Discussions](https://github.com/kru3ish/sigil/discussions); `sigil feedback wrong <c#> --report` builds a sanitized report for an issue.

This is a **preview** (v0.14.0). Read the evidence lines before trusting a status, and the backtest before trusting an estimate.

## Did the agent actually finish? `sigil verify`

`sigil verify` is the flagship. Every criterion gets one of four statuses, and the evidence under it is what decided:

```
Sigil Verify

Task: Rate limit the login endpoint
Agent: claude-code   Model: claude-opus-5 (anthropic)

Acceptance criteria
✓ VERIFIED    POST /api/login returns 429 after 5 failed attempts from one IP within 15 minutes
  ├─ src/login.js changed
  ├─ src/rateLimit.js changed
  ├─ test.js mentions 429
  ├─ independent run of `npm test` passed
  └─ src/rateLimit.js returns true above 5 attempts and src/login.js maps it to 429 (1.00) [model]
✓ VERIFIED    A test covers the 429 path
  ├─ test.js mentions 429
  ├─ independent run of `npm test` passed
  └─ test.js asserts 429 after 6 attempts; the auditor ran it and it passed. (1.00) [model]
✗ UNMET       README documents the limit
  └─ README.md is unchanged in the diff; the assistant said "I did not update the README". (1.00) [model]
? UNVERIFIED  Existing login behaviour is unchanged below the limit
  ├─ independent run of `npm test` passed
  └─ No test exercises attempts below the limit; nothing in the diff contradicts it. (1.00) [model]

Verification
✓ npm test  independent run
  pre-existing tests: 1 file(s) at session start
  agent-created tests: 0 file(s) added, 0 modified, 0 case(s) added
  agent's own runs: 4 (1 green)  claims, not evidence

Result
2/4 criteria have sufficient evidence (2 verified, 0 supported).
1 criterion is unmet.
1 could not be verified from the evidence.
```

- **VERIFIED**: deterministic evidence demonstrates it: an independent run, a file check, a diff match, or a test that names the behaviour plus a green run made by Sigil.
- **SUPPORTED**: the evidence supports it but needs interpretation or is incomplete. A model's reading of the diff lands here on its own; it can never lift a criterion higher.
- **UNVERIFIED**: not enough evidence to say. Sigil says so instead of guessing.
- **UNMET**: the evidence shows it was not done.

`sigil verify --json` emits the same as a `sigil.verify.v1` document for CI and tools; `sigil verify --ci` exits non-zero on any UNMET criterion. Verdicts, a 0–10 quality score and ROI still exist on the receipt, labelled experimental and placed after the evidence: they rest on an estimated human value and a model's opinion.

**The mutation check.** After a green run, the test files the agent added or changed are run once more at the base commit, with nothing else from the work applied. A test that passes there too tests nothing about the change, so it cannot anchor a VERIFIED criterion; one that fails there is recorded as evidence that it does. This is the check a self-review loop cannot make: it is adversarial to the agent's own tests.

**At the merge gate.** `sigil check` produces the same receipt in CI from a clean checkout, with no session and no hooks: the task from the PR body or `--task`, the tests run there, the mutation check, scope, one PR comment kept updated, and a failing check when the repo's bar is not met (`verification.required` in `sigil.json`: `no-unmet`, `sufficient` or `verified`). `uses: kru3ish/sigil@main` in a `pull_request` workflow, then make it a required check; details in [`docs/CI.md`](docs/CI.md). A check can be written into the ticket's own criterion line (`— check: file_contains README.md Limit`), so the run needs no model at all.

The recording above is the real output of `sigil demo` (timing compressed; also in [`docs/demo.cast`](docs/demo.cast) for `asciinema play`). The demo replays a recorded session through the real hooks with a stubbed model, in a throwaway directory, and never touches your `~/.claude`.

## Install

Two ways; pick one. Both record the same events into `~/.sigil` and can be removed without a trace.

**As a Claude Code plugin** (hooks plus `/sigil:*` commands, no Node setup beyond what Claude Code already needs):

```
/plugin marketplace add kru3ish/sigil
/plugin install sigil@sigil
```

Then `/sigil:statusline` once, so the task, spend against budget, context and open Coach flags sit in Claude Code's status bar. The Coach itself needs nothing: it runs after every turn (autopilot) and hands Claude its observations on the next prompt.

Optionally install the CLI for the one-key Coach pane, reports and backfill:

```bash
npm i -g sigil       # gives you `sigil` (and `tally`, the old name, the same binary until 0.15)
sigil doctor                  # node, install and updates, agents and their hooks, history; every failure prints its fix; --json for issues
```

**As an npm CLI only** (hooks go into `~/.claude/settings.json`, backed up first):

```bash
npm i -g sigil
sigil install                 # hooks + status line; refuses if the plugin is already enabled, so you never record twice
sigil doctor
```

What each path gives you:

| | Plugin only | Plugin + CLI (`npm i -g sigil`) |
|---|---|---|
| Hooks record every session; receipts on push and at session end | yes | yes |
| Coach autopilot: rules run after every turn, observations reach Claude on the next prompt | yes | yes |
| Status line: task, spend vs budget, context %, open Coach flags (`/sigil:statusline` or `sigil install`) | yes | yes |
| `/sigil:task`, `/sigil:judge`, `/sigil:report`, `/sigil:sigil` (status), `/sigil:coach` (pending suggestions) | yes | yes |
| Optional one-key Coach pane (`sigil watch`, `sigil start`) | no, the slash command prints the install hint | yes |
| Receipts for past sessions (`sigil backfill`) and blind grading (`sigil calibrate`) | no | yes |
| Experiments, `sigil undo`, `sigil doctor`, `sigil followup` on demand | no | yes |
| Evidence explorer, disputes, hard-stop approval (`/sigil:explain`, `/sigil:dispute`, `/sigil:budget`) | yes | yes |
| Repo policy in `sigil.json`: standing criteria, budget, hard stop | yes | yes |
| Other agents (`sigil install --agent codex|gemini|cursor`) | no | yes |
| Playbook and numbers-only export (`sigil playbook`, `sigil export`) | no | yes |

Requirements: Node 18+, the Claude Code CLI (`claude`) on your PATH, `git`. `gh` is optional: GitHub issue intake works without it through the public REST API (set `GITHUB_TOKEN` for private repos); write-back and follow-up still need `gh`. Jira and Linear read `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `LINEAR_API_KEY` from the environment.

Uninstall: `/plugin uninstall sigil` or `sigil uninstall` (settings come back byte-identical, checked in CI), then `rm -rf ~/.sigil` if you want the receipts gone too.

## Use it

```bash
claude                        # start Claude Code as usual; Sigil is already running
```

Nothing else to start. After each of Claude's turns the hooks run the Coach once; anything it observes (a command failing three times, a file read three times, spend at 80% of budget, an MCP server erroring) is queued and reaches Claude as a `Sigil:` line on your next prompt. Things only you can decide (confirm an inferred task, allow test re-runs, write a CLAUDE.md) are handed to Claude once as flags with the exact command, so Claude asks you in the conversation and runs it on your yes; they also show in the status line, `sigil coach` lists them, `sigil watch` acts on them with one key, and `sigil config coach.autopilot false` turns autopilot off.

Paste a GitHub, Jira or Linear URL (or a `.md` path) in your first prompt and Sigil links the task. With no ticket, Sigil **infers** the task from your first prompts, the branch name and the commits you make, labels it `inferred task (unconfirmed)`, and the Coach asks once: `[c]onfirm  [e]dit  [l]ink`. From the CLI:

```bash
sigil task https://github.com/acme/app/issues/42     # link a ticket
sigil task --confirm                                  # keep the inferred criteria
sigil task --edit "add rate limiting to login, with a test and a README note"
```

When Claude runs `git push` or `gh pr create`, the Judge runs in the background and the receipt lands in `~/.sigil/sessions/<id>/report.md`. `sigil judge` runs it on demand; `sigil judge --post` also comments a compact receipt on the issue or PR. Seven days later, `sigil followup` (or the next session start) checks whether it held up.

```bash
sigil task --show        # the Task Contract: goal, criteria, constraints, verification commands, unknowns, status, revisions
sigil verify             # the Evidence Map for this session; --json for tools, --ci to gate, --deep for the strong model
```

Inside Claude Code the plugin adds `/sigil:task <ref>`, `/sigil:judge [--post]`, `/sigil:coach`, `/sigil:report` and `/sigil:sigil` (status).

## For one person

The moment Sigil is installed it reads the transcripts already on the machine and prints a one-page report with no model calls: total spend over the last 30 days, the three biggest sessions, where money bought nothing (retry loops, repeated reads, first-turn load, compactions), the one habit that would have saved the most, and what the same usage costs on each Claude plan at list price. `sigil onboard` reprints it; `sigil onboard --since 90d --json` feeds it to something else.

```bash
sigil onboard                     # the 30-day report, from disk, no model
sigil replay <session>            # the session as a timeline: prompts, first edits, first failing test, retry loops, context pressure, compactions, the receipt
sigil prompts                     # what your best tasks' opening prompts had in common, and a template built from them
sigil ask "which tasks cost the most per criterion this month?"   # a question over the receipts; numbers only leave the machine, answer cites sessions
sigil export --invoice --out sept.md    # invoice lines: task, criteria met, independent test result, estimate, AI cost, verdict
```

`sigil report` also shows estimate versus outcome by size bucket (≤ 1 h, 1–4 h, > 4 h): completion and cost per estimated hour, so you see where planning is consistently off. If the Coach or you leave a `HANDOFF.md` in the repo, the next session start hands its first lines to Claude as the state to resume from (files older than a day are ignored).

Inside Claude Code these are `/sigil:onboard`, `/sigil:replay`, `/sigil:prompts` and `/sigil:ask`.

## What a receipt looks like

```
Sigil receipt · Rate limit the login endpoint
BORDERLINE  ·  66.7% complete (1 unverifiable)  ·  quality 7/10  ·  ROI 84.84×
  ✔ c1 POST /api/login returns 429 after 5 failed attempts from one IP within 15 minutes [tier2 1.00]
  ✔ c2 A test covers the 429 path [tier2 1.00]
  ✘ c3 README documents the limit [tier1 1.00]
  ? c4 Existing login behaviour is unchanged below the limit [tier1 1.00]
Judged by: tier 0 → tier 1 → tier 2 · tier 2 on 2 criteria: verdict-sensitive: c1, c2 · model spend $0.062
Verification: npm test → passed
Cost (API-equivalent): $1.33 / budget $56.25 (2.4%) · per met criterion $0.660 · waste $0.629
  Sigil's own spend: $0.070 (5.3% of session spend, separate)
  by phase: explore $0.528, build $0.149, verify $0.604, ship $0.045  · subagents: agent-explore-01 $0.009
Value: 3h × $75 = $225, credited $113
Why: Two of the three verifiable criteria are met with an independent green test run, one is unmet and one
unverifiable, so 66.7% completion over what could be checked. Spend is well inside the budget and the ROI is comfortably above 2×, but the README
criterion was skipped and stated as skipped, and $0.60 of the $1.33 went into three identical failing test runs.
Next time:
  • When `npm test` fails twice with the same assertion, read the test before editing the implementation again.
  • Read the ticket checklist before saying done: the README item was explicit and skipped.
  • Stop calling the Jira MCP after the first 401; three retries burned three turns.

Follow-up 8 days later: PR #57 merged, then reverted in dba0f121  →  final verdict: NOT WORTH IT
```

The full `report.md` adds the evidence table, the waste breakdown (failed loops, repeated reads, dead-weight context, compaction churn, each in dollars), which files were `verified-against-disk` versus `reconstructed` from the transcript, and a skill/MCP attribution table labelled **correlational**, because it is.

## How the Judge works

1. **Intake** (one small-model call, cached): fetches the ticket via `gh`, the Jira REST API, the Linear API, a local `.md`, or plain text; freezes a checklist of acceptance criteria in `task.json` so the goalposts cannot move; scores spec quality 0–10 and lists the missing information; estimates human-hours (story points win when present) and sets the budget from comparable past tasks, a cap, or repo policy (see "The budget" above; nothing is invented when there is no history).
2. **Evidence**: the git diff from the session-start HEAD, files changed, every test and lint command Claude ran with its result, ship events, and Claude's final messages. With no commits, the changes are reconstructed from the Edit / MultiEdit / Write calls and the shell commands that write files, and labelled as such.
3. **Independent verification**: Sigil detects the project's test command (`package.json`, pytest, go, cargo, make, …) and runs it itself with a timeout, after asking once per repo. It never trusts "tests pass" in the transcript, and never runs tests against a reconstructed tree. Anything it cannot check is marked `unverifiable`, never guessed.
4. **Tiered judging**, so most receipts cost almost nothing:

| Tier | What runs | When |
|---|---|---|
| 0 | Mechanical checks the intake model attached to each criterion (`tests_pass`, `file_exists`, `file_changed`, `file_contains`, `diff_contains`, `command`, `pr`); cost, waste, ship events, test results | Always, no model |
| 1 | A small model (`models.tier1`, haiku) on the remaining `judgment` criteria, with an evidence pack trimmed to ~6k tokens; returns a confidence per criterion | Whenever judgment criteria remain |
| 2 | A stronger model on only the criteria that need it: the small model again under $1 of session spend, sonnet up to `judge.deepThreshold` ($3), opus above | Session cost ≥ $3, `--deep`, a tier-1 confidence below 0.6, a partial/unmet call on a correctness criterion, a criterion whose one-step change would flip the verdict, or a tier-1 quality score below 4 with a green run |
| review | The strong model reads the diff as the repo's maintainer: is the fix where the bug lives, what else does the touched code serve, what changed that no test exercises. Can hold the verdict at borderline, never raise it | Library-shaped repos (`judge.maintainer_review: auto`), or always with `on` |

5. **Abstention**: when nothing could be checked, or most criteria were unverifiable, the verdict is `insufficient evidence` rather than a guess. `sigil report` shows how often that happens.
6. **Numbers** are computed, not asked for: completion %, cost by phase, by subagent and by model, cost per met criterion, spend vs budget, waste in dollars, value = hours × `hourly_rate` credited at completion %, ROI, and a deterministic verdict (`worth it` needs ≥70% completion, ROI ≥2×, quality ≥6 and a green independent test run; `not worth it` is <40%, ROI <1 or quality <4). Three things cap a verdict and never lift one: a maintainer review that would request changes, a spec the intake flagged for clarification that nobody confirmed (`sigil task --confirm` lifts it), and a quality score under 4 that came from the small model alone (it escalates to the strong model first). Regression claims ("existing behaviour unchanged") are always judged, never resolved from a green suite. Dead-weight first-turn context is reported as setup cost, separate from the session's waste.
7. **Follow-up** runs on the next session start after 7 days (or `sigil followup`): PR merged or closed, reverted (git log), issue reopened, review comments and change requests, CI after merge. It stamps **held up / needed rework / reverted**, records the review burden (review rounds, hours from open to merge) and shows both the original and the adjusted verdict.

All dollar figures are **API-equivalent** at list price from `pricing.json` (with a `last_verified` date), since most people are on subscriptions. Sigil's own calls are counted separately and shown on every receipt.

## Audit, dispute, policy

**See the evidence.** `sigil judge <session> --explain c3` (or `/sigil:explain c3`) prints the cited evidence line, the diff hunks for the files involved from the session's base commit, the independent test output, and the transcript moments that touched those files. A manager who sees "c3 unmet" can confirm in ten seconds that the README really was not touched.

**Disagree on the record.** `sigil dispute <session> c3 --status met --reason "docs landed in the follow-up PR"` (or `/sigil:dispute c3 met <reason>`). The receipt keeps the original status next to the override, is re-scored, says so on the report and in the PR brief, and the disagreement goes into the calibration log with its reason. Every dispute is a labelled data point about how your team reads "done".

**Repo policy.** A `sigil.json` at the repo root, committed like any config:

```json
{
  "criteria": [
    { "text": "New code has tests", "check": { "kind": "tests_pass" } },
    { "text": "No changes under /billing without a CODEOWNERS review" }
  ],
  "budget": { "hourly_rate": 120, "fraction": 0.25, "hard_stop": true },
  "test_command": "npm run tests-only"
}
```

`test_command` is what the Judge runs for independent verification when the detected runner is wrong for the repo (a `pretest` step that needs the network or breaks on one platform, a monorepo, a suite that only works in CI). Standing criteria are appended to every task's frozen checklist (mechanical where a check is given, judged otherwise). The budget block is optional: by default the budget is the price of comparable past tasks, or a cap the person sets. A fixed `usd` is a ceiling for every task in the repo that a cap cannot raise; `fraction` or `hourly_rate` opt the repo into the older hours × rate rule when no history matches. With `hard_stop`, once a session passes its budget the PreToolUse hook denies every tool call, the status line says `HARD STOP`, and a human lifts it with `sigil budget approve --note "why"` (or `/sigil:budget`), which is recorded on the receipt.

**Reviewer brief.** `sigil judge --post` (or `writeback: true`) now posts a brief for the reviewer rather than a score: what was verified independently, what the model rated, what needs a manual look, where the agent struggled, and what was not verified against disk.

**Playbook and export.** `sigil playbook` clusters the recurring "Next time" lessons across receipts and `--write` puts them in CLAUDE.md. `sigil export --since 30d --out receipts.jsonl` writes one line per receipt with numbers, statuses and outcomes only, the record a platform team can collect centrally without collecting anyone's prompts or code.

## How accurate is the Judge?

Early, and measured two ways. Neither is a benchmark.

**Fixture regression (n = 10 sessions, 36 criteria: 5 ordinary, 5 adversarial).** Authored sessions with answers known by construction (`test/fixtures/calibration/`) are judged live and compared with the authored grades. The adversarial five are built to fool an assurance tool: a test that asserts `true`, an implementation and test that agree with each other and not the task, a green suite that never exercises the new behaviour, a `test` script that is `echo ok`, and work written then reverted while the final message claims it. Baseline recorded 2026-09-27 with haiku as tier 1 (recorded outputs replayed in CI):

| Measure | Result |
|---|---|
| Criterion agreement (exact) | 34 / 36 |
| Verdict agreement | 9 / 10 |
| False VERIFIED (a VERIFIED on a criterion the author graded unmet or partial) | 0 |
| Criteria resolved mechanically, at $0 | 17 of 36 |
| Escalated to tier 2 | 14 criteria on 7 sessions (verdict-sensitive, correctness, or a tier-1 quality score below 4) |
| Sigil's own spend, share of session spend | 0–13.9%, average 6.7% |

The two misses are kept, not re-graded: on the broad-green-suite fixture the Judge accepted "a test covers DELETE" because a modified test file and a green run exist (the Evidence Map holds it at SUPPORTED, so it is not a false VERIFIED, but the status is wrong); on the wrong-implementation fixture the Judge said unmet where the author said partial, and the Judge's reading is the stricter one. The ordinary five alone scored 19/19 and 5/5 on 2026-09-26. The adversarial set found a real bug on its first live run, a regex byte that stopped the lying-runner rule from ever firing; `docs/EVALUATION.md` has the account. CI replays the recorded model output through the deterministic pipeline and fails if criterion agreement drops below `baseline.json`, if false VERIFIED rises above it, or if the average self-share exceeds 8%.

**Headless sessions, blind-graded by an independent model (n = 8 sessions, 50 criteria, 2026-09-26).** Eight small Node tasks (a slugify function, RFC 4180 CSV quoting, DELETE/PATCH on a todo API, a token bucket, env-override config loading, a CLI with `--top`/`--json`, a Markdown TOC generator, and one deliberately vague "make the logger better") were run as real `claude -p` sessions with Sigil's hooks active, then graded from the repository alone by a separate Claude model that never saw Sigil's receipt. Criterion agreement 49 of 50; verdicts 8 of 8. The one disagreement was a mechanical `diff_contains` pattern the intake model wrote too narrowly (`/spawn.*wc2/` against `spawnSync(process.execPath, [binPath, …])`), which is why a content-pattern miss is now a hint for the judgment tier rather than an `unmet`. This is a model grading a model on tasks written for the purpose: it shows the pipeline scores clean small tasks correctly, not that the Judge matches humans on messy real work. The task repos and runner are `sigil-eval-setup.mjs` / `sigil-eval-run.mjs` in the author's workspace, not shipped.

**Autonomous fixture class, `sigil eval run --class fixture` (n = 8 sessions, 52 criteria, Sigil 0.6.0, 2026-09-27).** The same eight constructed tasks, run by the shipped harness: isolated copy of each repository, a fresh `claude -p` session (sonnet, 12 to 20 turns, $2.73 in total) with Sigil's hooks attached, Sigil's judge and Evidence Map, then a separate opus process grading from the repository alone. Exact criterion agreement 50 of 52; verdicts 6 of 8; **false VERIFIED 1, false UNMET 0**. The false VERIFIED was on the deliberately vague task: a test file the agent modified plus a green run anchored "enhanced for production use" at VERIFIED where the grader said partial. That anchor rule was wrong and is fixed (a test must name the behaviour); the run stays in `eval/results/` against 0.6.0. The other disagreement is Sigil saying unmet where the grader said partial on a criterion whose first half failed (the agent changed the default output order). Ledger, patches and per-criterion evidence are under `eval/results/fixture/`; `sigil eval report` prints the table by class.

**Autonomous real and historical classes, same harness (2026-09-27).** The six public issues above rerun through `sigil eval run --class real` with opus (27 to 72 turns, $16.36 in total): 26 of 27 criteria, verdicts 3 of 6, **false VERIFIED 0, false UNMET 0**. All three verdict misses are Sigil's maintainer-review tier holding at borderline (a workaround for an upstream bug, a wide blast radius, untested surfaces) where the grader said worth it; every criterion on those three was met by both readers. Three historical issues (qs #467, qs #493, yargs #2497), each cloned at the commit before the merged human fix that the agent never saw: 11 of 14 criteria, verdicts 2 of 3, false VERIFIED 0. The yargs task produced one **false UNMET** on the 0.6.0 build: `npm test` was already red at the base commit (lint in files the agent never touched) and Sigil read exit 1 as failed tests. Sigil now parses the runner's summary and re-runs the command at the base commit; on the rerun the criterion is UNVERIFIED and false UNMET is 0. Every disagreement is written up in [`docs/EVALUATION.md`](docs/EVALUATION.md); the release evidence is in [`docs/releases/0.6.1-evidence.md`](docs/releases/0.6.1-evidence.md).

**Real open-source issues, blind-graded by an independent model (n = 6 sessions, 29 criteria, 2026-09-26).** Six open bug reports from public repositories (express #7350 and #4557, yargs #2423, qs #262, commander #2603, micromatch #212) were cloned locally, given acceptance criteria written from the issue text, and fixed by `claude -p` sessions under Sigil (opus, 12 to 64 turns, $1.05 to $4.10 each, $15.14 in total). Nothing was pushed or posted upstream. A separate Claude model then graded each from the repository alone: criterion agreement 28 of 29; verdicts 4 of 6. Both verdict misses are the same kind: every criterion was met and the suite was green, and the grader still said *borderline* because the fix was a workaround for a bug that lives in a dependency (express #4557) or silently changed the meaning of patterns the suite never covered (micromatch #212). A criteria-and-tests Judge cannot see that, and the receipt does not claim to. Along the way the eval found and fixed five Sigil bugs: the intake race at session end, two kinds of brittle intake-written checks (a pattern too narrow, a path that does not exist), a `command` check that ignored the repo's `test_command`, and GitHub intake requiring `gh`.

What those numbers say: criterion statuses are reliable on tasks with a test suite and a clear criterion, and false VERIFIED is the number treated as a defect. The money verdict is the weaker half: the maintainer-review tier and the ROI rule still disagree with a grader on work that met every criterion. Until that is calibrated, read the criteria lines and treat the verdict as a second opinion.

Caveats: the fixtures are small JavaScript repos with one test file each; the small model's confidence is self-reported, so a confident wrong answer is only caught by the verdict-sensitivity and correctness guards; when a repo has no detectable test command, or you have not consented to re-runs, test criteria are `unverifiable` by rule; and on sessions with no commits the evidence is a transcript reconstruction, which the receipt says.

## What it costs you

Hooks: under 150 ms each, no network, exit 0 always (`sigil doctor` measures the runtime). SessionEnd appends one event and spawns a detached process, well inside Claude Code's shared 1.5 s budget.

Model calls, per task, on the fixture sessions: intake ≈ $0.01 (cached on repeat), tier 1 ≈ $0.015, tier 2 ≈ $0.12 only above the deep threshold; the Coach's LLM pass runs at most every 90 s and only once a session has spent $1. Every receipt prints Sigil's own spend and its share of the session; `sigil doctor` warns when the running average passes 5%.

## The Coach

Autopilot by default: the Stop hook spawns one Coach pass per turn, observations are injected automatically, and human decisions become flags that Claude asks you about. The optional pane (`sigil watch`) shows the same suggestions with one-key actions: `[a]pply`, `[i]nject`, `[s]kip`, `[m]ute rule`; an inferred task gets `[c]onfirm  [e]dit  [l]ink`. Injected notes reach Claude on its next turn as **observations** (`Sigil: Sigil observed npm test fail 3 times …`), never as instructions; what Claude does with them is up to Claude.

Rules are deterministic first, LLM second:

| Rule | Fires when | Action |
|---|---|---|
| loop-detect | the same failing command or edit repeats 3× | inject the observation |
| reread | the same file is read 3× | inject "keep notes" |
| context-pressure | context passes 70% / 85% | write `HANDOFF.md`, suggest `/compact` |
| claude-md | no CLAUDE.md, or an instruction is repeated | create / append CLAUDE.md |
| mcp-opportunity | 3+ shell or web fetches an MCP server would handle | show the `claude mcp add` snippet |
| dead-weight | a skill or MCP server is loaded but unused across recent sessions | measured or estimated first-turn overhead in dollars; points at `/plugin` Stats and "Not used recently" for the same list |
| mcp-errors | an MCP tool errors 3× | inject the observation |
| permission-friction | repeated prompts for the same safe command | allowlist entry, or `/fewer-permission-prompts` |
| burn-rate | spend with no file changes, or 80% / 100% of budget | inject a checkpoint |
| task-quality | no linked task, or spec quality < 5 | "Clarify the ticket first" + the questions |
| task-confirm | the task was inferred and not yet confirmed | confirm / edit / link |
| history-lesson | past receipts and follow-ups for this repo | inject at session start |
| verification-consent | the Judge wants to run your tests for the first time in this repo | allow / deny once |

Noise control: at most one non-critical suggestion per 3 minutes and 8 per session; critical ones always show. Suggestions rank by estimated dollars saved. Skip a rule 3 times and it mutes itself for that repo. `auto_apply` modes: `off`, `ask` (default), `auto`; `auto` may only write `.md` files, and `sigil undo` reverses any change.

## Experiments, backfill, calibration

```bash
sigil experiment start mcp jira --tasks 6          # alternate an item off/on across N tasks, compare arms
sigil backfill list --since 60d                     # past sessions with cost and detected task link + confidence
sigil backfill add <session> [--task <url|text>]    # receipt for a past session (worktree, consent, offline deps)
sigil calibrate grade <session> --grader you        # blind: grade first, then see Sigil's judgment
sigil calibrate report --source backfill            # agreement, confusion, lean, inter-grader, Coach precision, by task source
```

Backfill finds the task link (URL in a prompt → issue key in the branch or commits → PR on the branch → inferred from the prompts), reconstructs the window from git, judges the diff in a throwaway `git worktree`, re-runs tests there only with consent and offline dependencies, runs follow-up, and replays the Coach rules into `coach_replay.json`. Sessions with no commits are judged from the transcript reconstruction, tests not run.

## What's stored where, and privacy

| Path | Contents |
|---|---|
| `~/.sigil/sessions/<id>/events.jsonl` | hook events: prompts (truncated), tool names and inputs (truncated), results' first 600 chars, ship events; redacted before writing |
| `~/.sigil/sessions/<id>/task.json`, `judge.json`, `report.md` | the frozen task and the receipt |
| `~/.sigil/sessions/<id>/inject.jsonl`, `coach-state.json`, `seen.txt` | Coach notes queued for Claude, noise-control state, de-duplication keys |
| `~/.sigil/history.jsonl` | one line per session and receipt: numbers, verdicts, recommendations, skills/MCP loaded and used. No prompts, no code |
| `~/.sigil/calibration.jsonl`, `backfill/`, `experiments.json`, `mutes.json`, `undo.jsonl`, `sigil-spend.jsonl` | your grades, the backfill index, experiments, muted rules, the undo log, Sigil's own spend |
| `~/.sigil/config.json`, `pricing.json`, `backups/` | config, an editable price table, and your settings files before Sigil touched them |

Sigil keeps its data in `~/.sigil` rather than the plugin's data dir on purpose: receipts must outlive a plugin update or uninstall and be shared with the npm CLI. `SIGIL_HOME` relocates it; `CLAUDE_CONFIG_DIR` relocates `~/.claude`. Sigil reads Claude Code's transcripts in `~/.claude/projects/` for token usage and tool calls and never copies them.

- The hooks make no network calls and everything they record stays on the machine.
- What leaves it: model calls through `claude -p` (your login, isolated from your MCP servers, hooks and skills) carrying the criteria, a trimmed diff and test output; and, only when you ask, `gh` and the Jira/Linear APIs. If code must not reach a model provider, use the air-gapped setting below.
- Anonymous metrics are **off by default**: the first interactive run asks once (`Enable anonymous metrics? [y/N]`), `sigil telemetry show` prints exactly what would be sent (version, command name, success, criterion and verdict counts, feedback labels, a random installation id; never prompts, code, diffs, names or paths), `sigil telemetry off` deletes the id, and `SIGIL_TELEMETRY=0` or a CI environment disables it. Schema in [`PRIVACY.md`](PRIVACY.md).
- **Air-gapped:** `sigil config models.provider openai-compatible` points the Judge, Coach and intake at any OpenAI-compatible chat endpoint (`models.base_url`, default Ollama at `http://localhost:11434/v1`; key from the env var named by `models.api_key_env`). No traffic leaves the machine. Structured output is requested as JSON and parsed leniently, so a small local model works for the Coach and tier 1; calibrate before trusting a local model's verdicts (`sigil calibrate grade`).
- Write-back is opt-in (`--post` or `writeback: true`) and carries the verdict, completion, cost and the criteria list. Never prompts or code.
- Test re-runs execute your project's test command with a scrubbed environment and a timeout, only after you consent once per repo.

Details, threat model and how to report a problem: [`SECURITY.md`](SECURITY.md).

## Other agents: Codex CLI, Gemini CLI, Cursor

Sigil is not tied to Claude Code. The hooks, rules, Judge and Coach speak Claude Code's hook vocabulary; an adapter per agent maps the others onto it. One command installs Sigil into another agent's hook file (backed up first; `sigil uninstall --agent <id>` removes only Sigil's entries):

```bash
sigil install --agent codex      # ~/.codex/hooks.json      (PreToolUse / PostToolUse / Stop / SessionStart / SessionEnd, same schema as Claude Code)
sigil install --agent gemini     # ~/.gemini/settings.json  (BeforeTool / AfterTool / BeforeAgent / AfterAgent / SessionStart / SessionEnd)
sigil install --agent cursor     # ~/.cursor/hooks.json     (beforeShellExecution / afterShellExecution / afterFileEdit / preToolUse / postToolUse / stop)
```

What you get is the same: the task frozen from the first prompt or a ticket link, the Coach after every turn (observations reach the agent as extra context; hard stops deny tool calls in each agent's own permission format; the definition-of-done gate blocks a Stop, or in Cursor's case sends a follow-up message), the receipt at session end, replay, calibration. Tool names are normalised on the way in (`run_shell_command` and `shell` become `Bash`, `apply_patch` and `replace` become `Edit`), so every rule and check works unchanged.

**Cost.** Claude Code and Codex CLI expose token usage in their transcripts, so receipts carry dollars (Codex rollouts under `~/.codex/sessions` are read; OpenAI prices are in `pricing.json`, verified 2026-09-26). Gemini CLI and Cursor do not, so their receipts show criteria, tests, waste in tool calls and time, and no dollar figure rather than a guess; `sigil onboard` and `backfill` cover Codex sessions too.

**Which model judges.** By default Sigil judges and coaches through `claude -p` on your Claude login. With `sigil config models.provider openai-compatible` and `models.base_url` (OpenAI's API, Ollama, vLLM, LM Studio), the Judge and Coach use any model with a chat-completions endpoint, so a Codex user with no Claude account can run the whole thing on GPT, and an air-gapped team on a local model.

Verified against each agent's hook documentation on 2026-09-26 (`docs/PLATFORM_NOTES.md`); the Codex rollout parser was written from the public descriptions of the format and reads tolerantly, so a session it cannot price is labelled, not guessed. Adapters for other agents are one file each in `src/agents/`; contributions welcome.

## Compared with the built-ins and ccusage

| | ccusage / `/cost` / `/usage` | `/insights` | `/plugin` Stats | Sigil |
|---|---|---|---|---|
| Unit | session, day, model | 30 days of sessions | plugin, skill, MCP | one task |
| Question | how much did I spend? | how do I work, what friction recurs? | what is loaded and used? | was this task done, at what cost, and was it worth it? |
| A budget before the work | per-person limits, `--max-budget-usd` per run | no | no | the price of comparable past tasks, per task; a cap when there are none |
| Ties spend to acceptance criteria | no | no | no | yes, frozen at intake |
| Independent verification | no | no | no | re-runs your tests |
| Mutation check (do the new tests fail without the change?) | no | no | no | yes |
| A required check on the pull request | no | no | no | `sigil check` |
| Post-merge outcome | no | no | no | merged / reverted / reopened / review churn |
| Live coaching | no | no | no | yes, one-key actions |
| Skill / MCP value | `/usage` attributes tokens | flags unused ones | "Not used recently" | dollars per session, plus controlled experiments |

Claude Code's own `/verify` has the agent build and run the app and look at the result, `/goal` keeps it working until a small model agrees the condition holds, `/usage` breaks spend down by skill, plugin and MCP server, and Code Review has several agents read the PR. All of them run on the agent's side of the table. Sigil's receipt is made by a separate process from a contract frozen before the work, its tests run in a scrubbed environment and run again without the change, and `sigil check` turns the result into a required check on the pull request, which nothing inside a session can switch off.

Where a built-in already does the job, Sigil points you to it: `/insights` for the retrospective, `/fewer-permission-prompts` for the allowlist, `/cost` and `/usage` for totals, `/plugin` Stats for what is loaded.

## Known limitations

- **The verdict is experimental.** Criterion statuses come from checks and evidence; the money verdict is model-assisted and labelled experimental on every receipt. Treat it as a second opinion, read the criteria lines, and dispute what is wrong.
- **Cut from this release:** plugin evals (`claude plugin eval`, `evals/`), moving data into `${CLAUDE_PLUGIN_DATA}` (receipts stay in `~/.sigil`), best-of-N model comparison on the same task, private eval suites from receipts, visual verification of UI tasks, and per-line human/AI attribution. Each is listed in DECISIONS.md with the reason.
- Sessions with no commits are judged from the transcript reconstruction; edits made by tools Sigil does not parse (an MCP file server, an editor) are invisible, and tests are not run.
- Inferred tasks are only as good as the first prompts; confirm or edit them before trusting completion %.
- Dead-weight overhead is measured only when the repo has sessions both with and without the item; otherwise it is an even share, labelled estimated.
- Phase attribution (explore / build / verify / ship) is heuristic.
- Follow-up needs `gh`; Jira/Linear follow-up covers the linked issue only when a GitHub PR exists.
- Claude Code's transcript format is undocumented; the parser targets v2.1.x and `sigil doctor` checks recent transcripts still parse.
- Installing the plugin makes Claude Code run `npm install` in the plugin cache (it does so for any plugin with a `package.json`), which pulls about 80 MB of Sigil's dev tooling that the prebuilt `dist/` never uses. Slow the first time, otherwise harmless.
- Hooks in `~/.claude/settings.json` use the shell form (`node "<path>" Event`); the plugin uses the exec form. Both are recognised, but don't run both.

## Roadmap

The plan to v1.0 is in [`docs/ROADMAP_RELIABILITY_LAYER.md`](docs/ROADMAP_RELIABILITY_LAYER.md): v0.6 became the evaluation release (this document is its evidence); ship readiness and scope and risk analysis (v0.7), repository and mistake memory that survives switching agents (v0.8; recall cards and the task budget from history are its first pieces, shipped in 0.13), a stable adapter SDK and comparison views with sample sizes (v0.9), mutation verification in an isolated worktree (shipped early, as the mutation check). Architecture in [`ARCHITECTURE.md`](ARCHITECTURE.md); adding an agent in [`docs/ADAPTER_SDK.md`](docs/ADAPTER_SDK.md); how the numbers are measured in [`docs/EVALUATION.md`](docs/EVALUATION.md); how to help in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Evaluation

Sigil verifies itself. `sigil eval run` runs a coding-agent session on an isolated copy of a task repository with Sigil attached, lets Sigil judge it, then starts a blind evaluator (a separate model process that never sees Sigil's answer) and compares. `sigil eval discover` finds candidate public issues; `sigil eval report` prints the ledger by class and version, with false VERIFIED and false UNMET counted separately. Adversarial fixtures (a test that asserts `true`, an implementation and test that agree with each other and violate the task, a runner that runs nothing, a reverted change the agent still claims) live in `test/fixtures/calibration/adv-*` and replay in CI. Methodology, current numbers and known failure classes: [`docs/EVALUATION.md`](docs/EVALUATION.md).

## Development

```bash
npm test              # typecheck, bundle with esbuild, then vitest
npm run release-check # the release checklist, executed: build, tests, clean install, plugin, demo, fixtures, compat, docs, secrets
npm run build       # dist/cli.js + dist/hook.js, committed because the marketplace clones this repo
npm run fixtures    # regenerates test/fixtures/session-basic
```

`docs/PLATFORM_NOTES.md` records what was verified against the Claude Code docs and CLI. `DECISIONS.md` lists every judgment call. CI runs the suite, the demo, the calibration eval, `claude plugin validate --strict`, a committed-bundle check, and a clean install of the tarball in a fresh HOME on Linux, macOS and Windows.

MIT.
