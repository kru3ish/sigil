import fs from 'node:fs';
import path from 'node:path';
import { claudeHome, ensureDir, sigilHome, builtHookPath, builtCliPath, readJson } from '../paths.js';

export const HOOK_EVENTS: Array<{ event: string; matcher?: string; async: boolean }> = [
  { event: 'SessionStart', async: false },
  { event: 'UserPromptSubmit', async: false },
  { event: 'PreToolUse', async: true },
  { event: 'PostToolUse', async: true },
  { event: 'PostToolUseFailure', async: true },
  /* sync since 0.7: the end-of-turn cost notice is the Stop hook's output (it only reads small files) */
  { event: 'Stop', async: false },
  { event: 'PreCompact', async: true },
  { event: 'Notification', matcher: 'permission_prompt', async: true },
  { event: 'SessionEnd', async: false },
];

export function hookScriptPath(): string {
  return builtHookPath().replace(/\\/g, '/');
}

export function hookCommand(event: string, scriptPath = hookScriptPath()): string {
  return `node "${scriptPath}" ${event}`;
}

/* Recognises both hook forms: the shell string `sigil install` writes and the exec form (`command` + `args`)
   the plugin's hooks.json uses. */
export function isSigilHook(h: unknown): boolean {
  if (!h || typeof h !== 'object') return false;
  const o = h as { command?: unknown; args?: unknown };
  const parts = [typeof o.command === 'string' ? o.command : '', ...(Array.isArray(o.args) ? o.args.map(String) : [])];
  const joined = parts.join(' ');
  return /(?:sigil|tally)[^\s"']*[\\/](?:dist[\\/])?(?:hooks[\\/])?hook\.js/i.test(joined) || /CLAUDE_PLUGIN_ROOT\}?[\\/]dist[\\/](?:hooks[\\/])?hook\.js/i.test(joined);
}

/* The plugin id(s) under which Sigil is enabled in the user or project settings (`enabledPlugins`), e.g. `sigil@sigil`. */
export function enabledPluginIds(cwd = process.cwd()): string[] {
  const files = [path.join(claudeHome(), 'settings.json'), path.join(claudeHome(), 'settings.local.json'), path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')];
  const ids = new Set<string>();
  for (const f of files) {
    const s = readJson<{ enabledPlugins?: Record<string, boolean> }>(f, {});
    for (const [k, v] of Object.entries(s.enabledPlugins ?? {})) if (v && /^(?:sigil|tally)@/i.test(k)) ids.add(k);
  }
  return [...ids];
}

export class PluginConflictError extends Error {
  constructor(public readonly ids: string[]) {
    super(`Sigil is already enabled as a Claude Code plugin (${ids.join(', ')}), which installs these hooks itself. Installing again would record every event twice. Run /plugin uninstall sigil first, or pass --force to install anyway.`);
  }
}

export function statusLineCommand(cliPath = builtCliPath()): string {
  return `node "${cliPath.replace(/\\/g, '/')}" statusline`;
}

export function isSigilStatusLine(v: unknown): boolean {
  return !!v && typeof v === 'object' && typeof (v as { command?: unknown }).command === 'string' && /(?:sigil|tally)[^\s"']*[\\/]dist[\\/]cli\.js"?\s+statusline/i.test((v as { command: string }).command);
}

/* Adds Sigil's status line to the user settings unless another one is configured (or `force`). */
export function installStatusLine(opts: { force?: boolean; cliPath?: string } = {}): { installed: boolean; file: string; command: string; reason?: string } {
  const file = settingsPath('user');
  const command = statusLineCommand(opts.cliPath);
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const settings = raw.trim() ? (JSON.parse(raw) as Settings) : {};
  const current = settings.statusLine as { command?: string } | undefined;
  if (current && !isSigilStatusLine(current) && !opts.force) return { installed: false, file, command, reason: `A status line is already configured in ${file} (${String(current.command ?? current).slice(0, 80)}). Pass --force to replace it with Sigil's.` };
  if (current && isSigilStatusLine(current) && current.command === command) return { installed: false, file, command, reason: `Sigil's status line is already installed in ${file}.` };
  settings.statusLine = { type: 'command', command, padding: 0 };
  ensureDir(path.dirname(file));
  const indent = raw.trim() ? detectIndent(raw) : 2;
  fs.writeFileSync(file, JSON.stringify(settings, null, indent) + (!raw || raw.endsWith('\n') ? '\n' : ''));
  return { installed: true, file, command };
}

export function uninstallStatusLine(): { removed: boolean } {
  const file = settingsPath('user');
  if (!fs.existsSync(file)) return { removed: false };
  const raw = fs.readFileSync(file, 'utf8');
  const settings = JSON.parse(raw) as Settings;
  if (!isSigilStatusLine(settings.statusLine)) return { removed: false };
  delete settings.statusLine;
  fs.writeFileSync(file, JSON.stringify(settings, null, detectIndent(raw)) + (raw.endsWith('\n') ? '\n' : ''));
  return { removed: true };
}

export type Scope = 'user' | 'project' | 'managed';

/* Claude Code's managed settings: written by an administrator, read before user and project settings, and not
   something a person or an agent can edit away. SIGIL_MANAGED_SETTINGS overrides the path (tests, unusual installs). */
export function managedSettingsPath(platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (env.SIGIL_MANAGED_SETTINGS) return env.SIGIL_MANAGED_SETTINGS;
  if (platform === 'win32') return path.join(env.ProgramData ?? env.PROGRAMDATA ?? 'C:\\ProgramData', 'ClaudeCode', 'managed-settings.json');
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json';
  return '/etc/claude-code/managed-settings.json';
}

export function settingsPath(scope: Scope, cwd = process.cwd()): string {
  if (scope === 'managed') return managedSettingsPath();
  return scope === 'user' ? path.join(claudeHome(), 'settings.json') : path.join(cwd, '.claude', 'settings.json');
}

interface HookGroup {
  matcher?: string;
  hooks: Array<Record<string, unknown>>;
}
type Settings = Record<string, unknown> & { hooks?: Record<string, HookGroup[]> };

function detectIndent(raw: string): string | number {
  const m = /\n([ \t]+)"/.exec(raw);
  return m ? m[1]! : 2;
}

function backupDir(): string {
  return path.join(sigilHome(), 'backups');
}

export function backup(file: string, scope: string): string | null {
  ensureDir(backupDir());
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupDir(), `settings-${scope}-${stamp}.json`);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(dest + '.missing', '');
    return dest + '.missing';
  }
  fs.copyFileSync(file, dest);
  return dest;
}

function originalMarker(file: string): string {
  return path.join(backupDir(), 'original-' + Buffer.from(file).toString('base64url') + '.json');
}

export function install(opts: { scope: Scope; cwd?: string; scriptPath?: string; force?: boolean; statusline?: boolean }): { file: string; added: number; backup: string | null; statusline: boolean } {
  const plugin = enabledPluginIds(opts.cwd);
  if (plugin.length && !opts.force) throw new PluginConflictError(plugin);
  const file = settingsPath(opts.scope, opts.cwd);
  const existed = fs.existsSync(file);
  const raw = existed ? fs.readFileSync(file, 'utf8') : '';
  const bk = backup(file, opts.scope);
  const marker = originalMarker(file);
  if (!fs.existsSync(marker)) {
    ensureDir(backupDir());
    if (existed) fs.copyFileSync(file, marker);
    else fs.writeFileSync(marker + '.missing', '');
  }
  const settings: Settings = existed && raw.trim() ? (JSON.parse(raw) as Settings) : {};
  settings.hooks ??= {};
  let added = 0;
  for (const { event, matcher, async } of HOOK_EVENTS) {
    const groups = (settings.hooks[event] ??= []);
    /* a Sigil hook that points at a script which no longer exists is replaced, not kept */
    const wanted = hookCommand(event, opts.scriptPath);
    for (const g of groups) g.hooks = (g.hooks ?? []).filter((h) => !(isSigilHook(h) && typeof h.command === 'string' && h.command !== wanted && !fs.existsSync(/"([^"]+hook\.js)"/.exec(h.command)?.[1] ?? '')));
    const already = groups.some((g) => (g.hooks ?? []).some(isSigilHook));
    if (already) continue;
    const hook: Record<string, unknown> = { type: 'command', command: hookCommand(event, opts.scriptPath), timeout: 5 };
    if (async) hook.async = true;
    const group: HookGroup = { hooks: [hook] };
    if (matcher) group.matcher = matcher;
    groups.push(group);
    added += 1;
  }
  /* user scope also gets the status line, unless another one is configured */
  let statusline = false;
  if (opts.scope === 'user' && opts.statusline !== false && (!settings.statusLine || isSigilStatusLine(settings.statusLine))) {
    settings.statusLine = { type: 'command', command: statusLineCommand(opts.scriptPath ? path.join(path.dirname(opts.scriptPath), 'cli.js') : undefined), padding: 0 };
    statusline = true;
  }
  ensureDir(path.dirname(file));
  const indent = existed && raw.trim() ? detectIndent(raw) : 2;
  const trailingNl = !existed || raw.endsWith('\n');
  fs.writeFileSync(file, JSON.stringify(settings, null, indent) + (trailingNl ? '\n' : ''));
  return { file, added, backup: bk, statusline };
}

export function uninstall(opts: { scope: Scope; cwd?: string }): { file: string; removed: number; restoredOriginal: boolean } {
  const file = settingsPath(opts.scope, opts.cwd);
  const marker = originalMarker(file);
  if (!fs.existsSync(file)) {
    cleanupMarker(marker);
    return { file, removed: 0, restoredOriginal: false };
  }
  const raw = fs.readFileSync(file, 'utf8');
  const settings = JSON.parse(raw) as Settings;
  let removed = 0;
  if (settings.hooks) {
    for (const event of Object.keys(settings.hooks)) {
      const groups = settings.hooks[event] ?? [];
      const kept: HookGroup[] = [];
      for (const g of groups) {
        const before = (g.hooks ?? []).length;
        g.hooks = (g.hooks ?? []).filter((h) => !isSigilHook(h));
        removed += before - g.hooks.length;
        if (g.hooks.length) kept.push(g);
      }
      if (kept.length) settings.hooks[event] = kept;
      else delete settings.hooks[event];
    }
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }
  if (isSigilStatusLine(settings.statusLine)) delete settings.statusLine;
  const hadOriginal = fs.existsSync(marker);
  const originalMissing = fs.existsSync(marker + '.missing');
  if (originalMissing) {
    if (Object.keys(settings).length === 0) {
      fs.unlinkSync(file);
      cleanupMarker(marker);
      return { file, removed, restoredOriginal: true };
    }
  } else if (hadOriginal) {
    const originalRaw = fs.readFileSync(marker, 'utf8');
    try {
      if (deepEqual(JSON.parse(originalRaw), settings)) {
        fs.writeFileSync(file, originalRaw);
        cleanupMarker(marker);
        return { file, removed, restoredOriginal: true };
      }
    } catch {
      /* fall through to re-serialize */
    }
  }
  const indent = detectIndent(raw);
  fs.writeFileSync(file, JSON.stringify(settings, null, indent) + (raw.endsWith('\n') ? '\n' : ''));
  cleanupMarker(marker);
  return { file, removed, restoredOriginal: false };
}

function cleanupMarker(marker: string): void {
  for (const f of [marker, marker + '.missing']) if (fs.existsSync(f)) fs.unlinkSync(f);
}

export function isInstalled(scope: Scope, cwd?: string): boolean {
  const file = settingsPath(scope, cwd);
  if (!fs.existsSync(file)) return false;
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8')) as Settings;
    return Object.values(s.hooks ?? {}).some((groups) => groups.some((g) => (g.hooks ?? []).some(isSigilHook)));
  } catch {
    return false;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, (b as unknown[])[i]));
  if (typeof a === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}
