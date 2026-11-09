/* The task budget is the price of comparable past tasks, or a cap a person sets; nothing is invented. Recall hands a
   new prompt the outcome of the past task it resembles. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isolate, root, basicFixture, tmpDir } from './helpers.js';
import { budgetFor, describeBudget, readCap } from '../src/task/budget.js';
import { PolicySchema } from '../src/policy.js';
import { sessionDir, writeJson, readJson, repoKey } from '../src/paths.js';
import { renderStatusLine } from '../src/commands/statusline.js';
import { parseTranscriptFile } from '../src/transcript/parse.js';
import { backfillCards, buildCard, matchRecall, recallNote, readCards, recallDir, worthMatching, type RecallCard } from '../src/recall/index.js';
import { spanOf, renderCheck, type CostCheck } from '../src/estimate/variance.js';
import { rank } from '../src/text/similarity.js';
import type { CostEstimate } from '../src/estimate/estimate.js';

const HOOK = path.join(root, 'dist', 'hook.js');
const CLI = path.join(root, 'dist', 'cli.js');
let iso: ReturnType<typeof isolate>;
beforeEach(() => {
  iso = isolate();
});
afterEach(() => iso.restore());

const policy = (b: Record<string, unknown> = {}) => PolicySchema.parse({ budget: b }).budget;
const est = (over: Partial<CostEstimate> = {}): CostEstimate => ({ usd: 20, low_usd: 12, high_usd: 31, basis: 'similar', confidence: 'medium', n: 4, corpus: 40, neighbours: [], computed_at: '', ...over });
const task = (over: Record<string, unknown> = {}) => ({ session: 's', cwd: '/r', created_at: 'x', frozen: true, source: { kind: 'text', ref: 'x' }, title: 'Rate limit the login endpoint', body_excerpt: '', labels: [], criteria: [], spec_quality: { score: 7, missing: [], questions: [] }, needs_clarification: false, estimate: { hours: 3, basis: 'llm' }, budget_usd: 0, budget_basis: 'none', hourly_rate: 75, tally_cost_usd: 0, model: 'fixture', ...over });

describe('the task budget', () => {
  it('is the upper range of comparable past tasks, and nothing when there are none', () => {
    expect(budgetFor({ policy: policy(), estimate: est(), hours: 3, rate: 75 })).toEqual({ usd: 31, basis: 'history' });
    expect(budgetFor({ policy: policy(), estimate: est({ basis: 'all' }), hours: 3, rate: 75 })).toEqual({ usd: 0, basis: 'none' });
    expect(budgetFor({ policy: policy(), estimate: est({ basis: 'repo' }), hours: 3, rate: 75 })).toEqual({ usd: 0, basis: 'none' });
    expect(budgetFor({ policy: policy(), estimate: null, hours: 3, rate: 75 })).toEqual({ usd: 0, basis: 'none' });
  });

  it('a cap beats history; repo policy is a ceiling the cap cannot raise; the hours rule only when a repo opts in', () => {
    const cap = { usd: 40, by: 'krish', ts: 'now' };
    expect(budgetFor({ cap, policy: policy(), estimate: est(), hours: 3, rate: 75 })).toEqual({ usd: 40, basis: 'cap' });
    expect(budgetFor({ cap, policy: policy({ usd: 25 }), estimate: est(), hours: 3, rate: 75 })).toEqual({ usd: 25, basis: 'cap' });
    expect(budgetFor({ policy: policy({ usd: 25 }), estimate: est(), hours: 3, rate: 75 })).toEqual({ usd: 25, basis: 'policy' });
    expect(budgetFor({ policy: policy({ fraction: 0.25 }), estimate: null, hours: 3, rate: 75 })).toEqual({ usd: 56.25, basis: 'hours' });
    expect(budgetFor({ policy: policy({ hourly_rate: 100 }), estimate: null, hours: 2, rate: 75 })).toEqual({ usd: 50, basis: 'hours' });
    expect(describeBudget('none', 0)).toContain('no budget');
    expect(describeBudget('history', 31, est())).toContain('4 comparable past tasks');
  });

  it('`tally budget set` caps the live task, records the event, and the status line runs against it', () => {
    const session = 'cap-0001';
    const cwd = tmpDir('tally-cap-');
    writeJson(path.join(sessionDir(session), 'task.json'), task({ cwd }));
    writeJson(path.join(sessionDir(session), 'estimate.json'), est({ basis: 'all', usd: 1.5, high_usd: 3 }));
    expect(renderStatusLine({ session_id: session, cost: { total_cost_usd: 2 } }, false)).toContain('$2.00 · no cap');
    const r = spawnSync(process.execPath, [CLI, 'budget', 'set', '40', '--session', session, '--note', 'one afternoon'], { cwd, encoding: 'utf8', env: { ...process.env, TALLY_HOME: iso.home, CLAUDE_CONFIG_DIR: iso.claude }, timeout: 20000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('$40.00');
    expect(readCap(session)?.usd).toBe(40);
    const t = readJson<{ budget_usd: number; budget_basis: string }>(path.join(sessionDir(session), 'task.json'), { budget_usd: 0, budget_basis: '' });
    expect(t.budget_usd).toBe(40);
    expect(t.budget_basis).toBe('cap');
    const events = fs.readFileSync(path.join(sessionDir(session), 'events.jsonl'), 'utf8');
    expect(events).toContain('"type":"budget_set"');
    expect(events).toContain('one afternoon');
    const line = renderStatusLine({ session_id: session, cost: { total_cost_usd: 34 } }, false);
    expect(line).toContain('$34.00 / $40.00 cap (85%)');
    const status = spawnSync(process.execPath, [CLI, 'budget', '--session', session], { cwd, encoding: 'utf8', env: { ...process.env, TALLY_HOME: iso.home, CLAUDE_CONFIG_DIR: iso.claude }, timeout: 20000 });
    expect(status.stdout).toContain('$40.00 cap set for this session');
  });

  it('the cost check carries the budget, the span of the transcript and the largest reason for an overrun', () => {
    const t = parseTranscriptFile(path.join(basicFixture, 'transcript.jsonl'));
    const span = spanOf(t);
    expect(span.days).toBeGreaterThanOrEqual(1);
    expect(span.compactions).toBe(t.compactions.length);
    const check: CostCheck = { session: 'x', actual_usd: 48, status: 'no_estimate', model: 'claude-opus-5', drivers: [{ id: 'model', title: 'Main model claude-opus-5', usd: 20, detail: '', basis: 'estimated' }], savable_usd: 20, computed_at: '', budget_usd: 40, budget_basis: 'cap', span: { days: 3, first: '2026-11-01', last: '2026-11-03', compactions: 2 } };
    const text = renderCheck(check);
    expect(text).toContain('across 3 days and 2 compactions');
    expect(text).toContain('$40.00 cap set for this session  OVER by $8.00 (120%)');
    expect(text).toContain('Why       main model claude-opus-5 (~$20.00) is the largest single reason');
    const none = renderCheck({ ...check, actual_usd: 5, budget_usd: 0, budget_basis: 'none', span: { days: 1, compactions: 0 }, estimate: est({ basis: 'all', usd: 1.54 }) });
    expect(none).toContain('no comparable past task');
    expect(none).toContain('tally budget set <usd>');
    expect(none).not.toContain('median session');
  });
});

describe('recall: the past task this prompt is asking for again', () => {
  const card = (session: string, title: string, text: string, over: Partial<RecallCard> = {}): RecallCard => ({ v: 1, session, repo: 'r', title, text, outcome: `Done: ${title}. Files changed and tests green.`, files: ['src/a.ts', 'test/a.test.ts'], tests: ['npm test'], cost_usd: 4.2, started: '2026-10-12T10:00:00.000Z', updated: '2026-10-12T11:00:00.000Z', days: 1, ...over });

  it('ranks past tasks by the words of the prompt and ignores prompts that are not task descriptions', () => {
    const cards = [card('a1', 'Fix the Workday poller', 'the scheduled poller crashed on an unknown ats value; page through all postings'), card('b2', 'Add dark mode to the settings page', 'theme toggle, persist preference, respect system setting'), card('c3', 'Rate limit the login endpoint', 'token bucket per ip, 429 with retry-after')];
    const m = matchRecall('the poller for workday postings is broken again, it stops after the first page', cards);
    expect(m[0]!.card.session).toBe('a1');
    expect(m[0]!.similarity).toBeGreaterThan(0.35);
    expect(matchRecall('rewrite the billing invoices PDF export', cards)).toEqual([]);
    expect(matchRecall('the poller for workday postings is broken again', cards, { exclude: 'a1' })).toEqual([]);
    expect(worthMatching('/tally:cost')).toBe(false);
    expect(worthMatching('yes')).toBe(false);
    expect(worthMatching('ok go ahead and do it')).toBe(false);
    expect(worthMatching('the poller for workday postings is broken again')).toBe(true);
    expect(rank('dark mode theme', ['theme toggle dark mode', 'token bucket'])[0]!.i).toBe(0);
    const note = recallNote(m[0]!);
    expect(note).toContain('2026-10-12');
    expect(note).toContain('$4.20');
    expect(note).toContain('Fix the Workday poller');
    expect(note).toContain('src/a.ts');
    expect(note).toContain('tally recall a1');
  });

  it('builds a card from a transcript: task, outcome, files, tests, cost, span', () => {
    const t = parseTranscriptFile(path.join(basicFixture, 'transcript.jsonl'));
    const c = buildCard({ session: 'fix-1', cwd: basicFixture, transcript: t, task: null });
    expect(c).toBeTruthy();
    expect(c!.title.length).toBeGreaterThan(3);
    expect(c!.outcome.length).toBeGreaterThan(0);
    expect(c!.cost_usd).toBeCloseTo(Math.round(t.cost * 100) / 100, 2);
    expect(c!.days).toBe(spanOf(t).days);
    expect(c!.repo).toBe(repoKey(basicFixture));
  });

  it('backfills cards from the sessions already on the machine for this repo, once', () => {
    const cwd = tmpDir('tally-recall-bf-');
    const projects = path.join(iso.claude, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    fs.mkdirSync(projects, { recursive: true });
    const base = { cwd, sessionId: 'bf-0001', version: '2.1.268', entrypoint: 'cli', isSidechain: false, userType: 'external' };
    const ts = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    const lines = [
      { ...base, type: 'user', uuid: 'u1', timestamp: ts(30), message: { role: 'user', content: 'Fix the Workday poller: page through every posting, not just the first 20' } },
      { ...base, type: 'assistant', uuid: 'a1', timestamp: ts(29), message: { model: 'claude-opus-5', id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: `${cwd}/src/sweep.py`, old_string: 'a', new_string: 'b' } }], usage: { input_tokens: 100, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
      { ...base, type: 'user', uuid: 'u2', timestamp: ts(28), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
      { ...base, type: 'assistant', uuid: 'a2', timestamp: ts(27), message: { model: 'claude-opus-5', id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'Done: the sweep reads the reported total and pages to it.' }], usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    ];
    fs.writeFileSync(path.join(projects, 'bf-0001.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const r = backfillCards(cwd);
    expect(r.sessions).toBe(1);
    expect(r.written).toBe(1);
    const cards = readCards(cwd);
    expect(cards.length).toBe(1);
    expect(cards[0]!.title).toContain('Workday poller');
    expect(cards[0]!.outcome).toContain('pages to it');
    expect(cards[0]!.files).toEqual(['src/sweep.py']);
    expect(backfillCards(cwd)).toEqual({ written: 0, skipped: 1, sessions: 1 });
    expect(matchRecall('the workday poller stops after the first page of postings', cards)[0]!.card.session).toBe('bf-0001');
  });

  it('the UserPromptSubmit hook offers the matching card once per session and records the event', () => {
    const cwd = tmpDir('tally-recall-');
    const dir = recallDir(cwd);
    expect(dir.startsWith(path.join(iso.home, 'recall'))).toBe(true);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, 'past-0001.json'), card('past-0001', 'Fix the Workday poller', 'the scheduled poller crashed on an unknown ats value; page through all postings'));
    writeJson(path.join(dir, 'past-0002.json'), card('past-0002', 'Add dark mode', 'theme toggle, persist preference'));
    expect(readCards(cwd).length).toBe(2);
    const run = (prompt: string) => spawnSync(process.execPath, [HOOK, 'UserPromptSubmit'], { input: JSON.stringify({ session_id: 'now-0001', cwd, prompt }), encoding: 'utf8', env: { ...process.env, TALLY_HOME: iso.home, CLAUDE_CONFIG_DIR: iso.claude, TALLY_NO_SPAWN: '1' }, timeout: 8000 });
    const first = run('the workday poller is broken again: it only reads the first page of postings and the scheduled run crashes');
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('Tally recall');
    expect(first.stdout).toContain('Fix the Workday poller');
    expect(first.stdout).toContain('$4.20');
    expect(first.stdout).not.toContain('dark mode');
    const again = run('the workday poller is broken again: it only reads the first page of postings');
    expect(again.stdout).not.toContain('Tally recall');
    const events = fs.readFileSync(path.join(sessionDir('now-0001'), 'events.jsonl'), 'utf8');
    expect(events.split('\n').filter((l) => l.includes('"type":"recall"')).length).toBe(1);
    expect(events).toContain('"ref":"past-0001"');
  });
});
