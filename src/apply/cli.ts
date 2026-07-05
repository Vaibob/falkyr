// src/apply/cli.ts
//
// CLI entrypoint:  npm run apply -- --job <id> --mode fill|submit
//
// 'fill'   (default): fill the form and STOP at the submit button, leaving the
//                     visible browser open for the user to review + submit.
// 'submit'          : fill, then attempt submit — but this is HARD-GATED and
//                     will refuse unless job.stage==='approved' AND
//                     JOBPILOT_ALLOW_SUBMIT==='true'. See SAFETY.md / autofill.ts.

import { applyToJob, type ApplyMode } from './autofill.js';
import { getJob } from '../db/index.js';
import { SUBMIT_ALLOWED } from '../config.js';

interface Args {
  job?: number;
  mode: ApplyMode;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: 'fill', help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (a === '--job' || a === '-j') {
      args.job = Number(argv[++i]);
    } else if (a.startsWith('--job=')) {
      args.job = Number(a.slice('--job='.length));
    } else if (a === '--mode' || a === '-m') {
      args.mode = argv[++i] as ApplyMode;
    } else if (a.startsWith('--mode=')) {
      args.mode = a.slice('--mode='.length) as ApplyMode;
    }
  }
  return args;
}

function usage(): string {
  return [
    'Usage: npm run apply -- --job <id> [--mode fill|submit]',
    '',
    '  --job,  -j <id>     Job id from the jobs table (required).',
    '  --mode, -m <mode>   fill (default) | submit.',
    '',
    "  fill   : Fill the form and STOP at the submit button. Leaves the visible",
    '           browser open so you can review and submit by hand.',
    "  submit : Fill then submit — HARD-GATED. Refuses unless the job is at",
    "           stage 'approved' AND JOBPILOT_ALLOW_SUBMIT='true'. Otherwise it",
    '           falls back to fill-and-stop and records the refusal.',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage());
    return;
  }

  if (!args.job || !Number.isInteger(args.job) || args.job <= 0) {
    console.error('Error: --job <id> is required and must be a positive integer.\n');
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  if (args.mode !== 'fill' && args.mode !== 'submit') {
    console.error(`Error: --mode must be 'fill' or 'submit' (got '${args.mode}').\n`);
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const job = getJob(args.job);
  if (!job) {
    console.error(`Error: job ${args.job} not found.`);
    process.exitCode = 1;
    return;
  }

  // Loud, honest warning up front when submit cannot fire — no surprises.
  if (args.mode === 'submit') {
    const gateOk = job.stage === 'approved' && SUBMIT_ALLOWED;
    if (!gateOk) {
      console.warn(
        `[safety] 'submit' requested but the gate is closed ` +
          `(stage='${job.stage}', JOBPILOT_ALLOW_SUBMIT=${SUBMIT_ALLOWED}). ` +
          `Will fill and STOP at submit instead.`,
      );
    } else {
      console.warn(
        `[safety] Gate OPEN (stage='approved' + JOBPILOT_ALLOW_SUBMIT=true). ` +
          `This WILL submit a real application to ${job.url}.`,
      );
    }
  }

  console.log(`Applying to job ${job.id} — ${job.company ?? '?'} / ${job.role ?? '?'}`);
  console.log(`URL:  ${job.url}`);
  console.log(`Mode: ${args.mode}`);

  const result = await applyToJob(args.job, args.mode);

  console.log('\nResult:');
  console.log(`  filled:    ${result.filledCount} field(s)`);
  console.log(`  cvAttached:${result.cvAttached}`);
  console.log(`  submitted: ${result.submitted}`);
  for (const n of result.notes) console.log(`  - ${n}`);

  if (!result.submitted && result.mode !== 'submit') {
    console.log('\nBrowser left OPEN. Review the form and submit manually when ready.');
  } else if (!result.submitted && result.mode === 'submit') {
    console.log('\nSubmit was refused by the safety gate. Browser left OPEN for manual review.');
  }
  // Note: when the browser is left open, this process stays alive holding it.
  // The user closes the browser window (or Ctrl-C) when done.
}

main().catch((err) => {
  console.error(`apply failed: ${(err as Error).message}`);
  process.exitCode = 1;
});
