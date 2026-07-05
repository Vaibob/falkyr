// Module resolution hook: redirect any import of 'better-sqlite3' to our
// node:sqlite-backed shim. Test-only.
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shim = pathToFileURL(join(here, '__fake-sqlite.mjs')).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'better-sqlite3') {
    return { url: shim, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
