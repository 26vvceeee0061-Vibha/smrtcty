import { mkdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

const { Pool } = pg;
const SCHEMA_URL = new URL('../db/schema.sql', import.meta.url);

const INSERT_SNAPSHOT = `
  INSERT INTO resource_snapshots (
    label,
    scenario_id,
    scenario_code,
    scenario_name,
    demand_pressure,
    water_availability,
    grid_capacity,
    water_demand,
    water_available,
    water_shortage,
    water_status,
    electricity_demand,
    electricity_available,
    electricity_shortage,
    electricity_status,
    shortage_count,
    advisory_headline,
    advisory_summary,
    advisory_risk,
    advisory_provider,
    advisory_model,
    advisory_fallback,
    advisory_notice,
    recommendations
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
    $21, $22, $23, $24::jsonb
  )
  RETURNING *
`;

const SELECT_SNAPSHOTS = `
  SELECT *
  FROM resource_snapshots
  ORDER BY created_at DESC, id DESC
  LIMIT $1
`;

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toIsoString(value) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toRecommendations(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
  if (typeof value !== 'string') return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Maps a database row into the API representation shared by pg and PGlite. */
export function mapSnapshotRow(row) {
  return {
    id: Number(row.id),
    label: row.label ?? null,
    createdAt: toIsoString(row.created_at),
    scenario: {
      id: row.scenario_id,
      code: row.scenario_code,
      name: row.scenario_name,
    },
    controls: {
      demandPressure: toNumber(row.demand_pressure),
      waterAvailability: toNumber(row.water_availability),
      gridCapacity: toNumber(row.grid_capacity),
    },
    water: {
      demand: toNumber(row.water_demand),
      available: toNumber(row.water_available),
      shortage: toNumber(row.water_shortage),
      status: row.water_status,
    },
    electricity: {
      demand: toNumber(row.electricity_demand),
      available: toNumber(row.electricity_available),
      shortage: toNumber(row.electricity_shortage),
      status: row.electricity_status,
    },
    shortageCount: toNumber(row.shortage_count) ?? 0,
    advisory: {
      headline: row.advisory_headline,
      summary: row.advisory_summary,
      risk: row.advisory_risk,
      provider: row.advisory_provider,
      model: row.advisory_model,
      fallback: Boolean(row.advisory_fallback),
      notice: row.advisory_notice ?? null,
      recommendations: toRecommendations(row.recommendations),
    },
  };
}

function normalizeLimit(value, fallback = 10) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return fallback;
  return Math.min(50, Math.max(1, numeric));
}

/**
 * Creates the snapshot repository.
 *
 * - `DATABASE_URL` selects a real PostgreSQL pool (`pg`).
 * - Otherwise an embedded PGlite database is opened at `dataDir`.
 * - A null `dataDir` opens a private in-memory database (used by tests).
 */
export async function createSnapshotStore({ databaseUrl = null, dataDir = null } = {}) {
  const driver = databaseUrl ? 'postgres' : 'pglite';
  let pool = null;
  let pglite = null;
  let closed = false;
  let closing = null;

  if (databaseUrl) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  } else {
    if (dataDir) await mkdir(dataDir, { recursive: true });
    pglite = dataDir ? new PGlite(dataDir) : new PGlite();
  }

  async function query(text, params = []) {
    if (pool) return pool.query(text, params);
    return pglite.query(text, params);
  }

  try {
    const schemaSql = await readFile(SCHEMA_URL, 'utf8');

    if (pool) {
      await pool.query(schemaSql);
    } else {
      await pglite.exec(schemaSql);
    }
  } catch (error) {
    if (pool) await pool.end().catch(() => {});
    else if (pglite) await pglite.close().catch(() => {});
    throw error;
  }

  return {
    driver,

    async save({ label = null, scenario, controls, resourceModel, advisory }) {
      const result = await query(INSERT_SNAPSHOT, [
        label,
        scenario.id,
        scenario.code,
        scenario.name,
        controls.demandPressure,
        controls.waterAvailability,
        controls.gridCapacity,
        resourceModel.water.demand,
        resourceModel.water.available,
        resourceModel.water.shortage,
        resourceModel.water.status,
        resourceModel.electricity.demand,
        resourceModel.electricity.available,
        resourceModel.electricity.shortage,
        resourceModel.electricity.status,
        resourceModel.alerts.shortageCount,
        advisory.headline,
        advisory.summary,
        advisory.risk,
        advisory.provider,
        advisory.model,
        Boolean(advisory.fallback),
        advisory.notice ?? null,
        JSON.stringify(advisory.recommendations ?? []),
      ]);

      return mapSnapshotRow(result.rows[0]);
    },

    async list(limit = 10) {
      const result = await query(SELECT_SNAPSHOTS, [
        normalizeLimit(limit),
      ]);
      return result.rows.map(mapSnapshotRow);
    },

    async health() {
      const startedAt = performance.now();
      await query('SELECT 1 AS ok');
      const countResult = await query(
        'SELECT COUNT(*)::int AS count FROM resource_snapshots',
      );

      return {
        connected: true,
        latencyMs: Math.round(performance.now() - startedAt),
        snapshotCount: toNumber(countResult.rows[0]?.count) ?? 0,
      };
    },

    async close() {
      if (closing) return closing;
      if (closed) return;

      closed = true;
      closing = (async () => {
        if (pool) {
          await pool.end();
        } else if (pglite) {
          await pglite.close();
        }
      })();

      return closing;
    },
  };
}
