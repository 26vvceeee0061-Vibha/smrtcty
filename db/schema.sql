-- Quantum Flux resource snapshots.
-- Compatible with PostgreSQL 14+ and PGlite (embedded PostgreSQL).
CREATE TABLE IF NOT EXISTS resource_snapshots (
  id BIGSERIAL PRIMARY KEY,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scenario_id TEXT NOT NULL,
  scenario_code TEXT NOT NULL,
  scenario_name TEXT NOT NULL,
  demand_pressure NUMERIC(6, 2) NOT NULL,
  water_availability NUMERIC(6, 2) NOT NULL,
  grid_capacity NUMERIC(6, 2) NOT NULL,
  water_demand NUMERIC(12, 2) NOT NULL,
  water_available NUMERIC(12, 2) NOT NULL,
  water_shortage NUMERIC(12, 2) NOT NULL,
  water_status TEXT NOT NULL,
  electricity_demand NUMERIC(12, 2) NOT NULL,
  electricity_available NUMERIC(12, 2) NOT NULL,
  electricity_shortage NUMERIC(12, 2) NOT NULL,
  electricity_status TEXT NOT NULL,
  shortage_count SMALLINT NOT NULL,
  advisory_headline TEXT NOT NULL,
  advisory_summary TEXT NOT NULL,
  advisory_risk TEXT NOT NULL,
  advisory_provider TEXT NOT NULL,
  advisory_model TEXT NOT NULL,
  advisory_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  advisory_notice TEXT,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT resource_snapshots_water_status_check
    CHECK (water_status IN ('normal', 'shortage', 'unknown')),
  CONSTRAINT resource_snapshots_electricity_status_check
    CHECK (electricity_status IN ('normal', 'shortage', 'unknown')),
  CONSTRAINT resource_snapshots_risk_check
    CHECK (advisory_risk IN ('stable', 'guarded', 'elevated', 'critical'))
);

CREATE INDEX IF NOT EXISTS resource_snapshots_created_at_idx
  ON resource_snapshots (created_at DESC, id DESC);
