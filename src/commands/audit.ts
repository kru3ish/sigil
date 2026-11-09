/* `tally audit [--since 30d] [--repo <path>] [--json]`: the trail of decisions Tally recorded on this machine, in one
   list: receipts, pull-request checks, disputes (who overrode which criterion and why), budget approvals, hard stops
   and done-gate blocks. Read from the session event streams already on disk; nothing new is written, nothing leaves.
   `--json` is the form for a SIEM or a spreadsheet. */
import fs from 'node:fs';
import path from 'node:path';
import { type Args, flag, has } from '../cli.js';
import { sessionsDir, readJson } from '../paths.js';
import { readEvents } from '../store/events.js';

export type AuditKind = 'receipt' | 'check' | 'dispute' | 'budget_set' | 'budget_approved' | 'hard_stop' | 'gate_block';

export interface AuditLine {
  ts: string;
  session: string;
  repo?: string;
  cwd?: string;
  kind: AuditKind;
  detail: string;
  by?: string;
}

export function parseSince(s: string | undefined, now = Date.now()): number {
  const m = /^(\d+)\s*([dhm])$/i.exec((s ?? '30d').trim());
  const n = m ? Number(m[1]) : 30;
  const unit = (m?.[2] ?? 'd').toLowerCase();
  return now - n * (unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : 60000);
}

export function collectAudit(opts: { since: number; repo?: string }): AuditLine[] {
  const root = sessionsDir();
  if (!fs.existsSync(root)) return [];
  const out: AuditLine[] = [];
  const wanted = opts.repo ? path.resolve(opts.repo) : undefined;
  for (const id of fs.readdirSync(root)) {
    const dir = path.join(root, id);
    let st: fs.Stats;
    try {
      st = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory() || st.mtimeMs < opts.since) continue;
    const events = readEvents(id);
    const cwd = events.find((e) => e.cwd)?.cwd;
    if (wanted && (!cwd || path.resolve(cwd) !== wanted)) continue;
    const repo = cwd ? path.basename(cwd) : undefined;
    const isCheck = events.some((e) => e.type === 'session_start' && e.data.agent === 'ci');
    for (const e of events) {
      if (Date.parse(e.ts) < opts.since) continue;
      const d = e.data;
      if (e.type === 'judge') out.push({ ts: e.ts, session: id, repo, cwd, kind: isCheck ? 'check' : 'receipt', detail: `${String(d.verdict ?? '')} · ${String(d.completion_pct ?? '?')}% complete · $${Number(d.cost_usd ?? 0).toFixed(2)} (${String(d.reason ?? '')})` });
      else if (e.type === 'dispute') out.push({ ts: e.ts, session: id, repo, cwd, kind: 'dispute', detail: `${String(d.id)}: ${String(d.original)} → ${String(d.status)}`, by: d.by ? String(d.by) : undefined });
      else if (e.type === 'budget_approved') out.push({ ts: e.ts, session: id, repo, cwd, kind: 'budget_approved', detail: `${d.lifted ? 'hard stop lifted' : 'over-budget approved'}${d.note ? `: ${String(d.note)}` : ''}`, by: d.by ? String(d.by) : undefined });
      else if (e.type === 'budget_set') out.push({ ts: e.ts, session: id, repo, cwd, kind: 'budget_set', detail: `cap set to $${Number(d.usd ?? 0).toFixed(2)}${d.clamped ? ' (clamped to repo policy)' : ''}${d.note ? `: ${String(d.note)}` : ''}`, by: d.by ? String(d.by) : undefined });
      else if (e.type === 'hard_stop_denied') out.push({ ts: e.ts, session: id, repo, cwd, kind: 'hard_stop', detail: `${String(d.tool_name ?? 'tool call')} denied: over the repo budget` });
    }
    const gate = readJson<{ blocks?: number; ts?: string; unmet?: string[] } | null>(path.join(dir, 'dod-gate.json'), null);
    if (gate?.ts && Date.parse(gate.ts) >= opts.since) out.push({ ts: gate.ts, session: id, repo, cwd, kind: 'gate_block', detail: `done gate blocked the stop ${gate.blocks ?? 1}×${gate.unmet?.length ? ` (unmet: ${gate.unmet.slice(0, 4).join(', ')})` : ''}` });
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

export function renderAudit(lines: AuditLine[], since: string): string {
  if (!lines.length) return `No receipts, checks, disputes, approvals or blocks recorded in the last ${since}.`;
  const counts = new Map<AuditKind, number>();
  for (const l of lines) counts.set(l.kind, (counts.get(l.kind) ?? 0) + 1);
  const L: string[] = [];
  L.push(`Tally audit · last ${since} · ${lines.length} entries: ${[...counts.entries()].map(([k, n]) => `${n} ${k.replace('_', ' ')}${n === 1 ? '' : k === 'dispute' ? 's' : k.endsWith('k') ? 's' : k === 'receipt' ? 's' : ''}`).join(', ')}`);
  L.push('');
  L.push(`${'when (UTC)'.padEnd(17)}${'session'.padEnd(10)}${'repo'.padEnd(22)}${'kind'.padEnd(16)}detail`);
  for (const l of lines) L.push(`${l.ts.replace('T', ' ').slice(0, 16).padEnd(17)}${l.session.slice(0, 8).padEnd(10)}${(l.repo ?? '').slice(0, 20).padEnd(22)}${l.kind.replace('_', ' ').padEnd(16)}${l.detail}${l.by ? `  [${l.by}]` : ''}`);
  return L.join('\n');
}

export async function run(args: Args): Promise<number | void> {
  const sinceText = flag(args, 'since') ?? '30d';
  const lines = collectAudit({ since: parseSince(sinceText), repo: flag(args, 'repo') });
  if (has(args, 'json')) {
    process.stdout.write(JSON.stringify({ schema: 'tally.audit.v1', since: sinceText, generated_at: new Date().toISOString(), entries: lines }, null, 2) + '\n');
    return;
  }
  process.stdout.write(renderAudit(lines, sinceText) + '\n');
}
