/* Recall at prompt time: which past task in this repository is this prompt asking for again. Reads the cards the
   Coach tick wrote (one per past session, plain JSON under ~/.sigil/recall/<repo>/ or `recall.dir`) and ranks them by
   word similarity. Imports only paths and the similarity code so the hook stays fast. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readJson, repoKey, sigilHome, configFile } from '../paths.js';
import { rank } from '../text/similarity.js';

export interface RecallCard {
  v: 1;
  session: string;
  repo: string;
  cwd?: string;
  title: string;
  /* the task as it was described: ticket title and body, or the opening prompts */
  text: string;
  /* the agent's final message, redacted and cut */
  outcome: string;
  files: string[];
  tests: string[];
  cost_usd: number;
  started?: string;
  updated: string;
  days: number;
  verdict?: string;
}

export const RECALL_MIN_SIMILARITY = 0.35;
export const RECALL_MIN_PROMPT_CHARS = 20;

export function recallSettings(): { enabled: boolean; min: number; dir?: string } {
  const raw = readJson<{ recall?: { enabled?: boolean; min_similarity?: number; dir?: string } }>(configFile(), {});
  const r = raw.recall ?? {};
  return { enabled: r.enabled !== false, min: typeof r.min_similarity === 'number' ? r.min_similarity : RECALL_MIN_SIMILARITY, dir: typeof r.dir === 'string' && r.dir ? r.dir : undefined };
}

/* one folder per repository: the path made file-safe, plus a short hash so two paths that differ only in punctuation
   never share a folder */
export function recallKey(cwd: string): string {
  const key = repoKey(cwd);
  const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(-60);
  return `${slug || 'repo'}-${createHash('sha1').update(key).digest('hex').slice(0, 8)}`;
}

export function recallDir(cwd: string, dir = recallSettings().dir): string {
  return path.join(dir ?? path.join(sigilHome(), 'recall'), recallKey(cwd));
}

export function cardFile(cwd: string, session: string): string {
  return path.join(recallDir(cwd), `${session}.json`);
}

export function readCards(cwd: string): RecallCard[] {
  const dir = recallDir(cwd);
  if (!fs.existsSync(dir)) return [];
  const out: RecallCard[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const c = readJson<RecallCard | null>(path.join(dir, f), null);
    if (c && c.v === 1 && c.title && c.outcome) out.push(c);
  }
  return out.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
}

export interface RecallMatch {
  card: RecallCard;
  similarity: number;
}

/* a prompt that is a slash command, a one-liner or a pasted stack trace is not a task description */
export function worthMatching(prompt: string): boolean {
  const p = prompt.trim();
  return p.length >= RECALL_MIN_PROMPT_CHARS && !p.startsWith('/') && !/^(yes|no|ok|okay|go|continue|done|thanks)\b/i.test(p);
}

export function matchRecall(query: string, cards: RecallCard[], opts: { exclude?: string; min?: number; limit?: number } = {}): RecallMatch[] {
  const pool = cards.filter((c) => c.session !== opts.exclude);
  if (!pool.length) return [];
  const min = opts.min ?? RECALL_MIN_SIMILARITY;
  return rank(query, pool.map((c) => `${c.title}\n${c.text}`))
    .filter((r) => r.sim >= min)
    .slice(0, opts.limit ?? 3)
    .map((r) => ({ card: pool[r.i]!, similarity: Math.round(r.sim * 100) / 100 }));
}

export function findRecall(prompt: string, cwd: string, session: string, min?: number): RecallMatch[] {
  if (!worthMatching(prompt)) return [];
  return matchRecall(prompt, readCards(cwd), { exclude: session, min });
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/* the note Claude sees: what was done, what it cost, where to find the rest */
export function recallNote(m: RecallMatch, cli = 'sigil'): string {
  const c = m.card;
  const when = (c.started ?? c.updated).slice(0, 10);
  const files = c.files.length ? ` Files it touched: ${c.files.slice(0, 6).join(', ')}${c.files.length > 6 ? ` (+${c.files.length - 6})` : ''}.` : '';
  return `Sigil recall: a task like this ran in this repo on ${when} and cost $${c.cost_usd.toFixed(2)}: "${cut(c.title, 80)}". Outcome then: ${cut(c.outcome.replace(/\s+/g, ' '), 400)}${files} Reuse that work before re-deriving it; the full card: ${cli} recall ${c.session.slice(0, 8)}`;
}
