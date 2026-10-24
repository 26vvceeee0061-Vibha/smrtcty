import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startServer } from '../server.mjs';

let app;

async function request(path, options = {}) {
  const response = await fetch(`${app.url}${path}`, options);
  const body = await response.json().catch(() => null);
  return { response, body };
}

function postJson(path, payload) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

before(async () => {
  app = await startServer({
    port: 0,
    quiet: true,
    pgliteDataDir: null,
    advisoryProvider: 'local',
  });
});

after(async () => {
  await app?.close();
});

test('health reports LangChain and the embedded PostgreSQL driver', async () => {
  const { response, body } = await request('/api/health');

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'quantum-flux');
  assert.equal(body.advisory.framework, 'langchain');
  assert.equal(body.advisory.provider, 'local');
  assert.equal(body.database.driver, 'pglite');
  assert.equal(body.database.connected, true);
  assert.equal(body.database.snapshotCount, 0);
});

test('advisory endpoint ignores client metrics and computes authoritative values', async () => {
  const { response, body } = await postJson('/api/advisory', {
    scenarioId: 'summer-surge',
    controls: {
      demandPressure: 120,
      waterAvailability: 100,
      gridCapacity: 100,
    },
    water: { demand: 1, available: 9999 },
  });

  assert.equal(response.status, 200);
  assert.equal(body.context.water.demand, 614.4);
  assert.equal(body.context.water.shortage, 166.4);
  assert.equal(body.context.electricity.shortage, 123.2);
  assert.equal(body.context.alerts.shortageCount, 2);
  assert.equal(body.advisory.risk, 'critical');
  assert.equal(body.advisory.provider, 'local');
  assert.match(body.advisory.summary, /166.4 ML\/day/);
});

test('ai-brief endpoint processes requests and delivers agentic intelligence', async () => {
  const { response, body } = await postJson('/api/ai-brief', {
    scenarioId: 'summer-surge',
    controls: {
      demandPressure: 100,
      waterAvailability: 100,
      gridCapacity: 100,
    },
  });

  assert.equal(response.status, 200);
  assert.equal(body.context.scenario.id, 'summer-surge');
  assert.equal(body.context.water.shortage, 64);
  assert.equal(body.advisory.risk, 'elevated');
  assert.equal(body.advisory.priorityResource, 'water');
  assert.ok(body.advisory.consequences.length > 0);
  assert.ok(body.advisory.emergencyProtocol.length > 0);
  assert.equal(body.advisory.recommendations.length, 3);
});

test('advisory endpoint validates scenario, controls, and content type', async () => {
  const unknownScenario = await postJson('/api/advisory', {
    scenarioId: 'not-a-scenario',
  });
  assert.equal(unknownScenario.response.status, 400);
  assert.equal(unknownScenario.body.error.code, 'invalid_scenario');

  const badControls = await postJson('/api/advisory', {
    scenarioId: 'steady-state',
    controls: { demandPressure: 'hot' },
  });
  assert.equal(badControls.response.status, 400);
  assert.equal(badControls.body.error.code, 'invalid_controls');

  const wrongType = await request('/api/advisory', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ scenarioId: 'steady-state' }),
  });
  assert.equal(wrongType.response.status, 415);
  assert.equal(wrongType.body.error.code, 'unsupported_media_type');

  const wrongMethod = await request('/api/advisory');
  assert.equal(wrongMethod.response.status, 405);
  assert.equal(wrongMethod.response.headers.get('allow'), 'POST');
});

test('snapshots are recomputed, persisted, and listed newest first', async () => {
  const empty = await request('/api/snapshots?limit=6');
  assert.equal(empty.response.status, 200);
  assert.equal(empty.body.count, 0);
  assert.deepEqual(empty.body.snapshots, []);

  const saved = await postJson('/api/snapshots', {
    scenarioId: 'infrastructure-crunch',
    controls: {
      demandPressure: 100,
      waterAvailability: 100,
      gridCapacity: 100,
    },
    label: '  Shift   handover  ',
    water: { demand: 0, shortage: 0 },
    electricity: { demand: 0, shortage: 0 },
  });

  assert.equal(saved.response.status, 201);
  assert.equal(saved.body.driver, 'pglite');
  assert.equal(saved.body.snapshot.id, 1);
  assert.equal(saved.body.snapshot.label, 'Shift handover');
  assert.equal(saved.body.snapshot.scenario.id, 'infrastructure-crunch');
  assert.equal(saved.body.snapshot.water.demand, 596);
  assert.equal(saved.body.snapshot.water.shortage, 164);
  assert.equal(saved.body.snapshot.electricity.shortage, 166);
  assert.equal(saved.body.snapshot.shortageCount, 2);
  assert.equal(saved.body.snapshot.advisory.risk, 'critical');

  const listed = await request('/api/snapshots?limit=6');
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.count, 1);
  assert.equal(listed.body.snapshots[0].id, 1);
  assert.equal(listed.body.snapshots[0].label, 'Shift handover');

  const health = await request('/api/health');
  assert.equal(health.body.database.snapshotCount, 1);

  const tooLongLabel = await postJson('/api/snapshots', {
    scenarioId: 'steady-state',
    label: 'x'.repeat(121),
  });
  assert.equal(tooLongLabel.response.status, 400);
  assert.equal(tooLongLabel.body.error.code, 'invalid_label');

  const invalidLimit = await request('/api/snapshots?limit=900');
  assert.equal(invalidLimit.response.status, 400);
  assert.equal(invalidLimit.body.error.code, 'invalid_limit');
});

test('unknown API routes return JSON 404 responses', async () => {
  const { response, body } = await request('/api/does-not-exist');

  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'not_found');
});

test('private runtime files are not exposed by the static server', async () => {
  for (const path of ['/.env', '/.data/pglite/PG_VERSION', '/package.json']) {
    const response = await fetch(`${app.url}${path}`);
    assert.equal(response.status, 404, `${path} should not be served`);
  }
});
