# Privacy

What Sigil stores, what leaves the machine, and the exact schema of the optional anonymous metrics. SECURITY.md covers the threat model and how to report a problem.

## What stays on the machine

Everything the hooks record: events, receipts, the Task Contract, feedback labels, the usefulness answer. All of it lives under `~/.sigil` (or `SIGIL_HOME`), redacted before it is written, and `rm -rf ~/.sigil` removes it. `sigil uninstall` restores your agent settings byte for byte.

## What can leave the machine, and when

- **Model calls**, when the Judge, Coach or intake run: through `claude -p` on your own Claude login by default, or to the `models.base_url` you configure (a local server for air-gapped use). Sent: the frozen criteria, a trimmed diff and test output, tool names and truncated command lines, the assistant's final message. Prompts go to intake only when a task is inferred from them. This is the one place code leaves the machine; point `models.provider` at a local endpoint if it must not.
- **Tracker calls** (`gh`, Jira, Linear, GitHub's REST API) only for the ticket you linked; write-back only with `--post` or `writeback: true`, carrying statuses, cost and criteria text.
- **Anonymous metrics**, only if you opted in. Schema below.
- **The team ledger** (`<repo>/.sigil/ledger.jsonl`) is written into your repository, not sent anywhere. It leaves the machine only if you commit and push it. One line per finished story: the story's title and ticket key, the author's `git user.name`, the model, the estimate and actual cost, and the cost drivers and fixes by id. No prompts, code, diffs or file paths. `sigil config cost.ledger false` turns it off; add `.sigil/` to `.gitignore` to keep it local.
- **Story metrics over OpenTelemetry**, only to an endpoint you or your organisation configured (`cost.otel_endpoint`, `SIGIL_OTEL_ENDPOINT`, or the standard `OTEL_EXPORTER_OTLP_ENDPOINT`). Sent: cost, estimate, overage, avoidable and per-driver figures in USD, with repo name, ticket key, model, status, estimate basis, agent, author and session id. No titles, prompts, code or paths.
- **The catalog** (`sigil catalog update`, and weekly before a cost check when `cost.catalog_online` is on, the default): plain GET requests for Anthropic's marketplace files and three awesome lists on raw.githubusercontent.com, and GitHub's API for the star count of curated tools a check is about to recommend (through `gh` when it is logged in). No request carries anything about you, your repo or your sessions. `sigil config cost.catalog_online false` or `SIGIL_OFFLINE=1` stops it.
- **The dashboard** is a local HTML file in the temp directory with no scripts and no network requests.
- **A wrong-verdict report** (`sigil feedback wrong <c#> --report`) goes nowhere by itself: it is shown, saved to a file you can read, and opening a GitHub issue with it is a separate default-No question.

## Anonymous metrics (opt-in, default off)

The first interactive run asks once: `Enable anonymous metrics? [y/N]`. No answer, `n`, `SIGIL_TELEMETRY=0`, or a CI environment all mean off. `sigil telemetry status` shows the state, `sigil telemetry show` prints exactly what would be sent, `sigil telemetry on|off` switches it. `off` deletes the installation id and anything queued.

Sending never blocks or slows a command: events are queued locally and a detached process posts them with a four-second timeout; failures are silent and the queue is capped at 500 events.

### Schema `sigil.telemetry.v1`

Every event is a JSON object with only these fields. The list is the allowlist in `src/telemetry/index.ts`; a field not on it cannot be sent.

| Field | Type | Meaning |
|---|---|---|
| `schema` | `"sigil.telemetry.v1"` | |
| `ts` | ISO timestamp | when the event was recorded |
| `installation_id` | UUID | random, created locally on opt-in, not derived from the machine; deleted by `sigil telemetry off` |
| `sigil_version` | string | e.g. `0.6.1` |
| `agent` | `claude-code` \| `codex` \| `gemini` \| `cursor` \| `unknown` | the agent product; never a model name or version |
| `command` | string | the Sigil command name, e.g. `verify` |
| `success` | boolean | whether the command exited 0 |
| `criteria` | `{verified, supported, unverified, unmet}` | counts on the receipt, for `verify` and `judge` |
| `verdict` | string | the verdict word: `worth it`, `borderline`, `not worth it`, `insufficient evidence` |
| `feedback_label` | `correct` \| `wrong` \| `unsure` | from `sigil feedback` |
| `false_verified` | boolean | a `wrong` label on a VERIFIED criterion |
| `usefulness_answer` | `yes` \| `no` \| `skip` | the one-time question |

Example:

```json
{
  "schema": "sigil.telemetry.v1",
  "ts": "2026-09-28T10:15:00.000Z",
  "installation_id": "5f0d2c1e-…",
  "sigil_version": "0.6.1",
  "agent": "claude-code",
  "command": "verify",
  "success": true,
  "criteria": { "verified": 2, "supported": 1, "unverified": 1, "unmet": 0 },
  "verdict": "borderline"
}
```

### Never sent

Prompts, code, diffs, file names or paths, repository names or URLs, task or criterion text, evidence text, terminal output, hostnames, usernames, email addresses, model names, IP-derived identity.

### The receiving side

Metrics go to the endpoint in `SIGIL_TELEMETRY_ENDPOINT` (or `endpoint` in `~/.sigil/telemetry.json`). Until an endpoint is configured nothing is sent even when metrics are on, and `sigil telemetry status` says so. The endpoint Sigil's maintainer runs must not store IP addresses or request headers beyond what is needed to accept the POST; that requirement is part of this document and any endpoint that does not meet it is not a Sigil endpoint.
