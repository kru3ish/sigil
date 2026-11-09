/* 0.14 renamed Tally to Sigil. For one release, everything written or configured under the old name keeps working:
   stored `tally_*` fields, the old policy and ledger file names, hooks and status lines installed by the old binary,
   and the old internal-run marker. Removed in 0.15 (DECISIONS N2). */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseJson, modernizeKeys, isInternalCwd } from '../src/paths.js';
import { POLICY_FILES } from '../src/policy.js';
import { ledgerFile } from '../src/estimate/ledger.js';
import { isSigilHook, isSigilStatusLine } from '../src/install/install.js';
import { isSigilPath } from '../src/judge/judge.js';
import { tmpDir } from './helpers.js';

describe('data written under the old name', () => {
  it('reads tally_* fields as sigil_*, nested and in arrays, and leaves values alone', () => {
    const v = parseJson<{ sigil_own_usd: number; spend: { sigil_share_pct: number }; runs: Array<{ sigil_usd: number; note: string }> }>(
      '{"tally_own_usd":1.5,"spend":{"tally_share_pct":6.7},"runs":[{"tally_usd":0.2,"note":"tally_usd stays a value"}]}',
    );
    expect(v.sigil_own_usd).toBe(1.5);
    expect(v.spend.sigil_share_pct).toBe(6.7);
    expect(v.runs[0]!.sigil_usd).toBe(0.2);
    expect(v.runs[0]!.note).toBe('tally_usd stays a value');
  });

  it('does not touch keys that merely contain the word, and is a plain parse when no old key is present', () => {
    expect(modernizeKeys({ totally_fine: 1, tally: 'a value-ish key stays', 'tally@tally': true })).toEqual({ totally_fine: 1, tally: 'a value-ish key stays', 'tally@tally': true });
    expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('still excludes the old internal-run marker from stats', () => {
    expect(isInternalCwd('C:\\Users\\x\\AppData\\Local\\Temp\\tally-llm-abc\\repo')).toBe(true);
    expect(isInternalCwd('/tmp/sigil-llm-abc/repo')).toBe(true);
    expect(isInternalCwd('/home/x/dev/tally')).toBe(false);
  });
});

describe('files and settings named under the old name', () => {
  it('reads tally.json after sigil.json', () => {
    expect(POLICY_FILES.indexOf('sigil.json')).toBeLessThan(POLICY_FILES.indexOf('tally.json'));
    expect(POLICY_FILES).toContain('.tally.json');
  });

  it('uses a repository\'s .tally ledger only when it has no .sigil ledger', () => {
    const root = tmpDir('h27-ledger-');
    expect(ledgerFile(root)).toBe(path.join(root, '.sigil', 'ledger.jsonl'));
    fs.mkdirSync(path.join(root, '.tally'), { recursive: true });
    fs.writeFileSync(path.join(root, '.tally', 'ledger.jsonl'), '');
    expect(ledgerFile(root)).toBe(path.join(root, '.tally', 'ledger.jsonl'));
    fs.mkdirSync(path.join(root, '.sigil'), { recursive: true });
    fs.writeFileSync(path.join(root, '.sigil', 'ledger.jsonl'), '');
    expect(ledgerFile(root)).toBe(path.join(root, '.sigil', 'ledger.jsonl'));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('recognises hooks and status lines installed by the old binary', () => {
    expect(isSigilHook({ type: 'command', command: 'node "C:/Users/x/dev/tally/dist/hook.js" Stop' })).toBe(true);
    expect(isSigilHook({ type: 'command', command: 'node', args: ['/usr/lib/node_modules/@kru3ish/tally/dist/hook.js', 'Stop'] })).toBe(true);
    expect(isSigilStatusLine({ type: 'command', command: 'node "C:/Users/x/dev/tally/dist/cli.js" statusline' })).toBe(true);
    expect(isSigilPath('.tally/ledger.jsonl')).toBe(true);
    expect(isSigilPath('.sigil/ledger.jsonl')).toBe(true);
    expect(isSigilPath('src/tally.ts')).toBe(false);
  });
});
