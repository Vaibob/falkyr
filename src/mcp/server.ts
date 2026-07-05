// src/mcp/server.ts
//
// JobPilot MCP server (Phase-1 wedge). Exposes the ALREADY-BUILT JobPilot engine
// — multi-source scan, monoculture-aware scoring, grounded résumé tailoring, and
// humanized answer drafting — as MCP tools that the user's OWN Claude Code calls.
// The creative/LLM work (tailor/draft) runs on the user's Claude subscription via
// the same `claude -p` backend the CLIs use; this server NEVER touches Anthropic
// credentials (the ToS-safe path — see jobpilot-saas/VISION.md v0.2).
//
// SAFETY (Phase 1): NO autofill/submit tools are exposed. src/apply exists but is
// deliberately NOT wired here — auto-apply is Phase 2, human-gated. Everything
// stays grounded in the peer card (career-ops files); the JD is untrusted data.
//
// stdio transport: stdout is the JSON-RPC channel — never console.log to it.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { ingestSources } from '../ingest/index.js';
import { buildStrategyReport } from '../strategy/index.js';
import { rewriteResumeForJob } from '../generate/resume.js';
import { generateForJob } from '../generate/index.js';
import { getJobs, getJob, getAnswers, getEvents } from '../db/index.js';
import { verifyJobCv } from '../verify/index.js';
import type { Stage } from '../types.js';

const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false };
const JOB_ARG = {
  type: 'object',
  properties: { jobId: { type: 'number', description: 'jobs.id from jobpilot_list' } },
  required: ['jobId'],
  additionalProperties: false,
};

const TOOLS = [
  {
    name: 'jobpilot_scan',
    description:
      'Scan the configured ATS boards + remote aggregators for jobs matching the peer card (LinkedIn/Indeed always excluded) and upsert them into the local DB. Returns per-source counts + totals.',
    inputSchema: NO_ARGS,
  },
  {
    name: 'jobpilot_list',
    description:
      'List jobs for the board (id, company, role, fit score, stage, url). Optionally filter by stage.',
    inputSchema: { type: 'object', properties: { stage: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'jobpilot_get',
    description: 'Get one job with its generated answers and event history.',
    inputSchema: JOB_ARG,
  },
  {
    name: 'jobpilot_score',
    description:
      'Non-rejection strategy report for a job: monoculture risk, routing suggestions, AI-detector voice risk, and de-correlation vs the other applications.',
    inputSchema: JOB_ARG,
  },
  {
    name: 'jobpilot_tailor_cv',
    description:
      "Generate a de-correlated, human-voiced, one-page tailored résumé for a job. Grounded ONLY in the peer card (cv.md/profile.yml/article-digest.md); no fabrication; honest gaps respected. Runs on the user's Claude via claude -p (deterministic fallback if unavailable).",
    inputSchema: JOB_ARG,
  },
  {
    name: 'jobpilot_draft_answers',
    description:
      'Draft humanized, grounded application-form answers + a cover letter for a job. No fabrication; honest gaps respected. Runs on the user\'s Claude via claude -p (fallback if unavailable).',
    inputSchema: JOB_ARG,
  },
  {
    name: 'jobpilot_verify_cv',
    description:
      'Deterministic non-fabrication check on the tailored résumé for a job: flags any number/metric, honest-gap term (PhD, top-tier papers, frontier distributed RL, robotics), or low-grounding line that does NOT trace to the peer card. A trust tripwire to run before sending.',
    inputSchema: JOB_ARG,
  },
];

const server = new Server({ name: 'jobpilot', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

/** Wrap any value as a text tool-result. */
function text(obj: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }],
  };
}
/** Wrap an error message as an isError tool-result (never throw to the transport). */
function err(msg: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: msg }] };
}
/** A readable markdown brief with a trailing JSON block (still machine-parseable). */
function md(brief: string, data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: `${brief}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`` }],
  };
}

server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  const jobId = Number(args.jobId);

  try {
    switch (name) {
      case 'jobpilot_scan': {
        const r = await ingestSources();
        const brief = [
          `**Scan complete — ${r.totalKept} relevant jobs kept, ${r.upserted} upserted, ${r.totalJobs} in the board.**`,
          ...r.bySource.filter((x) => x.ok).map((x) => `- ${x.source}: ${x.fetched} → ${x.kept}`),
          ...r.bySource.filter((x) => !x.ok).map((x) => `- ⚠️ ${x.source}: ${x.error ?? 'failed'}`),
        ].join('\n');
        return md(brief, { upserted: r.upserted, kept: r.totalKept, totalJobs: r.totalJobs });
      }
      case 'jobpilot_list': {
        const jobs = getJobs(typeof args.stage === 'string' ? (args.stage as Stage) : undefined);
        return text(
          jobs.map((j) => ({ id: j.id, company: j.company, role: j.role, score: j.fit_score, stage: j.stage, url: j.url })),
        );
      }
      case 'jobpilot_get': {
        const job = getJob(jobId);
        if (!job) return err(`no job with id=${jobId}`);
        return text({ job, answers: getAnswers(jobId), events: getEvents(jobId) });
      }
      case 'jobpilot_score': {
        const s = buildStrategyReport(jobId);
        const brief = [
          `**${s.summary}**`,
          '',
          `- **Monoculture:** ${s.monoculture.tier.toUpperCase()}${s.monoculture.vendor ? ` (${s.monoculture.vendor})` : ''} — ${s.monoculture.reason}`,
          s.voice
            ? `- **Voice / AI-detector risk:** ${s.voice.tier} (${s.voice.score})`
            : `- **Voice:** not scored yet (no materials — run jobpilot_tailor_cv)`,
          `- **De-correlation:** ${s.decorrelation.score} — ${s.decorrelation.advice}`,
          `- **Routing:**`,
          ...s.routing.map((r) => `  - [${r.channel}] ${r.action}`),
        ].join('\n');
        return md(brief, s);
      }
      case 'jobpilot_tailor_cv': {
        const r = await rewriteResumeForJob(jobId);
        if (r.paused) return md(`⏸ **Paused — ${r.note}**`, r);
        return md(
          `**Tailored résumé saved via ${r.backend}.** ${r.note}\n\nRun \`jobpilot_verify_cv\` to check grounding.`,
          r,
        );
      }
      case 'jobpilot_draft_answers': {
        const r = await generateForJob(jobId);
        if (r.paused) {
          return md(
            `⏸ **Paused — Claude usage limit reached${r.retryHint ? ` (${r.retryHint})` : ''}.** No template saved; retry when your limit resets.`,
            r,
          );
        }
        return md(
          `**Drafted ${r.answers.length} item(s) via ${r.backend}.**` +
            (r.backend === 'fallback' ? ' ⚠️ Template fallback — review before sending.' : ''),
          { backend: r.backend, saved: r.answers.length, missingSources: r.missingSources },
        );
      }
      case 'jobpilot_verify_cv': {
        const report = verifyJobCv(jobId);
        if (!report) return err(`no tailored résumé found for job ${jobId} — run jobpilot_tailor_cv first`);
        const icon = report.clean ? '✅' : report.findings.some((f) => f.hardFlags.length) ? '🔴' : '🟠';
        const brief = [
          `${icon} **${report.summary}**`,
          ...report.findings.slice(0, 12).map((f) => {
            const tag = f.hardFlags.length ? '🔴' : f.unmatchedNumbers.length ? '🚩' : '⚠️';
            const why = f.hardFlags.length
              ? ` — honest-gap term not in your sources: ${f.hardFlags.join(', ')}`
              : f.unmatchedNumbers.length
                ? ` — number(s) not in your sources: ${f.unmatchedNumbers.join(', ')}`
                : ` — low grounding (${f.score})`;
            return `- ${tag} \`${f.line.slice(0, 90)}\`${why}`;
          }),
        ].join('\n');
        return md(brief, report);
      }
      default:
        return err(`unknown tool: ${name}`);
    }
  } catch (e) {
    return err(`error in ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(
  'jobpilot MCP server ready — tools: scan, list, get, score, tailor_cv, draft_answers, verify_cv\n',
);
