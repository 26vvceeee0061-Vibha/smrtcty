import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTROL_DEFAULTS,
  getScenario,
} from '../src/data/scenarios.js';
import { deriveDashboardModel } from '../src/lib/calculations.js';
import { createAdvisoryService } from '../server/advisory.mjs';

function generate(scenarioId, controls = CONTROL_DEFAULTS) {
  const scenario = getScenario(scenarioId);
  const service = createAdvisoryService({ provider: 'local' });

  return service.generate({
    scenario,
    model: deriveDashboardModel(scenario, controls),
  });
}

test('local LangChain chain produces a structured water-shortage brief', async () => {
  const advisory = await generate('summer-surge');

  assert.equal(advisory.risk, 'elevated');
  assert.equal(advisory.provider, 'local');
  assert.equal(advisory.chain, 'langchain');
  assert.equal(advisory.model, 'quantum-flux-rules-v1');
  assert.match(advisory.headline, /resource gap/i);
  assert.match(advisory.summary, /Summer Surge/);
  assert.match(advisory.summary, /64 ML\/day/);
  assert.equal(advisory.recommendations.length, 3);
  assert.match(advisory.recommendations[0], /water supply/i);
  assert.equal(advisory.fallback, false);
  assert.ok(!Number.isNaN(Date.parse(advisory.generatedAt)));
});

test('dual-network shortage escalates the brief to critical', async () => {
  const advisory = await generate('infrastructure-crunch');

  assert.equal(advisory.risk, 'critical');
  assert.match(advisory.summary, /164 ML\/day/);
  assert.match(advisory.summary, /166 MW/);
  assert.match(advisory.recommendations[1], /164 ML\/day/);
  assert.match(advisory.recommendations[1], /166 MW/);
});

test('surplus scenario produces stable guidance', async () => {
  const advisory = await generate('monsoon-recovery');

  assert.equal(advisory.risk, 'stable');
  assert.match(advisory.summary, /in reserve/);
  assert.match(advisory.recommendations[0], /Maintain the current dispatch plan/);
});

test('exact parity is treated as guarded rather than falsely critical', async () => {
  const advisory = await generate('tight-margin');

  assert.equal(advisory.risk, 'guarded');
  assert.match(advisory.summary, /exactly matched/);
});

test('missing telemetry is called out without inventing a shortage', async () => {
  const scenario = {
    id: 'broken',
    code: 'SCN-XX',
    name: 'Broken Telemetry',
    description: 'Test scenario',
    window: '00:00 — 24:00',
    water: {},
    electricity: {},
  };
  const service = createAdvisoryService({ provider: 'local' });
  const advisory = await service.generate({
    scenario,
    model: deriveDashboardModel(scenario, CONTROL_DEFAULTS),
  });

  assert.equal(advisory.risk, 'guarded');
  assert.match(advisory.summary, /telemetry is incomplete/);
  assert.match(advisory.summary, /no shortage is inferred/);
});

test('explicit local provider wins even when an API key is supplied', () => {
  const service = createAdvisoryService({
    provider: 'local',
    apiKey: 'not-used',
  });

  assert.equal(service.provider, 'local');
  assert.equal(service.model, 'quantum-flux-rules-v1');
});

test('OpenAI chain is selected when a key is configured', () => {
  const service = createAdvisoryService({
    provider: 'auto',
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
  });

  assert.equal(service.provider, 'openai');
  assert.equal(service.model, 'gpt-4o-mini');
});
