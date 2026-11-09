import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/* Internal (Sigil-initiated) headless runs execute from a temp dir with this prefix; with
   --no-session-persistence they write no transcript, but anything under such a cwd is excluded from stats. */
export const INTERNAL_CWD_MARKER = 'sigil-llm-';

export function isInternalCwd(cwd: string | undefined): boolean {
  return !!cwd && cwd.replace(/\\/g, '/').toLowerCase().includes(INTERNAL_CWD_MARKER);
}

/* one release of compatibility with the old name: a SIGIL_* variable that is unset takes the TALLY_* value */
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith('TALLY_') && process.env[`SIGIL_${k.slice(6)}`] === undefined) process.env[`SIGIL_${k.slice(6)}`] = v;
}

export const LEGACY_HOME_NAME = '.tally';

/* ~/.sigil, or ~/.tally in place when only that exists (0.13 data is used, never moved); SIGIL_HOME wins */
export function sigilHome(): string {
  if (process.env.SIGIL_HOME) return process.env.SIGIL_HOME;
  const home = path.join(os.homedir(), '.sigil');
  if (fs.existsSync(home)) return home;
  const legacy = path.join(os.homedir(), LEGACY_HOME_NAME);
  return fs.existsSync(legacy) ? legacy : home;
}

export function isLegacyHome(): boolean {
  return path.basename(sigilHome()) === LEGACY_HOME_NAME;
}

export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

export function sessionsDir(): string {
  return path.join(sigilHome(), 'sessions');
}

export function sessionDir(id: string): string {
  return path.join(sessionsDir(), safeId(id));
}

export function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

export function historyFile(): string {
  return path.join(sigilHome(), 'history.jsonl');
}

export function configFile(): string {
  return path.join(sigilHome(), 'config.json');
}

export function pricingFile(): string {
  return path.join(sigilHome(), 'pricing.json');
}

export function experimentsFile(): string {
  return path.join(sigilHome(), 'experiments.json');
}

export function activeFile(): string {
  return path.join(sigilHome(), 'active.json');
}

export function undoLog(): string {
  return path.join(sigilHome(), 'undo.jsonl');
}

export function mutesFile(): string {
  return path.join(sigilHome(), 'mutes.json');
}

export function sigilLog(): string {
  return path.join(sigilHome(), 'sigil.log');
}

export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[:\\/.]/g, '-');
}

export function projectTranscriptsDir(cwd: string): string {
  return path.join(claudeHome(), 'projects', encodeProjectDir(cwd));
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function appendLine(file: string, line: string): void {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, line.endsWith('\n') ? line : line + '\n');
}

export function log(msg: string): void {
  try {
    appendLine(sigilLog(), `${new Date().toISOString()} ${msg}`);
  } catch {
    /* logging must never fail the caller */
  }
}

export function repoKey(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

let cachedRoot: string | null = null;

/* The package root, found by walking up from this module (works from both src/ under tests and dist/ at runtime). */
export function packageRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        if ((JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string }).name === 'sigil') {
          cachedRoot = dir;
          return dir;
        }
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cachedRoot = dir;
  return dir;
}

export function builtHookPath(): string {
  return path.join(packageRoot(), 'dist', 'hook.js');
}

export function builtCliPath(): string {
  return path.join(packageRoot(), 'dist', 'cli.js');
}
