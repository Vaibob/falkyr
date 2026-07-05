// Per-user configuration — the de-personalization spine (Week 2).
//
// Everything that used to be hardcoded to one person (the career-ops path, the
// honest-gap "landmines" the verifier polices, the GitHub handle, the scan
// sources) is resolved HERE, per user, from `~/.jobpilot/config.json`. This is
// what lets a human who isn't the author install and use JobPilot.
//
// Precedence for every value: ENV VAR  >  ~/.jobpilot/config.json  >  built-in
// default. The defaults reproduce the original single-user behavior exactly, so
// an existing setup with no config file keeps working unchanged.
//
// Loaded synchronously and memoized: config.ts imports this at module load to
// resolve paths, so it must not be async and must never throw.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/** The JSON shape written by `npx @jobpilot/mcp init` (all fields optional). */
export interface UserConfigFile {
  /** Absolute path to the career-ops repo holding cv.md / profile.yml / article-digest.md. */
  careerOpsRoot?: string;
  /** Absolute path to the SQLite DB. */
  dbPath?: string;
  /** Candidate GitHub handle to surface in tailored résumés (e.g. "github.com/you"). */
  githubHandle?: string;
  /**
   * Honest-gap "landmines" the deterministic verifier flags if they appear in a
   * tailored résumé but not in the sources — i.e. things this candidate does NOT
   * have and must never claim. Per-user: a data engineer's landmines differ from
   * an RL researcher's. Empty/omitted → the verifier uses its built-in default.
   */
  landmines?: string[];
  /** Path to a sources.config.json (scan keyword + company config). */
  sourcesConfigPath?: string;
}

/** Fully-resolved config. Path fields always present; personalization optional. */
export interface ResolvedUserConfig {
  careerOpsRoot: string;
  dbPath: string;
  githubHandle?: string;
  landmines?: string[];
  sourcesConfigPath?: string;
  /** Where the config file was read from (for `doctor` / diagnostics). */
  configPath: string;
  /** True when a config file was actually found and parsed. */
  loadedFromFile: boolean;
}

/** Directory holding the per-user config + (by default) DB. Override with JOBPILOT_CONFIG_DIR. */
export function configDir(): string {
  return process.env.JOBPILOT_CONFIG_DIR ?? join(homedir(), '.jobpilot');
}

/** Absolute path to the config file. */
export function configFilePath(): string {
  return join(configDir(), 'config.json');
}

/** Built-in defaults — reproduce the original single-user behavior. */
const DEFAULT_CAREER_OPS_ROOT = 'C:\\Users\\VaibhavGangaramShela\\Documents\\career-ops';
const DEFAULT_DB_PATH = join(REPO_ROOT, 'data', 'jobpilot.db');

/** Read + parse the config file if present. Never throws — warns and returns null. */
function readFileConfig(): UserConfigFile | null {
  const path = configFilePath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as UserConfigFile;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    process.stderr.write(
      `[jobpilot] warning: could not parse ${path} (${err instanceof Error ? err.message : String(err)}); using defaults.\n`,
    );
    return null;
  }
}

let cached: ResolvedUserConfig | undefined;

/** Resolve the effective user config (env > file > default). Memoized per process. */
export function getUserConfig(): ResolvedUserConfig {
  if (cached) return cached;
  const file = readFileConfig();
  const nonEmpty = (a?: string[]): string[] | undefined => (a && a.length > 0 ? a : undefined);

  cached = {
    careerOpsRoot: process.env.CAREER_OPS_ROOT ?? file?.careerOpsRoot ?? DEFAULT_CAREER_OPS_ROOT,
    dbPath: process.env.JOBPILOT_DB ?? file?.dbPath ?? DEFAULT_DB_PATH,
    githubHandle: process.env.JOBPILOT_GITHUB ?? file?.githubHandle,
    landmines: nonEmpty(file?.landmines),
    sourcesConfigPath: process.env.JOBPILOT_SOURCES ?? file?.sourcesConfigPath,
    configPath: configFilePath(),
    loadedFromFile: file !== null,
  };
  return cached;
}

/** Test/CLI hook to reset the memoized config after writing a new file. */
export function resetUserConfigCache(): void {
  cached = undefined;
}
