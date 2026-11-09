/* Recall cards: what a past session in this repository produced, kept so the next session that asks for the same thing
   starts from the answer instead of re-deriving it. The Coach tick writes the card for the live session at every
   Stop (so it is current when the session ends); the UserPromptSubmit hook matches new prompts against the cards of
   the same repository. Local files, redacted like everything else Tally stores. */
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, repoKey, writeJson } from '../paths.js';
import { redact } from '../redact.js';
import { isTestCommand, type Transcript } from '../transcript/parse.js';
import type { Task } from '../task/intake.js';
import { storyTitle } from '../estimate/estimate.js';
import { spanOf } from '../estimate/variance.js';
import { cardFile, type RecallCard } from './match.js';

export { readCards, matchRecall, findRecall, recallNote, recallDir, cardFile, worthMatching, type RecallCard, type RecallMatch } from './match.js';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function relative(cwd: string, f: string): string {
  const r = path.relative(cwd, f);
  return (r && !r.startsWith('..') && !path.isAbsolute(r) ? r : f).replace(/\\/g, '/');
}

export function buildCard(opts: { session: string; cwd: string; transcript: Transcript; task?: Task | null; verdict?: string; now?: Date }): RecallCard | undefined {
  const t = opts.transcript;
  const outcome = redact(t.finalAssistantText ?? '').trim();
  /* a session that changed nothing and said nothing has nothing to recall */
  if (!t.toolCalls.length || !outcome) return undefined;
  const prompts = t.prompts.map((p) => p.text);
  const title = (opts.task?.title ?? storyTitle(prompts, opts.cwd) ?? prompts[0]?.split('\n')[0] ?? '').trim();
  if (!title) return undefined;
  const text = redact(opts.task && !opts.task.inferred ? `${opts.task.title}\n${opts.task.body_excerpt}` : prompts.slice(0, 3).join('\n')).slice(0, 2000);
  const files = new Set<string>();
  const tests = new Set<string>();
  for (const c of t.toolCalls) {
    if (c.agent !== 'main') continue;
    if (EDIT_TOOLS.has(c.name) && typeof c.input.file_path === 'string') files.add(relative(opts.cwd, c.input.file_path));
    if (c.name === 'Bash' && typeof c.input.command === 'string' && isTestCommand(c.input.command) && tests.size < 5) tests.add(redact(c.input.command).slice(0, 120));
  }
  const span = spanOf(t);
  return {
    v: 1,
    session: opts.session,
    repo: repoKey(opts.cwd),
    cwd: opts.cwd,
    title: title.slice(0, 200),
    text,
    outcome: outcome.slice(0, 1500),
    files: [...files].slice(0, 30),
    tests: [...tests],
    cost_usd: Math.round(t.cost * 100) / 100,
    started: span.first ?? t.startedAt,
    updated: (opts.now ?? new Date()).toISOString(),
    days: span.days,
    ...(opts.verdict ? { verdict: opts.verdict } : {}),
  };
}

export function writeCard(opts: { session: string; cwd: string; transcript: Transcript; task?: Task | null; verdict?: string; now?: Date }): RecallCard | undefined {
  const card = buildCard(opts);
  if (!card) return undefined;
  const f = cardFile(opts.cwd, opts.session);
  ensureDir(path.dirname(f));
  writeJson(f, card);
  return card;
}

export function removeCard(cwd: string, session: string): void {
  const f = cardFile(cwd, session);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

export function renderCard(c: RecallCard): string {
  const L = [`${c.title}`, `  session ${c.session.slice(0, 8)} · ${(c.started ?? c.updated).slice(0, 10)}${c.days > 1 ? ` · ${c.days} days` : ''} · $${c.cost_usd.toFixed(2)}${c.verdict ? ` · ${c.verdict}` : ''}`, ''];
  L.push('Asked for:', ...c.text.split('\n').slice(0, 12).map((l) => `  ${l}`), '');
  L.push('Outcome:', ...c.outcome.split('\n').map((l) => `  ${l}`));
  if (c.files.length) L.push('', `Files: ${c.files.join(', ')}`);
  if (c.tests.length) L.push(`Tests run: ${c.tests.join(' · ')}`);
  return L.join('\n');
}
