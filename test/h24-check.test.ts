/* `sigil check`: the pull-request check with no session behind it. A clean checkout, a task file with checks written
   into it, an independent test run, the mutation check, and an exit code that follows the repo policy. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isolate, tmpDir, root } from './helpers.js';
import { taskRefFromPullRequest, resolveBase, passes, readPullRequestEvent } from '../src/commands/check.js';
import { splitInlineCheck } from '../src/task/intake.js';
import { renderVerifyMarkdown, MARKDOWN_MARKER, type Assurance } from '../src/assurance/index.js';

const CLI = path.join(root, 'dist', 'cli.js');
let iso: ReturnType<typeof isolate>;
beforeEach(() => {
  iso = isolate();
});
afterEach(() => iso.restore());

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_EMAIL: 't@t', GIT_AUTHOR_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_COMMITTER_NAME: 't' } });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

/* base: login returns 200; a task file with three criteria, two of them with checks written in. The branch adds the
   limit, a test that names the 429, and (unless `forgetReadme`) the README line. */
function makeRepo(opts: { forgetReadme?: boolean } = {}): { cwd: string; base: string } {
  const cwd = tmpDir('sigil-check-');
  git(cwd, ['init', '-q', '-b', 'main']);
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.mkdirSync(path.join(cwd, 'test'));
  fs.mkdirSync(path.join(cwd, 'tasks'));
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'app', scripts: { test: 'node test/run.js' } }));
  fs.writeFileSync(path.join(cwd, 'src', 'login.js'), 'module.exports = function login() { return 200; };\n');
  fs.writeFileSync(path.join(cwd, 'test', 'run.js'), "const fs = require('fs'); let n = 0; for (const f of fs.readdirSync(__dirname)) if (f.endsWith('.test.js')) { require('./' + f); n++; } console.log(n + ' passing');\n");
  fs.writeFileSync(path.join(cwd, 'test', 'existing.test.js'), "it = (n, f) => f(); it('login returns 200 first', () => { if (require('../src/login.js')() !== 200) throw new Error('x'); });\n");
  fs.writeFileSync(path.join(cwd, 'README.md'), '# app\n');
  fs.writeFileSync(path.join(cwd, 'tasks', 'rate-limit.md'), '# Rate limit the login endpoint\n\n## Acceptance criteria\n1. README documents the limit — check: file_contains README.md Limit\n2. Login returns 429 after 5 failed attempts\n3. The suite passes (check: tests_pass)\n');
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', 'base']);
  const base = git(cwd, ['rev-parse', 'HEAD']);
  git(cwd, ['checkout', '-q', '-b', 'feature/limit']);
  fs.writeFileSync(path.join(cwd, 'src', 'login.js'), 'let attempts = 0;\nmodule.exports = function login() { attempts += 1; return attempts > 5 ? 429 : 200; };\n');
  fs.writeFileSync(path.join(cwd, 'test', 'ratelimit.test.js'), "const it = (n, f) => f();\nit('returns 429 after five failed attempts', () => { const login = require('../src/login.js'); for (let i = 0; i < 5; i++) login(); if (login() !== 429) throw new Error('no 429'); });\n");
  if (!opts.forgetReadme) fs.writeFileSync(path.join(cwd, 'README.md'), '# app\n\nLimit: 5 attempts, then 429.\n');
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', 'add the limit']);
  return { cwd, base };
}

function check(cwd: string, args: string[], env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string; json: (Assurance & { check: { passed: boolean; required: string; no_model: boolean; tests_run: boolean } }) | null } {
  const r = spawnSync(process.execPath, [CLI, 'check', ...args], { cwd, encoding: 'utf8', env: { ...process.env, SIGIL_HOME: iso.home, CLAUDE_CONFIG_DIR: iso.claude, SIGIL_LLM: 'none', SIGIL_TELEMETRY: '0', GITHUB_EVENT_PATH: '', GITHUB_STEP_SUMMARY: '', GITHUB_OUTPUT: '', ...env }, timeout: 120000 });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = null;
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

describe('checks written into the ticket', () => {
  it('parses a check at the end of a criterion line and leaves the text clean', () => {
    expect(splitInlineCheck('README documents the limit — check: file_contains README.md Limit')).toEqual({ text: 'README documents the limit', check: { kind: 'file_contains', path: 'README.md', pattern: 'Limit' } });
    expect(splitInlineCheck('The suite passes (check: tests_pass)')).toEqual({ text: 'The suite passes', check: { kind: 'tests_pass' } });
    expect(splitInlineCheck('Migration exists `check: file_exists migrations/0007_limit.sql`')).toEqual({ text: 'Migration exists', check: { kind: 'file_exists', path: 'migrations/0007_limit.sql' } });
    expect(splitInlineCheck('Logs the client id - check: diff_contains "client_id"')).toEqual({ text: 'Logs the client id', check: { kind: 'diff_contains', pattern: 'client_id' } });
    expect(splitInlineCheck('Login returns 429 after 5 failed attempts')).toEqual({ text: 'Login returns 429 after 5 failed attempts' });
    /* an unknown kind is left as text, never a half check */
    expect(splitInlineCheck('Deployed — check: production_green')).toEqual({ text: 'Deployed — check: production_green' });
  });
});

describe('sigil check', () => {
  it('judges base..HEAD of a checkout with no session: mechanical checks, the independent run, the mutation check, and a clean exit', () => {
    const { cwd, base } = makeRepo();
    const summary = path.join(tmpDir('sigil-sum-'), 'summary.md');
    fs.writeFileSync(summary, '');
    const out = path.join(path.dirname(summary), 'out.txt');
    fs.writeFileSync(out, '');
    const r = check(cwd, ['--task', 'tasks/rate-limit.md', '--base', base, '--json', '--no-comment'], { GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: out });
    expect(r.status, r.stderr).toBe(0);
    const a = r.json!;
    expect(a.check.passed).toBe(true);
    expect(a.check.no_model).toBe(true);
    expect(a.check.tests_run).toBe(true);
    const by = Object.fromEntries(a.criteria.map((c) => [c.text, c]));
    expect(by['README documents the limit']!.status).toBe('VERIFIED');
    expect(by['The suite passes']!.status).toBe('VERIFIED');
    /* the behavioural criterion needs a reading and there is no model, which the map says; but a test that names the
       429, passes, and fails without the change supports it on deterministic grounds. Not VERIFIED: nobody read it. */
    expect(by['Login returns 429 after 5 failed attempts']!.status).toBe('SUPPORTED');
    expect(by['Login returns 429 after 5 failed attempts']!.basis).toBe('deterministic');
    expect(by['Login returns 429 after 5 failed attempts']!.evidence.some((e) => e.kind === 'rule' && /no model in this run/.test(e.summary))).toBe(true);
    expect(by['Login returns 429 after 5 failed attempts']!.evidence.some((e) => e.kind === 'without_change_run' && e.ok === true)).toBe(true);
    expect(a.task.status).toBe('linked');
    expect(a.verification.independent.ran).toBe(true);
    expect(a.verification.independent.passed).toBe(true);
    /* the agent's test fails without the change: it tests the work */
    expect(a.verification.independent.discriminating).toBe(true);
    expect(a.verification.agent_created.added_files).toEqual(['test/ratelimit.test.js']);
    /* the step summary and outputs for the workflow */
    const md = fs.readFileSync(summary, 'utf8');
    expect(md.startsWith(MARKDOWN_MARKER)).toBe(true);
    expect(md).toContain('### Sigil check — passed');
    expect(md).toContain('| ✅ VERIFIED | README documents the limit |');
    expect(md).toContain('Mutation check: the agent\'s tests fail without the change');
    expect(md).toContain('No model in this run');
    expect(fs.readFileSync(out, 'utf8')).toMatch(/passed=true\nrequired=no-unmet\nverified=2\nsupported=1\nunverified=0\nunmet=0\ntotal=3/);
    /* the same checkout under stricter bars: sufficient passes, verified does not */
    expect(check(cwd, ['--task', 'tasks/rate-limit.md', '--base', base, '--require', 'sufficient', '--no-comment']).status).toBe(0);
    const strict = check(cwd, ['--task', 'tasks/rate-limit.md', '--base', base, '--require', 'verified', '--no-comment']);
    expect(strict.status).toBe(1);
    expect(strict.stderr).toContain('the bar is "verified"');
    expect(strict.stdout).toContain('Sigil Verify');
  }, 120000);

  it('fails the check on an unmet criterion, and follows the repo policy for the bar', () => {
    const { cwd, base } = makeRepo({ forgetReadme: true });
    const r = check(cwd, ['--task', 'tasks/rate-limit.md', '--base', base, '--json', '--no-comment']);
    expect(r.status).toBe(1);
    expect(r.json!.check.passed).toBe(false);
    expect(r.json!.criteria.find((c) => c.text === 'README documents the limit')!.status).toBe('UNMET');
    /* the policy can lower the bar to nothing but the mechanical checks' absence... no: no-unmet is the floor; it can only raise it */
    fs.writeFileSync(path.join(cwd, 'sigil.json'), JSON.stringify({ verification: { required: 'verified', comment: false } }));
    const ok = makeRepo();
    fs.writeFileSync(path.join(ok.cwd, 'sigil.json'), JSON.stringify({ verification: { required: 'verified', comment: false } }));
    const r2 = check(ok.cwd, ['--task', 'tasks/rate-limit.md', '--base', ok.base, '--json', '--no-comment']);
    expect(r2.status).toBe(1);
    expect(r2.json!.check.required).toBe('verified');
    /* a bad --require is refused before anything runs */
    expect(check(ok.cwd, ['--task', 'tasks/rate-limit.md', '--base', ok.base, '--require', 'perfect']).status).toBe(2);
    /* no base and no task are errors, not empty receipts */
    expect(check(ok.cwd, ['--task', 'tasks/rate-limit.md', '--base', 'nope']).status).toBe(2);
    expect(check(ok.cwd, ['--base', ok.base]).status).toBe(2);
  }, 120000);

  it('finds the task behind a pull request from the event file, and the base from the PR base branch', () => {
    const { cwd, base } = makeRepo();
    const ev = path.join(tmpDir('sigil-ev-'), 'event.json');
    fs.writeFileSync(ev, JSON.stringify({ pull_request: { number: 7, title: 'Add the limit', body: 'Implements tasks/rate-limit.md\n\nFixes #12', html_url: 'https://github.com/o/r/pull/7', base: { ref: 'main' } }, repository: { full_name: 'o/r' } }));
    const pr = readPullRequestEvent({ GITHUB_EVENT_PATH: ev })!;
    expect(pr).toMatchObject({ number: 7, repo: 'o/r', base_ref: 'main' });
    /* a task file the body names wins over the issue reference */
    expect(taskRefFromPullRequest(pr, cwd)).toEqual({ ref: path.join(cwd, 'tasks', 'rate-limit.md'), kind: 'file' });
    expect(taskRefFromPullRequest({ ...pr, body: 'Fixes #12' }, cwd)).toEqual({ ref: 'https://github.com/o/r/issues/12', kind: 'issue' });
    expect(taskRefFromPullRequest({ ...pr, body: 'see https://github.com/o/r/issues/3 for context' }, cwd)).toEqual({ ref: 'https://github.com/o/r/issues/3', kind: 'issue' });
    expect(taskRefFromPullRequest({ ...pr, body: 'Just a refactor' }, cwd)).toEqual({ ref: 'Add the limit\n\nJust a refactor', kind: 'text' });
    /* a branch name as --base means its merge-base with HEAD */
    expect(resolveBase(cwd, 'main')).toBe(base);
    expect(resolveBase(cwd, undefined, 'main')).toBe(base);
    expect(resolveBase(cwd, 'no-such-branch')).toBeNull();
    /* end to end from the event: the task file named in the body, no --task */
    const r = check(cwd, ['--json', '--no-comment'], { GITHUB_EVENT_PATH: ev });
    expect(r.status, r.stderr).toBe(0);
    expect(r.json!.task.goal).toBe('Rate limit the login endpoint');
    expect(r.json!.task.status).toBe('linked');
  }, 120000);

  it('the bar and the markdown', () => {
    const a = { criteria: [{ status: 'VERIFIED' }, { status: 'SUPPORTED' }], summary: { unmet: 0 } } as unknown as Assurance;
    expect(passes(a, 'no-unmet')).toBe(true);
    expect(passes(a, 'sufficient')).toBe(true);
    expect(passes(a, 'verified')).toBe(false);
    const b = { criteria: [{ status: 'VERIFIED' }, { status: 'UNVERIFIED' }], summary: { unmet: 0 } } as unknown as Assurance;
    expect(passes(b, 'no-unmet')).toBe(true);
    expect(passes(b, 'sufficient')).toBe(false);
    const md = renderVerifyMarkdown(
      {
        task: { goal: 'G', source: 'file', status: 'linked' },
        criteria: [{ id: 'c1', text: 'A | B', status: 'UNMET', basis: 'deterministic', evidence: [{ kind: 'file_check', strength: 'deterministic', summary: 'README.md does not contain Limit', ok: false }], judge_status: 'unmet', resolved_by: 'tier0' }],
        verification: { preexisting_files: 1, agent_created: { added_files: [], modified_files: [], cases_added: 0 }, independent: { ran: false, total_passed: null, reason: 'no consent' }, agent_runs: [], note: '' },
        scope: { named_in_contract: [], touched_areas: ['src'], unnamed_areas: [], note: '' },
        summary: { verified: 0, supported: 0, unverified: 0, unmet: 1, total: 1, sufficient: 0 },
        experimental: { verdict: 'borderline', completion_pct: 0, quality: 5, roi: null, note: '' },
      } as unknown as Assurance,
      { range: 'a..b', required: 'no-unmet', passed: false },
    );
    expect(md).toContain('### Sigil check — failed');
    expect(md).toContain('| ❌ UNMET | A \\| B | README.md does not contain Limit |');
    expect(md).toContain('for a..b');
    expect(md).toContain('no code or prompts');
  });
});
