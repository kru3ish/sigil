/* The organisation view: every repository's .sigil/ledger.jsonl under one root, read together. Cost per story was the
   first number; the ones a platform team asks for come from the receipt summary each judged story carries: how many
   stories ended with every criterion verified or supported and none unmet or unverified ("verified"), and what a
   verified story costs, by repository and by agent. Nothing here calls a model or leaves the machine. */
import fs from 'node:fs';
import path from 'node:path';
import { isVerifiedStory, type LedgerEntry } from './ledger.js';

export interface RepoLedger {
  name: string;
  root: string;
  entries: LedgerEntry[];
}

/* the same reading as readLedger, from a file path: a re-recorded session replaces its earlier line */
export function readLedgerFile(file: string): LedgerEntry[] {
  if (!fs.existsSync(file)) return [];
  const bySession = new Map<string, LedgerEntry>();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as LedgerEntry;
      if (e && e.v === 1 && typeof e.actual_usd === 'number' && e.session) bySession.set(e.session, e);
    } catch {
      /* a half-written line */
    }
  }
  return [...bySession.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

/* repositories under `root` (the root itself included) that carry a ledger, to `depth` directories down */
export function scanLedgers(root: string, depth = 2): RepoLedger[] {
  const out: RepoLedger[] = [];
  const visit = (dir: string, d: number): void => {
    const f = [path.join(dir, '.sigil', 'ledger.jsonl'), path.join(dir, '.tally', 'ledger.jsonl')].find((p) => fs.existsSync(p));
    if (f) {
      out.push({ name: path.basename(dir), root: dir, entries: readLedgerFile(f) });
      return;
    }
    if (d >= depth) return;
    let kids: fs.Dirent[] = [];
    try {
      kids = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const k of kids) if (k.isDirectory() && !k.name.startsWith('.') && k.name !== 'node_modules') visit(path.join(dir, k.name), d + 1);
  };
  visit(path.resolve(root), 0);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface Stats {
  stories: number;
  spend_usd: number;
  median_usd: number | null;
  /* stories whose ledger line carries a receipt summary */
  judged: number;
  verified: number;
  no_unmet: number;
  /* spend on verified stories with a known cost, over their count */
  cost_per_verified_usd: number | null;
  mutation: { checked: number; discriminating: number };
  contracts: { confirmed: number; linked: number; inferred: number };
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

export function stats(entries: LedgerEntry[]): Stats {
  const priced = entries.filter((e) => e.actual_usd > 0);
  const judged = entries.filter((e) => e.verification && e.verification.total > 0);
  const verified = judged.filter((e) => isVerifiedStory(e) === true);
  const verifiedPriced = verified.filter((e) => e.actual_usd > 0);
  const checked = judged.filter((e) => e.verification!.discriminating !== undefined);
  return {
    stories: entries.length,
    spend_usd: entries.reduce((a, e) => a + e.actual_usd, 0),
    median_usd: median(priced.map((e) => e.actual_usd)),
    judged: judged.length,
    verified: verified.length,
    no_unmet: judged.filter((e) => e.verification!.unmet === 0).length,
    cost_per_verified_usd: verifiedPriced.length ? verifiedPriced.reduce((a, e) => a + e.actual_usd, 0) / verifiedPriced.length : null,
    mutation: { checked: checked.length, discriminating: checked.filter((e) => e.verification!.discriminating === true).length },
    contracts: { confirmed: judged.filter((e) => e.verification!.contract === 'confirmed').length, linked: judged.filter((e) => e.verification!.contract === 'linked').length, inferred: judged.filter((e) => e.verification!.contract === 'needs_confirmation' || e.verification!.contract === 'none').length },
  };
}

export interface OrgReport {
  generated_at: string;
  root: string;
  total: Stats;
  by_repo: Array<{ name: string; root: string } & Stats>;
  by_agent: Array<{ agent: string } & Stats>;
  by_model: Array<{ model: string } & Stats>;
}

export function aggregateOrg(root: string, repos: RepoLedger[], now = new Date()): OrgReport {
  const all = repos.flatMap((r) => r.entries);
  const group = <K extends string>(key: (e: LedgerEntry) => string, label: K): Array<Record<K, string> & Stats> => {
    const m = new Map<string, LedgerEntry[]>();
    for (const e of all) {
      const k = key(e) || 'unknown';
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()].map(([k, es]) => ({ [label]: k, ...stats(es) }) as Record<K, string> & Stats).sort((a, b) => b.stories - a.stories);
  };
  return {
    generated_at: now.toISOString(),
    root,
    total: stats(all),
    by_repo: repos.map((r) => ({ name: r.name, root: r.root, ...stats(r.entries) })),
    by_agent: group((e) => e.agent, 'agent'),
    by_model: group((e) => e.model, 'model'),
  };
}

const $ = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n >= 100 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`);
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderOrgText(r: OrgReport): string {
  const L: string[] = [];
  const t = r.total;
  L.push(`Sigil · ${r.by_repo.length} repositor${r.by_repo.length === 1 ? 'y' : 'ies'} under ${r.root}`);
  L.push(`${t.stories} stories · ${$(t.spend_usd)} · median ${$(t.median_usd)} per story`);
  L.push(`${t.judged} judged · ${t.verified} verified (${pct(t.verified, t.judged)}) · ${t.no_unmet} with nothing unmet (${pct(t.no_unmet, t.judged)}) · cost per verified story ${$(t.cost_per_verified_usd)}`);
  if (t.mutation.checked) L.push(`mutation check: ${t.mutation.discriminating}/${t.mutation.checked} stories whose new tests fail without the change`);
  const row = (name: string, s: Stats) => `${name.slice(0, 28).padEnd(28)}${String(s.stories).padStart(8)}${$(s.spend_usd).padStart(10)}${$(s.median_usd).padStart(9)}${String(s.judged).padStart(8)}${pct(s.verified, s.judged).padStart(10)}${$(s.cost_per_verified_usd).padStart(12)}`;
  const head = `${'' .padEnd(28)}${'stories'.padStart(8)}${'spend'.padStart(10)}${'median'.padStart(9)}${'judged'.padStart(8)}${'verified'.padStart(10)}${'$/verified'.padStart(12)}`;
  L.push('');
  L.push('By repository');
  L.push(head);
  for (const x of r.by_repo) L.push(row(x.name, x));
  if (r.by_agent.length > 1) {
    L.push('');
    L.push('By agent');
    L.push(head);
    for (const x of r.by_agent) L.push(row(x.agent, x));
  }
  if (r.by_model.length > 1) {
    L.push('');
    L.push('By model');
    L.push(head);
    for (const x of r.by_model) L.push(row(x.model, x));
  }
  return L.join('\n');
}

export function renderOrgHtml(r: OrgReport): string {
  const t = r.total;
  const table = (title: string, rows: Array<{ label: string } & Stats>) => `<section><div class="eyebrow">${esc(title)}</div><table><thead><tr><th></th><th>Stories</th><th>Spend</th><th>Median</th><th>Judged</th><th>Verified</th><th>Nothing unmet</th><th>$ / verified story</th><th>Tests that fail without the change</th></tr></thead><tbody>${rows
    .map((x) => `<tr><td><b>${esc(x.label)}</b></td><td>${x.stories}</td><td>${$(x.spend_usd)}</td><td>${$(x.median_usd)}</td><td>${x.judged}</td><td class="${x.judged ? (x.verified / x.judged >= 0.8 ? 'good' : x.verified / x.judged >= 0.5 ? 'mid' : 'bad') : ''}">${pct(x.verified, x.judged)}</td><td>${pct(x.no_unmet, x.judged)}</td><td>${$(x.cost_per_verified_usd)}</td><td>${x.mutation.checked ? `${x.mutation.discriminating}/${x.mutation.checked}` : '–'}</td></tr>`)
    .join('')}</tbody></table></section>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sigil · organisation</title>
<style>
:root{--bg:#fafaf8;--card:#fff;--ink:#16191d;--mute:#6b7280;--line:#e7e5e0;--soft:#f3f2ee;--accent:#2563eb;--good:#15803d;--mid:#b45309;--bad:#dc4a33}
@media (prefers-color-scheme:dark){:root{--bg:#0f1114;--card:#171a1f;--ink:#e9e7e2;--mute:#9aa1aa;--line:#262a31;--soft:#1d2127;--accent:#7aa2ff;--good:#4ade80;--mid:#fbbf24;--bad:#ff7a63}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
.wrap{max-width:1040px;margin:0 auto;padding:28px 16px 72px}header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;color:var(--mute);font-size:13px;margin-bottom:18px}header b{color:var(--ink);font-size:15px}
h1{font-size:24px;letter-spacing:-.02em;margin:0 0 6px}.sub{color:var(--mute);margin:0 0 22px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:0 0 28px}.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}.kpi .n{font-size:26px;font-weight:650;letter-spacing:-.02em}.kpi .l{color:var(--mute);font-size:13px}
section{margin:0 0 28px}.eyebrow{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin-bottom:8px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:14px}th,td{padding:9px 12px;text-align:right;border-bottom:1px solid var(--line)}th:first-child,td:first-child{text-align:left}th{color:var(--mute);font-weight:500;font-size:12.5px;background:var(--soft)}tr:last-child td{border-bottom:0}
.good{color:var(--good);font-weight:600}.mid{color:var(--mid);font-weight:600}.bad{color:var(--bad);font-weight:600}
.note{color:var(--mute);font-size:13px;line-height:1.5}
</style></head><body><div class="wrap">
<header><b>Sigil</b><span>${esc(r.by_repo.length)} repositor${r.by_repo.length === 1 ? 'y' : 'ies'} under ${esc(r.root)} · generated ${esc(r.generated_at.replace('T', ' ').slice(0, 16))} UTC · nothing left this machine</span></header>
<h1>Was the work done, and what did a done story cost?</h1>
<p class="sub">From each repository's committed <code>.sigil/ledger.jsonl</code>: one line per story with its cost and, once judged, the receipt summary.</p>
<div class="kpis">
<div class="kpi"><div class="n">${t.stories}</div><div class="l">stories · ${esc($(t.spend_usd))}</div></div>
<div class="kpi"><div class="n">${pct(t.verified, t.judged)}</div><div class="l">verified · every criterion verified or supported, none unmet or unverified (${t.verified} of ${t.judged} judged)</div></div>
<div class="kpi"><div class="n">${pct(t.no_unmet, t.judged)}</div><div class="l">nothing unmet</div></div>
<div class="kpi"><div class="n">${esc($(t.cost_per_verified_usd))}</div><div class="l">per verified story (median story ${esc($(t.median_usd))})</div></div>
<div class="kpi"><div class="n">${t.mutation.checked ? pct(t.mutation.discriminating, t.mutation.checked) : '–'}</div><div class="l">of new test suites fail without the change (${t.mutation.discriminating}/${t.mutation.checked})</div></div>
<div class="kpi"><div class="n">${t.contracts.confirmed + t.contracts.linked}</div><div class="l">stories on a confirmed or linked contract · ${t.contracts.inferred} inferred</div></div>
</div>
${table('By repository', r.by_repo.map((x) => ({ label: x.name, ...x })))}
${r.by_agent.length ? table('By agent', r.by_agent.map((x) => ({ label: x.agent, ...x }))) : ''}
${r.by_model.length ? table('By model', r.by_model.map((x) => ({ label: x.model, ...x }))) : ''}
<p class="note">A story is <b>judged</b> when its session was judged and the receipt summary reached the ledger (sessions since Sigil 0.12). <b>Verified</b> is the strict reading: no criterion UNMET or UNVERIFIED. A repository with few judged stories has a noisy rate; the counts are next to every percentage for that reason. Cost is the API-equivalent spend the agent exposed; agents that expose none show $0 and are left out of the per-story figures.</p>
</div></body></html>`;
}
