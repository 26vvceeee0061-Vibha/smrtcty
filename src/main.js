import {
  CONTROL_DEFAULTS,
  CONTROL_LIMITS,
  ELECTRICITY_UNIT,
  SCENARIOS,
  WATER_UNIT,
  getScenario,
} from './data/scenarios.js';
import {
  deriveDashboardModel,
  getBarWidth,
  getComparisonMaximum,
} from './lib/calculations.js';
import { formatMetric, formatUnit } from './lib/format.js';
import { createStore } from './lib/store.js';

const ICONS = {
  warning: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2.5 18 17H2L10 2.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M10 7.2v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="10" cy="14" r=".9" fill="currentColor"/></svg>`,
  check: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10.3 3.6 3.5L16 5.7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  unknown: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4"/><path d="M10 6.2v4.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="10" cy="13.6" r=".9" fill="currentColor"/></svg>`,
};

const RISK_META = {
  stable: { label: 'Stable', tone: 'normal' },
  guarded: { label: 'Guarded', tone: 'warning' },
  elevated: { label: 'Elevated', tone: 'warning' },
  critical: { label: 'Critical', tone: 'critical' },
};

const advisoryTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const ledgerTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const store = createStore();

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = value;
}

const elements = {
  scenarioSelect: byId('scenario-select'),
  scenarioCode: byId('scenario-code'),
  scenarioDescription: byId('scenario-description'),
  scenarioWindow: byId('scenario-window'),
  clock: byId('live-clock'),
  navAlertCount: byId('nav-alert-count'),
  resetControls: byId('reset-controls'),
  allClear: byId('all-clear-banner'),
  alertsList: byId('alerts-list'),
  alertsSummary: byId('alerts-summary'),
  alertsSummaryText: byId('alerts-summary-text'),
  demandPressure: byId('demand-pressure'),
  waterAvailability: byId('water-availability'),
  gridCapacity: byId('grid-capacity'),
  demandPressureValue: byId('demand-pressure-value'),
  waterAvailabilityValue: byId('water-availability-value'),
  gridCapacityValue: byId('grid-capacity-value'),
  telemetryAi: byId('telemetry-ai'),
  telemetryDb: byId('telemetry-db'),
  briefPanel: byId('operations-brief'),
  briefRefresh: byId('brief-refresh'),
  briefProviderPill: byId('brief-provider-pill'),
  briefProvider: byId('brief-provider'),
  briefRisk: byId('brief-risk'),
  briefHeadline: byId('brief-headline'),
  briefSummary: byId('brief-summary'),
  briefRecommendations: byId('brief-recommendations'),
  briefStatus: byId('brief-status'),
  briefModel: byId('brief-model'),
  briefUpdated: byId('brief-updated'),
  snapshotForm: byId('snapshot-form'),
  snapshotLabel: byId('snapshot-label'),
  snapshotSave: byId('snapshot-save'),
  ledgerRefresh: byId('ledger-refresh'),
  ledgerDriverPill: byId('ledger-driver-pill'),
  ledgerDriver: byId('ledger-driver'),
  ledgerStore: byId('ledger-store'),
  ledgerStatus: byId('ledger-status'),
  ledgerList: byId('ledger-list'),
  ledgerCount: byId('ledger-count'),
};

function populateScenarioOptions() {
  if (!elements.scenarioSelect) return;

  elements.scenarioSelect.replaceChildren(
    ...SCENARIOS.map((scenario) => {
      const option = document.createElement('option');
      option.value = scenario.id;
      option.textContent = scenario.name;
      return option;
    }),
  );
}

function updateClock() {
  if (!elements.clock) return;

  elements.clock.textContent = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

function syncControls(state) {
  const controls = [
    {
      input: elements.demandPressure,
      output: elements.demandPressureValue,
      value: state.demandPressure,
      limits: CONTROL_LIMITS.demandPressure,
    },
    {
      input: elements.waterAvailability,
      output: elements.waterAvailabilityValue,
      value: state.waterAvailability,
      limits: CONTROL_LIMITS.waterAvailability,
    },
    {
      input: elements.gridCapacity,
      output: elements.gridCapacityValue,
      value: state.gridCapacity,
      limits: CONTROL_LIMITS.gridCapacity,
    },
  ];

  for (const { input, output, value, limits } of controls) {
    if (!input) continue;

    input.value = String(value);
    if (output) output.textContent = `${formatMetric(value)}%`;

    const progress =
      ((value - limits.min) / (limits.max - limits.min)) * 100;
    input.style.setProperty('--range-progress', `${progress}%`);
  }
}

function setStatusPill(element, tone, text) {
  if (!element) return;
  element.className = `status-pill status-pill--${tone}`;
  const label = element.querySelector('span:last-child');
  if (label) label.textContent = text;
}

function updateBar({
  fill,
  track,
  value,
  maximum,
  unit,
  isCritical,
}) {
  if (!fill || !track) return;

  fill.style.width = `${getBarWidth(value, maximum)}%`;
  fill.classList.toggle('is-critical', Boolean(isCritical));

  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : null;
  const safeMaximum =
    typeof maximum === 'number' && Number.isFinite(maximum) ? maximum : 0;

  track.setAttribute('aria-valuemax', String(safeMaximum));
  track.setAttribute('aria-valuenow', String(safeValue ?? 0));
  track.setAttribute(
    'aria-valuetext',
    safeValue === null
      ? 'Data unavailable'
      : `${formatMetric(safeValue)} ${unit}`,
  );
}

function getVerdictMarkup(resource, sufficientLabel) {
  if (resource.status === 'unknown') {
    return `
      <div class="verdict verdict--unknown">
        <span class="verdict__icon">${ICONS.unknown}</span>
        <div class="verdict__copy">
          <span class="verdict__label">Data unavailable</span>
          <strong class="verdict__value">No shortage inferred</strong>
        </div>
        <span class="verdict__detail">Valid scenario data is required</span>
      </div>
    `;
  }

  if (resource.status === 'shortage') {
    const detail =
      resource.demand > 0
        ? `${formatMetric((resource.shortage / resource.demand) * 100)}% of demand unmet`
        : 'Supply shortfall detected';

    return `
      <div class="verdict verdict--critical">
        <span class="verdict__icon">${ICONS.warning}</span>
        <div class="verdict__copy">
          <span class="verdict__label">${resource.name} shortage</span>
          <strong class="verdict__value">${formatUnit(resource.shortage, resource.unit)}</strong>
        </div>
        <span class="verdict__detail">${detail}</span>
      </div>
    `;
  }

  const reserveText =
    resource.reserve > 0
      ? `+${formatUnit(resource.reserve, resource.unit)} reserve`
      : 'Demand fully met';

  return `
    <div class="verdict verdict--normal">
      <span class="verdict__icon">${ICONS.check}</span>
      <div class="verdict__copy">
        <span class="verdict__label">${sufficientLabel}</span>
        <strong class="verdict__value">${reserveText}</strong>
      </div>
      <span class="verdict__detail">${resource.availableLabel} meets demand</span>
    </div>
  `;
}

function updateResourceCard(resource, { prefix, sufficientLabel }) {
  const isShortage = resource.status === 'shortage';
  const isUnknown = resource.status === 'unknown';
  const tone = isShortage ? 'critical' : isUnknown ? 'warning' : 'normal';
  const statusText = isShortage
    ? 'Shortage'
    : isUnknown
      ? 'Data unavailable'
      : 'Normal';

  setText(`${prefix}-demand-value`, formatMetric(resource.demand));
  setText(`${prefix}-available-value`, formatMetric(resource.available));
  setText(`${prefix}-demand-bar-value`, formatMetric(resource.demand));
  setText(`${prefix}-available-bar-value`, formatMetric(resource.available));

  setStatusPill(byId(`${prefix}-status-pill`), tone, statusText);

  const maximum = getComparisonMaximum(resource.demand, resource.available);

  updateBar({
    fill: byId(`${prefix}-demand-bar`),
    track: byId(`${prefix}-demand-track`),
    value: resource.demand,
    maximum,
    unit: resource.unit,
    isCritical: isShortage,
  });

  updateBar({
    fill: byId(`${prefix}-available-bar`),
    track: byId(`${prefix}-available-track`),
    value: resource.available,
    maximum,
    unit: resource.unit,
    isCritical: false,
  });

  const verdict = byId(`${prefix}-verdict`);
  if (verdict) verdict.innerHTML = getVerdictMarkup(resource, sufficientLabel);

  const utilizationText = isUnknown
    ? '—'
    : resource.utilization === null
      ? 'No supply'
      : `${formatMetric(resource.utilization)}%`;
  setText(`${prefix}-utilization`, utilizationText);

  const demandMetText = isUnknown
    ? '—'
    : `${formatMetric(resource.demandMetPercent)}%`;
  setText(`${prefix}-demand-met`, demandMetText);

  const utilization = byId(`${prefix}-utilization`);
  if (utilization) utilization.classList.toggle('is-critical', isShortage);
}

function getAlertMessage(resource) {
  if (resource.status === 'unknown') {
    return 'Required scenario data is unavailable. No shortage is assumed.';
  }

  if (resource.status === 'shortage') {
    return `${resource.name} demand exceeds ${resource.availableLabel.toLowerCase()} by ${formatUnit(resource.shortage, resource.unit)}.`;
  }

  if (resource.reserve > 0) {
    return `${resource.availableLabel} meets demand with ${formatUnit(resource.reserve, resource.unit)} in reserve.`;
  }

  return `${resource.availableLabel} exactly meets demand. No shortage detected.`;
}

function getAlertIcon(resource) {
  if (resource.status === 'shortage') return ICONS.warning;
  if (resource.status === 'unknown') return ICONS.unknown;
  return ICONS.check;
}

function renderAlert(resource) {
  const isShortage = resource.status === 'shortage';
  const isUnknown = resource.status === 'unknown';
  const tone = isShortage ? 'critical' : isUnknown ? 'unknown' : 'normal';
  const statusText = isShortage
    ? 'Shortage'
    : isUnknown
      ? 'Unavailable'
      : 'Normal';
  const shortageText = isUnknown
    ? '—'
    : formatUnit(resource.shortage, resource.unit);
  const shortageTone = isShortage
    ? 'is-critical'
    : isUnknown
      ? 'is-unknown'
      : 'is-normal';

  return `
    <article
      class="alert-item alert-item--${tone}"
      data-resource="${resource.key}"
      data-status="${resource.status}"
      aria-label="${resource.name}: ${statusText}"
    >
      <span class="alert-item__icon">${getAlertIcon(resource)}</span>
      <div class="alert-item__content">
        <div class="alert-item__head">
          <h3 class="alert-item__name">${resource.name}</h3>
          <span class="alert-status alert-status--${tone === 'unknown' ? 'warning' : tone}">${statusText}</span>
        </div>
        <p class="alert-item__message">${getAlertMessage(resource)}</p>
        <dl class="alert-metrics">
          <div class="alert-metric">
            <dt>Total demand</dt>
            <dd>${formatUnit(resource.demand, resource.unit)}</dd>
          </div>
          <div class="alert-metric">
            <dt>${resource.availableLabel}</dt>
            <dd>${formatUnit(resource.available, resource.unit)}</dd>
          </div>
          <div class="alert-metric">
            <dt>Shortage</dt>
            <dd class="${shortageTone}">${shortageText}</dd>
          </div>
        </dl>
      </div>
    </article>
  `;
}

function updateAlerts(model) {
  const { resources, shortageCount, unknownCount, allNormal } = model.alerts;

  if (elements.alertsList) {
    elements.alertsList.innerHTML = resources.map(renderAlert).join('');
  }

  if (elements.allClear) {
    elements.allClear.hidden = !allNormal;
  }

  let tone = 'normal';
  let summaryText = 'All clear';

  if (shortageCount > 0) {
    tone = 'critical';
    summaryText = `${shortageCount} active shortage${shortageCount === 1 ? '' : 's'}`;
  } else if (unknownCount > 0) {
    tone = 'warning';
    summaryText = 'Data review required';
  }

  if (elements.alertsSummary) {
    elements.alertsSummary.className = `status-pill status-pill--${tone} alerts-panel__summary`;
    if (elements.alertsSummaryText) {
      elements.alertsSummaryText.textContent = summaryText;
    }
  }

  if (elements.navAlertCount) {
    elements.navAlertCount.hidden = shortageCount === 0;
    elements.navAlertCount.textContent = String(shortageCount);
  }
}

/* AI operations brief ------------------------------------------------------ */
let advisoryTimer = null;
let advisoryController = null;
let advisorySequence = 0;

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatAdvisoryTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? advisoryTimeFormatter.format(date)
    : '—';
}

function formatLedgerTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? ledgerTimeFormatter.format(date)
    : '—';
}

function setIntelStatus(element, message, tone = '') {
  if (!element) return;
  element.textContent = message;
  element.className = `intel-status${tone ? ` is-${tone}` : ''}`;
}

function setRecommendations(items) {
  if (!elements.briefRecommendations) return;

  const recommendations =
    Array.isArray(items) && items.length
      ? items
      : ['No advisory actions were returned. Refresh the brief to retry.'];

  elements.briefRecommendations.replaceChildren(
    ...recommendations.map((item) =>
      createElement('li', null, String(item)),
    ),
  );
}

function setBriefBusy(busy) {
  if (elements.briefRefresh) {
    elements.briefRefresh.disabled = busy;
    elements.briefRefresh.classList.toggle('is-spinning', busy);
  }

  elements.briefPanel?.setAttribute('aria-busy', String(busy));
}

function setBriefLoading() {
  setBriefBusy(true);
  setIntelStatus(
    elements.briefStatus,
    'Refreshing the operations brief from the LangChain service…',
    'loading',
  );
}

function renderAdvisory(advisory, scenarioId) {
  if (!advisory) {
    renderAdvisoryError();
    return;
  }

  const meta = RISK_META[advisory.risk] ?? RISK_META.guarded;
  const isFallback = Boolean(advisory.fallback);
  const providerText =
    advisory.provider === 'openai'
      ? 'OpenAI'
      : isFallback
        ? 'Local fallback'
        : 'Local chain';

  if (elements.briefRisk) {
    elements.briefRisk.className = `risk-badge risk-badge--${meta.tone}`;
    elements.briefRisk.textContent = meta.label;
  }

  setText('brief-headline', advisory.headline ?? 'Operations brief unavailable');
  setText(
    'brief-summary',
    advisory.summary ?? 'The advisory service did not return a summary.',
  );
  setRecommendations(advisory.recommendations);

  setStatusPill(
    elements.briefProviderPill,
    isFallback ? 'warning' : 'normal',
    providerText,
  );
  setText('brief-model', advisory.model ?? 'LangChain');
  setText(
    'brief-updated',
    advisory.generatedAt ? formatAdvisoryTime(advisory.generatedAt) : '—',
  );
  setText(
    'telemetry-ai',
    advisory.provider === 'openai' ? 'OpenAI' : 'Local chain',
  );

  if (elements.briefPanel) {
    elements.briefPanel.dataset.advisoryScenario = scenarioId ?? '';
    elements.briefPanel.dataset.advisoryProvider = advisory.provider ?? 'local';
  }

  setIntelStatus(
    elements.briefStatus,
    isFallback
      ? advisory.notice
      : `Generated ${formatAdvisoryTime(advisory.generatedAt)} from the server-verified resource model.`,
    isFallback ? 'warning' : 'ready',
  );
  setBriefBusy(false);
}

function renderAdvisoryError() {
  if (elements.briefRisk) {
    elements.briefRisk.className = 'risk-badge risk-badge--guarded';
    elements.briefRisk.textContent = 'Offline';
  }

  setText('brief-headline', 'AI advisory is temporarily unavailable');
  setText(
    'brief-summary',
    'The live resource cards are unaffected. Start the Quantum Flux server or retry the advisory chain.',
  );
  setRecommendations([
    'Confirm the app server is running, then refresh the brief.',
    'The scenario model, cards, and alerts continue to operate without the advisory service.',
  ]);

  setStatusPill(elements.briefProviderPill, 'warning', 'Offline');
  setText('brief-model', 'Unavailable');
  setText('brief-updated', '—');
  setText('telemetry-ai', 'Offline');

  if (elements.briefPanel) {
    elements.briefPanel.dataset.advisoryScenario = 'offline';
    elements.briefPanel.dataset.advisoryProvider = 'offline';
  }

  setIntelStatus(
    elements.briefStatus,
    'Advisory API unavailable. Verify the server and use refresh to retry.',
    'error',
  );
  setBriefBusy(false);
}

function scheduleAdvisoryRefresh({ immediate = false } = {}) {
  if (!elements.briefHeadline) return;

  window.clearTimeout(advisoryTimer);
  advisorySequence += 1;
  const requestId = advisorySequence;
  advisoryController?.abort();
  advisoryController = null;

  const state = store.getState();
  const requestState = {
    scenarioId: state.scenarioId,
    controls: {
      demandPressure: state.demandPressure,
      waterAvailability: state.waterAvailability,
      gridCapacity: state.gridCapacity,
    },
  };

  setBriefLoading();
  advisoryTimer = window.setTimeout(
    () => {
      void runAdvisoryRequest(requestId, requestState);
    },
    immediate ? 0 : 320,
  );
}

async function runAdvisoryRequest(requestId, requestState) {
  const controller = new AbortController();
  advisoryController = controller;

  try {
    let response = await fetch('/api/ai-brief', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestState),
      signal: controller.signal,
    }).catch(() => null);

    if (!response || !response.ok) {
      response = await fetch('/api/advisory', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestState),
        signal: controller.signal,
      });
    }

    if (!response.ok) {
      throw new Error(`Advisory request failed with status ${response.status}.`);
    }

    const payload = await response.json();
    if (requestId !== advisorySequence) return;

    renderAdvisory(
      payload.advisory,
      payload.context?.scenario?.id ?? requestState.scenarioId,
    );
  } catch (error) {
    if (error?.name === 'AbortError' || requestId !== advisorySequence) return;
    renderAdvisoryError();
  } finally {
    if (advisoryController === controller) advisoryController = null;
    if (requestId === advisorySequence) setBriefBusy(false);
  }
}

/* Snapshot ledger ---------------------------------------------------------- */
let ledgerSnapshots = [];
let savingSnapshot = false;

function setLedgerDriver(driver) {
  if (!driver) return;

  const label =
    driver === 'postgres'
      ? 'PostgreSQL'
      : driver === 'pglite'
        ? 'PGlite'
        : 'Database';

  setStatusPill(elements.ledgerDriverPill, 'normal', label);
  setText('ledger-store', label);
  setText('telemetry-db', label);

  if (elements.ledgerDriverPill) {
    elements.ledgerDriverPill.dataset.driver = driver;
  }
}

function renderLedgerItem(snapshot) {
  const item = createElement('li', 'ledger-item');
  item.dataset.snapshotId = String(snapshot.id);

  const top = createElement('div', 'ledger-item__top');
  const identity = createElement('div', 'ledger-item__identity');
  identity.append(
    createElement('span', 'ledger-item__code', snapshot.scenario?.code ?? 'SCN'),
    createElement(
      'strong',
      'ledger-item__scenario',
      snapshot.scenario?.name ?? 'Unknown scenario',
    ),
  );

  const time = createElement(
    'time',
    'ledger-item__time',
    formatLedgerTime(snapshot.createdAt),
  );
  if (snapshot.createdAt) time.dateTime = snapshot.createdAt;

  top.append(identity, time);
  item.append(top);

  if (snapshot.label) {
    item.append(createElement('p', 'ledger-item__label', snapshot.label));
  }

  const metrics = createElement('div', 'ledger-item__metrics');
  const gaps = [
    {
      label: 'Water gap',
      value: snapshot.water?.shortage,
      unit: WATER_UNIT,
      status: snapshot.water?.status,
    },
    {
      label: 'Power gap',
      value: snapshot.electricity?.shortage,
      unit: ELECTRICITY_UNIT,
      status: snapshot.electricity?.status,
    },
  ];

  for (const gap of gaps) {
    const tone =
      gap.status === 'shortage'
        ? 'is-critical'
        : gap.status === 'unknown'
          ? 'is-unknown'
          : 'is-normal';
    const metric = createElement('span', `ledger-metric ${tone}`);
    metric.append(
      createElement('em', null, gap.label),
      createElement('strong', null, formatUnit(gap.value, gap.unit)),
    );
    metrics.append(metric);
  }

  item.append(metrics);
  item.append(
    createElement(
      'p',
      'ledger-item__advisory',
      snapshot.advisory?.headline ?? 'No advisory stored for this snapshot.',
    ),
  );

  return item;
}

function renderLedger(snapshots, driver) {
  if (driver) setLedgerDriver(driver);

  ledgerSnapshots = Array.isArray(snapshots) ? snapshots.slice(0, 6) : [];

  if (!elements.ledgerList) return;

  if (ledgerSnapshots.length === 0) {
    elements.ledgerList.replaceChildren(
      createElement(
        'li',
        'ledger-empty',
        'No snapshots yet. Save the active operating point to start the ledger.',
      ),
    );
  } else {
    elements.ledgerList.replaceChildren(
      ...ledgerSnapshots.map(renderLedgerItem),
    );
  }

  const count = ledgerSnapshots.length;
  setText(
    'ledger-count',
    count === 0 ? '0 snapshots' : count === 1 ? '1 recent snapshot' : `${count} recent snapshots`,
  );
}

function handleLedgerFailure() {
  if (elements.ledgerList) {
    elements.ledgerList.replaceChildren(
      createElement(
        'li',
        'ledger-empty',
        'The snapshot ledger is offline. Start the server and refresh to reconnect.',
      ),
    );
  }

  setStatusPill(elements.ledgerDriverPill, 'warning', 'Offline');
  setText('ledger-store', '—');
  setText('telemetry-db', 'Offline');
  setText('ledger-count', '—');
  setIntelStatus(
    elements.ledgerStatus,
    'Ledger API unavailable. Verify the database connection and refresh.',
    'error',
  );
}

async function refreshLedger() {
  if (!elements.ledgerList) return;

  setIntelStatus(
    elements.ledgerStatus,
    'Loading recent snapshots from the database…',
    'loading',
  );

  if (elements.ledgerRefresh) {
    elements.ledgerRefresh.disabled = true;
    elements.ledgerRefresh.classList.add('is-spinning');
  }

  try {
    const response = await fetch('/api/snapshots?limit=6', {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Ledger request failed with status ${response.status}.`);
    }

    const payload = await response.json();
    renderLedger(payload.snapshots, payload.driver);
    setIntelStatus(
      elements.ledgerStatus,
      payload.count
        ? `Ledger synchronized · showing the ${payload.count} most recent snapshot${payload.count === 1 ? '' : 's'}.`
        : 'Ledger ready. No snapshots saved yet.',
      'ready',
    );
  } catch {
    handleLedgerFailure();
  } finally {
    if (elements.ledgerRefresh) {
      elements.ledgerRefresh.disabled = false;
      elements.ledgerRefresh.classList.remove('is-spinning');
    }
  }
}

async function saveSnapshot(event) {
  event.preventDefault();
  if (savingSnapshot) return;

  savingSnapshot = true;
  if (elements.snapshotSave) elements.snapshotSave.disabled = true;
  setIntelStatus(
    elements.ledgerStatus,
    'Recomputing the operating point and saving the snapshot…',
    'loading',
  );

  const state = store.getState();

  try {
    const response = await fetch('/api/snapshots', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scenarioId: state.scenarioId,
        controls: {
          demandPressure: state.demandPressure,
          waterAvailability: state.waterAvailability,
          gridCapacity: state.gridCapacity,
        },
        label: elements.snapshotLabel?.value ?? '',
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        payload?.error?.message ?? 'Snapshot could not be saved.',
      );
    }

    if (!payload.snapshot) {
      throw new Error('The server returned an incomplete snapshot.');
    }

    setLedgerDriver(payload.driver);
    renderLedger([
      payload.snapshot,
      ...ledgerSnapshots.filter((item) => item.id !== payload.snapshot.id),
    ]);

    if (elements.snapshotLabel) elements.snapshotLabel.value = '';

    setIntelStatus(
      elements.ledgerStatus,
      `Snapshot #${payload.snapshot.id} saved · ${payload.snapshot.scenario.name} · ${formatLedgerTime(payload.snapshot.createdAt)}.`,
      'ready',
    );
  } catch (error) {
    setIntelStatus(
      elements.ledgerStatus,
      error?.message ||
        'Snapshot could not be saved. Check the database connection and try again.',
      'error',
    );
  } finally {
    savingSnapshot = false;
    if (elements.snapshotSave) elements.snapshotSave.disabled = false;
  }
}


function render(state) {
  const scenario = getScenario(state.scenarioId);
  const model = deriveDashboardModel(scenario, state);

  if (elements.scenarioSelect) elements.scenarioSelect.value = scenario.id;
  setText('scenario-code', scenario.code);
  setText('scenario-description', scenario.description);
  setText('scenario-window', scenario.window);

  syncControls(state);

  updateResourceCard(model.water, {
    prefix: 'water',
    sufficientLabel: 'Sufficient Supply',
  });

  updateResourceCard(model.electricity, {
    prefix: 'electricity',
    sufficientLabel: 'Sufficient Capacity',
  });

  updateAlerts(model);

  document.body.dataset.scenario = scenario.id;
  scheduleAdvisoryRefresh();
}

function bindEvents() {
  elements.scenarioSelect?.addEventListener('change', (event) => {
    store.setState({ scenarioId: event.target.value });
  });

  for (const input of [
    elements.demandPressure,
    elements.waterAvailability,
    elements.gridCapacity,
  ]) {
    input?.addEventListener('input', (event) => {
      const key = event.target.dataset.controlKey;
      if (!key) return;
      store.setState({ [key]: Number(event.target.value) });
    });
  }

  elements.resetControls?.addEventListener('click', () => {
    store.setState({ ...CONTROL_DEFAULTS });
  });

  elements.briefRefresh?.addEventListener('click', () => {
    scheduleAdvisoryRefresh({ immediate: true });
  });

  elements.ledgerRefresh?.addEventListener('click', () => {
    void refreshLedger();
  });

  elements.snapshotForm?.addEventListener('submit', (event) => {
    void saveSnapshot(event);
  });
}

function init() {
  if (!elements.scenarioSelect) return;

  populateScenarioOptions();
  bindEvents();
  store.subscribe(render);
  render(store.getState());
  void refreshLedger();

  updateClock();
  window.setInterval(updateClock, 30_000);
}

init();
