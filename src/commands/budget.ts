/* `sigil budget status|set <usd>|approve [--session id] [--note "..."]`: the task's budget, the cap a person sets when
   no comparable past task priced it, the hard stop a repo policy can impose when a session passes the budget, and the
   human approval that lifts it. The Coach tick writes the stop marker; the PreToolUse hook denies tool calls while it
   exists; approve records who lifted it and why. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { type Args, flag } from '../cli.js';
import { resolveSession } from '../session.js';
import { sessionDir, writeJson, readJson } from '../paths.js';
import { appendEvent } from '../store/events.js';
import { fmtUsd } from '../cost/pricing.js';
import { loadTask, taskFile } from '../task/intake.js';
import { budgetFor, describeBudget, writeCap, type Cap } from '../task/budget.js';
import { loadPolicy } from '../policy.js';
import { loadEstimate } from '../estimate/estimate.js';

export interface HardStop {
  ts: string;
  spend_usd: number;
  budget_usd: number;
  policy_file?: string;
}

export function hardStopFile(session: string): string {
  return path.join(sessionDir(session), 'hard-stop.json');
}
export function approvalFile(session: string): string {
  return path.join(sessionDir(session), 'budget-approved.json');
}
export function readHardStop(session: string): HardStop | null {
  return readJson<HardStop | null>(hardStopFile(session), null);
}
export function isApproved(session: string): boolean {
  return fs.existsSync(approvalFile(session));
}

export function approveBudget(session: string, by: string, note?: string, cwd?: string): { lifted: boolean } {
  const lifted = fs.existsSync(hardStopFile(session));
  writeJson(approvalFile(session), { ts: new Date().toISOString(), by, note: note ?? '' });
  if (lifted) fs.unlinkSync(hardStopFile(session));
  appendEvent({ ts: new Date().toISOString(), type: 'budget_approved', session, cwd, data: { by, note: note ?? '', lifted } });
  return { lifted };
}

/* a person's cap for this session: written where intake reads it, applied to the task if one exists already (clamped
   to the repo policy's fixed budget when there is one), and recorded as an event for the audit trail */
export function setCap(session: string, usd: number, by: string, note: string | undefined, cwd: string | undefined): { usd: number; clamped: boolean; applied: boolean } {
  if (!(usd > 0)) throw new Error('the cap must be a positive dollar amount');
  const cap: Cap = { usd: Math.round(usd * 100) / 100, by, ts: new Date().toISOString(), ...(note ? { note } : {}) };
  writeCap(session, cap);
  const task = loadTask(session);
  const pol = loadPolicy(cwd ?? task?.cwd);
  const b = budgetFor({ cap, policy: pol.policy.budget, estimate: loadEstimate(session), hours: task?.estimate.hours ?? 0, rate: task?.hourly_rate ?? 0 });
  if (task) writeJson(taskFile(session), { ...task, budget_usd: b.usd, budget_basis: b.basis });
  appendEvent({ ts: cap.ts, type: 'budget_set', session, cwd, data: { usd: b.usd, requested_usd: cap.usd, by, note: note ?? '', clamped: b.usd < cap.usd } });
  return { usd: b.usd, clamped: b.usd < cap.usd, applied: !!task };
}

export async function run(args: Args): Promise<number | void> {
  const sub = args._[0] ?? 'status';
  const session = resolveSession(flag(args, 'session'), process.cwd());
  if (!session) {
    process.stderr.write('No session found.\n');
    return 1;
  }
  if (sub === 'set') {
    const usd = Number(String(args._[1] ?? '').replace(/^\$/, ''));
    if (!(usd > 0)) {
      process.stderr.write('Usage: sigil budget set <usd> [--note "why"]\n');
      return 2;
    }
    const r = setCap(session, usd, flag(args, 'by') ?? os.userInfo().username, flag(args, 'note'), process.cwd());
    process.stdout.write(`Budget for session ${session.slice(0, 8)}: ${fmtUsd(r.usd)}${r.clamped ? ' (clamped to the repo policy budget)' : ''}${r.applied ? '' : '; it applies once the task is linked'}. The status line and the Stop notices now run against it.\n`);
    return;
  }
  if (sub === 'approve') {
    const r = approveBudget(session, flag(args, 'by') ?? os.userInfo().username, flag(args, 'note'), process.cwd());
    process.stdout.write(r.lifted ? `Hard stop lifted for session ${session.slice(0, 8)}; tool calls are allowed again and the approval is recorded on the receipt.\n` : `Approval recorded for session ${session.slice(0, 8)} (no hard stop was active).\n`);
    return;
  }
  const task = loadTask(session);
  if (task) process.stdout.write(`Budget · ${describeBudget(task.budget_basis, task.budget_usd, loadEstimate(session))}${task.budget_usd > 0 ? '' : ' → sigil budget set <usd>'}\n`);
  const stop = readHardStop(session);
  if (stop) process.stdout.write(`HARD STOP · session ${session.slice(0, 8)} spent ${fmtUsd(stop.spend_usd)} against a ${fmtUsd(stop.budget_usd)} budget${stop.policy_file ? ` (${stop.policy_file})` : ''}. Tool calls are denied until: sigil budget approve --note "<why>"\n`);
  else process.stdout.write(`No hard stop active for session ${session.slice(0, 8)}${isApproved(session) ? ' (budget overrun approved)' : ''}.\n`);
}
