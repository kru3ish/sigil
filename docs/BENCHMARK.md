# Benchmark: how often is Tally's receipt right?

Every row is from `eval/results/ledger.jsonl`, produced by `tally eval run`: a coding agent works on an isolated copy of a task repository with Tally attached, Tally judges the result, then a blind evaluator (a separate model process that never sees Tally's answer) grades the same criteria, and the two are compared. Nothing here is curated; a failure stays in the ledger. `tally eval report --markdown` regenerates the table.

Classes are reported separately on purpose. There is no headline number.

- **fixture**: authored tasks with known answers, including adversarial cases (a test that asserts `true`, an implementation and test that agree with each other and violate the task, a runner that runs nothing, a reverted change the agent still claims).
- **real**: open issues from public repositories, worked by the agent.
- **historical**: closed issues replayed at the commit before their fix, so the maintainer's own fix is the reference.

| class | Tally | runs | criteria | exact agreement | false VERIFIED | false UNMET | verdict agreement | agent spend |
|---|---|---|---|---|---|---|---|---|
| fixture | 0.5.0 | 1 | 6 | 6/6 (100%) | 0 | 0 | 1/1 | $0.28 |
| fixture | 0.6.0 | 9 | 56 | 53/56 (95%) | 1 | 0 | 7/9 | $3.02 |
| historical | 0.6.0 | 4 | 20 | 14/20 (70%) | 0 | 1 | 2/4 | $7.09 |
| real | 0.6.0 | 6 | 27 | 26/27 (96%) | 0 | 0 | 3/6 | $16.36 |

20 runs as of 2026-11-05.

**How to read it.** *Exact agreement* is criterion by criterion: Tally's status and the grader's status are the same word. *False VERIFIED* is the number that matters: Tally said VERIFIED and the blind grader said partial or unmet. It is treated as a release defect; the one case in the 0.6.0 fixture class (a test file the agent touched anchoring a criterion with nothing nameable in it) was fixed in the next commit and is the reason anchoring now requires a test that names the behaviour. *False UNMET* is the opposite error. *Verdict agreement* is the money verdict ("worth it", "borderline", "not worth it"), which is model-assisted and labelled experimental on every receipt; it is right about half the time on real work and should be read as a second opinion, not a result.

**What is not in the table yet.** Runs under 0.7 and later, including the mutation check (0.12), have not been added to the ledger; the next real and historical runs will be. The grader is a model, not a person; agreement with a model is a proxy for agreement with a maintainer, and the historical class exists to narrow that gap. Costs are what the agent spent, in API-equivalent dollars, not what Tally spent.

## The estimate: how often is the price right?

The budget Tally sets before a task starts is the upper range of the cost of comparable past tasks (README, "The budget"). `tally estimate --backtest` prices every past task on a machine from all the others and compares with what it actually cost; tasks whose opening words are identical (scripted re-runs) are kept out of each other's estimates. On the author's machine, 2026-11-09, 123 past tasks:

| tasks | basis | median error | within 2× of actual | inside the stated range |
|---|---|---|---|---|
| 123 | all | 49% | 76% | 26% |
| 101 | had similar neighbours | 44% | 87% | – |

**How to read it.** The range is wide, which is why the budget is the upper quartile and not the median, and why Tally asks for a cap rather than inventing a number when no neighbour is similar enough (22 of the 123 here). "Within 2×" is the useful column for a budget: it says how often the real cost landed in the same order of magnitude as the number on the status line. Every finished task becomes an example, so the number moves with use; run the command on your own history before trusting any of this on your repositories.

Methodology, datasets, threats to validity and the known failure classes: [`EVALUATION.md`](EVALUATION.md). To add a case: [`CONTRIBUTING.md`](../CONTRIBUTING.md).
