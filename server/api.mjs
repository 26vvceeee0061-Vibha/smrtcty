import { CONTROL_DEFAULTS, SCENARIOS } from '../src/data/scenarios.js';
import { deriveDashboardModel } from '../src/lib/calculations.js';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_LABEL_LENGTH = 120;

class ApiError extends Error {
  constructor(status, message, code = 'bad_request', headers = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function sendJson(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);

  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

function requireMethod(request, method) {
  if (request.method === method) return;

  throw new ApiError(
    405,
    `This endpoint requires ${method}.`,
    'method_not_allowed',
    { Allow: method },
  );
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let size = 0;
    const chunks = [];

    function fail(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    const declaredLength = Number(request.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      fail(
        new ApiError(
          413,
          `Request body must be smaller than ${MAX_BODY_BYTES / 1024} KB.`,
          'payload_too_large',
        ),
      );
      return;
    }

    request.on('data', (chunk) => {
      if (settled) return;

      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(
          new ApiError(
            413,
            `Request body must be smaller than ${MAX_BODY_BYTES / 1024} KB.`,
            'payload_too_large',
          ),
        );
        return;
      }

      chunks.push(chunk);
    });

    request.on('end', () => {
      if (settled) return;
      settled = true;

      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        reject(new ApiError(400, 'A JSON request body is required.', 'missing_body'));
        return;
      }

      let parsed;

      try {
        parsed = JSON.parse(raw);
      } catch {
        reject(new ApiError(400, 'Request body is not valid JSON.', 'invalid_json'));
        return;
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        reject(
          new ApiError(400, 'Request body must be a JSON object.', 'invalid_body'),
        );
        return;
      }

      resolve(parsed);
    });

    request.on('error', () => {
      fail(new ApiError(400, 'Unable to read the request body.', 'request_error'));
    });
  });
}

function assertJsonContentType(request) {
  const contentType = request.headers['content-type'];
  const mediaType =
    typeof contentType === 'string'
      ? contentType.split(';')[0].trim().toLowerCase()
      : '';

  if (mediaType !== 'application/json') {
    throw new ApiError(
      415,
      'Content-Type must be application/json.',
      'unsupported_media_type',
    );
  }
}

function parseScenario(value) {
  if (typeof value !== 'string') {
    throw new ApiError(400, 'scenarioId must be a string.', 'invalid_scenario');
  }

  const scenario = SCENARIOS.find((item) => item.id === value);

  if (!scenario) {
    throw new ApiError(
      400,
      `Unknown scenarioId "${value}".`,
      'invalid_scenario',
    );
  }

  return scenario;
}

function parseControls(value) {
  if (value === undefined) return { ...CONTROL_DEFAULTS };

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'controls must be an object.', 'invalid_controls');
  }

  const controls = { ...CONTROL_DEFAULTS };

  for (const key of Object.keys(CONTROL_DEFAULTS)) {
    if (!(key in value)) continue;

    const raw = value[key];
    const numeric =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw)
          : Number.NaN;

    if (!Number.isFinite(numeric)) {
      throw new ApiError(
        400,
        `controls.${key} must be a finite number.`,
        'invalid_controls',
      );
    }

    controls[key] = numeric;
  }

  return controls;
}

function parseLabel(value) {
  if (value === undefined || value === null) return null;

  if (typeof value !== 'string') {
    throw new ApiError(400, 'label must be a string.', 'invalid_label');
  }

  const label = value.replace(/\s+/g, ' ').trim();
  if (!label) return null;

  if (label.length > MAX_LABEL_LENGTH) {
    throw new ApiError(
      400,
      `label must be ${MAX_LABEL_LENGTH} characters or fewer.`,
      'invalid_label',
    );
  }

  return label;
}

function parseLimit(value) {
  if (value === null) return 10;

  if (!/^\d+$/.test(value)) {
    throw new ApiError(
      400,
      'limit must be a whole number between 1 and 50.',
      'invalid_limit',
    );
  }

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ApiError(
      400,
      'limit must be a whole number between 1 and 50.',
      'invalid_limit',
    );
  }

  return limit;
}

function serializeResource(resource) {
  return {
    demand: resource.demand,
    available: resource.available,
    shortage: resource.shortage,
    reserve: resource.reserve,
    status: resource.status,
    unit: resource.unit,
    utilization: resource.utilization,
    demandMetPercent: resource.demandMetPercent,
  };
}

function buildContext(scenario, resourceModel) {
  return {
    scenario: {
      id: scenario.id,
      code: scenario.code,
      name: scenario.name,
      description: scenario.description,
      window: scenario.window,
    },
    controls: resourceModel.controls,
    water: serializeResource(resourceModel.water),
    electricity: serializeResource(resourceModel.electricity),
    alerts: {
      shortageCount: resourceModel.alerts.shortageCount,
      unknownCount: resourceModel.alerts.unknownCount,
      allNormal: resourceModel.alerts.allNormal,
    },
  };
}

function requireBodyScenario(body) {
  return {
    scenario: parseScenario(body.scenarioId),
    controls: parseControls(body.controls),
  };
}

/**
 * Creates the /api handler. Resource values are always derived on the server
 * from the canonical scenario data; client-supplied metrics are ignored.
 */
export function createApiHandler({
  snapshotStore,
  advisoryService,
  config,
  startedAt = Date.now(),
}) {
  return async function handleApi(
    request,
    response,
    pathname,
    searchParams,
  ) {
    if (pathname !== '/api' && !pathname.startsWith('/api/')) return false;

    try {
      if (pathname === '/api/health') {
        requireMethod(request, 'GET');

        let database;
        try {
          database = await snapshotStore.health();
        } catch {
          database = {
            connected: false,
            latencyMs: null,
            snapshotCount: null,
          };
        }

        const healthy = database.connected;

        sendJson(response, healthy ? 200 : 503, {
          status: healthy ? 'ok' : 'degraded',
          service: 'quantum-flux',
          version: config?.version ?? '1.1.0',
          timestamp: new Date().toISOString(),
          uptimeSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
          advisory: {
            framework: 'langchain',
            provider: advisoryService.provider,
            model: advisoryService.model,
          },
          database: {
            driver: snapshotStore.driver,
            ...database,
          },
        });
        return true;
      }

      if (pathname === '/api/ai-brief' || pathname === '/api/advisory') {
        if (pathname === '/api/advisory' || request.method !== 'GET') {
          requireMethod(request, 'POST');
          assertJsonContentType(request);
        }

        let scenario;
        let controls;

        if (request.method === 'GET') {
          const scenarioId = searchParams.get('scenarioId') ?? searchParams.get('scenario');
          if (!scenarioId) {
            throw new ApiError(400, 'scenarioId query parameter is required.', 'invalid_scenario');
          }
          scenario = parseScenario(scenarioId);
          controls = parseControls({
            demandPressure: searchParams.get('demandPressure'),
            waterAvailability: searchParams.get('waterAvailability'),
            gridCapacity: searchParams.get('gridCapacity'),
          });
        } else {
          const body = await readJsonBody(request);
          const parsed = requireBodyScenario(body);
          scenario = parsed.scenario;
          controls = parsed.controls;
        }

        const resourceModel = deriveDashboardModel(scenario, controls);
        const advisory = await advisoryService.generate({
          scenario,
          model: resourceModel,
        });

        sendJson(response, 200, {
          advisory,
          context: buildContext(scenario, resourceModel),
        });
        return true;
      }

      if (pathname === '/api/snapshots') {
        if (request.method === 'GET') {
          const limit = parseLimit(searchParams.get('limit'));
          const snapshots = await snapshotStore.list(limit);

          sendJson(response, 200, {
            driver: snapshotStore.driver,
            count: snapshots.length,
            snapshots,
          });
          return true;
        }

        if (request.method === 'POST') {
          assertJsonContentType(request);

          const body = await readJsonBody(request);
          const { scenario, controls } = requireBodyScenario(body);
          const label = parseLabel(body.label);
          const resourceModel = deriveDashboardModel(scenario, controls);
          const advisory = await advisoryService.generate({
            scenario,
            model: resourceModel,
          });

          const snapshot = await snapshotStore.save({
            label,
            scenario,
            controls: resourceModel.controls,
            resourceModel,
            advisory,
          });

          sendJson(response, 201, {
            driver: snapshotStore.driver,
            snapshot,
          });
          return true;
        }

        throw new ApiError(
          405,
          'This endpoint requires GET or POST.',
          'method_not_allowed',
          { Allow: 'GET, POST' },
        );
      }

      throw new ApiError(404, 'API route not found.', 'not_found');
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(
          response,
          error.status,
          {
            error: {
              code: error.code,
              message: error.message,
            },
          },
          error.headers,
        );
        return true;
      }

      console.error('Quantum Flux API error:', error);
      sendJson(response, 500, {
        error: {
          code: 'internal_error',
          message: 'The request could not be completed.',
        },
      });
      return true;
    }
  };
}
