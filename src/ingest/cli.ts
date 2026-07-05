// CLI entrypoint for `npm run ingest`.
//
// By default runs BOTH ingests:
//   1. career-ops (pipeline.md + reports/*.md)
//   2. live multi-source pull (aggregators + ATS APIs + dormant Dice)
// Idempotent: safe to run repeatedly.
//
// Usage:
//   npm run ingest                      both career-ops + live sources
//   npm run ingest -- --sources-only    only the live multi-source pull
//   npm run ingest -- --no-sources      only career-ops (offline)
//   npm run ingest -- --config <path>   override sources.config.json
//   npm run ingest -- --json            machine-readable output

import {
  ingest,
  ingestSources,
  PIPELINE_PATH,
  REPORTS_DIR,
  type IngestOptions,
  type IngestResult,
  type SourceIngestResult,
} from './index.js';

interface CliArgs {
  opts: IngestOptions;
  json: boolean;
  sourcesOnly: boolean;
  noSources: boolean;
  configPath?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { opts: {}, json: false, sourcesOnly: false, noSources: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--sources-only') args.sourcesOnly = true;
    else if (a === '--no-sources') args.noSources = true;
    else if (a === '--config') args.configPath = argv[++i];
    else if (a === '--pipeline') args.opts.pipelinePath = argv[++i];
    else if (a === '--reports') args.opts.reportsDir = argv[++i];
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(
    [
      'jobpilot ingest — seed the DB from career-ops AND live job sources',
      '',
      'Options:',
      '  --sources-only    Only pull live sources (skip career-ops files)',
      '  --no-sources      Only career-ops files (skip live network pull)',
      '  --config <path>   Override sources.config.json',
      '  --pipeline <path> Override career-ops pipeline.md path',
      '  --reports  <dir>  Override career-ops reports dir',
      '  --json            Print result as JSON',
      '  -h, --help        Show this help',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let careerOps: IngestResult | undefined;
  let sources: SourceIngestResult | undefined;

  if (!args.sourcesOnly) {
    careerOps = ingest(args.opts);
  }
  if (!args.noSources) {
    sources = await ingestSources(args.configPath);
  }

  if (args.json) {
    console.log(JSON.stringify({ careerOps, sources }, null, 2));
    return;
  }

  if (careerOps) {
    console.log('career-ops ingest:');
    console.log(`  pipeline: ${args.opts.pipelinePath ?? PIPELINE_PATH}`);
    console.log(`  reports:  ${args.opts.reportsDir ?? REPORTS_DIR}`);
    console.log(`  pipeline entries: ${careerOps.pipelineParsed}`);
    console.log(`  report files:     ${careerOps.reportsParsed}`);
    console.log(`  enriched by report: ${careerOps.reportsMatched}`);
    console.log('');
  }

  if (sources) {
    console.log('live sources ingest:');
    const ok = sources.bySource.filter((s) => s.ok);
    const failed = sources.bySource.filter((s) => !s.ok);
    for (const s of ok) {
      console.log(`  ✓ ${s.source.padEnd(24)} fetched ${String(s.fetched).padStart(4)} → kept ${s.kept}`);
    }
    for (const s of failed) {
      console.log(`  ✗ ${s.source.padEnd(24)} ${s.error ?? 'failed'}`);
    }
    console.log(`  kept (relevant, deduped): ${sources.totalKept}`);
    console.log(`  upserted:                 ${sources.upserted}`);
    console.log('');
  }

  const { getJobs } = await import('../db/index.js');
  console.log(`total jobs in DB: ${getJobs().length}`);
}

main().catch((err) => {
  console.error('ingest failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
