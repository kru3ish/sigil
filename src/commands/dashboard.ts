/* `sigil dashboard`: the team's cost per story from the repo's ledger, with the current session's story on top when
   there is one. A self-contained HTML file in the temp directory, opened in the browser. */
import { type Args, flag, has } from '../cli.js';
import { resolveSession } from '../session.js';
import { loadCheck } from '../estimate/variance.js';
import { openDashboard } from '../estimate/story.js';
import { readLedger } from '../estimate/ledger.js';
import { scanLedgers, aggregateOrg, renderOrgText, renderOrgHtml } from '../estimate/org.js';
import { dashboardPath, writeAndOpen } from '../estimate/open.js';

export async function run(args: Args): Promise<number | void> {
  const cwd = process.cwd();
  if (has(args, 'org')) {
    /* every repository under a root: the verified-completion rate and the cost per verified story the ledgers carry */
    const org = flag(args, 'org');
    const root = typeof org === 'string' && org ? org : cwd;
    const repos = scanLedgers(root);
    if (!repos.length) {
      process.stdout.write(`No .sigil/ledger.jsonl under ${root} (two directories deep). Repositories record stories there when sessions end; commit the file to share.\n`);
      return 1;
    }
    const report = aggregateOrg(root, repos);
    if (has(args, 'json')) {
      process.stdout.write(JSON.stringify({ schema: 'sigil.org.v1', ...report }, null, 2) + '\n');
      return;
    }
    process.stdout.write(renderOrgText(report) + '\n');
    const r = writeAndOpen(renderOrgHtml(report), dashboardPath('org'), !has(args, 'no-open'));
    process.stdout.write(`\n${r.opened ? 'Opened' : 'Wrote'} ${r.file}\n`);
    return;
  }
  let current;
  try {
    const session = resolveSession(flag(args, 'session'), cwd);
    current = session ? loadCheck(session) ?? undefined : undefined;
  } catch {
    current = undefined;
  }
  const r = openDashboard(cwd, { current, open: !has(args, 'no-open') });
  const n = readLedger(cwd).length;
  process.stdout.write(`${r.opened ? 'Opened' : 'Wrote'} ${r.file}\n${n} ${n === 1 ? 'story' : 'stories'} in the team ledger${current ? ', plus this session' : ''}.${n ? '' : ' Stories are recorded in .sigil/ledger.jsonl when a session ends; commit it to share.'}\n`);
}
