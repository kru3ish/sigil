/* The enterprise layer: the receipt summary on the team ledger, the organisation view across repositories, the audit
   trail, and the managed-settings install that no user or project setting can remove. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isolate, tmpDir, root } from './helpers.js';
import { recordStory, recordVerification, readLedger, isVerifiedStory, type LedgerEntry } from '../src/estimate/ledger.js';
import { scanLedgers, aggregateOrg, renderOrgText, renderOrgHtml, readLedgerFile } from '../src/estimate/org.js';
import { collectAudit, parseSince, renderAudit } from '../src/commands/audit.js';
import { appendEvent } from '../src/store/events.js';
import { sessionDir, ensureDir, writeJson } from '../src/paths.js';
import { install, uninstall, isInstalled, managedSettingsPath, settingsPath } from '../src/install/install.js';

const CLI = path.join(root, 'dist', 'cli.js');
let iso: ReturnType<typeof isolate>;
beforeEach(() => {
  iso = isolate();
});
afterEach(() => iso.restore());

function repo(name: string, parent: string): string {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  return dir;
}

const entry = (session: string, usd: number, agent = 'claude-code', model = 'claude-sonnet-5'): LedgerEntry => ({ v: 1, ts: `2026-11-0${session.slice(-1)}T10:00:00.000Z`, session, story: `Story ${session}`, agent, model, actual_usd: usd, status: 'no_estimate', savable_usd: 0, drivers: [] });

describe('the receipt summary on the team ledger', () => {
  it('merges onto the story line when one exists, writes a minimal line when none does, and survives a re-record', () => {
    const parent = tmpDir('sigil-org-');
    const cwd = repo('api', parent);
    recordStory(cwd, entry('s1', 4.2));
    const v = { verified: 2, supported: 1, unverified: 0, unmet: 0, total: 3, discriminating: true, contract: 'linked' as const, verdict: 'worth it' };
    expect(recordVerification(cwd, 's1', v, { story: 'Story s1', agent: 'claude-code', model: 'claude-sonnet-5' })).toBe(path.join(cwd, '.sigil', 'ledger.jsonl'));
    let l = readLedger(cwd);
    expect(l.length).toBe(1);
    expect(l[0]!.actual_usd).toBe(4.2);
    expect(l[0]!.verification).toEqual(v);
    expect(isVerifiedStory(l[0]!)).toBe(true);
    /* a session with no cost line (an agent that exposes no usage) still gets its receipt onto the ledger */
    recordVerification(cwd, 's2', { verified: 1, supported: 0, unverified: 0, unmet: 1, total: 2, contract: 'confirmed' }, { story: 'Story s2\nsecond line', agent: 'gemini', model: 'gemini-2.5-pro' });
    l = readLedger(cwd);
    expect(l.length).toBe(2);
    const s2 = l.find((e) => e.session === 's2')!;
    expect(s2.actual_usd).toBe(0);
    expect(s2.story).toBe('Story s2');
    expect(isVerifiedStory(s2)).toBe(false);
    expect(isVerifiedStory(entry('s3', 1))).toBeUndefined();
    /* the cost line arriving later (recordStory replaces the session's line) would drop the summary; recording again restores it */
    recordStory(cwd, entry('s2', 0));
    expect(readLedger(cwd).find((e) => e.session === 's2')!.verification).toBeUndefined();
    recordVerification(cwd, 's2', { verified: 1, supported: 0, unverified: 0, unmet: 1, total: 2, contract: 'confirmed' }, { story: 'x', agent: 'gemini', model: 'g' });
    expect(readLedger(cwd).find((e) => e.session === 's2')!.verification?.unmet).toBe(1);
    expect(readLedger(cwd).length).toBe(2);
  });
});

describe('the organisation view', () => {
  it('reads every ledger under a root and reports verified completion and cost per verified story by repo, agent and model', () => {
    const parent = tmpDir('sigil-org-');
    const api = repo('api', parent);
    const web = repo('web', path.join(parent, 'frontend'));
    repo('empty', parent);
    recordStory(api, entry('a1', 10));
    recordVerification(api, 'a1', { verified: 3, supported: 0, unverified: 0, unmet: 0, total: 3, discriminating: true, contract: 'linked' }, { story: 'a1', agent: 'claude-code', model: 'm' });
    recordStory(api, entry('a2', 30));
    recordVerification(api, 'a2', { verified: 1, supported: 1, unverified: 0, unmet: 1, total: 3, discriminating: false, contract: 'needs_confirmation' }, { story: 'a2', agent: 'claude-code', model: 'm' });
    recordStory(api, entry('a3', 5));
    recordStory(web, entry('w1', 20, 'codex', 'gpt-5.3-codex'));
    recordVerification(web, 'w1', { verified: 2, supported: 2, unverified: 0, unmet: 0, total: 4, contract: 'confirmed' }, { story: 'w1', agent: 'codex', model: 'gpt-5.3-codex' });
    const repos = scanLedgers(parent);
    expect(repos.map((r) => r.name)).toEqual(['api', 'web']);
    expect(readLedgerFile(path.join(api, '.sigil', 'ledger.jsonl')).length).toBe(3);
    const r = aggregateOrg(parent, repos, new Date('2026-11-05T12:00:00Z'));
    expect(r.total.stories).toBe(4);
    expect(r.total.spend_usd).toBe(65);
    expect(r.total.judged).toBe(3);
    expect(r.total.verified).toBe(2);
    expect(r.total.no_unmet).toBe(2);
    /* $10 + $20 over the two verified stories */
    expect(r.total.cost_per_verified_usd).toBe(15);
    expect(r.total.mutation).toEqual({ checked: 2, discriminating: 1 });
    expect(r.total.contracts).toEqual({ confirmed: 1, linked: 1, inferred: 1 });
    const apiRow = r.by_repo.find((x) => x.name === 'api')!;
    expect(apiRow.stories).toBe(3);
    expect(apiRow.verified).toBe(1);
    expect(apiRow.median_usd).toBe(10);
    expect(r.by_agent.map((x) => x.agent)).toEqual(['claude-code', 'codex']);
    expect(r.by_agent.find((x) => x.agent === 'codex')!.cost_per_verified_usd).toBe(20);
    expect(r.by_model.length).toBe(2);
    const text = renderOrgText(r);
    expect(text).toContain('2 repositories');
    expect(text).toContain('4 stories · $65.00');
    expect(text).toContain('2 verified (67%)');
    expect(text).toContain('cost per verified story $15.00');
    const html = renderOrgHtml(r);
    expect(html).toContain('Was the work done, and what did a done story cost?');
    expect(html).toContain('<b>api</b>');
    expect(html).toContain('<b>codex</b>');
    expect(html).not.toContain('<script');
    /* the CLI form, without opening a browser */
    const cli = spawnSync(process.execPath, [CLI, 'dashboard', '--org', parent, '--json'], { encoding: 'utf8', env: { ...process.env, SIGIL_HOME: iso.home, CLAUDE_CONFIG_DIR: iso.claude, SIGIL_TELEMETRY: '0' }, cwd: parent });
    expect(cli.status).toBe(0);
    const j = JSON.parse(cli.stdout) as { schema: string; total: { verified: number } };
    expect(j.schema).toBe('sigil.org.v1');
    expect(j.total.verified).toBe(2);
    expect(spawnSync(process.execPath, [CLI, 'dashboard', '--org', path.join(parent, 'empty')], { encoding: 'utf8', env: { ...process.env, SIGIL_HOME: iso.home, CLAUDE_CONFIG_DIR: iso.claude }, cwd: parent }).status).toBe(1);
  });
});

describe('the audit trail', () => {
  it('lists receipts, checks, disputes, approvals, hard stops and gate blocks from the sessions on this machine', () => {
    const cwd = tmpDir('sigil-audit-');
    const t = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
    ensureDir(sessionDir('aud-1'));
    appendEvent({ ts: t(5), type: 'session_start', session: 'aud-1', cwd, data: { agent: 'claude-code' } });
    appendEvent({ ts: t(4), type: 'hard_stop_denied', session: 'aud-1', cwd, data: { tool_name: 'Bash' } });
    appendEvent({ ts: t(3), type: 'budget_approved', session: 'aud-1', cwd, data: { by: 'krish', note: 'ship it', lifted: true } });
    appendEvent({ ts: t(2), type: 'judge', session: 'aud-1', cwd, data: { verdict: 'worth it', completion_pct: 100, cost_usd: 3.5, reason: 'session_end' } });
    appendEvent({ ts: t(1), type: 'dispute', session: 'aud-1', cwd, data: { id: 'c2', original: 'unmet', status: 'met', by: 'krish' } });
    writeJson(path.join(sessionDir('aud-1'), 'dod-gate.json'), { blocks: 1, ts: t(2.5), unmet: ['c1', 'c3'] });
    ensureDir(sessionDir('ci-abc'));
    appendEvent({ ts: t(1.5), type: 'session_start', session: 'ci-abc', cwd: path.join(cwd, 'other'), data: { agent: 'ci', git_head: 'x' } });
    appendEvent({ ts: t(1.4), type: 'judge', session: 'ci-abc', cwd: path.join(cwd, 'other'), data: { verdict: 'borderline', completion_pct: 50, cost_usd: 0, reason: 'pr' } });
    /* too old to show */
    ensureDir(sessionDir('aud-old'));
    appendEvent({ ts: new Date(Date.now() - 40 * 86400000).toISOString(), type: 'judge', session: 'aud-old', cwd, data: { verdict: 'x', completion_pct: 1, cost_usd: 0, reason: 'manual' } });
    const lines = collectAudit({ since: parseSince('30d') });
    expect(lines.map((l) => l.kind)).toEqual(['hard_stop', 'budget_approved', 'gate_block', 'receipt', 'check', 'dispute']);
    expect(lines.find((l) => l.kind === 'dispute')).toMatchObject({ by: 'krish', detail: 'c2: unmet → met', session: 'aud-1' });
    expect(lines.find((l) => l.kind === 'gate_block')!.detail).toContain('unmet: c1, c3');
    expect(lines.find((l) => l.kind === 'check')!.session).toBe('ci-abc');
    expect(collectAudit({ since: parseSince('30d'), repo: cwd }).length).toBe(5);
    expect(collectAudit({ since: parseSince('1h') }).length).toBe(0);
    const text = renderAudit(lines, '30d');
    expect(text).toContain('6 entries');
    expect(text).toContain('[krish]');
    expect(renderAudit([], '7d')).toContain('No receipts');
    const cli = spawnSync(process.execPath, [CLI, 'audit', '--json', '--since', '30d'], { encoding: 'utf8', env: { ...process.env, SIGIL_HOME: iso.home, CLAUDE_CONFIG_DIR: iso.claude, SIGIL_TELEMETRY: '0' }, cwd });
    expect(cli.status).toBe(0);
    expect((JSON.parse(cli.stdout) as { schema: string; entries: unknown[] }).entries.length).toBe(6);
  });
});

describe('managed settings', () => {
  it('installs the hooks into the managed settings file and removes them again, byte-identical', () => {
    const file = path.join(tmpDir('sigil-managed-'), 'ClaudeCode', 'managed-settings.json');
    process.env.SIGIL_MANAGED_SETTINGS = file;
    try {
      expect(managedSettingsPath()).toBe(file);
      expect(settingsPath('managed')).toBe(file);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '{\n  "permissions": { "deny": ["Bash(rm -rf *)"] }\n}\n');
      const before = fs.readFileSync(file, 'utf8');
      const r = install({ scope: 'managed', force: true });
      expect(r.file).toBe(file);
      expect(r.added).toBeGreaterThan(0);
      expect(isInstalled('managed')).toBe(true);
      const s = JSON.parse(fs.readFileSync(file, 'utf8')) as { permissions: unknown; hooks: Record<string, unknown> };
      expect(s.permissions).toEqual({ deny: ['Bash(rm -rf *)'] });
      expect(Object.keys(s.hooks)).toContain('Stop');
      const u = uninstall({ scope: 'managed' });
      expect(u.removed).toBeGreaterThan(0);
      expect(fs.readFileSync(file, 'utf8')).toBe(before);
      expect(isInstalled('managed')).toBe(false);
    } finally {
      delete process.env.SIGIL_MANAGED_SETTINGS;
    }
    /* the default paths per platform */
    expect(managedSettingsPath('win32', { ProgramData: 'C:\\ProgramData' })).toBe(path.join('C:\\ProgramData', 'ClaudeCode', 'managed-settings.json'));
    expect(managedSettingsPath('darwin', {})).toBe('/Library/Application Support/ClaudeCode/managed-settings.json');
    expect(managedSettingsPath('linux', {})).toBe('/etc/claude-code/managed-settings.json');
  });
});
