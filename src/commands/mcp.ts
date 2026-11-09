/* `sigil mcp` runs the MCP server on stdio (what the plugin manifest starts); `sigil mcp --install` registers it for
   CLI installs through `claude mcp add`, so Claude can call sigil_task / sigil_unmet / sigil_receipt / sigil_flags. */
import { spawnSync } from 'node:child_process';
import { type Args, has } from '../cli.js';
import { serve } from '../mcp/server.js';
import { builtCliPath } from '../paths.js';
import { resolveClaudeBin } from '../llm/client.js';

export async function run(args: Args): Promise<number | void> {
  if (has(args, 'install') || has(args, 'uninstall')) {
    const claude = resolveClaudeBin(process.env.SIGIL_CLAUDE_BIN);
    const cli = builtCliPath().replace(/\\/g, '/');
    const argv = has(args, 'install') ? [...claude.prefix, 'mcp', 'add', '--scope', 'user', 'sigil', '--', 'node', cli, 'mcp'] : [...claude.prefix, 'mcp', 'remove', '--scope', 'user', 'sigil'];
    const r = spawnSync(claude.bin, argv, { encoding: 'utf8', windowsHide: true });
    process.stdout.write((r.stdout || '') + (r.stderr || ''));
    if (r.status === 0) process.stdout.write(has(args, 'install') ? 'Sigil MCP server registered (user scope). Claude can now call sigil_task, sigil_unmet, sigil_receipt and sigil_flags in every session.\n' : 'Sigil MCP server removed.\n');
    return r.status ?? 1;
  }
  serve(process.cwd());
  await new Promise(() => {});
}
