import { createRuntime } from '../server.mjs';

let runtimePromise = null;

export async function getSharedRuntime() {
  if (!runtimePromise) {
    runtimePromise = createRuntime();
  }
  return runtimePromise;
}

export async function handleRequest(req, res) {
  try {
    const runtime = await getSharedRuntime();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    await runtime.handleApi(req, res, pathname, url.searchParams);
  } catch (error) {
    console.error('Quantum Flux Serverless API Error:', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: error?.message || 'Internal Server Error' } }));
    }
  }
}
