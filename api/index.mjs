import { createRuntime } from '../server.mjs';

let runtimePromise = null;

async function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = createRuntime();
  }
  return runtimePromise;
}

export default async function handler(req, res) {
  try {
    const runtime = await getRuntime();
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
