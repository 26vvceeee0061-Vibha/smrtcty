import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTROL_DEFAULTS,
  SCENARIOS,
  getScenario,
} from '../src/data/scenarios.js';
import {
  ALL_CLEAR_MESSAGE,
  buildResourceAlerts,
  calculateResourceBalance,
  deriveDashboardModel,
  getBarWidth,
  getComparisonMaximum,
  normalizeControl,
  toMetric,
} from '../src/lib/calculations.js';
import { formatMetric, formatUnit } from '../src/lib/format.js';

test('water demand exceeds available water: shortage is demand minus availability', () => {
  const water = calculateResourceBalance(512, 448);

  assert.equal(water.status, 'shortage');
  assert.equal(water.shortage, 64);
  assert.equal(water.reserve, 0);
  assert.equal(water.demand, 512);
  assert.equal(water.available, 448);
  assert.equal(water.utilization, 114.3);
});

test('water availability equals demand: zero shortage and normal status', () => {
  const water = calculateResourceBalance(480, 480);

  assert.equal(water.status, 'normal');
  assert.equal(water.shortage, 0);
  assert.equal(water.reserve, 0);
});

test('water availability exceeds demand: no shortage is generated', () => {
  const water = calculateResourceBalance(428, 472);

  assert.equal(water.status, 'normal');
  assert.equal(water.shortage, 0);
  assert.equal(water.reserve, 44);
});

test('electricity demand exceeds capacity: shortage is demand minus capacity', () => {
  const electricity = calculateResourceBalance(958, 902);

  assert.equal(electricity.status, 'shortage');
  assert.equal(electricity.shortage, 56);
  assert.equal(electricity.reserve, 0);
});

test('electricity capacity equals demand: zero shortage and normal status', () => {
  const electricity = calculateResourceBalance(900, 900);

  assert.equal(electricity.status, 'normal');
  assert.equal(electricity.shortage, 0);
});

test('electricity capacity exceeds demand: no shortage is generated', () => {
  const electricity = calculateResourceBalance(886, 940);

  assert.equal(electricity.status, 'normal');
  assert.equal(electricity.shortage, 0);
  assert.equal(electricity.reserve, 54);
});

test('both resources can report independent shortage alerts', () => {
  const model = deriveDashboardModel(getScenario('infrastructure-crunch'), CONTROL_DEFAULTS);
  const waterAlert = model.alerts.resources.find((item) => item.key === 'water');
  const electricityAlert = model.alerts.resources.find(
    (item) => item.key === 'electricity',
  );

  assert.equal(model.alerts.shortageCount, 2);
  assert.equal(model.alerts.allNormal, false);
  assert.equal(waterAlert.status, 'shortage');
  assert.equal(waterAlert.shortage, 164);
  assert.equal(electricityAlert.status, 'shortage');
  assert.equal(electricityAlert.shortage, 166);
  assert.equal(model.water.shortage, waterAlert.shortage);
  assert.equal(model.electricity.shortage, electricityAlert.shortage);
});

test('neither resource shortage: all-resources-sufficient message is available', () => {
  const model = deriveDashboardModel(getScenario('steady-state'), CONTROL_DEFAULTS);

  assert.equal(model.alerts.shortageCount, 0);
  assert.equal(model.alerts.allNormal, true);
  assert.equal(model.alerts.allClearMessage, ALL_CLEAR_MESSAGE);
  assert.match(model.alerts.allClearMessage, /All resources are sufficient/);
  assert.equal(
    model.alerts.resources.filter((item) => item.status === 'shortage').length,
    0,
  );
});

test('one resource shortage produces exactly one alert', () => {
  const waterOnly = deriveDashboardModel(getScenario('summer-surge'), CONTROL_DEFAULTS);
  const powerOnly = deriveDashboardModel(getScenario('grid-lock'), CONTROL_DEFAULTS);

  assert.equal(waterOnly.alerts.shortageCount, 1);
  assert.equal(
    waterOnly.alerts.resources.find((item) => item.key === 'water').status,
    'shortage',
  );
  assert.equal(
    waterOnly.alerts.resources.find((item) => item.key === 'electricity').status,
    'normal',
  );

  assert.equal(powerOnly.alerts.shortageCount, 1);
  assert.equal(
    powerOnly.alerts.resources.find((item) => item.key === 'water').status,
    'normal',
  );
  assert.equal(
    powerOnly.alerts.resources.find((item) => item.key === 'electricity').status,
    'shortage',
  );
});

test('equal-demand scenario reports zero shortages for both resources', () => {
  const model = deriveDashboardModel(getScenario('tight-margin'), CONTROL_DEFAULTS);

  assert.equal(model.water.demand, model.water.available);
  assert.equal(model.electricity.demand, model.electricity.available);
  assert.equal(model.water.shortage, 0);
  assert.equal(model.electricity.shortage, 0);
  assert.equal(model.alerts.shortageCount, 0);
  assert.equal(model.alerts.allNormal, true);
});

test('scenario changes recalculate values and all three sections stay consistent', () => {
  const summer = deriveDashboardModel(getScenario('summer-surge'), CONTROL_DEFAULTS);
  const grid = deriveDashboardModel(getScenario('grid-lock'), CONTROL_DEFAULTS);

  assert.equal(summer.water.status, 'shortage');
  assert.equal(summer.electricity.status, 'normal');
  assert.equal(summer.alerts.shortageCount, 1);

  assert.equal(grid.water.status, 'normal');
  assert.equal(grid.electricity.status, 'shortage');
  assert.equal(grid.alerts.shortageCount, 1);

  for (const scenario of SCENARIOS) {
    const model = deriveDashboardModel(scenario, CONTROL_DEFAULTS);

    for (const alert of model.alerts.resources) {
      const balance = model[alert.key];
      assert.equal(alert.demand, balance.demand, `${scenario.id}: ${alert.key} demand`);
      assert.equal(
        alert.available,
        balance.available,
        `${scenario.id}: ${alert.key} supply`,
      );
      assert.equal(
        alert.shortage,
        balance.shortage,
        `${scenario.id}: ${alert.key} shortage`,
      );
      assert.equal(
        alert.status,
        balance.status,
        `${scenario.id}: ${alert.key} status`,
      );
    }
  }
});

test('input changes immediately drive demands, shortages and alerts', () => {
  const scenario = getScenario('summer-surge');
  const model = deriveDashboardModel(scenario, {
    demandPressure: 120,
    waterAvailability: 100,
    gridCapacity: 100,
  });

  assert.equal(model.water.demand, 614.4);
  assert.equal(model.water.available, 448);
  assert.equal(model.water.shortage, 166.4);
  assert.equal(model.electricity.demand, 1063.2);
  assert.equal(model.electricity.shortage, 123.2);
  assert.equal(model.alerts.shortageCount, 2);

  const reducedWater = deriveDashboardModel(scenario, {
    demandPressure: 120,
    waterAvailability: 70,
    gridCapacity: 100,
  });

  assert.equal(reducedWater.water.available, 313.6);
  assert.equal(reducedWater.water.shortage, 300.8);
  assert.equal(
    reducedWater.alerts.resources.find((item) => item.key === 'water').shortage,
    300.8,
  );
});

test('outputs remain consistent when a scenario meets demand exactly at a control boundary', () => {
  const model = deriveDashboardModel(getScenario('tight-margin'), {
    demandPressure: 100,
    waterAvailability: 100,
    gridCapacity: 100,
  });

  assert.equal(model.water.shortage, 0);
  assert.equal(model.electricity.shortage, 0);
  assert.equal(model.alerts.shortageCount, 0);
  assert.equal(model.alerts.allNormal, true);
});

test('missing and invalid values resolve to unknown rather than a false shortage', () => {
  for (const [demand, available] of [
    [undefined, 448],
    [512, null],
    [Number.NaN, 448],
    ['not-a-number', 448],
    [512, -1],
  ]) {
    const balance = calculateResourceBalance(demand, available);

    assert.equal(balance.status, 'unknown');
    assert.equal(balance.shortage, null);
    assert.equal(balance.reserve, null);
    assert.equal(balance.valid, false);
  }

  const model = deriveDashboardModel(
    { id: 'broken', name: 'Broken scenario', water: {}, electricity: {} },
    CONTROL_DEFAULTS,
  );

  assert.equal(model.water.status, 'unknown');
  assert.equal(model.electricity.status, 'unknown');
  assert.equal(model.alerts.shortageCount, 0);
  assert.equal(model.alerts.allNormal, false);
  assert.equal(model.alerts.allClearMessage, ALL_CLEAR_MESSAGE);
});

test('zero calculated shortage never produces a shortage alert', () => {
  const water = calculateResourceBalance(480.04, 480);
  const electricity = calculateResourceBalance(900.04, 900);
  const alerts = buildResourceAlerts(water, electricity);

  assert.equal(water.status, 'normal');
  assert.equal(water.shortage, 0);
  assert.equal(electricity.status, 'normal');
  assert.equal(electricity.shortage, 0);
  assert.equal(alerts.shortageCount, 0);
  assert.equal(alerts.shortageAlerts.length, 0);
});

test('no availability and positive demand reports the full amount as shortage', () => {
  const balance = calculateResourceBalance(100, 0);

  assert.equal(balance.status, 'shortage');
  assert.equal(balance.shortage, 100);
  assert.equal(balance.utilization, null);
});

test('zero demand and zero availability remains normal', () => {
  const balance = calculateResourceBalance(0, 0);

  assert.equal(balance.status, 'normal');
  assert.equal(balance.shortage, 0);
  assert.equal(balance.utilization, 100);
});

test('controls are clamped to their supported ranges', () => {
  assert.equal(normalizeControl('demandPressure', 400), 120);
  assert.equal(normalizeControl('demandPressure', -20), 80);
  assert.equal(normalizeControl('waterAvailability', 300), 120);
  assert.equal(normalizeControl('gridCapacity', 'invalid'), 100);
});

test('metric parsing rejects negative and non-finite values', () => {
  assert.equal(toMetric(12.5), 12.5);
  assert.equal(toMetric('12.5'), 12.5);
  assert.equal(toMetric(0), 0);
  assert.equal(toMetric(-1), null);
  assert.equal(toMetric(Infinity), null);
  assert.equal(toMetric(''), null);
  assert.equal(toMetric(undefined), null);
});

test('bar widths are bounded and based on the larger comparison value', () => {
  const maximum = getComparisonMaximum(512, 448);

  assert.equal(maximum, 512);
  assert.equal(getBarWidth(512, maximum), 100);
  assert.equal(getBarWidth(448, maximum), 87.5);
  assert.equal(getBarWidth(600, maximum), 100);
  assert.equal(getBarWidth(null, maximum), 0);
  assert.equal(getBarWidth(100, 0), 0);
});

test('display formatting retains units and safely handles missing values', () => {
  assert.equal(formatMetric(614.4), '614.4');
  assert.equal(formatMetric(null), '—');
  assert.equal(formatMetric(Number.NaN), '—');
  assert.equal(formatUnit(64, 'ML/day'), '64 ML/day');
  assert.equal(formatUnit(56, 'MW'), '56 MW');
  assert.equal(formatUnit(null, 'MW'), '—');
});
