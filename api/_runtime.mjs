import { createRuntime } from '../server.mjs';

let runtimePromise = null;

export async function getSharedRuntime() {
  if (!runtimePromise) {
    runtimePromise = createRuntime();
  }
  return runtimePromise;
}

export function createRouteHandler(forcedPathname = null) {
  return async function handle(req, res) {
    try {
      const runtime = await getSharedRuntime();
      const url = new URL(req.url ?? '/', 'http://localhost');
      let pathname = forcedPathname;
      if (!pathname) {
        pathname = decodeURIComponent(url.pathname);
        if (!pathname.startsWith('/api')) {
          pathname = `/api${pathname.startsWith('/') ? '' : '/'}${pathname}`;
        }
      }
      if (pathname.length > 5 && pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      await runtime.handleApi(req, res, pathname, url.searchParams);
    } catch (error) {
      console.error('Quantum Flux Serverless API Error:', error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: { message: error?.message || 'Internal Server Error' } }));
      }
    }
  };
}

export const handleRequest = createRouteHandler();
