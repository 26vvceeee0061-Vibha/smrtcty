/**
 * Quantum Flux server.
 *
 * Serves the static dashboard and a small JSON API backed by LangChain
 * advisories and a PostgreSQL-compatible snapshot ledger.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createAdvisoryService } from './server/advisory.mjs';
import { createApiHandler } from './server/api.mjs';
import { loadConfig } from './server/config.mjs';
import { createSnapshotStore } from './server/database.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_PORT = 4173;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

/** Reject access to runtime data, secrets, and implementation-only folders. */
function isPrivatePath(relativePath) {
  const segments = relativePath.split('/');

  if (segments.some((segment) => segment.startsWith('.'))) return true;

  const privateRoots = new Set([
    'node_modules',
    'server',
    'db',
    'tests',
    'scripts',
  ]);

  if (privateRoots.has(segments[0])) return true;

  return relativePath === 'package.json' || relativePath === 'package-lock.json';
}

export function createRequestHandler({ handleApi }) {
  return async function handleRequest(request, response) {
    let url;

    try {
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      send(response, 400, 'Bad Request');
      return;
    }

    let pathname;

    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      send(response, 400, 'Bad Request');
      return;
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      try {
        await handleApi(request, response, pathname, url.searchParams);
      } catch (error) {
        console.error('Quantum Flux request error:', error);

        if (response.headersSent) {
          response.destroy();
        } else {
          send(response, 500, 'Internal Server Error');
        }
      }
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
      return;
    }

    const relativePath =
      pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const normalizedPath = normalize(relativePath);

    if (
      normalizedPath.startsWith('..') ||
      normalizedPath.includes(`..${sep}`) ||
      normalizedPath.includes(`${sep}..`) ||
      isPrivatePath(relativePath)
    ) {
      send(response, 404, 'Not Found');
      return;
    }

    const filePath = join(ROOT, normalizedPath);

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        send(response, 404, 'Not Found');
        return;
      }

      const file = await readFile(filePath);
      const type =
        MIME_TYPES[extname(filePath).toLowerCase()] ??
        'application/octet-stream';

      response.writeHead(200, {
        'Content-Type': type,
        'Content-Length': file.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });

      if (request.method === 'HEAD') response.end();
      else response.end(file);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        send(response, 404, 'Not Found');
        return;
      }

      console.error('Static file serve error:', error);
      send(response, 500, 'Internal Server Error');
    }
  };
}

export function createAppServer(runtime) {
  return createServer(createRequestHandler(runtime));
}

/** Wires configuration, persistence, and LangChain into one runtime. */
export async function createRuntime(overrides = {}) {
  const config = loadConfig(overrides);
  const snapshotStore = await createSnapshotStore({
    databaseUrl: config.databaseUrl,
    dataDir: config.pgliteDataDir,
  });

  try {
    const advisoryService = createAdvisoryService({
      apiKey: config.openaiApiKey,
      baseUrl: config.openaiBaseUrl,
      model: config.openaiModel,
      provider: config.advisoryProvider,
      timeoutMs: config.openaiTimeoutMs,
    });

    const handleApi = createApiHandler({
      snapshotStore,
      advisoryService,
      config,
      startedAt: Date.now(),
    });

    let closePromise = null;

    return {
      config,
      snapshotStore,
      advisoryService,
      handleApi,
      close() {
        if (!closePromise) closePromise = snapshotStore.close();
        return closePromise;
      },
    };
  } catch (error) {
    await snapshotStore.close().catch(() => {});
    throw error;
  }
}

export async function startServer({
  port = DEFAULT_PORT,
  host = '127.0.0.1',
  quiet = false,
  ...overrides
} = {}) {
  const runtime = await createRuntime({ ...overrides, port, host });
  const server = createAppServer(runtime);
  let closePromise = null;

  // Closing the raw HTTP server (as tests and external callers can do) still
  // releases PGlite/pg handles.
  server.once('close', () => {
    void runtime.close().catch(() => {});
  });

  function close() {
    if (closePromise) return closePromise;

    closePromise = new Promise((resolve) => {
      const finish = () => {
        runtime
          .close()
          .catch(() => {})
          .then(() => resolve());
      };

      if (!server.listening) {
        finish();
        return;
      }

      server.close(() => finish());
    });

    return closePromise;
  }

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await runtime.close().catch(() => {});
    throw error;
  }

  const address = server.address();
  const actualPort =
    typeof address === 'object' && address ? address.port : port;
  const url = `http://${host}:${actualPort}`;

  if (!quiet) {
    const advisoryLabel =
      runtime.advisoryService.provider === 'openai'
        ? `OpenAI ${runtime.advisoryService.model}`
        : 'LangChain local chain';
    const databaseLabel =
      runtime.snapshotStore.driver === 'postgres'
        ? 'PostgreSQL'
        : runtime.config.pgliteDataDir
          ? `embedded PGlite (${runtime.config.pgliteDataDir})`
          : 'embedded PGlite (in-memory)';

    console.log(`Quantum Flux running at ${url}`);
    console.log(`  Advisory: ${advisoryLabel}`);
    console.log(`  Snapshots: ${databaseLabel}`);
  }

  return {
    server,
    port: actualPort,
    url,
    runtime,
    close,
  };
}

const isDirectRun =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const host = process.env.HOST || '127.0.0.1';

  startServer({ port, host })
    .then(({ close }) => {
      const shutdown = (signal) => {
        console.log(`\n${signal} received; closing Quantum Flux…`);
        close().finally(() => {
          process.exitCode = 0;
        });
      };

      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    })
    .catch((error) => {
      console.error('Unable to start the Quantum Flux server:', error);
      process.exitCode = 1;
    });
}

let serverlessHandlerPromise = null;

async function getServerlessHandler() {
  if (!serverlessHandlerPromise) {
    serverlessHandlerPromise = (async () => {
      const runtime = await createRuntime();
      return createRequestHandler(runtime);
    })();
  }
  return serverlessHandlerPromise;
}

export default async function handler(req, res) {
  try {
    const handleRequest = await getServerlessHandler();
    await handleRequest(req, res);
  } catch (error) {
    console.error('Quantum Flux Serverless Runtime Error:', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`Internal Server Error: ${error?.message || error}`);
    }
  }
}

