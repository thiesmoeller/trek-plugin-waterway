import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');

describe('SDK CLI compatibility', () => {
  it('validates the plugin exactly as the TREK plugin SDK sees it', () => {
    const bin = path.join(root, 'node_modules', '.bin', 'trek-plugin-sdk');

    const result = spawnSync(bin, ['validate'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(result.status).toBe(0);
    expect(result.error).toBeUndefined();
    expect(result.stderr ?? '').not.toContain('error');
  });
});
