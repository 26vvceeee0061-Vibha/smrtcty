import {
  CONTROL_DEFAULTS,
  CONTROL_LIMITS,
  ELECTRICITY_UNIT,
  WATER_UNIT,
} from '../data/scenarios.js';

export const ALL_CLEAR_MESSAGE =
  'All resources are sufficient. No shortages detected.';

const MAX_CONTROL = {
  demandPressure: CONTROL_LIMITS.demandPressure.max,
  waterAvailability: CONTROL_LIMITS.waterAvailability.max,
  gridCapacity: CONTROL_LIMITS.gridCapacity.max,
};

const MIN_CONTROL = {
  demandPressure: CONTROL_LIMITS.demandPressure.min,
  waterAvailability: CONTROL_LIMITS.waterAvailability.min,
  gridCapacity: CONTROL_LIMITS.gridCapacity.min,
};

function roundToTenth(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

/** Converts any raw value into a finite, non-negative metric or null. */
export function toMetric(value) {
  if (value === null || value === undefined || value === '') return null;

  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;

  return numeric;
}

/** Keeps a control within its configured range; invalid values use the default. */
export function normalizeControl(key, value) {
  const fallback = CONTROL_DEFAULTS[key] ?? 100;
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) return fallback;

  const min = MIN_CONTROL[key] ?? 0;
  const max = MAX_CONTROL[key] ?? 200;

  return Math.min(max, Math.max(min, numeric));
}

/**
 * Computes the balance for one resource.
 *
 * Water Shortage = max(0, Water Demand - Available Water)
 * Electricity Shortage = max(0, Electricity Demand - Available Capacity)
 *
 * A shortage is only reported when the calculated (display-rounded) shortage
 * is greater than zero. Missing values produce an `unknown` state instead of a
 * fabricated shortage.
 */
export function calculateResourceBalance(demandValue, availableValue) {
  const demand = toMetric(demandValue);
  const available = toMetric(availableValue);

  if (demand === null || available === null) {
    return {
      valid: false,
      demand,
      available,
      shortage: null,
      reserve: null,
      difference: null,
      status: 'unknown',
      utilization: null,
      demandMetPercent: null,
    };
  }

  const difference = roundToTenth(demand - available);
  const shortage = Math.max(0, difference);
  const reserve = Math.max(0, roundToTenth(available - demand));
  const status = shortage > 0 ? 'shortage' : 'normal';
  const utilization =
    available > 0
      ? roundToTenth((demand / available) * 100)
      : demand > 0
        ? null
        : 100;
  const demandMetPercent =
    demand > 0
      ? roundToTenth(Math.min(100, (available / demand) * 100))
      : 100;

  return {
    valid: true,
    demand,
    available,
    shortage,
    reserve,
    difference,
    status,
    utilization,
    demandMetPercent,
  };
}

function scaleMetric(value, factor) {
  const metric = toMetric(value);
  return metric === null ? null : roundToTenth(metric * factor);
}

function buildAlert({ key, name, unit, demandLabel, availableLabel, balance }) {
  return {
    key,
    name,
    unit,
    demandLabel,
    availableLabel,
    demand: balance.demand,
    available: balance.available,
    shortage: balance.shortage,
    reserve: balance.reserve,
    status: balance.status,
    valid: balance.valid,
    utilization: balance.utilization,
  };
}

/**
 * Evaluates both resource balances. The cards and the alert section both read
 * from this return value, so their numbers are guaranteed to be consistent.
 */
export function buildResourceAlerts(water, electricity) {
  const resources = [
    buildAlert({
      key: 'water',
      name: 'Water',
      unit: WATER_UNIT,
      demandLabel: 'Total demand',
      availableLabel: 'Available water',
      balance: water,
    }),
    buildAlert({
      key: 'electricity',
      name: 'Electricity',
      unit: ELECTRICITY_UNIT,
      demandLabel: 'Total demand',
      availableLabel: 'Available capacity',
      balance: electricity,
    }),
  ];

  const shortageAlerts = resources.filter(
    (resource) => resource.status === 'shortage',
  );
  const unknownAlerts = resources.filter(
    (resource) => resource.status === 'unknown',
  );

  return {
    resources,
    shortageAlerts,
    shortageCount: shortageAlerts.length,
    unknownCount: unknownAlerts.length,
    allNormal: resources.every((resource) => resource.status === 'normal'),
    allClearMessage: ALL_CLEAR_MESSAGE,
  };
}

/**
 * Derives the complete dashboard model from the selected scenario and the
 * scenario inputs. This is the only place where demand scaling and shortage
 * calculations happen.
 */
export function deriveDashboardModel(scenario, controls = {}) {
  const demandPressure = normalizeControl(
    'demandPressure',
    controls.demandPressure,
  );
  const waterAvailability = normalizeControl(
    'waterAvailability',
    controls.waterAvailability,
  );
  const gridCapacity = normalizeControl('gridCapacity', controls.gridCapacity);

  const demandFactor = demandPressure / 100;
  const waterFactor = waterAvailability / 100;
  const gridFactor = gridCapacity / 100;

  const waterBalance = calculateResourceBalance(
    scaleMetric(scenario?.water?.demand, demandFactor),
    scaleMetric(scenario?.water?.available, waterFactor),
  );
  const electricityBalance = calculateResourceBalance(
    scaleMetric(scenario?.electricity?.demand, demandFactor),
    scaleMetric(scenario?.electricity?.capacity, gridFactor),
  );

  const water = {
    ...waterBalance,
    key: 'water',
    name: 'Water',
    unit: WATER_UNIT,
    demandLabel: 'Total demand',
    availableLabel: 'Available water',
    sufficientLabel: 'Sufficient Supply',
  };

  const electricity = {
    ...electricityBalance,
    key: 'electricity',
    name: 'Electricity',
    unit: ELECTRICITY_UNIT,
    demandLabel: 'Total demand',
    availableLabel: 'Available capacity',
    sufficientLabel: 'Sufficient Capacity',
  };

  return {
    scenarioId: scenario?.id ?? null,
    scenarioName: scenario?.name ?? 'Unavailable scenario',
    water,
    electricity,
    alerts: buildResourceAlerts(water, electricity),
    controls: {
      demandPressure,
      waterAvailability,
      gridCapacity,
    },
  };
}

/** Width of a comparison bar, as a percentage of the largest value. */
export function getBarWidth(value, maxValue) {
  const metric = toMetric(value);
  const maximum = toMetric(maxValue);

  if (metric === null || maximum === null || maximum <= 0) return 0;

  return Math.min(100, Math.max(0, (metric / maximum) * 100));
}

export function getComparisonMaximum(...values) {
  return Math.max(
    0,
    ...values.map((value) => toMetric(value) ?? 0),
  );
}
