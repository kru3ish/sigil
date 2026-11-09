#!/usr/bin/env node
import { createRequire as __sigilCreateRequire } from "node:module";
const require = __sigilCreateRequire(import.meta.url);

// src/hooks/hook.ts
import fs5 from "node:fs";

// src/agents/index.ts
import os from "node:os";
import path from "node:path";
var ALL_CANONICAL = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "PreCompact", "Notification", "SessionEnd"];
function home() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}
function asRecord(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function isSigil(cmd) {
  return typeof cmd === "string" && /hook\.js["']?\s|sigil|tally/.test(cmd) && /--agent|sigil|tally/.test(cmd);
}
var claudeCode = {
  id: "claude-code",
  label: "Claude Code",
  capabilities: { lifecycle_hooks: true, tool_calls: true, shell_commands: true, file_reads: true, file_edits: true, permission_hooks: true, stop_hook: true, context_events: true, subagents: true, transcript: true, token_usage: true, model_name: true, cost: true },
  sessionEnv: "CLAUDE_SESSION_ID",
  subscribed: ALL_CANONICAL,
  event: (name) => ALL_CANONICAL.includes(name) ? name : "Unknown",
  normalize: (raw) => raw,
  output(out) {
    if (out.kind === "notice") return { systemMessage: out.text };
    if (out.kind === "context") return { hookSpecificOutput: { hookEventName: out.event, additionalContext: out.text } };
    if (out.kind === "deny") return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: out.reason } };
    return { decision: "block", reason: out.reason };
  },
  hooksFile: () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home(), ".claude"), "settings.json"),
  writeHooks: (existing) => existing,
  removeHooks: (existing) => existing,
  transcriptRoots: () => [path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home(), ".claude"), "projects")]
};
function codexTool(raw) {
  const name = typeof raw.tool_name === "string" ? raw.tool_name : void 0;
  const input = asRecord(raw.tool_input);
  if (name === "apply_patch") {
    const patch = typeof input.input === "string" ? input.input : typeof input.patch === "string" ? input.patch : JSON.stringify(input);
    const m = /\*\*\* (?:Update|Add|Delete) File: (.+)/.exec(patch);
    return { tool_name: /\*\*\* Add File/.test(patch) && !/\*\*\* Update File/.test(patch) ? "Write" : "Edit", tool_input: { file_path: m?.[1]?.trim() ?? "", patch: patch.slice(0, 600) } };
  }
  if (name === "shell" || name === "exec_command" || name === "local_shell") {
    const cmd = Array.isArray(input.command) ? input.command.map(String).join(" ") : typeof input.cmd === "string" ? input.cmd : input.command;
    return { tool_name: "Bash", tool_input: { ...input, command: typeof cmd === "string" ? cmd : String(cmd ?? "") } };
  }
  return { tool_name: name, tool_input: input };
}
var codex = {
  id: "codex",
  label: "Codex CLI",
  capabilities: { lifecycle_hooks: true, tool_calls: true, shell_commands: true, file_reads: false, file_edits: true, permission_hooks: true, stop_hook: true, context_events: true, subagents: true, transcript: true, token_usage: true, model_name: true, cost: true, notes: "file reads are not a separate tool in Codex (apply_patch edits, shell reads); rollout format read from public descriptions, so a file without recognisable token counts is labelled partial" },
  subscribed: ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "PreCompact", "SessionEnd"],
  event: (name) => ALL_CANONICAL.includes(name) ? name : "Unknown",
  normalize: (raw) => ({ ...raw, ...codexTool(raw) }),
  output(out) {
    if (out.kind === "notice") return { systemMessage: out.text };
    if (out.kind === "context") return { hookSpecificOutput: { hookEventName: out.event, additionalContext: out.text } };
    if (out.kind === "deny") return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: out.reason } };
    return { decision: "block", reason: out.reason };
  },
  hooksFile: () => path.join(process.env.CODEX_HOME || path.join(home(), ".codex"), "hooks.json"),
  writeHooks(existing, command) {
    const doc = asRecord(existing);
    const hooks = asRecord(doc.hooks);
    for (const ev of this.subscribed) {
      const groups = Array.isArray(hooks[ev]) ? hooks[ev] : [];
      const kept = groups.filter((g) => !(Array.isArray(g.hooks) && g.hooks.some((h) => isSigil(h.command))));
      kept.push({ hooks: [{ type: "command", command: command(ev), timeout: 5 }] });
      hooks[ev] = kept;
    }
    return { ...doc, hooks };
  },
  removeHooks(existing) {
    const doc = asRecord(existing);
    const hooks = asRecord(doc.hooks);
    for (const ev of Object.keys(hooks)) {
      const groups = Array.isArray(hooks[ev]) ? hooks[ev] : [];
      const kept = groups.filter((g) => !(Array.isArray(g.hooks) && g.hooks.some((h) => isSigil(h.command))));
      if (kept.length) hooks[ev] = kept;
      else delete hooks[ev];
    }
    return { ...doc, hooks };
  },
  transcriptRoots: () => [path.join(process.env.CODEX_HOME || path.join(home(), ".codex"), "sessions")]
};
var GEMINI_EVENTS = { SessionStart: "SessionStart", SessionEnd: "SessionEnd", BeforeAgent: "UserPromptSubmit", AfterAgent: "Stop", BeforeTool: "PreToolUse", AfterTool: "PostToolUse", PreCompress: "PreCompact", Notification: "Notification" };
var GEMINI_TOOLS = { run_shell_command: "Bash", write_file: "Write", replace: "Edit", edit: "Edit", read_file: "Read", read_many_files: "Read", glob: "Glob", grep_search: "Grep", search_file_content: "Grep", web_fetch: "WebFetch", google_web_search: "WebSearch" };
var gemini = {
  id: "gemini",
  label: "Gemini CLI",
  capabilities: { lifecycle_hooks: true, tool_calls: true, shell_commands: true, file_reads: true, file_edits: true, permission_hooks: true, stop_hook: true, context_events: true, subagents: false, transcript: false, token_usage: false, model_name: false, cost: false, notes: "no documented transcript with token usage: receipts carry criteria, tests and tool-call counts, no dollars" },
  sessionEnv: "GEMINI_SESSION_ID",
  subscribed: ["SessionStart", "BeforeAgent", "BeforeTool", "AfterTool", "AfterAgent", "PreCompress", "SessionEnd"],
  event: (name) => GEMINI_EVENTS[name] ?? "Unknown",
  normalize(raw, agentEvent) {
    const name = typeof raw.tool_name === "string" ? raw.tool_name : void 0;
    const out = { ...raw, hook_event_name: this.event(agentEvent) };
    if (name) out.tool_name = GEMINI_TOOLS[name] ?? (name.startsWith("mcp__") ? name : `mcp__gemini__${name}`);
    if (agentEvent === "AfterAgent" && typeof raw.prompt_response === "string") out.last_assistant_message = raw.prompt_response;
    return out;
  },
  output(out) {
    if (out.kind === "notice") return { systemMessage: out.text };
    if (out.kind === "context") return { hookSpecificOutput: { hookEventName: out.event, additionalContext: out.text } };
    if (out.kind === "deny") return { decision: "deny", reason: out.reason, systemMessage: out.reason };
    return { decision: "block", reason: out.reason };
  },
  hooksFile: () => path.join(home(), ".gemini", "settings.json"),
  writeHooks(existing, command) {
    const doc = asRecord(existing);
    const hooks = asRecord(doc.hooks);
    for (const ev of this.subscribed) {
      const groups = Array.isArray(hooks[ev]) ? hooks[ev] : [];
      const kept = groups.filter((g) => !(Array.isArray(g.hooks) && g.hooks.some((h) => h.name === "sigil" || isSigil(h.command))));
      kept.push({ matcher: "*", hooks: [{ name: "sigil", type: "command", command: command(this.event(ev)), timeout: 5e3 }] });
      hooks[ev] = kept;
    }
    return { ...doc, hooks };
  },
  removeHooks(existing) {
    const doc = asRecord(existing);
    const hooks = asRecord(doc.hooks);
    for (const ev of Object.keys(hooks)) {
      const groups = Array.isArray(hooks[ev]) ? hooks[ev] : [];
      const kept = groups.filter((g) => !(Array.isArray(g.hooks) && g.hooks.some((h) => h.name === "sigil" || isSigil(h.command))));
      if (kept.length) hooks[ev] = kept;
      else delete hooks[ev];
    }
    return { ...doc, hooks };
  }
};
var CURSOR_EVENTS = { sessionStart: "SessionStart", sessionEnd: "SessionEnd", beforeSubmitPrompt: "UserPromptSubmit", preToolUse: "PreToolUse", postToolUse: "PostToolUse", postToolUseFailure: "PostToolUseFailure", beforeShellExecution: "PreToolUse", afterShellExecution: "PostToolUse", afterFileEdit: "PostToolUse", stop: "Stop", preCompact: "PreCompact" };
var cursor = {
  id: "cursor",
  label: "Cursor",
  capabilities: { lifecycle_hooks: true, tool_calls: true, shell_commands: true, file_reads: true, file_edits: true, permission_hooks: true, stop_hook: true, context_events: true, subagents: true, transcript: false, token_usage: false, model_name: true, cost: false, notes: "the stop hook continues the agent with a follow-up message rather than blocking; no documented transcript with token usage, so no dollars" },
  subscribed: ["sessionStart", "beforeSubmitPrompt", "beforeShellExecution", "afterShellExecution", "afterFileEdit", "preToolUse", "postToolUse", "stop", "sessionEnd"],
  event: (name) => CURSOR_EVENTS[name] ?? "Unknown",
  normalize(raw, agentEvent) {
    const roots = Array.isArray(raw.workspace_roots) ? raw.workspace_roots.map(String) : [];
    const out = {
      ...raw,
      hook_event_name: this.event(agentEvent),
      session_id: typeof raw.conversation_id === "string" ? raw.conversation_id : typeof raw.session_id === "string" ? raw.session_id : void 0,
      cwd: typeof raw.cwd === "string" ? raw.cwd : roots[0],
      transcript_path: typeof raw.transcript_path === "string" ? raw.transcript_path : void 0
    };
    if (agentEvent === "beforeShellExecution" || agentEvent === "afterShellExecution") {
      out.tool_name = "Bash";
      out.tool_input = { command: String(raw.command ?? "") };
      if (agentEvent === "afterShellExecution") out.tool_response = raw.output ?? raw.result ?? "";
    } else if (agentEvent === "afterFileEdit") {
      out.tool_name = "Edit";
      out.tool_input = { file_path: String(raw.file_path ?? ""), edits: raw.edits };
      out.tool_response = "";
    } else if (agentEvent === "postToolUse") {
      out.tool_response = raw.tool_output;
    } else if (agentEvent === "beforeSubmitPrompt") {
      out.prompt = typeof raw.prompt === "string" ? raw.prompt : typeof raw.text === "string" ? raw.text : "";
    } else if (agentEvent === "stop") {
      out.stop_hook_active = typeof raw.loop_count === "number" && raw.loop_count > 0;
    }
    return out;
  },
  output(out) {
    if (out.kind === "notice") return null;
    if (out.kind === "context") return out.event === "SessionStart" ? { additional_context: out.text } : { additional_context: out.text };
    if (out.kind === "deny") return { permission: "deny", user_message: out.reason, agent_message: out.reason };
    return { followup_message: out.reason };
  },
  hooksFile: () => path.join(home(), ".cursor", "hooks.json"),
  writeHooks(existing, command) {
    const doc = asRecord(existing);
    const hooks = asRecord(doc.hooks);
    for (const ev of this.subscribed) {
      const list = Array.isArray(hooks[ev]) ? hooks[ev] : [];
      const kept = list.filter((h) => !isSigil(h.command));
      kept.push({ type: "command", command: command(this.event(ev)), timeout: 5 });
      hooks[ev] = kept;
    }
    return { version: 1, ...doc, hooks };
  },
  removeHooks(existing) {
    const doc = asRecord(existing);
    const hooks = asRecord(doc.hooks);
    for (const ev of Object.keys(hooks)) {
      const list = Array.isArray(hooks[ev]) ? hooks[ev] : [];
      const kept = list.filter((h) => !isSigil(h.command));
      if (kept.length) hooks[ev] = kept;
      else delete hooks[ev];
    }
    return { ...doc, hooks };
  }
};
var ADAPTERS = { "claude-code": claudeCode, codex, gemini, cursor };
function agent(id) {
  return ADAPTERS[id ?? "claude-code"] ?? claudeCode;
}
function agentFromArgv(argv) {
  const rest = [];
  let id = process.env.SIGIL_AGENT;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--agent" && argv[i + 1]) {
      id = argv[++i];
      continue;
    }
    const m = /^--agent=(.+)$/.exec(a);
    if (m) {
      id = m[1];
      continue;
    }
    rest.push(a);
  }
  return { adapter: agent(id), rest };
}

// src/hooks/hook.ts
import path6 from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// src/paths.ts
import os2 from "node:os";
import path2 from "node:path";
import fs from "node:fs";
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith("TALLY_") && process.env[`SIGIL_${k.slice(6)}`] === void 0) process.env[`SIGIL_${k.slice(6)}`] = v;
}
var LEGACY_HOME_NAME = ".tally";
function sigilHome() {
  if (process.env.SIGIL_HOME) return process.env.SIGIL_HOME;
  const home2 = path2.join(os2.homedir(), ".sigil");
  if (fs.existsSync(home2)) return home2;
  const legacy = path2.join(os2.homedir(), LEGACY_HOME_NAME);
  return fs.existsSync(legacy) ? legacy : home2;
}
function claudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || path2.join(os2.homedir(), ".claude");
}
function sessionsDir() {
  return path2.join(sigilHome(), "sessions");
}
function sessionDir(id) {
  return path2.join(sessionsDir(), safeId(id));
}
function safeId(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function historyFile() {
  return path2.join(sigilHome(), "history.jsonl");
}
function configFile() {
  return path2.join(sigilHome(), "config.json");
}
function activeFile() {
  return path2.join(sigilHome(), "active.json");
}
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  ensureDir(path2.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}
function appendLine(file, line) {
  ensureDir(path2.dirname(file));
  fs.appendFileSync(file, line.endsWith("\n") ? line : line + "\n");
}
function repoKey(cwd) {
  return cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

// src/store/events.ts
import fs2 from "node:fs";
import path3 from "node:path";
function eventsFile(sessionId) {
  return path3.join(sessionDir(sessionId), "events.jsonl");
}
function readEvents(sessionId) {
  return readEventsFile(eventsFile(sessionId));
}
function readEventsFile(file) {
  if (!fs2.existsSync(file)) return [];
  const out = [];
  for (const line of fs2.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
    }
  }
  return out;
}

// src/redact.ts
var PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{10,}/g, "sk-ant-***"],
  [/sk-[A-Za-z0-9]{20,}/g, "sk-***"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, "gh*_***"],
  [/github_pat_[A-Za-z0-9_]{20,}/g, "github_pat_***"],
  [/AKIA[0-9A-Z]{16}/g, "AKIA***"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, "xox*-***"],
  [/lin_api_[A-Za-z0-9]{10,}/g, "lin_api_***"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1***"],
  [/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, "$1***$2"],
  [/((?:api[_-]?key|token|secret|password|passwd|pwd|authorization)\s*[=:]\s*["']?)([^\s"'&,;]{6,})/gi, "$1***"],
  [/(https?:\/\/[^\s:@/]+:)[^\s@/]+(@)/g, "$1***$2"]
];
function redact(text) {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}
function redactDeep(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out;
  }
  return value;
}

// src/judge/quickcheck.ts
import fs3 from "node:fs";
import path4 from "node:path";
import { spawnSync } from "node:child_process";
function safeRegex(p) {
  try {
    return new RegExp(p, "i");
  } catch {
    return null;
  }
}
function baseHead(session) {
  const f = path4.join(sessionDir(session), "events.jsonl");
  if (!fs3.existsSync(f)) return void 0;
  for (const line of fs3.readFileSync(f, "utf8").split("\n")) {
    if (!line.includes('"session_start"')) continue;
    try {
      const e = JSON.parse(line);
      if (e.type === "session_start" && e.data?.git_head) return e.data.git_head;
    } catch {
    }
  }
  return void 0;
}
function gitDiff(cwd, base) {
  if (!fs3.existsSync(path4.join(cwd, ".git"))) return { files: [], text: "" };
  const range = base ? [base] : ["HEAD"];
  const names = spawnSync("git", ["diff", "--name-only", ...range], { cwd, encoding: "utf8", windowsHide: true, timeout: 3e3 });
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd, encoding: "utf8", windowsHide: true, timeout: 3e3 });
  const files = [...(names.stdout ?? "").split("\n"), ...(untracked.stdout ?? "").split("\n")].map((s) => s.trim()).filter(Boolean);
  const diff = spawnSync("git", ["diff", "--no-color", ...range], { cwd, encoding: "utf8", windowsHide: true, timeout: 3e3, maxBuffer: 8 * 1024 * 1024 });
  return { files, text: diff.stdout ?? "" };
}
var norm = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
function quickChecks(session, cwd) {
  const task = readJson(path4.join(sessionDir(session), "task.json"), null);
  const criteria = task?.criteria ?? [];
  const items = [];
  let diff = null;
  const getDiff = () => diff ??= cwd ? gitDiff(cwd, baseHead(session)) : { files: [], text: "" };
  for (const c of criteria) {
    const ch = c.check;
    if (!ch || ch.kind === "none") {
      items.push({ id: c.id, text: c.text, kind: "judgment", status: "unknown", why: "needs the Judge (a reader decides this one)" });
      continue;
    }
    if (ch.kind === "file_exists" && ch.path && cwd) {
      const ok = fs3.existsSync(path4.join(cwd, ch.path));
      items.push({ id: c.id, text: c.text, kind: ch.kind, status: ok ? "met" : "unmet", why: `${ch.path} ${ok ? "exists" : "does not exist"}` });
    } else if (ch.kind === "file_contains" && ch.path && ch.pattern && cwd) {
      const p = path4.join(cwd, ch.path);
      const re = safeRegex(ch.pattern);
      if (!fs3.existsSync(p)) items.push({ id: c.id, text: c.text, kind: ch.kind, status: fs3.existsSync(path4.dirname(p)) ? "unmet" : "unknown", why: `${ch.path} does not exist${fs3.existsSync(path4.dirname(p)) ? "" : " (nor its directory; the path may be a guess)"}` });
      else if (!re) items.push({ id: c.id, text: c.text, kind: ch.kind, status: "unknown", why: "invalid pattern" });
      else {
        const ok = re.test(fs3.readFileSync(p, "utf8"));
        items.push({ id: c.id, text: c.text, kind: ch.kind, status: ok ? "met" : "unmet", why: `${ch.path} ${ok ? "matches" : "does not match"} /${ch.pattern}/` });
      }
    } else if (ch.kind === "file_changed" && ch.path) {
      const d = getDiff();
      const want = norm(ch.path);
      const hit = ch.path === "." || ch.path === "*" ? d.files[0] : d.files.find((f) => norm(f) === want || norm(f).endsWith("/" + want) || want.endsWith("/" + norm(f)));
      items.push({ id: c.id, text: c.text, kind: ch.kind, status: hit ? "met" : "unmet", why: hit ? `${hit} is changed` : `${ch.path} is not changed yet (${d.files.length} file(s) changed so far)` });
    } else if (ch.kind === "diff_contains" && ch.pattern) {
      const d = getDiff();
      const re = safeRegex(ch.pattern);
      const ok = !!re && re.test(d.text);
      items.push({ id: c.id, text: c.text, kind: ch.kind, status: ok ? "met" : "unmet", why: ok ? `the diff matches /${ch.pattern}/` : `the diff does not match /${ch.pattern}/ yet` });
    } else {
      items.push({ id: c.id, text: c.text, kind: ch.kind, status: "unknown", why: ch.kind === "tests_pass" ? "tests are run by the Judge (sigil judge), not here" : ch.kind === "pr" ? "decided by the push / PR events at judge time" : `${ch.kind} is run by the Judge` });
    }
  }
  const checked = items.filter((i) => i.status !== "unknown").length;
  const progress = { ts: (/* @__PURE__ */ new Date()).toISOString(), met: items.filter((i) => i.status === "met").length, checked, total: items.length, items };
  try {
    writeJson(path4.join(sessionDir(session), "progress.json"), progress);
  } catch {
  }
  return progress;
}

// src/recall/match.ts
import fs4 from "node:fs";
import path5 from "node:path";
import { createHash } from "node:crypto";

// src/text/similarity.ts
var STOP = new Set(
  "the and for with that this from into have has are was were will would should could can not but you your our their them they its use using please make need needs want also then than when what which there here just like some any all each other more most very about after before over under only into onto off out via per a an to of in on at by is it be as or if so do we i me my".split(" ")
);
function tokenize(text) {
  return text.toLowerCase().replace(/<\/?pasted_content[^>]*>/g, " ").replace(/https?:\/\/\S+/g, (u) => u.replace(/[/.:#?=&_-]+/g, " ")).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w) && w.length < 30);
}
function termCounts(tokens) {
  const m = /* @__PURE__ */ new Map();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}
function vectorize(counts, idf, fallbackIdf) {
  const v = /* @__PURE__ */ new Map();
  let norm2 = 0;
  for (const [t, n] of counts) {
    const w = (1 + Math.log(n)) * (idf.get(t) ?? fallbackIdf);
    v.set(t, w);
    norm2 += w * w;
  }
  norm2 = Math.sqrt(norm2) || 1;
  for (const [t, w] of v) v.set(t, w / norm2);
  return v;
}
function cosine(a, b) {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [t, w] of small) s += w * (large.get(t) ?? 0);
  return s;
}
function index(texts) {
  const counts = texts.map((t) => termCounts(tokenize(t)));
  const df = /* @__PURE__ */ new Map();
  for (const c of counts) for (const t of c.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const N = texts.length;
  const idf = /* @__PURE__ */ new Map();
  for (const [t, n] of df) idf.set(t, Math.log((N + 1) / (n + 1)) + 1);
  const fallbackIdf = Math.log(N + 1) + 1;
  return { idf, fallbackIdf, vectors: counts.map((c) => vectorize(c, idf, fallbackIdf)) };
}
function rank(query, texts) {
  const ix = index(texts);
  const q = vectorize(termCounts(tokenize(query)), ix.idf, ix.fallbackIdf);
  if (!q.size) return [];
  return ix.vectors.map((v, i) => ({ i, sim: cosine(q, v) })).filter((x) => x.sim > 0).sort((a, b) => b.sim - a.sim);
}

// src/recall/match.ts
var RECALL_MIN_SIMILARITY = 0.35;
var RECALL_MIN_PROMPT_CHARS = 20;
function recallSettings() {
  const raw = readJson(configFile(), {});
  const r = raw.recall ?? {};
  return { enabled: r.enabled !== false, min: typeof r.min_similarity === "number" ? r.min_similarity : RECALL_MIN_SIMILARITY, dir: typeof r.dir === "string" && r.dir ? r.dir : void 0 };
}
function recallKey(cwd) {
  const key = repoKey(cwd);
  const slug = key.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(-60);
  return `${slug || "repo"}-${createHash("sha1").update(key).digest("hex").slice(0, 8)}`;
}
function recallDir(cwd, dir = recallSettings().dir) {
  return path5.join(dir ?? path5.join(sigilHome(), "recall"), recallKey(cwd));
}
function readCards(cwd) {
  const dir = recallDir(cwd);
  if (!fs4.existsSync(dir)) return [];
  const out = [];
  for (const f of fs4.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const c = readJson(path5.join(dir, f), null);
    if (c && c.v === 1 && c.title && c.outcome) out.push(c);
  }
  return out.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
}
function worthMatching(prompt) {
  const p = prompt.trim();
  return p.length >= RECALL_MIN_PROMPT_CHARS && !p.startsWith("/") && !/^(yes|no|ok|okay|go|continue|done|thanks)\b/i.test(p);
}
function matchRecall(query, cards, opts = {}) {
  const pool = cards.filter((c) => c.session !== opts.exclude);
  if (!pool.length) return [];
  const min = opts.min ?? RECALL_MIN_SIMILARITY;
  return rank(query, pool.map((c) => `${c.title}
${c.text}`)).filter((r) => r.sim >= min).slice(0, opts.limit ?? 3).map((r) => ({ card: pool[r.i], similarity: Math.round(r.sim * 100) / 100 }));
}
function findRecall(prompt, cwd, session, min) {
  if (!worthMatching(prompt)) return [];
  return matchRecall(prompt, readCards(cwd), { exclude: session, min });
}
var cut = (s, n) => s.length > n ? s.slice(0, n - 1).trimEnd() + "\u2026" : s;
function recallNote(m, cli = "sigil") {
  const c = m.card;
  const when = (c.started ?? c.updated).slice(0, 10);
  const files = c.files.length ? ` Files it touched: ${c.files.slice(0, 6).join(", ")}${c.files.length > 6 ? ` (+${c.files.length - 6})` : ""}.` : "";
  return `Sigil recall: a task like this ran in this repo on ${when} and cost $${c.cost_usd.toFixed(2)}: "${cut(c.title, 80)}". Outcome then: ${cut(c.outcome.replace(/\s+/g, " "), 400)}${files} Reuse that work before re-deriving it; the full card: ${cli} recall ${c.session.slice(0, 8)}`;
}

// src/hooks/hook.ts
var here = path6.dirname(fileURLToPath(import.meta.url));
var CLI = process.env.SIGIL_HOOK_CLI || [path6.join(here, "cli.js"), path6.join(here, "..", "cli.js")].find((p) => fs5.existsSync(p)) || path6.join(here, "cli.js");
var SHIP_RE = /\bgit\s+push\b|\bgh\s+pr\s+(create|merge)\b|\bnpm\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b/;
var TASK_URL_RE = /https?:\/\/(github\.com\/[^\s/]+\/[^\s/]+\/(issues|pull)\/\d+|[^\s]+\.atlassian\.net\/browse\/[A-Z][A-Z0-9]+-\d+|linear\.app\/[^\s]+\/issue\/[A-Z0-9]+-\d+[^\s]*)/;
var TASK_MD_RE = /(?:^|[\s`"'(])((?:[A-Za-z]:)?[^\s"'`]+?\.md)(?=[\s.,;:!?)"'`]|$)/;
var MAX_FIELD = 2e3;
function readStdin() {
  try {
    return fs5.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}
function truncate(s, n = MAX_FIELD) {
  const str = typeof s === "string" ? s : JSON.stringify(s ?? "");
  return str.length > n ? str.slice(0, n) + `\u2026[+${str.length - n}]` : str;
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function record(session, type, cwd, data) {
  const ev = { ts: nowIso(), type, session, cwd, data: redactDeep(data) };
  appendLine(path6.join(sessionDir(session), "events.jsonl"), JSON.stringify(ev));
}
function alreadySeen(session, event, toolUseId) {
  if (!toolUseId) return false;
  const file = path6.join(sessionDir(session), "seen.txt");
  const key = `${event}:${toolUseId}
`;
  try {
    if (fs5.existsSync(file) && fs5.readFileSync(file, "utf8").includes(key)) return true;
    fs5.appendFileSync(file, key);
  } catch {
  }
  return false;
}
function spawnDetached(args) {
  if (process.env.SIGIL_NO_SPAWN) {
    appendLine(path6.join(sigilHome(), "spawn.log"), JSON.stringify({ ts: nowIso(), args }));
    return;
  }
  try {
    const child = spawn(process.execPath, [CLI, ...args], { detached: true, stdio: "ignore", windowsHide: true, env: process.env });
    child.unref();
  } catch {
  }
}
function gitHead(cwd) {
  if (!cwd) return void 0;
  try {
    let dir = cwd;
    for (let i = 0; i < 6; i++) {
      const gitPath = path6.join(dir, ".git");
      if (fs5.existsSync(gitPath)) {
        let gitDir = gitPath;
        if (fs5.statSync(gitPath).isFile()) {
          const m = /gitdir:\s*(.+)/.exec(fs5.readFileSync(gitPath, "utf8"));
          if (!m) return void 0;
          gitDir = path6.resolve(dir, m[1].trim());
        }
        const head = fs5.readFileSync(path6.join(gitDir, "HEAD"), "utf8").trim();
        const ref = /^ref:\s*(.+)$/.exec(head);
        if (!ref) return head;
        const refFile = path6.join(gitDir, ref[1]);
        if (fs5.existsSync(refFile)) return fs5.readFileSync(refFile, "utf8").trim();
        const packed = path6.join(gitDir, "packed-refs");
        if (fs5.existsSync(packed)) {
          for (const line of fs5.readFileSync(packed, "utf8").split("\n")) {
            const [sha, name] = line.split(" ");
            if (name === ref[1]) return sha;
          }
        }
        return void 0;
      }
      const parent = path6.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
  }
  return void 0;
}
function loadedInventory(cwd) {
  const mcp = /* @__PURE__ */ new Set();
  const skills = /* @__PURE__ */ new Set();
  const plugins = /* @__PURE__ */ new Set();
  try {
    const home2 = claudeHome();
    const global = readJson(path6.join(path6.dirname(home2), ".claude.json"), {});
    for (const k of Object.keys(global.mcpServers ?? {})) mcp.add(k);
    if (cwd) for (const k of Object.keys(global.projects?.[cwd]?.mcpServers ?? {})) mcp.add(k);
    if (cwd) {
      const proj = readJson(path6.join(cwd, ".mcp.json"), {});
      for (const k of Object.keys(proj.mcpServers ?? {})) mcp.add(k);
    }
    const settings = readJson(path6.join(home2, "settings.json"), {});
    for (const [k, v] of Object.entries(settings.enabledPlugins ?? {})) if (v) plugins.add(k.split("@")[0]);
    const skillDirs = [path6.join(home2, "skills"), cwd ? path6.join(cwd, ".claude", "skills") : ""].filter(Boolean);
    for (const d of skillDirs) {
      if (!fs5.existsSync(d)) continue;
      for (const s of fs5.readdirSync(d)) if (fs5.existsSync(path6.join(d, s, "SKILL.md"))) skills.add(s);
    }
  } catch {
  }
  return { mcp: [...mcp], skills: [...skills], plugins: [...plugins] };
}
function updateActive(session, patch, remove = false) {
  const file = activeFile();
  const active = readJson(file, {});
  if (remove) delete active[session];
  else active[session] = { ...active[session] ?? {}, ...patch, last_seen: nowIso() };
  const cutoff = Date.now() - 24 * 3600 * 1e3;
  for (const [k, v] of Object.entries(active)) if (Date.parse(String(v.last_seen ?? "")) < cutoff) delete active[k];
  writeJson(file, active);
}
function dodGate(session, cwd, stopHookActive) {
  if (stopHookActive || !fs5.existsSync(path6.join(sessionDir(session), "task.json"))) return void 0;
  const cfg = readJson(configFile(), {});
  if (cfg.coach?.dod_gate !== true) return void 0;
  const task = readJson(path6.join(sessionDir(session), "task.json"), {});
  if (task.inferred && !task.confirmed) return void 0;
  if (task.needs_clarification && !task.confirmed) return void 0;
  if (!readEvents(session).some((e) => e.type === "pre_tool" && ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(String(e.data.tool_name)))) return void 0;
  const max = cfg.coach?.dod_max_blocks ?? 1;
  const marker = path6.join(sessionDir(session), "dod-gate.json");
  const state = readJson(marker, { blocks: 0 });
  const progress = quickChecks(session, cwd);
  const unmet = progress.items.filter((i) => i.status === "unmet");
  if (!unmet.length || state.blocks >= max) return void 0;
  writeJson(marker, { blocks: state.blocks + 1, ts: nowIso(), unmet: unmet.map((u) => u.id) });
  record(session, "dod_gate", cwd, { unmet: unmet.map((u) => u.id), block: state.blocks + 1 });
  const reason = `Sigil: ${unmet.length} acceptance criteri${unmet.length === 1 ? "on is" : "a are"} still unmet by mechanical check: ${unmet.map((u) => `${u.id} "${u.text}" (${u.why})`).join("; ")}. Address ${unmet.length === 1 ? "it" : "them"}, or say why ${unmet.length === 1 ? "it is" : "they are"} out of scope.`;
  return { decision: "block", reason };
}
function costNotice(session) {
  const dir = sessionDir(session);
  const task = readJson(path6.join(dir, "task.json"), null);
  if (!task) return void 0;
  const est = readJson(path6.join(dir, "estimate.json"), null);
  const check = readJson(path6.join(dir, "cost-check.json"), null);
  const live = readJson(path6.join(dir, "spend.json"), null);
  const spend = Math.max(live?.usd ?? 0, check?.actual_usd ?? 0);
  const stateFile = path6.join(dir, "cost-notice.json");
  const state = readJson(stateFile, { shown: [] });
  const money = (n) => `$${n.toFixed(2)}`;
  const budget = task.budget_usd ?? 0;
  const basis = task.budget_basis ?? (budget > 0 ? "hours" : "none");
  let key;
  let text = "";
  if (budget <= 0) {
    if (state.shown.includes("cap") || spend < 0.5) return void 0;
    key = "cap";
    const seen = est?.basis && est.basis !== "none" ? `${est.n ?? 0} past tasks on record, none like this one` : "no past tasks on record yet";
    text = `Sigil: no comparable past task to price "${(task.title ?? "this task").slice(0, 60)}" (${seen}); ${money(spend)} spent so far. Set a cap so Sigil can hold the line: tell Claude "cap this at $40" (it runs sigil budget set 40), or /sigil:budget set 40.`;
  } else {
    const shipped = fs5.existsSync(path6.join(dir, "events.jsonl")) && fs5.readFileSync(path6.join(dir, "events.jsonl"), "utf8").includes('"type":"ship"');
    const drivers = check?.drivers ?? [];
    const top = drivers.find((d) => d.fix && d.fix.apply.kind !== "advice");
    const fixCmd = (id) => process.env.CLAUDE_PLUGIN_ROOT ? `/sigil:fix ${id}` : `sigil fix ${id}`;
    const lever = top ? ` Fix for next time: ${top.title.toLowerCase()} (~${money(top.usd)}) \u2192 ${fixCmd(top.fix.id)}.` : "";
    const why = drivers[0] ? ` Largest reason: ${drivers[0].title.toLowerCase()} (~${money(drivers[0].usd)}).` : "";
    const span = check?.span && check.span.days > 1 ? ` This transcript spans ${check.span.days} days, so it is probably more than one task.` : "";
    const from = basis === "history" ? `the upper range of ${est?.n ?? 0} comparable past task${(est?.n ?? 0) === 1 ? "" : "s"}` : basis === "cap" ? "the cap you set" : basis === "policy" ? "repo policy" : "the repo's hours \xD7 rate rule";
    const pct = spend / budget * 100;
    for (const t of [200, 150, 100]) {
      if (pct >= t && !state.shown.includes(`over${t}`)) {
        key = `over${t}`;
        text = `Sigil: this task has cost ${money(spend)}, ${Math.round(pct)}% of its ${money(budget)} budget from ${from} (+${money(spend - budget)}).${why}${span}${lever} Breakdown: /sigil:cost`;
        for (const lower of [100, 150, 200]) if (lower <= t && !state.shown.includes(`over${lower}`)) state.shown.push(`over${lower}`);
        break;
      }
    }
    if (!key && shipped && !state.shown.includes("ship")) {
      key = "ship";
      text = spend > budget ? `Sigil: shipped for ${money(spend)}, ${money(spend - budget)} over the ${money(budget)} budget.${why}${lever} Breakdown: /sigil:cost` : `Sigil: shipped for ${money(spend)}, ${money(budget - spend)} under the ${money(budget)} budget from ${from}.${drivers[0] ? ` Largest cost: ${drivers[0].title.toLowerCase()} (~${money(drivers[0].usd)}).` : ""} Breakdown: /sigil:cost`;
    }
    if (!key && !state.shown.includes("estimate")) {
      key = "estimate";
      text = basis === "history" && est ? `Sigil: tasks like this have cost ~${money(est.usd ?? 0)} here (typical ${money(est.low_usd ?? 0)}\u2013${money(est.high_usd ?? 0)}, from ${from}, ${est.confidence} confidence); budget ${money(budget)}.${spend > 0 ? ` ${money(spend)} so far.` : ""}` : `Sigil: budget for this task ${money(budget)} (${from}).${spend > 0 ? ` ${money(spend)} so far.` : ""} Change it: sigil budget set <usd>`;
    }
  }
  if (!key) return void 0;
  if (!state.shown.includes(key)) state.shown.push(key);
  writeJson(stateFile, state);
  record(session, "cost_notice", void 0, { key, spend_usd: spend, budget_usd: budget, budget_basis: basis, estimate_usd: est?.usd });
  return text;
}
function flagNotice(session) {
  const file = path6.join(sessionDir(session), "coach-flags.json");
  const flags = readJson(file, {});
  const notified = new Set(flags.notified ?? []);
  const ordered = [...flags.pending ?? []].sort((a, b) => (b.usd_saved ?? 0) - (a.usd_saved ?? 0));
  const fresh = ordered.filter((f) => !notified.has(f.key));
  if (!fresh.length) return void 0;
  const width = Math.max(...ordered.map((f) => f.title.length), 20);
  const rows = ordered.map((f, i) => `  ${i + 1}  ${f.title.padEnd(Math.min(width, 56))}  ${f.usd_saved ? `saves ~$${f.usd_saved.toFixed(2)}` : f.label ?? ""}${notified.has(f.key) ? "" : "  new"}`);
  writeJson(file, { ...flags, notified: [...notified, ...fresh.map((f) => f.key)].filter((k) => (flags.pending ?? []).some((f) => f.key === k)) });
  return [`Sigil Coach \xB7 ${ordered.length} waiting for you`, ...rows, `  Act: tell Claude "sigil apply 1" (it runs sigil coach --apply 1), or /sigil:coach for details`].join("\n");
}
function autopilotEnabled() {
  const cfg = readJson(configFile(), {});
  return cfg.coach?.autopilot !== false;
}
function handoffNote(cwd) {
  if (!cwd) return "";
  const f = path6.join(cwd, "HANDOFF.md");
  if (!fs5.existsSync(f)) return "";
  const age = Date.now() - fs5.statSync(f).mtimeMs;
  if (age > 24 * 3600 * 1e3) return "";
  const body = fs5.readFileSync(f, "utf8").split("\n").slice(0, 25).join("\n").slice(0, 1800);
  return `Sigil: HANDOFF.md in this repo was written ${Math.round(age / 6e4)} min ago and holds the state to resume from:
${body}`;
}
function lastReceipt(cwd) {
  if (!cwd) return "";
  const key = repoKey(cwd);
  const file = historyFile();
  if (!fs5.existsSync(file)) return "";
  const lines = fs5.readFileSync(file, "utf8").trim().split("\n").slice(-300);
  for (const line of lines.reverse()) {
    try {
      const h = JSON.parse(line);
      if (h.repo !== key || !h.verdict || h.internal) continue;
      const money = (n) => `$${(n ?? 0).toFixed(2)}`;
      return `Sigil: last receipt in this repo: "${h.task_title ?? "task"}" ${h.completion_pct ?? 0}% complete, ${money(h.cost_usd)} spent, ${money(h.waste_usd)} waste, verdict ${h.final_verdict ?? h.verdict}${h.final_status && h.final_status !== "unknown" ? ` (${h.final_status})` : ""}.`;
    } catch {
    }
  }
  return "";
}
function historyLessons(cwd) {
  if (!cwd) return "";
  const key = repoKey(cwd);
  const file = historyFile();
  if (!fs5.existsSync(file)) return "";
  const lines = fs5.readFileSync(file, "utf8").trim().split("\n").slice(-200);
  const lessons = [];
  for (const line of lines.reverse()) {
    try {
      const h = JSON.parse(line);
      if (h.repo !== key) continue;
      for (const r of h.recommendations ?? []) if (lessons.length < 3 && !lessons.includes(r)) lessons.push(r);
      if (h.final_status === "reverted" || h.final_status === "needed rework") {
        const l = `Last time "${h.task_title ?? "a task"}" was judged ${h.verdict ?? ""} but later ${h.final_status}. Verify against the acceptance criteria before shipping.`;
        if (lessons.length < 3 && !lessons.includes(l)) lessons.push(l);
      }
      if (lessons.length >= 3) break;
    } catch {
    }
  }
  return lessons.length ? `Sigil: past receipts in this repo recorded these lessons:
- ${lessons.join("\n- ")}` : "";
}
function recallNotice(session, cwd, prompt) {
  if (!cwd) return "";
  try {
    const settings = recallSettings();
    if (!settings.enabled) return "";
    const stateFile = path6.join(sessionDir(session), "recall-state.json");
    const state = readJson(stateFile, { offered: [] });
    const matches = findRecall(prompt, cwd, session, settings.min).filter((m2) => !state.offered.includes(m2.card.session));
    if (!matches.length) return "";
    const m = matches[0];
    state.offered.push(m.card.session);
    writeJson(stateFile, state);
    record(session, "recall", cwd, { ref: m.card.session, similarity: m.similarity, prior_cost_usd: m.card.cost_usd, title: m.card.title.slice(0, 120) });
    return recallNote(m, process.env.CLAUDE_PLUGIN_ROOT ? "/sigil:recall" : "sigil recall");
  } catch {
    return "";
  }
}
function deliverInjects(session) {
  const file = path6.join(sessionDir(session), "inject.jsonl");
  if (!fs5.existsSync(file)) return "";
  const lines = fs5.readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
  const pending = [];
  const kept = [];
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item.delivered) kept.push(line);
      else {
        pending.push(item.note);
        kept.push(JSON.stringify({ ...item, delivered: true, delivered_at: nowIso() }));
      }
    } catch {
    }
  }
  if (!pending.length) return "";
  fs5.writeFileSync(file, kept.join("\n") + "\n");
  return pending.map((n) => `Sigil: ${n}`).join("\n");
}
function followupDue() {
  const state = readJson(path6.join(sigilHome(), "followup-state.json"), {});
  const last = state.last_run ? Date.parse(state.last_run) : 0;
  return Date.now() - last > 24 * 3600 * 1e3;
}
function main() {
  if (process.env.SIGIL_INTERNAL) return;
  const raw = readStdin();
  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  if (!parsed || typeof parsed !== "object") parsed = {};
  const { adapter, rest } = agentFromArgv(process.argv.slice(2));
  const agentEvent = rest[0] || String(parsed.hook_event_name ?? "Unknown");
  const input = adapter.normalize(parsed, agentEvent);
  const event = adapter.event(agentEvent);
  const session = String(input.session_id || "unknown");
  const cwd = input.cwd;
  ensureDir(sessionDir(session));
  let out;
  switch (event) {
    case "SessionStart": {
      const loaded = loadedInventory(cwd);
      record(session, "session_start", cwd, {
        source: input.source,
        model: input.model,
        agent: adapter.id,
        transcript_path: input.transcript_path,
        git_head: gitHead(cwd),
        loaded
      });
      updateActive(session, { cwd, transcript_path: input.transcript_path, model: input.model, started: nowIso() });
      const ctx = [handoffNote(cwd), lastReceipt(cwd), historyLessons(cwd), deliverInjects(session)].filter(Boolean).join("\n");
      if (ctx) out = { kind: "context", event: "SessionStart", text: ctx };
      if (followupDue()) spawnDetached(["followup", "--auto"]);
      break;
    }
    case "UserPromptSubmit": {
      const prompt = String(input.prompt ?? "");
      const isFirst = !fs5.existsSync(path6.join(sessionDir(session), "task.json")) && !fs5.existsSync(path6.join(sessionDir(session), "task.pending"));
      record(session, "prompt", cwd, { prompt: truncate(prompt), chars: prompt.length });
      updateActive(session, { cwd, transcript_path: input.transcript_path });
      if (isFirst) {
        const url = TASK_URL_RE.exec(prompt)?.[0];
        const md = !url ? TASK_MD_RE.exec(prompt)?.[1] : void 0;
        const ref = url ?? (md && cwd && fs5.existsSync(path6.resolve(cwd, md)) ? path6.resolve(cwd, md) : void 0);
        if (ref) {
          fs5.writeFileSync(path6.join(sessionDir(session), "task.pending"), ref);
          spawnDetached(["task", ref, "--session", session, "--cwd", cwd ?? "", "--auto"]);
        } else if (prompt.trim().length > 0) {
          fs5.writeFileSync(path6.join(sessionDir(session), "task.pending"), "text");
          spawnDetached(["task", "--text", truncate(prompt, 4e3), "--session", session, "--cwd", cwd ?? "", "--auto"]);
        }
      }
      const ctx = [deliverInjects(session), recallNotice(session, cwd, prompt)].filter(Boolean).join("\n");
      if (ctx) out = { kind: "context", event: "UserPromptSubmit", text: ctx };
      break;
    }
    case "PreToolUse": {
      if (alreadySeen(session, event, input.tool_use_id)) break;
      const stopFile = path6.join(sessionDir(session), "hard-stop.json");
      const cmd0 = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
      if (fs5.existsSync(stopFile) && !/budget\s+approve/.test(cmd0)) {
        const stop = readJson(stopFile, {});
        out = { kind: "deny", reason: `Sigil: this session has spent $${(stop.spend_usd ?? 0).toFixed(2)} against the repo policy's $${(stop.budget_usd ?? 0).toFixed(2)} budget (hard stop). A human can lift it with: sigil budget approve --note "<why>"` };
        record(session, "hard_stop_denied", cwd, { tool_name: input.tool_name, tool_use_id: input.tool_use_id });
        break;
      }
      record(session, "pre_tool", cwd, {
        tool_name: input.tool_name,
        tool_input: shrinkInput(input.tool_input),
        tool_use_id: input.tool_use_id,
        agent: input.agent_id ?? null
      });
      break;
    }
    case "PostToolUse":
    case "PostToolUseFailure": {
      if (alreadySeen(session, event, input.tool_use_id)) break;
      const resp = input.tool_response;
      const respText = typeof resp === "string" ? resp : JSON.stringify(resp ?? "");
      const isError = event === "PostToolUseFailure" || !!resp && typeof resp === "object" && (resp.is_error === true || resp.interrupted === true) || /^\s*(Error|error:|Command failed|Exit code [1-9])/.test(respText);
      record(session, "post_tool", cwd, {
        tool_name: input.tool_name,
        tool_input: shrinkInput(input.tool_input),
        tool_use_id: input.tool_use_id,
        is_error: isError,
        response_chars: respText.length,
        response_head: truncate(respText, 600),
        agent: input.agent_id ?? null
      });
      const cmd = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
      if (input.tool_name === "Bash" && cmd && SHIP_RE.test(cmd) && !isError) {
        const kind = /gh\s+pr\s+create/.test(cmd) ? "pr" : /gh\s+pr\s+merge/.test(cmd) ? "merge" : /publish|upload/.test(cmd) ? "publish" : "push";
        const url = /https?:\/\/\S+/.exec(respText)?.[0];
        record(session, "ship", cwd, { kind, command: redact(cmd), url });
        spawnDetached(["judge", session, "--auto", "--reason", kind]);
      }
      break;
    }
    case "Stop": {
      record(session, "stop", cwd, { last_assistant_message: truncate(input.last_assistant_message, 800) });
      updateActive(session, { cwd, transcript_path: input.transcript_path });
      const gate = dodGate(session, cwd, input.stop_hook_active === true);
      if (gate) out = { kind: "block", reason: String(gate.reason ?? "") };
      else if (input.stop_hook_active !== true) {
        const notices = [costNotice(session), flagNotice(session)].filter((n) => !!n);
        if (notices.length) out = { kind: "notice", text: notices.join("\n") };
      }
      if (autopilotEnabled()) spawnDetached(["coach", "--tick", "--session", session, "--cwd", cwd ?? "", "--auto"]);
      break;
    }
    case "PreCompact": {
      record(session, "pre_compact", cwd, { trigger: input.trigger });
      break;
    }
    case "Notification": {
      record(session, "permission", cwd, { notification_type: input.notification_type, message: truncate(input.message, 400) });
      break;
    }
    case "SessionEnd": {
      record(session, "session_end", cwd, { reason: input.reason, transcript_path: input.transcript_path });
      updateActive(session, {}, true);
      spawnDetached(["finalize", session, "--auto"]);
      break;
    }
    default: {
      record(session, "note", cwd, { event, keys: Object.keys(input) });
    }
  }
  if (out) {
    const shaped = adapter.output(out);
    if (shaped) process.stdout.write(JSON.stringify(shaped));
  }
}
function shrinkInput(input) {
  const out = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (k === "content" || k === "new_string" || k === "old_string") out[k] = truncate(v, 300);
    else out[k] = typeof v === "string" ? truncate(v, 600) : v;
  }
  return out;
}
try {
  main();
} catch {
}
process.exitCode = 0;
