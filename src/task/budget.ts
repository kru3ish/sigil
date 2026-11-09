/* The task budget: what a task like this should cost, decided before the work and held through it. The number comes,
   in order, from a cap a person set for this session, the repository policy's fixed budget, the price of comparable
   past tasks (the upper quartile: "a task like this should not take more than"), or an hours-times-rate rule the
   repository opted into. With none of those there is no budget, and Sigil asks for a cap rather than inventing one. */
import fs from 'node:fs';
import path from 'node:path';
import { readJson, sessionDir, writeJson, ensureDir } from '../paths.js';
import { isComparable, type CostEstimate } from '../estimate/estimate.js';
import type { Policy } from '../policy.js';

export type BudgetBasis = 'cap' | 'policy' | 'history' | 'hours' | 'none';

export interface Cap {
  usd: number;
  by: string;
  note?: string;
  ts: string;
}

export const BUDGET_FRACTION = 0.25;
export const BUDGET_FLOOR_USD = 2;

export function capFile(session: string): string {
  return path.join(sessionDir(session), 'budget.json');
}

export function readCap(session: string): Cap | null {
  const c = readJson<Cap | null>(capFile(session), null);
  return c && typeof c.usd === 'number' && c.usd > 0 ? c : null;
}

export function writeCap(session: string, cap: Cap): void {
  ensureDir(sessionDir(session));
  writeJson(capFile(session), cap);
}

export function clearCap(session: string): void {
  const f = capFile(session);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function hoursBudget(hours: number, hourlyRate: number, fraction = BUDGET_FRACTION): number {
  return Math.max(BUDGET_FLOOR_USD, round2(hours * hourlyRate * fraction));
}

export function budgetFor(opts: { cap?: Cap | null; policy: Policy['budget']; estimate?: CostEstimate | null; hours: number; rate: number }): { usd: number; basis: BudgetBasis } {
  const ceiling = opts.policy.usd;
  if (opts.cap) return { usd: round2(ceiling ? Math.min(opts.cap.usd, ceiling) : opts.cap.usd), basis: 'cap' };
  if (ceiling) return { usd: round2(ceiling), basis: 'policy' };
  if (isComparable(opts.estimate)) return { usd: round2(Math.max(opts.estimate.high_usd, opts.estimate.usd)), basis: 'history' };
  if (opts.policy.fraction || opts.policy.hourly_rate) return { usd: hoursBudget(opts.hours, opts.policy.hourly_rate ?? opts.rate, opts.policy.fraction ?? BUDGET_FRACTION), basis: 'hours' };
  return { usd: 0, basis: 'none' };
}

export function describeBudget(basis: BudgetBasis | undefined, usd: number, est?: CostEstimate | null): string {
  const $ = (n: number) => `$${n.toFixed(2)}`;
  /* a task frozen before 0.13 has a budget from the old hours × rate rule and no recorded basis */
  switch (basis ?? (usd > 0 ? 'hours' : 'none')) {
    case 'cap':
      return `${$(usd)} cap set for this session`;
    case 'policy':
      return `${$(usd)} fixed by repo policy (sigil.json)`;
    case 'history':
      return est && isComparable(est) ? `${$(usd)}, the upper range of ${est.n} comparable past ${est.n === 1 ? 'task' : 'tasks'} (typical ${$(est.low_usd)}–${$(est.high_usd)})` : `${$(usd)} from comparable past tasks`;
    case 'hours':
      return `${$(usd)} from the repo's hours × rate rule`;
    default:
      return 'no budget: no comparable past task and no cap set';
  }
}
