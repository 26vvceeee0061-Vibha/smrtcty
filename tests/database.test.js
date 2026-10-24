import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CONTROL_DEFAULTS, getScenario } from '../src/data/scenarios.js';
import { deriveDashboardModel } from '../src/lib/calculations.js';
import { createAdvisoryService } from '../server/advisory.mjs';
import { createSnapshotStore } from '../server/database.mjs';

test('PGlite snapshots survive a close and reopen', async () => {
  const parentDir = await mkdtemp(join(tmpdir(), 'quantum-flux-db-'));
  const dataDir = join(parentDir, 'nested', 'pglite');

  try {
    const scenario = getScenario('summer-surge');
    const controls = { ...CONTROL_DEFAULTS };
    const resourceModel = deriveDashboardModel(scenario, controls);
    const advisory = await createAdvisoryService({
      provider: 'local',
    }).generate({ scenario, model: resourceModel });

    const firstStore = await createSnapshotStore({ dataDir });
    assert.equal(firstStore.driver, 'pglite');

    const saved = await firstStore.save({
      label: 'Persistence check',
      scenario,
      controls,
      resourceModel,
      advisory,
    });

    assert.equal(saved.scenario.id, 'summer-surge');
    assert.equal(saved.water.shortage, 64);
    await firstStore.close();

    const secondStore = await createSnapshotStore({ dataDir });
    const snapshots = await secondStore.list(5);

    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].id, saved.id);
    assert.equal(snapshots[0].label, 'Persistence check');
    assert.equal(snapshots[0].water.shortage, 64);
    assert.equal(snapshots[0].advisory.provider, 'local');
    assert.equal(snapshots[0].advisory.recommendations.length, 3);

    await secondStore.close();
  } finally {
    await rm(parentDir, { recursive: true, force: true });
  }
});
