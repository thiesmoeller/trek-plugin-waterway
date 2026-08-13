import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('original rowing-planner intent: first TREK plugin slice', () => {
  it('implements the scoped default waterway provider capabilities', () => {
    const manifest = JSON.parse(read('trek-plugin.json'));
    const server = read('server/index.js');
    const routing = read('server/waterway/routing.js');
    const context = read('server/waterway/context.js');

    expect(manifest.id).toBe('waterway');
    expect(manifest.permissions).toContain('hook:route-provider');
    expect(manifest.capabilities.routeProfiles).toEqual([
      { id: 'canoe', label: 'Canoe' },
      { id: 'kayak', label: 'Kayak' },
      { id: 'rowing', label: 'Rowing' },
    ]);
    expect(manifest.settings.map((setting) => setting.key)).toEqual([
      'overpassUrl',
      'canoeSpeedKmh',
      'kayakSpeedKmh',
      'rowingSpeedKmh',
      'defaultLockDelayMinutes',
    ]);

    expect(server).toContain('getRoute(req)');
    expect(server).toContain('fetchLocksForRoute');
    expect(server).toContain('defaultLockDelayMinutes');
    expect(routing).toContain('way["waterway"~"^(river|canal|fairway|tidal_channel)$"]');
    expect(context).toContain("waterway === 'lock_gate'");
    expect(context).toContain("lock === 'yes'");
  });

  it('keeps tide-window and multi-section planner work out of this first plugin slice', () => {
    const allSource = [
      read('trek-plugin.json'),
      read('server/index.js'),
      read('server/waterway/context.js'),
      read('server/waterway/routing.js'),
    ].join('\n');

    expect(allSource).not.toContain('roughTide');
    expect(allSource).not.toContain('TideProvider');
    expect(allSource).not.toContain('buildRowingPlan');
    expect(allSource).not.toContain('suggestWindowsFromTideEvents');
  });
});
