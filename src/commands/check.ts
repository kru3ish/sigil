/* `sigil check`: the pull-request check. Judges base..HEAD of this checkout against the task (a linked issue, a
   tasks/*.md, or the PR text) with no session behind it: the acceptance criteria, an independent test run in this clean
   checkout, the mutation check, scope. Prints the receipt, writes the CI step summary, posts or updates one PR comment,
   and exits 1 when the repo policy's bar (`verification.required` in sigil.json) is not met.

   Without a model (no key in the environment) it resolves mechanical checks and runs the tests, and says so: criteria
   that need a reading are UNVERIFIED, never guessed. With SIGIL_LLM_BASE_URL + SIGIL_LLM_API_KEY (+ SIGIL_LLM_MODEL) it
   judges them through an OpenAI-compatible endpoint. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { type Args, flag, has } from '../cli.js';
import { loadConfig } from '../config.js';
import { makeLlm, NoModelLlm, type LlmClient } from '../llm/client.js';
import { OpenAICompatible } from '../llm/openai.js';
import { intake } from '../task/intake.js';
import { judgeSession } from '../judge/judge.js';
import { appendEvent } from '../store/events.js';
import { sessionDir, ensureDir } from '../paths.js';
import { loadPolicy } from '../policy.js';
import { buildAssurance, renderVerify, renderVerifyMarkdown, MARKDOWN_MARKER, type Assurance } from '../assurance/index.js';

export type Required = 'no-unmet' | 'sufficient' | 'verified';
const REQUIRED: Required[] = ['no-unmet', 'sufficient', 'verified'];

function git(cwd: string, args: string[]): string | null {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 20 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.trim() : null;
}

export interface PullRequest {
  number?: number;
  title?: string;
  body: string;
  url?: string;
  base_ref?: string;
  repo?: string;
}

/* the pull_request event GitHub Actions writes to GITHUB_EVENT_PATH */
export function readPullRequestEvent(env: NodeJS.ProcessEnv = process.env): PullRequest | null {
  const file = env.GITHUB_EVENT_PATH;
  if (!file || !fs.existsSync(file)) return null;
  try {
    const ev = JSON.parse(fs.readFileSync(file, 'utf8')) as { pull_request?: { number?: number; title?: string; body?: string | null; html_url?: string; base?: { ref?: string } }; repository?: { full_name?: string } };
    const pr = ev.pull_request;
    if (!pr) return null;
    return { number: pr.number, title: pr.title, body: pr.body ?? '', url: pr.html_url, base_ref: pr.base?.ref, repo: ev.repository?.full_name ?? env.GITHUB_REPOSITORY };
  } catch {
    return null;
  }
}

/* the task behind a pull request: a task file the body names, a linked issue (#12, "fixes #12", or its URL), else the
   PR title and body as text (an inferred contract, labelled as such on the receipt) */
export function taskRefFromPullRequest(pr: PullRequest, cwd: string): { ref: string; kind: 'file' | 'issue' | 'text' } {
  const body = pr.body ?? '';
  for (const m of body.matchAll(/(?:^|[\s(`"'])((?:[\w-]+\/)*[\w-]+\.md)\b/gi)) {
    const p = path.resolve(cwd, m[1]!);
    if (p.startsWith(path.resolve(cwd)) && fs.existsSync(p)) return { ref: p, kind: 'file' };
  }
  const url = /https?:\/\/github\.com\/[^/\s]+\/[^/\s#?]+\/issues\/\d+/.exec(body)?.[0];
  if (url) return { ref: url, kind: 'issue' };
  const n = /(?:^|\s)(?:(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*)?#(\d+)\b/i.exec(body)?.[1];
  if (n && pr.repo) return { ref: `https://github.com/${pr.repo}/issues/${n}`, kind: 'issue' };
  return { ref: `${pr.title ?? 'Pull request'}\n\n${body}`.trim(), kind: 'text' };
}

/* the commit the pull request branches from: --base, else merge-base with the PR's base branch, else with the default branch */
export function resolveBase(cwd: string, explicit?: string, baseRef?: string): string | null {
  if (explicit) {
    const direct = git(cwd, ['rev-parse', '--verify', `${explicit}^{commit}`]);
    if (!direct) return null;
    /* a branch name as base means "where this branch left it", not its tip */
    return git(cwd, ['merge-base', direct, 'HEAD']) ?? direct;
  }
  const candidates = [baseRef ? `origin/${baseRef}` : '', baseRef ?? '', 'origin/HEAD', 'origin/main', 'origin/master', 'main', 'master'].filter(Boolean);
  for (const c of candidates) {
    if (baseRef && c === `origin/${baseRef}` && !git(cwd, ['rev-parse', '--verify', `${c}^{commit}`])) spawnSync('git', ['fetch', '--quiet', 'origin', baseRef], { cwd, windowsHide: true, timeout: 120000 });
    const mb = git(cwd, ['merge-base', c, 'HEAD']);
    if (mb) return mb;
  }
  return null;
}

export function passes(a: Assurance, required: Required): boolean {
  if (required === 'verified') return a.criteria.every((c) => c.status === 'VERIFIED');
  if (required === 'sufficient') return a.criteria.every((c) => c.status === 'VERIFIED' || c.status === 'SUPPORTED');
  return a.summary.unmet === 0;
}

/* a model for the run, when the environment has one: an OpenAI-compatible endpoint (Anthropic's, OpenAI's, a gateway,
   Ollama) through SIGIL_LLM_BASE_URL / SIGIL_LLM_API_KEY / SIGIL_LLM_MODEL; else the configured provider when its key is
   present; else none */
export function modelForCheck(session: string, cfg: ReturnType<typeof loadConfig>, env: NodeJS.ProcessEnv = process.env): LlmClient {
  if (env.SIGIL_LLM === 'none') return new NoModelLlm();
  if (env.SIGIL_LLM === 'stub') return makeLlm({ session });
  if (env.SIGIL_LLM_BASE_URL && env.SIGIL_LLM_API_KEY) {
    if (env.SIGIL_LLM_MODEL) for (const k of ['intake', 'tier1', 'tier2_escalation', 'judge', 'coach'] as const) cfg.models[k] = env.SIGIL_LLM_MODEL;
    return new OpenAICompatible({ baseUrl: env.SIGIL_LLM_BASE_URL, apiKey: env.SIGIL_LLM_API_KEY, session, usdPerMillionInput: cfg.models.usd_per_million_input, usdPerMillionOutput: cfg.models.usd_per_million_output });
  }
  if (cfg.models.provider === 'openai-compatible' && env[cfg.models.api_key_env]) return makeLlm({ session });
  return new NoModelLlm();
}

/* one comment per pull request: find the one that starts with the marker and update it, else create it. gh carries the
   token (GH_TOKEN in Actions). Failures are reported, never fatal: the check's exit code is about the receipt. */
export function postComment(cwd: string, pr: PullRequest, body: string, say: (s: string) => void): boolean {
  if (!pr.number || !pr.repo) return false;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sigil-check-')), 'comment.md');
  fs.writeFileSync(file, body);
  const gh = (args: string[]) => spawnSync('gh', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  try {
    const list = gh(['api', `repos/${pr.repo}/issues/${pr.number}/comments`, '--paginate', '--jq', `.[] | select(.body | startswith("${MARKDOWN_MARKER}")) | .id`]);
    const id = list.status === 0 ? list.stdout.trim().split('\n').filter(Boolean)[0] : undefined;
    const r = id ? gh(['api', '-X', 'PATCH', `repos/${pr.repo}/issues/comments/${id}`, '-F', `body=@${file}`]) : gh(['api', '-X', 'POST', `repos/${pr.repo}/issues/${pr.number}/comments`, '-F', `body=@${file}`]);
    if (r.status !== 0) {
      say(`sigil check: could not ${id ? 'update' : 'post'} the PR comment: ${(r.stderr || r.stdout).trim().slice(0, 200) || 'gh not available'}`);
      return false;
    }
    say(`sigil check: ${id ? 'updated' : 'posted'} the receipt comment on #${pr.number}`);
    return true;
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

export async function run(args: Args): Promise<number | void> {
  const cwd = path.resolve(flag(args, 'cwd') ?? process.cwd());
  const json = has(args, 'json');
  const say = (s: string) => {
    if (!json) process.stderr.write(s + '\n');
  };
  if (!git(cwd, ['rev-parse', '--show-toplevel'])) {
    process.stderr.write('sigil check: not a git repository.\n');
    return 2;
  }
  const pr = readPullRequestEvent();
  const base = resolveBase(cwd, flag(args, 'base'), pr?.base_ref ?? process.env.GITHUB_BASE_REF);
  const head = git(cwd, ['rev-parse', 'HEAD']);
  if (!base || !head) {
    process.stderr.write('sigil check: could not find the base commit. Pass --base <sha|branch>; in Actions use actions/checkout with fetch-depth: 0.\n');
    return 2;
  }
  const taskArg = flag(args, 'task');
  const taskRef = taskArg ? { ref: /\.md$/i.test(taskArg) && !/^https?:/.test(taskArg) ? path.resolve(cwd, taskArg) : taskArg, kind: 'given' as const } : pr ? taskRefFromPullRequest(pr, cwd) : null;
  if (!taskRef) {
    process.stderr.write('sigil check: no task. Pass --task <issue url | tasks/x.md | "text">, or run in a pull_request workflow.\n');
    return 2;
  }
  const cfg = loadConfig();
  cfg.judge.maintainer_review = 'off';
  const pol = loadPolicy(cwd);
  const reqFlag = flag(args, 'require');
  if (reqFlag && !REQUIRED.includes(reqFlag as Required)) {
    process.stderr.write(`sigil check: --require must be one of ${REQUIRED.join(', ')}.\n`);
    return 2;
  }
  const required = (reqFlag as Required | undefined) ?? pol.policy.verification.required;
  const runTests = !has(args, 'no-tests') && pol.policy.verification.run_tests;
  const session = `ci-${head.slice(0, 12)}`;
  const dir = sessionDir(session);
  ensureDir(dir);
  /* a re-run judges again: nothing from the last run of this commit is reused */
  for (const f of ['task.json', 'judge.json', 'events.jsonl', 'contract.json', 'progress.json']) fs.rmSync(path.join(dir, f), { force: true });
  const llm = has(args, 'no-model') ? new NoModelLlm() : modelForCheck(session, cfg);
  appendEvent({ ts: new Date().toISOString(), type: 'session_start', session, cwd, data: { agent: 'ci', git_head: base, source: 'sigil check', pr: pr?.number ?? null, head } });
  const range = `${base.slice(0, 8)}..${head.slice(0, 8)}`;
  say(`Sigil check: ${range} in ${cwd}${llm.noModel ? ' (no model: mechanical checks and tests only)' : ''}`);
  const isText = taskRef.kind === 'text' || (taskRef.kind === 'given' && !/^https?:/.test(taskRef.ref) && !/\.md$/i.test(taskRef.ref) && !/^[A-Z][A-Z0-9]+-\d+$/.test(taskRef.ref));
  const { task } = await intake({ session, cwd, ref: isText ? undefined : taskRef.ref, text: isText ? taskRef.ref : undefined, cfg, llm, force: true, noCache: true });
  say(`Task: ${task.title} · ${task.criteria.length} criteria (${task.criteria.filter((c) => c.kind === 'mechanical').length} mechanical)${task.fetch_error ? ` · ${task.fetch_error}` : ''}`);
  const j = await judgeSession({ session, cwd, transcriptPath: path.join(dir, 'no-transcript.jsonl'), cfg, llm, reason: 'pr', consent: runTests, task });
  const a = j.assurance ?? buildAssurance({ judge: j, task, cwd, agent: { product: 'ci' } });
  const ok = passes(a, required);
  const md = renderVerifyMarkdown(a, { range, required, passed: ok, noModel: !!llm.noModel });
  if (json) process.stdout.write(JSON.stringify({ ...a, check: { base, head, required, passed: ok, no_model: !!llm.noModel, tests_run: j.verification.ran } }, null, 2) + '\n');
  else process.stdout.write(renderVerify(a, { color: !!process.stdout.isTTY && !process.env.CI }) + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
    } catch {
      /* the summary is a convenience */
    }
  }
  if (process.env.GITHUB_OUTPUT) {
    try {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `passed=${ok}\nrequired=${required}\nverified=${a.summary.verified}\nsupported=${a.summary.supported}\nunverified=${a.summary.unverified}\nunmet=${a.summary.unmet}\ntotal=${a.summary.total}\n`);
    } catch {
      /* same */
    }
  }
  const wantComment = has(args, 'comment') || (!has(args, 'no-comment') && pol.policy.verification.comment);
  if (wantComment && pr?.number) postComment(cwd, pr, md, say);
  if (!ok) {
    say(`sigil check: the bar is "${required}" and the receipt does not meet it (${a.summary.verified} verified, ${a.summary.supported} supported, ${a.summary.unverified} unverified, ${a.summary.unmet} unmet).`);
    return 1;
  }
  say(`sigil check: passed (${required}).`);
  return 0;
}
