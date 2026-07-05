// All /api routes for JobPilot, registered as a Fastify plugin.
//
// Every endpoint from the shared contract is implemented here. Data access
// goes exclusively through the typed helpers in src/db/index.ts; request
// bodies/params are validated with zod. Handlers stay thin: validate, call a
// helper, shape the response.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  addEvent,
  getAnswers,
  getEvents,
  getJob,
  getJobs,
  setStage,
} from '../db/index.js';
import { STAGES, type Job, type Stage } from '../types.js';
import { buildStrategyReport } from '../strategy/index.js';
import { verifyJobCv } from '../verify/index.js';
import { ingestSources } from '../ingest/index.js';
import { triggerApply, triggerGenerate, triggerRewrite } from './trigger.js';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

/** :id path param — a positive integer job id. */
const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** ?stage= query filter — optional, must be a valid Stage if present. */
const stageQuerySchema = z.object({
  stage: z.enum(STAGES as unknown as [Stage, ...Stage[]]).optional(),
});

/** Body for POST /jobs/:id/stage. */
const stageBodySchema = z.object({
  stage: z.enum(STAGES as unknown as [Stage, ...Stage[]]),
});

/** Body for POST /jobs/:id/apply. */
const applyBodySchema = z.object({
  mode: z.enum(['fill', 'submit']),
});

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Parse & validate the :id param, or send a 400 and return undefined. */
function parseId(req: FastifyRequest, reply: FastifyReply): number | undefined {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    reply.code(400).send({ error: 'invalid job id' });
    return undefined;
  }
  return parsed.data.id;
}

/** Load a job by id, or send a 404 and return undefined. */
function loadJobOr404(
  id: number,
  reply: FastifyReply,
): Job | undefined {
  const job = getJob(id);
  if (!job) {
    reply.code(404).send({ error: `job ${id} not found` });
    return undefined;
  }
  return job;
}

// ---------------------------------------------------------------------------
// Routes plugin
// ---------------------------------------------------------------------------

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/health -> {ok:true}
  app.get('/api/health', async () => ({ ok: true }));

  // GET /api/jobs?stage= -> Job[]
  app.get('/api/jobs', async (req, reply) => {
    const parsed = stageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid stage filter' });
    }
    return getJobs(parsed.data.stage);
  });

  // POST /api/scan -> run the multi-source ingest and return per-source counts.
  // Awaits the scan (~30s) so the UI can show a spinner then the results.
  app.post('/api/scan', async () => ingestSources());

  // GET /api/jobs/:id/verify -> { report: GroundingReport | null }
  // Deterministic non-fabrication check on the tailored CV (null if none yet).
  app.get('/api/jobs/:id/verify', async (req, reply) => {
    const id = parseId(req, reply);
    if (id === undefined) return reply;
    if (!loadJobOr404(id, reply)) return reply;
    return { report: verifyJobCv(id) };
  });

  // GET /api/jobs/:id -> {job, answers, events}
  app.get('/api/jobs/:id', async (req, reply) => {
    const id = parseId(req, reply);
    if (id === undefined) return reply;
    const job = loadJobOr404(id, reply);
    if (!job) return reply;
    return { job, answers: getAnswers(id), events: getEvents(id) };
  });

  // GET /api/jobs/:id/answers -> Answer[]
  app.get('/api/jobs/:id/answers', async (req, reply) => {
    const id = parseId(req, reply);
    if (id === undefined) return reply;
    if (!loadJobOr404(id, reply)) return reply;
    return getAnswers(id);
  });

  // POST /api/jobs/:id/stage {stage} -> updated Job (records an event)
  app.post('/api/jobs/:id/stage', async (req, reply) => {
    const id = parseId(req, reply);
    if (id === undefined) return reply;

    const body = stageBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid or missing stage' });
    }
    // setStage returns undefined if the job does not exist.
    const updated = setStage(id, body.data.stage);
    if (!updated) {
      return reply.code(404).send({ error: `job ${id} not found` });
    }
    return updated;
  });

  // POST /api/jobs/:id/approve -> sets stage='approved' (records event)
  app.post('/api/jobs/:id/approve', async (req, reply) => {
    const id = parseId(req, reply);
    if (id === undefined) return reply;

    const updated = setStage(id, 'approved', 'approved for apply');
    if (!updated) {
      return reply.code(404).send({ error: `job ${id} not found` });
    }
    return updated;
  });

  // POST /api/jobs/:id/generate -> {queued:true}
  app.post('/api/jobs/:id/generate', async (req, reply) => {
    const id = parseId(req, reply);
    if (id === undefined) return reply;
    if (!loadJobOr404(id, reply)) return reply;

    addEvent(id, 'generate', 'generation queued');
    triggerGenerate(id);
    return { queued: true };
  });

  // GET /api/jobs/:id/strategy -> StrategyReport (advisory anti-monoculture report)
  app.get('/api/jobs/:id/strategy', async (req, reply) => {
    const id = parseId(req, reply);
    if (id === undefined) return reply;
    if (!loadJobOr404(id, reply)) return reply;

    return buildStrategyReport(id);
  });

  // POST /api/jobs/:id/rewrite -> {queued:true}
  // Fire-and-forget grounded résumé rewrite (advisory / generation only).
  app.post('/api/jobs/:id/rewrite', async (req, reply) => {
    const id = parseId(req, reply);
    if (id === undefined) return reply;
    if (!loadJobOr404(id, reply)) return reply;

    addEvent(id, 'rewrite', 'rewrite queued');
    triggerRewrite(id);
    return { queued: true };
  });

  // POST /api/jobs/:id/apply {mode:'fill'|'submit'} -> {started:true}
  // HARD GATE: mode==='submit' requires job.stage==='approved', else 409.
  app.post('/api/jobs/:id/apply', async (req, reply) => {
    const id = parseId(req, reply);
    if (id === undefined) return reply;

    const body = applyBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "mode must be 'fill' or 'submit'" });
    }

    const job = loadJobOr404(id, reply);
    if (!job) return reply;

    const { mode } = body.data;

    // 409 rule: refuse to start a submit for a non-approved job. This is the
    // first of two independent guards; the apply module re-checks stage AND
    // the JOBPILOT_ALLOW_SUBMIT env flag before ever clicking submit.
    if (mode === 'submit' && job.stage !== 'approved') {
      addEvent(
        id,
        'apply',
        `submit refused: stage=${job.stage} (must be 'approved')`,
      );
      return reply.code(409).send({
        error: 'submit requires stage=approved',
        stage: job.stage,
      });
    }

    addEvent(id, 'apply', `autofill started (mode=${mode})`);
    triggerApply(id, mode);
    return { started: true };
  });
}
