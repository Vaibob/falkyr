// `npm run init` (→ eventually `npx @jobpilot/mcp init`).
//
// Sets JobPilot up for a NEW user: writes ~/.jobpilot/config.json (+ a starter
// sources.config.json), runs a doctor check, and prints the one line to register
// the MCP in Claude Code. This is what makes JobPilot installable by someone who
// isn't the original author — the config it writes feeds src/userconfig.ts.
//
// Flag-driven (no blocking prompts, so it works headless / in scripts):
//   npm run init -- --role rl-ml --career-ops <path> --github github.com/you
// Idempotent: refuses to overwrite an existing config unless --force.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDir, configFilePath, type UserConfigFile } from '../userconfig.js';

/** Universal credential landmines — SAFE for everyone: the verifier only flags a
 *  term if it appears in the résumé but NOT in the candidate's own files, so a
 *  real degree/patent in cv.md is never flagged. Role packs add domain terms. */
const UNIVERSAL_LANDMINES = ['phd', 'ph.d', 'doctorate', 'patent', 'published', 'publication', 'award'];

interface RolePack {
  label: string;
  extraLandmines: string[];
  keywords: string[];
}

const ROLE_PACKS: Record<string, RolePack> = {
  'rl-ml': {
    label: 'RL / ML / post-training',
    extraLandmines: ['neurips', 'icml', 'iclr', 'fsdp', 'deepspeed', 'megatron', 'robotics', 'embodied', 'sim-to-real'],
    keywords: ['reinforcement learning', 'post-training', 'rlhf', 'llm', 'vlm', 'machine learning', 'ml engineer', 'ai engineer', 'applied ai', 'research engineer', 'deep learning', 'mlops'],
  },
  'data-eng': {
    label: 'Data engineering',
    extraLandmines: [],
    keywords: ['data engineer', 'analytics engineer', 'etl', 'data pipeline', 'data platform', 'warehouse', 'dbt', 'spark', 'airflow', 'streaming'],
  },
  backend: {
    label: 'Backend / platform',
    extraLandmines: [],
    keywords: ['backend', 'software engineer', 'platform engineer', 'distributed systems', 'api', 'microservices', 'golang', 'rust', 'infrastructure'],
  },
  frontend: {
    label: 'Frontend / full-stack',
    extraLandmines: [],
    keywords: ['frontend', 'full stack', 'react', 'typescript', 'ui engineer', 'web', 'design systems'],
  },
  pm: {
    label: 'Product management',
    extraLandmines: [],
    keywords: ['product manager', 'technical product manager', 'group product manager', 'product lead', 'ai product'],
  },
  generic: {
    label: 'Generic (broad)',
    extraLandmines: [],
    keywords: ['engineer', 'developer', 'manager', 'lead', 'senior', 'staff'],
  },
};

function arg(flags: string[], name: string): string | undefined {
  const i = flags.indexOf(name);
  return i >= 0 ? flags[i + 1] : undefined;
}

function main(): void {
  const flags = process.argv.slice(2);
  if (flags.includes('--help') || flags.includes('-h')) {
    console.log(HELP);
    return;
  }

  const roleKey = arg(flags, '--role') ?? 'generic';
  const pack = ROLE_PACKS[roleKey];
  if (!pack) {
    console.error(`error: unknown --role "${roleKey}". Choose one of: ${Object.keys(ROLE_PACKS).join(', ')}`);
    process.exitCode = 2;
    return;
  }

  const dir = configDir();
  const cfgPath = configFilePath();
  const force = flags.includes('--force');
  mkdirSync(dir, { recursive: true });

  if (existsSync(cfgPath) && !force) {
    console.log(`✓ Config already exists at ${cfgPath} (use --force to overwrite).`);
  } else {
    const sourcesPath = join(dir, 'sources.config.json');
    const config: UserConfigFile = {
      careerOpsRoot: arg(flags, '--career-ops') ?? '<PATH-TO-YOUR-career-ops-REPO>',
      dbPath: join(dir, 'jobpilot.db'),
      githubHandle: arg(flags, '--github'),
      landmines: [...UNIVERSAL_LANDMINES, ...pack.extraLandmines],
      sourcesConfigPath: sourcesPath,
    };
    writeFileSync(cfgPath, JSON.stringify(config, null, 2) + '\n');
    writeFileSync(sourcesPath, JSON.stringify(starterSources(pack.keywords), null, 2) + '\n');
    console.log(`✓ Wrote ${cfgPath}`);
    console.log(`✓ Wrote ${sourcesPath}  (role: ${pack.label})`);
    console.log(`  Landmines seeded (${config.landmines!.length}): terms you must never claim unless they're in your CV.`);
    console.log(`  → Edit config.json to add any role/tech-specific things you do NOT have (that's what protects you).`);
  }

  runDoctor(arg(flags, '--career-ops'));
  printMcpRegistration();
}

/** A minimal, safe starter sources config: free remote aggregators + the role's
 *  title keywords. The user adds target-company ATS slugs themselves. */
function starterSources(keywords: string[]): unknown {
  return {
    _comment: 'JobPilot scan sources. Add company ATS slugs under "ats" (see the repo template for the full catalog).',
    titleKeywords: keywords,
    maxPerSource: 150,
    aggregators: {
      himalayas: { enabled: true, limit: 100 },
      remoteok: { enabled: true },
      remotive: { enabled: true },
      arbeitnow: { enabled: true },
      jobicy: { enabled: true, count: 100 },
    },
    ats: { greenhouse: [], lever: [], ashby: [], workable: [] },
  };
}

function ok(b: boolean): string {
  return b ? '✓' : '✗';
}

function runDoctor(careerOpsFlag?: string): void {
  console.log('\nDoctor:');
  // 1. claude CLI on PATH?
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const claude = spawnSync(finder, ['claude'], { encoding: 'utf8' });
  const hasClaude = claude.status === 0;
  console.log(`  ${ok(hasClaude)} claude CLI ${hasClaude ? 'found' : 'NOT found — install Claude Code; generation will use the template fallback until then'}`);

  // 2. career-ops readable (cv.md present)?
  const root = careerOpsFlag;
  if (root) {
    const cv = join(root, 'cv.md');
    const hasCv = existsSync(cv);
    console.log(`  ${ok(hasCv)} career-ops cv.md ${hasCv ? `found at ${cv}` : `NOT found at ${cv}`}`);
  } else {
    console.log('  … set --career-ops <path> (or edit careerOpsRoot in config.json) to point at your CV/profile/article-digest');
  }

  // 3. config dir writable (we just wrote to it, so yes).
  console.log(`  ${ok(true)} config dir writable (${configDir()})`);
}

function printMcpRegistration(): void {
  console.log('\nRegister the MCP in your Claude Code, then just ask it to "scan for jobs":');
  console.log('  claude mcp add jobpilot -- npx -y @jobpilot/mcp');
  console.log('\nOr add this to a project .mcp.json:');
  console.log(
    JSON.stringify(
      { mcpServers: { jobpilot: { command: 'npx', args: ['-y', '@jobpilot/mcp'] } } },
      null,
      2,
    ),
  );
  console.log('\nThe LLM work runs on YOUR Claude subscription. Nothing is uploaded.');
}

const HELP = `jobpilot init — set JobPilot up for you (writes ~/.jobpilot/config.json).

Usage:
  npm run init -- [--role <role>] [--career-ops <path>] [--github <handle>] [--force]

Options:
  --role <role>        Starter pack: ${Object.keys(ROLE_PACKS).join(' | ')}   (default: generic)
  --career-ops <path>  Path to your career-ops repo (cv.md / config/profile.yml / article-digest.md)
  --github <handle>    Your GitHub handle to surface in tailored résumés (e.g. github.com/you)
  --force              Overwrite an existing config.json
  -h, --help           Show this help

After running, edit ~/.jobpilot/config.json to add the role/tech-specific things
you do NOT have (your "honest gaps") — that's what the verifier polices for you.`;

main();
