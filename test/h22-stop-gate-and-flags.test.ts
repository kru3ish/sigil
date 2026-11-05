/* From the maintainer's own month of use: the Stop gate blocked the first turn of 37 sessions on checks the intake model
   had guessed for prompts that were never coding tasks, and Coach flags (an unused MCP server) never reached the person. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isolate, root, tmpDir, basicFixture } from './helpers.js';
import { loadConfig, saveConfig } from '../src/config.js';
import { StubLlm } from '../src/llm/client.js';
import { intake, confirmTask } from '../src/task/intake.js';
import { appendEvent, readEventsFile } from '../src/store/events.js';
import { run as coachRun } from '../src/commands/coach.js';
import { readFlags } from '../src/commands/statusline.js';
import { sessionDir, ensureDir, writeJson, readJson } from '../src/paths.js';
import type { FetchDeps } from '../src/task/fetchers.js';

const HOOK = path.join(root, 'dist', 'hook.js');
let iso: ReturnType<typeof isolate>;
beforeEach(() => {
  iso = isolate();
  /* the gate is opt-in since 0.7; these tests are about its standing once it is on */
  saveConfig({ coach: { dod_gate: true } });
});
afterEach(() => iso.restore());

const deps = { exec: () => ({ ok: false, stdout: '', stderr: '' }), fetch: async () => ({ ok: false, status: 0, text: async () => '' }), readFile: () => '', exists: () => false } as FetchDeps;
const stub = {
  intake: () => ({ title: 'Write the thing', criteria: [{ text: 'MISSING.md exists', source: 'explicit', check: { kind: 'file_exists', path: 'MISSING.md' } }], spec_quality: { score: 8, missing: [], questions: [] }, estimate_hours: 1, rationale: 'x', constraints: [] }),
};

function stop(session: string, cwd: string): Record<string, unknown> {
  const r = spawnSync(process.execPath, [HOOK, 'Stop'], { input: JSON.stringify({ session_id: session, cwd, last_assistant_message: 'done', transcript_path: '' }), env: { ...process.env, TALLY_HOME: iso.home, CLAUDE_CONFIG_DIR: iso.claude, TALLY_NO_SPAWN: '1' }, encoding: 'utf8', timeout: 8000 });
  expect(r.status).toBe(0);
  return r.stdout.trim() ? (JSON.parse(r.stdout) as Record<string, unknown>) : {};
}

function seed(session: string, cwd: string, opts: { edit?: boolean } = {}): void {
  ensureDir(sessionDir(session));
  appendEvent({ ts: '2026-11-05T02:30:00.000Z', type: 'session_start', session, cwd, data: { agent: 'claude-code' } });
  if (opts.edit) appendEvent({ ts: '2026-11-05T02:31:00.000Z', type: 'pre_tool', session, cwd, data: { tool_name: 'Edit', tool_input: { file_path: 'a.md' }, tool_use_id: 't1' } });
}

describe('the definition-of-done gate has standing only for a real contract and real work', () => {
  it('does not block an inferred, unconfirmed task even when checks are unmet', async () => {
    const cwd = tmpDir('tally-gate-');
    seed('gate-inferred', cwd, { edit: true });
    await intake({ session: 'gate-inferred', cwd, text: 'You are a judgment layer over an expected-points model', cfg: loadConfig(), llm: new StubLlm(stub, 'gate-inferred'), deps });
    expect(stop('gate-inferred', cwd).decision).toBeUndefined();
    expect(fs.existsSync(path.join(sessionDir('gate-inferred'), 'dod-gate.json'))).toBe(false);
  });

  it('does not block a linked task when the session edited nothing', async () => {
    const cwd = tmpDir('tally-gate-');
    fs.writeFileSync(path.join(cwd, 'task.md'), '# Write the thing\n\n## Acceptance criteria\n1. MISSING.md exists\n');
    seed('gate-noedit', cwd);
    await intake({ session: 'gate-noedit', cwd, ref: path.join(cwd, 'task.md'), cfg: loadConfig(), llm: new StubLlm(stub, 'gate-noedit') });
    expect(stop('gate-noedit', cwd).decision).toBeUndefined();
  });

  it('blocks once for a linked task with edits and an unmet mechanical check, then lets the next stop through', async () => {
    const cwd = tmpDir('tally-gate-');
    fs.writeFileSync(path.join(cwd, 'task.md'), '# Write the thing\n\n## Acceptance criteria\n1. MISSING.md exists\n');
    seed('gate-real', cwd, { edit: true });
    await intake({ session: 'gate-real', cwd, ref: path.join(cwd, 'task.md'), cfg: loadConfig(), llm: new StubLlm(stub, 'gate-real') });
    const first = stop('gate-real', cwd);
    expect(first.decision).toBe('block');
    expect(String(first.reason)).toMatch(/MISSING\.md/);
    expect(stop('gate-real', cwd).decision).toBeUndefined();
    /* a confirmed inferred task counts as real too */
    const cwd2 = tmpDir('tally-gate-');
    seed('gate-confirmed', cwd2, { edit: true });
    await intake({ session: 'gate-confirmed', cwd: cwd2, text: 'Write the thing', cfg: loadConfig(), llm: new StubLlm(stub, 'gate-confirmed'), deps });
    confirmTask('gate-confirmed');
    expect(stop('gate-confirmed', cwd2).decision).toBe('block');
  });
});

describe('Coach flags reach the person at the terminal', () => {
  it('a pending flag is shown once as the hook message, with its command', () => {
    const cwd = tmpDir('tally-flag-');
    seed('flag-1', cwd);
    writeJson(path.join(sessionDir('flag-1'), 'coach-flags.json'), { pending: [{ rule: 'dead-weight', key: 'dead-weight:mcp:context7', title: 'mcp "context7" unused in the last 5 sessions here', usd_saved: 0.42, label: 'remove from settings' }], announced: ['dead-weight:mcp:context7'] });
    const out = stop('flag-1', cwd);
    const msg = String(out.systemMessage);
    const lines = msg.split('\n');
    expect(lines[0]).toBe('Tally Coach · 1 waiting for you');
    expect(lines[1]).toMatch(/^  1  mcp "context7" unused in the last 5 sessions here\s+saves ~\$0\.42  new$/);
    expect(lines[2]).toMatch(/^  Act: tell Claude "tally apply 1"/);
    expect(out.decision).toBeUndefined();
    const flags = readJson<{ notified?: string[] }>(path.join(sessionDir('flag-1'), 'coach-flags.json'), {});
    expect(flags.notified).toEqual(['dead-weight:mcp:context7']);
    expect(stop('flag-1', cwd).systemMessage).toBeUndefined();
  });

  it('a Coach tick and an apply keep the record of what the person has already seen', async () => {
    const session = 'flag-tick';
    const cwd = tmpDir('tally-flag-');
    for (const e of readEventsFile(path.join(basicFixture, 'events.jsonl'))) appendEvent({ ...e, session, cwd });
    await intake({ session, cwd, text: 'rate limit the login endpoint', cfg: loadConfig(), llm: new StubLlm(stub, session), deps });
    await coachRun({ _: [], flags: { tick: true, session, cwd, auto: true } });
    const key = readFlags(session).pending.find((f) => f.rule === 'task-confirm')!.key;
    expect(String(stop(session, cwd).systemMessage)).toContain('waiting for you');
    expect(readFlags(session).notified).toContain(key);
    /* the next tick rewrites the flags file; the card must not come back on the next Stop */
    await coachRun({ _: [], flags: { tick: true, session, cwd, auto: true } });
    expect(readFlags(session).notified).toContain(key);
    expect(stop(session, cwd).systemMessage).toBeUndefined();
    /* acting on a flag retires it from every list */
    expect(await coachRun({ _: [], flags: { apply: 'task-confirm', session, cwd } })).toBe(0);
    expect(readFlags(session).pending.some((f) => f.key === key)).toBe(false);
    expect(readFlags(session).notified ?? []).not.toContain(key);
    expect(readFlags(session).announced ?? []).not.toContain(key);
  });
});

describe('/tally:coach arguments', () => {
  it('parses apply/inject with a number or a rule id, defaulting to apply', async () => {
    const { parseCoachArgs } = await import('../src/commands/coach.js');
    expect(parseCoachArgs('apply 2')).toEqual({ verb: 'apply', target: '2' });
    expect(parseCoachArgs('2')).toEqual({ verb: 'apply', target: '2' });
    expect(parseCoachArgs('yes #3')).toEqual({ verb: 'apply', target: '3' });
    expect(parseCoachArgs('inject claude-md')).toEqual({ verb: 'inject', target: 'claude-md' });
    expect(parseCoachArgs('')).toBeNull();
    expect(parseCoachArgs('what is this')).toBeNull();
  });
});
