# The pull-request check

`sigil check` judges a pull request with no session behind it. It runs in the clean checkout a CI job already has, finds the task the PR claims to do, and produces the same receipt a local session gets: acceptance criteria against evidence, an independent test run, the mutation check, and scope. It fails the check when the receipt does not meet the bar the repo sets.

It is the one place where verification cannot be switched off by the person, or the agent, doing the work.

## Add it to a repository

```yaml
# .github/workflows/sigil.yml
name: Sigil check
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write   # one receipt comment per PR, kept updated
jobs:
  sigil:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0     # the check needs the base commit
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci          # the project's own dependencies, so its tests can run
      - uses: kru3ish/sigil@main
        with:
          require: no-unmet  # or sufficient | verified
```

Then make the check required in the branch protection or ruleset. From that point a PR merges only when its receipt meets the bar.

## What the check does

1. **Finds the base.** The merge-base of HEAD with the PR's base branch (`--base` overrides it).
2. **Finds the task.** `--task`, else from the PR body: a `.md` file it names (`tasks/rate-limit.md`), a linked issue (`#12`, `fixes #12`, or the issue URL), else the PR title and body as text. A task from a file or issue is a `linked` contract; one inferred from the PR text is labelled `needs_confirmation` on the receipt.
3. **Freezes the contract.** The acceptance criteria listed in the ticket are kept verbatim. Standing criteria from `sigil.json` are appended.
4. **Resolves mechanical checks.** `file_exists`, `file_changed`, `file_contains`, `diff_contains`, `tests_pass`, `command`, from the ticket (see below) or the policy.
5. **Runs the tests** with the repo's command (`npm test`, `pytest`, `go test`, `cargo test`, ... or `test_command` in `sigil.json`) in a scrubbed environment. A failure is attributed: if the base commit fails the same way, the receipt says so.
6. **Runs the mutation check.** After a green run, the test files the PR added or changed are run once more at the base commit, with nothing else from the PR applied. If they pass there too, they do not test the change, and they cannot anchor a VERIFIED criterion.
7. **Compares scope.** Areas the diff touches that no criterion names are flagged for explanation.
8. **Reports.** The receipt in the job log, the CI step summary, one PR comment (created, then updated on every push), and step outputs (`passed`, `verified`, `unmet`, `total`).
9. **Exits** 0 when the bar is met, 1 when it is not, 2 when there is nothing to judge (no base, no task).

## The bar

`verification.required` in the repo's `sigil.json` (the Action's `require` input overrides it):

| bar | passes when |
|---|---|
| `no-unmet` (default) | no criterion is UNMET |
| `sufficient` | every criterion is VERIFIED or SUPPORTED |
| `verified` | every criterion is VERIFIED |

```json
{
  "verification": { "required": "sufficient", "comment": true, "run_tests": true },
  "criteria": [{ "text": "No TODO left in the diff", "check": { "kind": "diff_contains", "pattern": "TODO" } }],
  "test_command": "npm run test:ci"
}
```

## Checks written into the ticket

A mechanical check can be written at the end of a criterion line, so the check resolves it with no model:

```markdown
## Acceptance criteria
1. README documents the limit — check: file_contains README.md Limit
2. The migration exists (check: file_exists migrations/0007_limit.sql)
3. Login returns 429 after five failed attempts
4. The suite passes `check: tests_pass`
```

Kinds: `tests_pass`, `file_exists <path>`, `file_changed <path>`, `file_contains <path> <pattern>`, `diff_contains <pattern>`, `command <command>`. Quote an argument that has spaces. The text before the check is the criterion as the receipt shows it.

## With and without a model

**Without a model** (the default in CI) the check resolves mechanical checks, runs the tests and the mutation check, and compares scope. A criterion that needs a reading of the evidence (criterion 3 above) is UNVERIFIED, and the receipt says why, unless a test the PR added names the behaviour, passes, and fails without the change: then it is SUPPORTED on deterministic grounds. Nothing is guessed.

**With a model**, those criteria are judged from the evidence the way a local session's are. Give the job an OpenAI-compatible endpoint:

```yaml
      - uses: kru3ish/sigil@main
        env:
          SIGIL_LLM_BASE_URL: https://api.anthropic.com/v1
          SIGIL_LLM_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SIGIL_LLM_MODEL: claude-sonnet-5-5
```

Any OpenAI-compatible endpoint works: Anthropic's, OpenAI's, a gateway, a self-hosted model. The judgment prompt carries the diff excerpt and the ticket; it is sent to the endpoint you name and nowhere else.

## What leaves the runner

Without a model: nothing. The receipt comment holds the criteria texts, statuses, one line of evidence each, file names and counts. No code, no prompts. With a model: the evidence pack goes to the endpoint you configured.

## Locally

The same command runs on a laptop, against any branch:

```
sigil check --task tasks/rate-limit.md --base main
sigil check --task https://github.com/o/r/issues/12 --require sufficient --json
```
