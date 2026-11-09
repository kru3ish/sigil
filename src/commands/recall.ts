/* `sigil recall [query | <session-prefix>] [--json] [--all]`: what past sessions in this repository already produced.
   No argument lists the most recent cards; words rank the cards by similarity; a session prefix prints one card. */
import { type Args, flag, has } from '../cli.js';
import { readCards, matchRecall, renderCard, backfillCards } from '../recall/index.js';

export async function run(args: Args): Promise<number | void> {
  const cwd = process.cwd();
  if (has(args, 'backfill')) {
    const r = backfillCards(cwd, { since: flag(args, 'since'), force: has(args, 'force') });
    process.stdout.write(`Recall cards for this repository: ${r.written} written from ${r.sessions} past sessions (${r.skipped} skipped: no changes, Sigil's own runs, or already carded).\n`);
    return;
  }
  const cards = readCards(cwd);
  const ref = args._.join(' ').trim();
  if (!cards.length) {
    process.stdout.write('No recall cards for this repository yet. The Coach writes one per session as it works (autopilot on), so the next task that looks like a past one starts from its outcome.\n');
    return;
  }
  const byPrefix = /^[0-9a-f-]{6,}$/i.test(ref) ? cards.find((c) => c.session.startsWith(ref)) : undefined;
  if (byPrefix) {
    process.stdout.write(has(args, 'json') ? JSON.stringify(byPrefix, null, 2) + '\n' : renderCard(byPrefix) + '\n');
    return;
  }
  const rows = ref ? matchRecall(ref, cards, { min: 0.1, limit: has(args, 'all') ? cards.length : 8 }).map((m) => ({ card: m.card, similarity: m.similarity })) : cards.slice(0, has(args, 'all') ? cards.length : 12).map((card) => ({ card, similarity: undefined as number | undefined }));
  if (has(args, 'json')) {
    process.stdout.write(JSON.stringify(rows.map((r) => ({ ...r.card, similarity: r.similarity })), null, 2) + '\n');
    return;
  }
  if (!rows.length) {
    process.stdout.write(`Nothing in ${cards.length} past ${cards.length === 1 ? 'task' : 'tasks'} here looks like "${ref.slice(0, 60)}".\n`);
    return;
  }
  const L = [ref ? `Past tasks in this repo most like "${ref.slice(0, 60)}":` : `Past tasks in this repo (${cards.length}):`, ''];
  for (const r of rows) {
    const c = r.card;
    L.push(`  ${c.session.slice(0, 8)}  ${(c.started ?? c.updated).slice(0, 10)}  ${`$${c.cost_usd.toFixed(2)}`.padStart(8)}${r.similarity !== undefined ? `  ${r.similarity.toFixed(2)}` : ''}  ${c.title.slice(0, 70)}`);
  }
  L.push('', 'One card: sigil recall <session-prefix>. Cards are local JSON (sigil config: recall.dir to keep them somewhere shared).');
  process.stdout.write(L.join('\n') + '\n');
}
