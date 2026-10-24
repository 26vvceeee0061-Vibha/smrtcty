/**
 * End-to-end browser check for the Quantum Flux dashboard.
 *
 * Starts the local server, launches headless Chrome over the DevTools
 * protocol, drives the real controls, verifies rendered values, and captures
 * desktop/mobile screenshots. Run with `npm run test:ui`.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer } from '../server.mjs';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const screenshotDir = join(tmpdir(), 'quantum-flux-ui');
const userDataDir = join(
  tmpdir(),
  `quantum-flux-chrome-${process.pid}-${Date.now()}`,
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForFile(path, timeoutMs = 12_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(path)) return;
    await sleep(80);
  }

  throw new Error(`Timed out waiting for ${path}`);
}

function findChrome() {
  const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!chrome) {
    throw new Error(
      'Chrome could not be found. Set CHROME_PATH to run the browser check.',
    );
  }
  return chrome;
}

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    const eventWaiters = new Map();
    const events = {
      exceptions: [],
      consoleErrors: [],
    };
    let nextId = 1;

    const timeout = setTimeout(() => {
      reject(new Error('Timed out opening the Chrome DevTools socket.'));
    }, 10_000);

    socket.addEventListener('open', () => {
      clearTimeout(timeout);

      resolve({
        events,
        send(method, params = {}) {
          return new Promise((resolveCommand, rejectCommand) => {
            const id = nextId++;
            pending.set(id, { resolve: resolveCommand, reject: rejectCommand });

            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        waitForEvent(method, timeoutMs = 10_000) {
          return new Promise((resolveEvent, rejectEvent) => {
            const waiters = eventWaiters.get(method) ?? [];
            const waiter = {
              resolve: (params) => {
                clearTimeout(timeoutId);
                resolveEvent(params);
              },
            };
            const timeoutId = setTimeout(() => {
              const activeWaiters = eventWaiters.get(method) ?? [];
              eventWaiters.set(
                method,
                activeWaiters.filter((item) => item !== waiter),
              );
              rejectEvent(new Error(`Timed out waiting for CDP event ${method}.`));
            }, timeoutMs);

            waiters.push(waiter);
            eventWaiters.set(method, waiters);
          });
        },
        close() {
          socket.close();
        },
      });
    });

    socket.addEventListener('message', (event) => {
      let message;

      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.id) {
        const command = pending.get(message.id);
        if (!command) return;
        pending.delete(message.id);

        if (message.error) {
          command.reject(new Error(`${message.error.message} (${message.error.code})`));
        } else {
          command.resolve(message.result);
        }
        return;
      }

      const waiters = eventWaiters.get(message.method);
      if (waiters?.length) {
        eventWaiters.delete(message.method);
        for (const waiter of waiters) waiter.resolve(message.params);
      }

      if (message.method === 'Runtime.exceptionThrown') {
        events.exceptions.push(
          message.params.exceptionDetails?.exception?.description ??
            message.params.exceptionDetails?.text ??
            'Unknown runtime exception',
        );
      }

      if (message.method === 'Log.entryAdded') {
        const entry = message.params.entry;
        if (entry?.level === 'error') {
          events.consoleErrors.push(entry.text);
        }
      }

      if (
        message.method === 'Runtime.consoleAPICalled' &&
        message.params.type === 'error'
      ) {
        events.consoleErrors.push(
          message.params.args
            .map((arg) => arg.value ?? arg.description ?? '')
            .join(' '),
        );
      }
    });

    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Chrome DevTools socket failed.'));
    });

    socket.addEventListener('close', () => {
      for (const command of pending.values()) {
        command.reject(new Error('Chrome DevTools socket closed.'));
      }
      pending.clear();
    });
  });
}

function createCdpClient(connection) {
  async function evaluate(expression, awaitPromise = false) {
    const result = await connection.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          'Evaluation failed',
      );
    }

    return result.result?.value;
  }

  return { evaluate };
}

const READ_DASHBOARD = `(() => {
  const text = (id) => document.getElementById(id)?.textContent.trim() ?? '';
  const alertItems = [...document.querySelectorAll('#alerts-list .alert-item')].map((item) => {
    const metrics = [...item.querySelectorAll('.alert-metric')].map((metric) => ({
      label: metric.querySelector('dt')?.textContent.trim() ?? '',
      value: metric.querySelector('dd')?.textContent.trim() ?? '',
      className: metric.querySelector('dd')?.className ?? '',
    }));

    return {
      resource: item.dataset.resource,
      status: item.dataset.status,
      statusText: item.querySelector('.alert-status')?.textContent.trim() ?? '',
      message: item.querySelector('.alert-item__message')?.textContent.trim() ?? '',
      metrics,
      critical: item.classList.contains('alert-item--critical'),
    };
  });

  return {
    title: document.title,
    scenario: document.body.dataset.scenario,
    waterTitle: document.querySelector('#water-card h2')?.textContent.trim() ?? '',
    powerTitle: document.querySelector('#power-card h2')?.textContent.trim() ?? '',
    alertsTitle: document.querySelector('#alerts-title')?.textContent.trim() ?? '',
    waterDemand: text('water-demand-value'),
    waterAvailable: text('water-available-value'),
    waterStatus: text('water-status-text'),
    waterVerdict: text('water-verdict'),
    powerDemand: text('electricity-demand-value'),
    powerAvailable: text('electricity-available-value'),
    powerStatus: text('electricity-status-text'),
    powerVerdict: text('electricity-verdict'),
    alertsSummary: text('alerts-summary-text'),
    allClearHidden: document.getElementById('all-clear-banner')?.hidden ?? null,
    allClearText: text('all-clear-banner'),
    navBadgeHidden: document.getElementById('nav-alert-count')?.hidden ?? null,
    navBadgeText: text('nav-alert-count'),
    alertItems,
    briefTitle: document.querySelector('#operations-brief h2')?.textContent.trim() ?? '',
    briefHeadline: text('brief-headline'),
    briefSummary: text('brief-summary'),
    briefRisk: text('brief-risk'),
    briefProvider: text('brief-provider'),
    briefModel: text('brief-model'),
    briefStatus: text('brief-status'),
    briefScenario: document.getElementById('operations-brief')?.dataset.advisoryScenario ?? '',
    briefProviderState: document.getElementById('operations-brief')?.dataset.advisoryProvider ?? '',
    briefRecommendationCount: document.querySelectorAll('#brief-recommendations li').length,
    ledgerTitle: document.querySelector('#snapshot-ledger h2')?.textContent.trim() ?? '',
    ledgerDriver: text('ledger-driver'),
    ledgerDriverState: document.getElementById('ledger-driver-pill')?.dataset.driver ?? '',
    ledgerStatus: text('ledger-status'),
    ledgerCount: text('ledger-count'),
    ledgerStore: text('ledger-store'),
    ledgerItems: [...document.querySelectorAll('#ledger-list .ledger-item')].map((item) => ({
      id: item.dataset.snapshotId,
      code: item.querySelector('.ledger-item__code')?.textContent.trim() ?? '',
      scenario: item.querySelector('.ledger-item__scenario')?.textContent.trim() ?? '',
      label: item.querySelector('.ledger-item__label')?.textContent.trim() ?? '',
      advisory: item.querySelector('.ledger-item__advisory')?.textContent.trim() ?? '',
      metrics: [...item.querySelectorAll('.ledger-metric')].map((metric) => ({
        label: metric.querySelector('em')?.textContent.trim() ?? '',
        value: metric.querySelector('strong')?.textContent.trim() ?? '',
        className: metric.className,
      })),
    })),
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    exceptionsInPage: window.__qfErrors ?? [],
  };
})()`;

async function main() {
  const server = await startServer({
    port: 0,
    quiet: true,
    pgliteDataDir: null,
    advisoryProvider: 'local',
  });
  const chromePath = findChrome();

  await mkdir(screenshotDir, { recursive: true });
  await mkdir(userDataDir, { recursive: true });

  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--hide-scrollbars',
      '--window-size=1440,1100',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      `http://127.0.0.1:${server.port}`,
    ],
    { stdio: 'ignore' },
  );

  let connection;

  try {
    const devToolsPortFile = join(userDataDir, 'DevToolsActivePort');
    await waitForFile(devToolsPortFile);

    const portFileContents = (await readFile(devToolsPortFile, 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean);
    const devToolsPort = Number(portFileContents[0]);

    if (!Number.isFinite(devToolsPort)) {
      throw new Error('Chrome did not expose a valid DevTools port.');
    }

    let target;

    for (let attempt = 0; attempt < 50; attempt++) {
      const targets = await fetch(
        `http://127.0.0.1:${devToolsPort}/json/list`,
      ).then((response) => response.json());
      target = targets.find(
        (item) => item.type === 'page' && item.url.includes(`127.0.0.1:${server.port}`),
      );

      if (target) break;
      await sleep(100);
    }

    if (!target) throw new Error('Dashboard page target was not found.');

    connection = await connectWebSocket(target.webSocketDebuggerUrl);
    const cdp = createCdpClient(connection);

    await connection.send('Runtime.enable');
    await connection.send('Log.enable');
    await connection.send('Page.enable');
    const loadEvent = connection.waitForEvent('Page.loadEventFired');
    await connection.send('Page.navigate', {
      url: `http://127.0.0.1:${server.port}`,
    });
    await loadEvent;

    await cdp.evaluate(`
      new Promise((resolve, reject) => {
        let attempts = 0;
        const check = () => {
          const element = document.getElementById('water-demand-value');
          if (element && element.textContent.trim() !== '—') {
            resolve(true);
            return;
          }
          if (++attempts > 100) {
            reject(new Error('Dashboard did not initialize.'));
            return;
          }
          setTimeout(check, 50);
        };
        check();
      })
    `, true);

    const read = () => cdp.evaluate(READ_DASHBOARD);
    const setScenario = async (scenarioId) => {
      await cdp.evaluate(`(() => {
        const select = document.getElementById('scenario-select');
        select.value = ${JSON.stringify(scenarioId)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await cdp.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => resolve(true)))',
        true,
      );
    };
    const setControl = async (controlId, value) => {
      await cdp.evaluate(`(() => {
        const input = document.getElementById(${JSON.stringify(controlId)});
        input.value = ${JSON.stringify(String(value))};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await cdp.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => resolve(true)))',
        true,
      );
    };
    const resetInputs = async () => {
      await cdp.evaluate('document.getElementById("reset-controls").click()');
      await cdp.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => resolve(true)))',
        true,
      );
    };
    const waitFor = async (condition, description) => {
      await cdp.evaluate(
        `new Promise((resolve, reject) => {
          let attempts = 0;
          const check = () => {
            try {
              if (${condition}) {
                resolve(true);
                return;
              }
            } catch {
              // Keep polling while the DOM settles.
            }
            if (++attempts > 200) {
              reject(new Error(${JSON.stringify(description)}));
              return;
            }
            setTimeout(check, 50);
          };
          check();
        })`,
        true,
      );
    };

    await waitFor(
      "document.getElementById('operations-brief')?.dataset.advisoryScenario === 'summer-surge'",
      'Initial AI operations brief did not load.',
    );
    await waitFor(
      "document.getElementById('ledger-driver-pill')?.dataset.driver === 'pglite'",
      'Snapshot ledger did not connect.',
    );

    // 1. Default scenario: water shortage, electricity normal.
    let state = await read();

    assert.equal(state.title, 'Quantum Flux — Smart City AI Command Center');
    assert.equal(state.waterTitle, 'Water Demand vs Available Water');
    assert.equal(state.powerTitle, 'Electricity Demand vs Available Capacity');
    assert.equal(state.alertsTitle, 'Resource Shortage Alerts');
    assert.equal(state.scenario, 'summer-surge');
    assert.equal(state.waterDemand, '512');
    assert.equal(state.waterAvailable, '448');
    assert.equal(state.waterStatus, 'Shortage');
    assert.match(state.waterVerdict, /Water shortage/i);
    assert.match(state.waterVerdict, /64 ML\/day/);
    assert.equal(state.powerDemand, '886');
    assert.equal(state.powerAvailable, '940');
    assert.equal(state.powerStatus, 'Normal');
    assert.match(state.powerVerdict, /Sufficient Capacity/);
    assert.match(state.powerVerdict, /54 MW reserve/);
    assert.equal(state.alertsSummary, '1 active shortage');
    assert.equal(state.navBadgeHidden, false);
    assert.equal(state.navBadgeText, '1');
    assert.equal(state.allClearHidden, true);
    assert.equal(state.alertItems.length, 2);
    assert.equal(state.alertItems[0].resource, 'water');
    assert.equal(state.alertItems[0].status, 'shortage');
    assert.equal(state.alertItems[0].critical, true);
    assert.match(state.alertItems[0].message, /64 ML\/day/);
    assert.equal(state.alertItems[1].resource, 'electricity');
    assert.equal(state.alertItems[1].status, 'normal');
    assert.equal(state.alertItems[1].critical, false);
    assert.equal(state.alertItems[1].metrics[2].value, '0 MW');
    assert.notEqual(state.alertItems[1].metrics[2].className, 'is-critical');

    // 1b. LangChain advisory and PostgreSQL ledger are live.
    assert.equal(state.briefTitle, 'AI Operations Brief');
    assert.equal(state.briefScenario, 'summer-surge');
    assert.equal(state.briefProviderState, 'local');
    assert.equal(state.briefProvider, 'Local chain');
    assert.equal(state.briefRisk, 'Elevated');
    assert.match(state.briefHeadline, /resource gap/i);
    assert.match(state.briefSummary, /64 ML\/day/);
    assert.match(state.briefSummary, /54 MW in reserve/);
    assert.equal(state.briefModel, 'quantum-flux-rules-v1');
    assert.equal(state.briefRecommendationCount, 3);
    assert.match(state.briefStatus, /server-verified resource model/);
    assert.equal(state.ledgerTitle, 'Scenario Snapshot Ledger');
    assert.equal(state.ledgerDriver, 'PGlite');
    assert.equal(state.ledgerDriverState, 'pglite');
    assert.equal(state.ledgerStore, 'PGlite');
    assert.equal(state.ledgerItems.length, 0);
    assert.match(state.ledgerStatus, /No snapshots saved yet/);

    // 1c. Persist the active operating point through the API.
    await cdp.evaluate(`(() => {
      const input = document.getElementById('snapshot-label');
      input.value = 'E2E handover';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('snapshot-form').requestSubmit();
    })()`);
    await waitFor(
      "document.querySelectorAll('#ledger-list .ledger-item').length === 1 && document.getElementById('ledger-status').textContent.includes('saved')",
      'Snapshot was not persisted to the ledger.',
    );

    state = await read();
    assert.equal(state.ledgerItems.length, 1);
    assert.equal(state.ledgerItems[0].id, '1');
    assert.equal(state.ledgerItems[0].scenario, 'Summer Surge');
    assert.equal(state.ledgerItems[0].code, 'SCN-01');
    assert.equal(state.ledgerItems[0].label, 'E2E handover');
    assert.equal(state.ledgerItems[0].metrics[0].value, '64 ML/day');
    assert.match(state.ledgerItems[0].metrics[0].className, /is-critical/);
    assert.equal(state.ledgerItems[0].metrics[1].value, '0 MW');
    assert.match(state.ledgerItems[0].metrics[1].className, /is-normal/);
    assert.match(state.ledgerItems[0].advisory, /resource gap/i);
    assert.equal(state.ledgerCount, '1 recent snapshot');
    assert.match(state.ledgerStatus, /Snapshot #1 saved/);

    // Capture the initial desktop view for visual inspection.
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(200);
    const desktopState = await read();
    assert.ok(
      desktopState.scrollWidth <= desktopState.viewportWidth + 1,
      `Desktop layout overflows horizontally: ${desktopState.scrollWidth} > ${desktopState.viewportWidth}`,
    );
    const layout = await connection.send('Page.getLayoutMetrics');
    const desktopContent = layout.cssContentSize;
    const desktopShot = await connection.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: desktopContent.width,
        height: desktopContent.height,
        scale: 1,
      },
    });
    const desktopScreenshotPath = join(screenshotDir, 'dashboard-desktop.png');
    await writeFile(desktopScreenshotPath, Buffer.from(desktopShot.data, 'base64'));

    // 2. Electricity-only shortage.
    await setScenario('grid-lock');
    state = await read();
    assert.equal(state.waterStatus, 'Normal');
    assert.match(state.waterVerdict, /Sufficient Supply/);
    assert.equal(state.powerStatus, 'Shortage');
    assert.match(state.powerVerdict, /Electricity shortage/i);
    assert.match(state.powerVerdict, /56 MW/);
    assert.equal(state.alertsSummary, '1 active shortage');
    assert.equal(state.alertItems[0].status, 'normal');
    assert.equal(state.alertItems[1].status, 'shortage');
    assert.equal(state.alertItems[1].metrics[2].value, '56 MW');

    await waitFor(
      "document.getElementById('operations-brief').dataset.advisoryScenario === 'grid-lock' && document.getElementById('brief-summary').textContent.includes('56 MW')",
      'Grid Lock advisory did not refresh.',
    );
    state = await read();
    assert.equal(state.briefRisk, 'Elevated');
    assert.match(state.briefSummary, /56 MW/);
    assert.match(state.briefSummary, /28 ML\/day in reserve/);
    assert.match(state.briefStatus, /server-verified resource model/);

    // 3. Exact parity: zero shortage, normal status, all-clear message.
    await setScenario('tight-margin');
    state = await read();
    assert.equal(state.waterDemand, '480');
    assert.equal(state.waterAvailable, '480');
    assert.equal(state.powerDemand, '900');
    assert.equal(state.powerAvailable, '900');
    assert.equal(state.waterStatus, 'Normal');
    assert.equal(state.powerStatus, 'Normal');
    assert.match(state.waterVerdict, /Sufficient Supply/);
    assert.match(state.powerVerdict, /Sufficient Capacity/);
    assert.equal(state.alertsSummary, 'All clear');
    assert.equal(state.navBadgeHidden, true);
    assert.equal(state.allClearHidden, false);
    assert.match(
      state.allClearText,
      /All resources are sufficient\. No shortages detected\./,
    );
    assert.equal(state.alertItems[0].metrics[2].value, '0 ML/day');
    assert.equal(state.alertItems[1].metrics[2].value, '0 MW');

    await waitFor(
      "document.getElementById('operations-brief').dataset.advisoryScenario === 'tight-margin' && document.getElementById('brief-risk').textContent.trim() === 'Guarded'",
      'Tight Margin advisory did not refresh.',
    );
    state = await read();
    assert.equal(state.briefRisk, 'Guarded');
    assert.match(state.briefSummary, /exactly matched/);

    // 4. Both resources in shortage.
    await setScenario('infrastructure-crunch');
    state = await read();
    assert.equal(state.waterStatus, 'Shortage');
    assert.equal(state.powerStatus, 'Shortage');
    assert.match(state.waterVerdict, /164 ML\/day/);
    assert.match(state.powerVerdict, /166 MW/);
    assert.equal(state.alertsSummary, '2 active shortages');
    assert.equal(state.navBadgeText, '2');
    assert.equal(state.allClearHidden, true);
    assert.equal(state.alertItems.length, 2);
    assert.equal(state.alertItems[0].status, 'shortage');
    assert.equal(state.alertItems[1].status, 'shortage');
    assert.equal(state.alertItems[0].metrics[2].value, '164 ML/day');
    assert.equal(state.alertItems[1].metrics[2].value, '166 MW');

    await waitFor(
      "document.getElementById('operations-brief').dataset.advisoryScenario === 'infrastructure-crunch' && document.getElementById('brief-risk').textContent.trim() === 'Critical'",
      'Infrastructure Crunch advisory did not refresh.',
    );
    state = await read();
    assert.equal(state.briefRisk, 'Critical');
    assert.match(state.briefSummary, /164 ML\/day/);
    assert.match(state.briefSummary, /166 MW/);
    assert.equal(state.briefRecommendationCount, 3);

    // 5. No shortage at all.
    await setScenario('steady-state');
    state = await read();
    assert.equal(state.waterStatus, 'Normal');
    assert.equal(state.powerStatus, 'Normal');
    assert.equal(state.alertsSummary, 'All clear');
    assert.equal(state.allClearHidden, false);
    assert.equal(state.alertItems.filter((item) => item.status === 'shortage').length, 0);
    assert.match(
      state.alertItems[0].message,
      /meets demand/,
    );

    await waitFor(
      "document.getElementById('operations-brief').dataset.advisoryScenario === 'steady-state' && document.getElementById('brief-risk').textContent.trim() === 'Stable'",
      'Steady State advisory did not refresh.',
    );
    state = await read();
    assert.equal(state.briefRisk, 'Stable');
    assert.match(state.briefSummary, /in reserve/);

    // 6. Live input change updates cards, alerts and nav badge together.
    await setScenario('summer-surge');
    await resetInputs();
    await setControl('demand-pressure', 120);
    await waitFor(
      "document.getElementById('brief-summary').textContent.includes('166.4 ML/day') && document.getElementById('brief-risk').textContent.trim() === 'Critical'",
      'Advisory did not follow the demand-pressure change.',
    );
    state = await read();
    assert.equal(state.briefRisk, 'Critical');
    assert.match(state.briefSummary, /166.4 ML\/day/);
    assert.match(state.briefSummary, /123.2 MW/);
    assert.equal(state.waterDemand, '614.4');
    assert.equal(state.waterAvailable, '448');
    assert.match(state.waterVerdict, /166.4 ML\/day/);
    assert.equal(state.powerDemand, '1,063.2');
    assert.equal(state.powerAvailable, '940');
    assert.match(state.powerVerdict, /123.2 MW/);
    assert.equal(state.alertsSummary, '2 active shortages');
    assert.equal(state.alertItems[0].metrics[0].value, '614.4 ML/day');
    assert.equal(state.alertItems[0].metrics[2].value, '166.4 ML/day');
    assert.equal(state.alertItems[1].metrics[0].value, '1,063.2 MW');
    assert.equal(state.alertItems[1].metrics[2].value, '123.2 MW');

    await setControl('water-availability', 70);
    await waitFor(
      "document.getElementById('brief-summary').textContent.includes('300.8 ML/day')",
      'Advisory did not follow the water-availability change.',
    );
    state = await read();
    assert.match(state.briefSummary, /300.8 ML\/day/);
    assert.equal(state.waterAvailable, '313.6');
    assert.match(state.waterVerdict, /300.8 ML\/day/);
    assert.equal(state.alertItems[0].metrics[1].value, '313.6 ML/day');
    assert.equal(state.alertItems[0].metrics[2].value, '300.8 ML/day');

    await resetInputs();
    await waitFor(
      "document.getElementById('brief-summary').textContent.includes('64 ML/day') && document.getElementById('brief-risk').textContent.trim() === 'Elevated'",
      'Advisory did not return to the scenario baseline.',
    );
    state = await read();
    assert.equal(state.briefRisk, 'Elevated');
    assert.match(state.briefSummary, /64 ML\/day/);
    assert.equal(state.waterDemand, '512');
    assert.equal(state.waterAvailable, '448');
    assert.equal(state.powerDemand, '886');
    assert.equal(state.powerAvailable, '940');
    assert.equal(state.alertsSummary, '1 active shortage');

    // 7. Mobile layout and screenshots.
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(300);
    state = await read();
    assert.ok(
      state.scrollWidth <= state.viewportWidth + 1,
      `Mobile layout overflows horizontally: ${state.scrollWidth} > ${state.viewportWidth}`,
    );

    const mobileLayout = await connection.send('Page.getLayoutMetrics');
    const mobileContent = mobileLayout.cssContentSize;
    const mobileShot = await connection.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: mobileContent.width,
        height: mobileContent.height,
        scale: 1,
      },
    });
    const mobileScreenshotPath = join(screenshotDir, 'dashboard-mobile.png');
    await writeFile(mobileScreenshotPath, Buffer.from(mobileShot.data, 'base64'));

    for (const width of [320, 768]) {
      await connection.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await sleep(180);
      state = await read();
      assert.ok(
        state.scrollWidth <= state.viewportWidth + 1,
        `Layout overflows horizontally at ${width}px: ${state.scrollWidth} > ${state.viewportWidth}`,
      );
    }

    assert.deepEqual(connection.events.exceptions, []);
    assert.deepEqual(connection.events.consoleErrors, []);

    console.log('Browser checks passed:');
    console.log('  ✓ Default water shortage and electricity normal state');
    console.log('  ✓ Electricity-only shortage state');
    console.log('  ✓ Exact-parity state shows zero shortage and normal status');
    console.log('  ✓ Both-shortage state shows two independent alerts');
    console.log('  ✓ No-shortage state shows the all-resources-sufficient message');
    console.log('  ✓ Scenario changes update cards and alerts consistently');
    console.log('  ✓ Slider changes recalculate immediately from shared data');
    console.log('  ✓ Reset restores the scenario baseline');
    console.log('  ✓ LangChain advisory refreshes with scenario and input changes');
    console.log('  ✓ Snapshot is recomputed, persisted, and rendered in the ledger');
    console.log('  ✓ Responsive layout has no horizontal overflow (320 / 390 / 768 / 1440)');
    console.log('  ✓ No JavaScript exceptions or console errors');
    console.log(`Screenshots: ${desktopScreenshotPath}`);
    console.log(`Screenshots: ${mobileScreenshotPath}`);
  } finally {
    connection?.close();
    chrome.kill();
    await server.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
