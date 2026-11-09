/* The mutation check: a test the agent wrote only anchors a criterion if it fails without the change. The demo's
   self-agreeing test (a test that passes with and without the fix) was the first case that showed why. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isolate, tmpDir, basicFixture } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { StubLlm } from '../src/llm/client.js';
import { intake } from '../src/task/intake.js';
import { judgeSession } from '../src/judge/judge.js';
import { runVerification } from '../src/judge/verify.js';
import { changedTestFiles, renderVerify } from '../src/assurance/index.js';
import type { FetchDeps } from '../src/task/fetchers.js';
import { readEventsFile } from '../src/store/events.js';

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

/* base: login always returns 200. The agent adds the limit and a test file that names the 429 behaviour. With `vacuous`
   the test only checks that login is a function, so it passes with or without the change. */
function makeRepo(opts: { vacuous: boolean; commit?: boolean }): { cwd: string; base: string } {
  const cwd = tmpDir('sigil-mut-');
  git(cwd, ['init', '-q', '-b', 'main']);
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.mkdirSync(path.join(cwd, 'test'));
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'app', scripts: { test: 'node test/run.js' } }));
  fs.writeFileSync(path.join(cwd, 'src', 'login.js'), 'module.exports = function login() { return 200; };\n');
  fs.writeFileSync(path.join(cwd, 'test', 'run.js'), "const fs = require('fs'); let n = 0; for (const f of fs.readdirSync(__dirname)) if (f.endsWith('.test.js')) { require('./' + f); n++; } console.log(n + ' passing');\n");
  fs.writeFileSync(path.join(cwd, 'test', 'existing.test.js'), "it = (n, f) => f(); it('login returns 200 first', () => { if (require('../src/login.js')() !== 200) throw new Error('x'); });\n");
  fs.writeFileSync(path.join(cwd, 'README.md'), '# app\n\nLimit: 5 attempts.\n');
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', 'base']);
  const base = git(cwd, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(cwd, 'src', 'login.js'), 'let attempts = 0;\nmodule.exports = function login() { attempts += 1; return attempts > 5 ? 429 : 200; };\n');
  const body = opts.vacuous ? "const it = (n, f) => f();\nit('returns 429 after five failed attempts', () => { if (typeof require('../src/login.js') !== 'function') throw new Error('no login'); });\n" : "const it = (n, f) => f();\nit('returns 429 after five failed attempts', () => { const login = require('../src/login.js'); for (let i = 0; i < 5; i++) login(); if (login() !== 429) throw new Error('no 429'); });\n";
  fs.writeFileSync(path.join(cwd, 'test', 'ratelimit.test.js'), body);
  if (opts.commit !== false) {
    git(cwd, ['add', '-A']);
    git(cwd, ['commit', '-q', '-m', 'agent work']);
  }
  return { cwd, base };
}

const fixtureEvents = (cwd: string, base: string) => readEventsFile(path.join(basicFixture, 'events.jsonl')).map((e) => (e.type === 'session_start' ? { ...e, cwd, data: { ...e.data, git_head: base } } : { ...e, cwd }));
const deps = { exec: () => ({ ok: false, stdout: '', stderr: '' }), fetch: async () => ({ ok: false, status: 0, text: async () => '' }), readFile: () => '', exists: () => false } as FetchDeps;
const stub = {
  intake: () => ({
    title: 'Rate limit the login endpoint',
    criteria: [
      { text: 'Login returns 429 after 5 failed attempts', source: 'explicit' },
      { text: 'README documents the limit', source: 'explicit', check: { kind: 'file_contains', path: 'README.md', pattern: 'Limit' } },
    ],
    spec_quality: { score: 8, missing: [], questions: [] },
    estimate_hours: 2,
    rationale: 'x',
    constraints: [],
  }),
  judge: () => ({ criteria: [{ id: 'c1', status: 'met', evidence: 'the limit is implemented and tested', files: ['src/login.js'], confidence: 0.9 }, { id: 'c2', status: 'met', evidence: 'README says so', files: ['README.md'], confidence: 0.9 }], quality_score: 7, quality_reason: 'r', verdict_reason: 'v', recommendations: ['a', 'b', 'c'] }),
  review: () => ({ layer: 'at_root_cause', layer_note: '', blast_radius: 'contained', blast_note: '', untested_surface: [], merge: 'merge', note: '' }),
};

describe('the mutation check in the verification runner', () => {
  it('runs the agent test files at the base commit after a green run and reports whether they fail there', async () => {
    const real = makeRepo({ vacuous: false });
    const files = changedTestFiles(real.cwd, real.base);
    expect(files.added).toEqual(['test/ratelimit.test.js']);
    const v = await runVerification(real.cwd, { timeoutMs: 60000, consent: true, baseHead: real.base, testFiles: [...files.added, ...files.modified] });
    expect(v.passed).toBe(true);
    expect(v.without_change?.ran).toBe(true);
    expect(v.without_change?.passed).toBe(false);
    expect(v.without_change?.test_files).toEqual(['test/ratelimit.test.js']);

    const vac = makeRepo({ vacuous: true, commit: false });
    const files2 = changedTestFiles(vac.cwd, vac.base);
    /* an uncommitted, untracked test file counts too */
    expect(files2.added).toEqual(['test/ratelimit.test.js']);
    const v2 = await runVerification(vac.cwd, { timeoutMs: 60000, consent: true, baseHead: vac.base, testFiles: [...files2.added, ...files2.modified] });
    expect(v2.passed).toBe(true);
    expect(v2.without_change?.passed).toBe(true);
    /* the working tree is untouched by the check */
    expect(fs.readFileSync(path.join(vac.cwd, 'src', 'login.js'), 'utf8')).toContain('429');
    expect(git(vac.cwd, ['worktree', 'list']).split('\n').length).toBe(1);

    /* nothing to run without a base commit, agent tests, or when switched off */
    const v3 = await runVerification(real.cwd, { timeoutMs: 60000, consent: true, baseHead: real.base, testFiles: [] });
    expect(v3.without_change).toBeUndefined();
    const v4 = await runVerification(real.cwd, { timeoutMs: 60000, consent: true, baseHead: real.base, testFiles: files.added, mutationCheck: false });
    expect(v4.without_change).toBeUndefined();
  }, 120000);
});

describe('the mutation check in the receipt', () => {
  it('a test that fails without the change anchors VERIFIED; one that passes without it is capped at SUPPORTED', async () => {
    const cfg = loadConfig();
    cfg.judge.maintainer_review = 'off';

    const real = makeRepo({ vacuous: false });
    await intake({ session: 'mut-real', cwd: real.cwd, text: 'Rate limit the login endpoint', cfg, llm: new StubLlm(stub, 'mut-real'), deps });
    const j1 = await judgeSession({ session: 'mut-real', cwd: real.cwd, transcriptPath: path.join(basicFixture, 'transcript.jsonl'), cfg, llm: new StubLlm(stub, 'mut-real'), reason: 'push', events: fixtureEvents(real.cwd, real.base), consent: true });
    expect(j1.verification.without_change?.passed).toBe(false);
    const c1 = j1.assurance!.criteria.find((c) => c.id === 'c1')!;
    expect(c1.status).toBe('VERIFIED');
    expect(c1.evidence.some((e) => e.kind === 'without_change_run' && e.ok === true)).toBe(true);
    expect(j1.assurance!.verification.independent.discriminating).toBe(true);
    expect(renderVerify(j1.assurance!, { color: false })).toContain("the agent's tests fail without the change");

    const vac = makeRepo({ vacuous: true });
    await intake({ session: 'mut-vac', cwd: vac.cwd, text: 'Rate limit the login endpoint', cfg, llm: new StubLlm(stub, 'mut-vac'), deps });
    const j2 = await judgeSession({ session: 'mut-vac', cwd: vac.cwd, transcriptPath: path.join(basicFixture, 'transcript.jsonl'), cfg, llm: new StubLlm(stub, 'mut-vac'), reason: 'push', events: fixtureEvents(vac.cwd, vac.base), consent: true });
    expect(j2.verification.without_change?.passed).toBe(true);
    const c1b = j2.assurance!.criteria.find((c) => c.id === 'c1')!;
    expect(c1b.status).toBe('SUPPORTED');
    expect(c1b.evidence.some((e) => e.kind === 'without_change_run' && e.ok === false)).toBe(true);
    expect(j2.assurance!.verification.independent.discriminating).toBe(false);
    expect(j2.assurance!.verification.note).toContain('do not test it');
    expect(renderVerify(j2.assurance!, { color: false })).toContain("the agent's tests pass without the change");
    /* the README check is mechanical and unaffected */
    expect(j2.assurance!.criteria.find((c) => c.id === 'c2')!.status).toBe('VERIFIED');

    /* switched off in config: no second run, the old rule applies */
    cfg.judge.mutation_check = false;
    const vac2 = makeRepo({ vacuous: true });
    await intake({ session: 'mut-off', cwd: vac2.cwd, text: 'Rate limit the login endpoint', cfg, llm: new StubLlm(stub, 'mut-off'), deps });
    const j3 = await judgeSession({ session: 'mut-off', cwd: vac2.cwd, transcriptPath: path.join(basicFixture, 'transcript.jsonl'), cfg, llm: new StubLlm(stub, 'mut-off'), reason: 'push', events: fixtureEvents(vac2.cwd, vac2.base), consent: true });
    expect(j3.verification.without_change).toBeUndefined();
    expect(j3.assurance!.verification.independent.discriminating).toBeUndefined();
  }, 180000);
});
