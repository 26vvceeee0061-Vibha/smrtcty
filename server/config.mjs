import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const APP_VERSION = '1.1.0';

let envLoaded = false;

function loadLocalEnv() {
  if (envLoaded) return;
  envLoaded = true;

  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return;

  try {
    // Node 20.12+ can load a .env file without an extra dependency.
    process.loadEnvFile(envPath);
  } catch {
    // A malformed .env should not prevent the dashboard from booting with
    // defaults. Explicit shell environment values still take precedence.
  }
}

function readInteger(value, fallback, { min = 1, max = 65535 } = {}) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) return fallback;
  return numeric;
}

function readString(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed === '' ? fallback : trimmed;
}

/**
 * Resolves runtime configuration from explicit overrides, environment
 * variables, and safe local defaults. Tests pass explicit overrides so they
 * never touch a developer's real database.
 */
export function loadConfig(overrides = {}) {
  loadLocalEnv();

  const host = overrides.host ?? readString(process.env.HOST, '127.0.0.1');
  const port = overrides.port ?? readInteger(process.env.PORT, 4173);
  const databaseUrl =
    overrides.databaseUrl !== undefined
      ? readString(overrides.databaseUrl)
      : readString(process.env.DATABASE_URL);

  const defaultDataDir = resolve(
    ROOT,
    readString(process.env.PGLITE_DATA_DIR, '.data/pglite'),
  );
  const pgliteDataDir =
    overrides.pgliteDataDir !== undefined
      ? overrides.pgliteDataDir
      : defaultDataDir;

  const advisoryProviderSetting = (
    overrides.advisoryProvider ??
    readString(process.env.ADVISORY_PROVIDER, 'auto')
  ).toLowerCase();
  const advisoryProvider = ['auto', 'openai', 'local'].includes(
    advisoryProviderSetting,
  )
    ? advisoryProviderSetting
    : 'auto';

  return {
    root: ROOT,
    version: APP_VERSION,
    host,
    port,
    databaseUrl,
    pgliteDataDir,
    openaiApiKey:
      overrides.openaiApiKey !== undefined
        ? readString(overrides.openaiApiKey)
        : readString(process.env.OPENAI_API_KEY),
    openaiModel:
      overrides.openaiModel ??
      readString(process.env.OPENAI_MODEL, 'gpt-4o-mini'),
    openaiTimeoutMs:
      overrides.openaiTimeoutMs ??
      readInteger(process.env.OPENAI_TIMEOUT_MS, 20_000, {
        min: 1_000,
        max: 120_000,
      }),
    advisoryProvider,
  };
}
