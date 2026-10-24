/**
 * Single source of truth for every scenario in Quantum Flux.
 *
 * Resource values are deliberately stored as raw demands / supplies. Shortage
 * values are never stored here: they are always derived by the calculation
 * layer so cards and alerts can never drift apart.
 */
export const WATER_UNIT = 'ML/day';
export const ELECTRICITY_UNIT = 'MW';

export const CONTROL_DEFAULTS = Object.freeze({
  demandPressure: 100,
  waterAvailability: 100,
  gridCapacity: 100,
});

export const CONTROL_LIMITS = Object.freeze({
  demandPressure: { min: 80, max: 120, step: 1 },
  waterAvailability: { min: 70, max: 120, step: 1 },
  gridCapacity: { min: 70, max: 120, step: 1 },
});

export const SCENARIOS = Object.freeze([
  {
    id: 'summer-surge',
    code: 'SCN-01',
    name: 'Summer Surge',
    description:
      'A prolonged heatwave is lifting residential cooling and water demand across the central districts.',
    window: '13:00 — 18:00 peak',
    water: { demand: 512, available: 448 },
    electricity: { demand: 886, capacity: 940 },
  },
  {
    id: 'steady-state',
    code: 'SCN-02',
    name: 'Steady State',
    description:
      'Nominal city operations with balanced reservoir levels and stable grid headroom.',
    window: '06:00 — 22:00',
    water: { demand: 428, available: 472 },
    electricity: { demand: 764, capacity: 842 },
  },
  {
    id: 'grid-lock',
    code: 'SCN-03',
    name: 'Grid Lock',
    description:
      'A transmission constraint is limiting available power while water operations remain stable.',
    window: '17:00 — 21:00 peak',
    water: { demand: 470, available: 498 },
    electricity: { demand: 958, capacity: 902 },
  },
  {
    id: 'tight-margin',
    code: 'SCN-04',
    name: 'Tight Margin',
    description:
      'Demand and supply are perfectly balanced at the current operating threshold.',
    window: '12:00 — 15:00',
    water: { demand: 480, available: 480 },
    electricity: { demand: 900, capacity: 900 },
  },
  {
    id: 'monsoon-recovery',
    code: 'SCN-05',
    name: 'Monsoon Recovery',
    description:
      'Reservoir recharge and restored grid capacity are creating surplus across both networks.',
    window: '00:00 — 24:00',
    water: { demand: 372, available: 586 },
    electricity: { demand: 714, capacity: 812 },
  },
  {
    id: 'infrastructure-crunch',
    code: 'SCN-06',
    name: 'Infrastructure Crunch',
    description:
      'Concurrent pump-station outages and generation shortfalls are stressing both city networks.',
    window: '08:00 — 20:00',
    water: { demand: 596, available: 432 },
    electricity: { demand: 990, capacity: 824 },
  },
]);

export const DEFAULT_SCENARIO_ID = 'summer-surge';

export function getScenario(scenarioId) {
  return (
    SCENARIOS.find((scenario) => scenario.id === scenarioId) ??
    SCENARIOS.find((scenario) => scenario.id === DEFAULT_SCENARIO_ID) ??
    SCENARIOS[0]
  );
}
