// /api/profile routes — the Glove's HTTP surface.
//
// M1 scope: read + partial save of gathered inputs and the draft card.
// AI intake routes (/extract, /fetch, /distill, /approve) land in M3/M4.
//
// TRUST INVARIANT (see schema.sql): this module writes gathered inputs and the
// DRAFT card only. The released `peer_card` column is written exclusively by
// POST /api/profile/approve (M4), which enforces the release gate.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getProfile, upsertProfile, type ProfilePatch } from '../db/index.js';
import { peerCardSchema, parseStoredCard } from '../profile/peerCard.js';
import { loadCareerOpsSources } from '../generate/sources.js';
import { ClaudeUnavailableError, claudeStatus, runClaude } from '../generate/claude.js';
import {
  clearClaudeToken,
  isValidTokenShape,
  storeClaudeToken,
  tokenIsStored,
} from '../profile/claudeAuth.js';
import {
  cancelConnectSession,
  startConnectSession,
  submitConnectCode,
} from '../profile/setupToken.js';
import { TASK_MODELS } from '../profile/models.js';
import { fetchGithubMarkdown, fetchPortfolioText } from '../profile/fetchers.js';
import { distillPeerCard, inputsHash } from '../profile/distill.js';
import { redactSecrets } from './security.js';
import { releaseBlockers } from '../profile/peerCard.js';
import { addEvent } from '../db/index.js';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** A nullable, trimmed text field with a sanity cap. null clears the column. */
const text = (max: number) => z.string().trim().max(max).nullable().optional();

/**
 * Body for POST /api/profile — any subset of the gathered fields (autosave
 * sends one section at a time) plus an optional draft-card update.
 */
const profileBodySchema = z
  .object({
    cv_md: text(200_000),
    essay_work: text(10_000),
    essay_target: text(10_000),
    essay_edge: text(10_000),
    github_username: text(80),
    portfolio_url: text(500),
    linkedin_url: text(500),
    linkedin_paste: text(50_000),
    /** Edited draft card (validated shape). Never touches the released card. */
    peerCardDraft: peerCardSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Grounding status (what would ground a generation right now?)
// ---------------------------------------------------------------------------

export type GroundingActive = 'glove' | 'files' | 'none';

export function groundingStatus(): { active: GroundingActive; filesMissing: string[] } {
  const profile = getProfile();
  if (profile && parseStoredCard(profile.peer_card) && (profile.approved_cv_md ?? '').trim()) {
    return { active: 'glove', filesMissing: [] };
  }
  const { missing } = loadCareerOpsSources();
  // All three career-ops files unreadable -> nothing to ground from.
  return { active: missing.length < 3 ? 'files' : 'none', filesMissing: missing };
}

// ---------------------------------------------------------------------------
// Single-flight lock for AI intake steps. The trigger.ts throttle only covers
// its own spawned CLIs; these routes run in-process, and the profile table is
// a single row — concurrent AI writes would race. One step at a time.
// ---------------------------------------------------------------------------

let intakeBusy: string | null = null;

async function withIntakeLock<T>(
  step: string,
  reply: FastifyReply,
  fn: () => Promise<T>,
): Promise<T | FastifyReply> {
  if (intakeBusy) {
    return reply.code(409).send({ error: `another intake step is running (${intakeBusy})` });
  }
  intakeBusy = step;
  try {
    return await fn();
  } finally {
    intakeBusy = null;
  }
}

/** Map a Claude failure to an honest HTTP response (never a silent fallback). */
function sendClaudeError(reply: FastifyReply, err: unknown, taskLabel: string): FastifyReply {
  if (err instanceof ClaudeUnavailableError) {
    if (err.kind === 'limit') {
      return reply.code(503).send({
        error: `Claude usage limit reached — ${taskLabel} will work again ${err.retryHint ?? 'after the limit resets'}.`,
        kind: 'limit',
        retryHint: err.retryHint ?? null,
      });
    }
    return reply.code(503).send({
      error: `${taskLabel} needs the Claude CLI on this machine. Run Falkyr on the host (npm run dev), or paste the text instead.`,
      kind: 'error',
    });
  }
  return reply.code(500).send({ error: errMsg(err) });
}

/** Error → string, with anything token-shaped scrubbed (defense-in-depth). */
function errMsg(err: unknown): string {
  return redactSecrets(err instanceof Error ? err.message : String(err));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function registerProfileRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/profile -> { profile, grounding, claude, claudeAvailable }
  app.get('/api/profile', async () => {
    const claude = claudeStatus();
    return {
      profile: getProfile() ?? null,
      grounding: groundingStatus(),
      claude: { ...claude, tokenStored: tokenIsStored() },
      // Back-compat flag consumed by GlovePage buttons.
      claudeAvailable: claude.cli && claude.connected,
    };
  });

  // POST /api/profile -> partial save of gathered fields / the draft card.
  app.post('/api/profile', async (req, reply) => {
    const parsed = profileBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .code(422)
        .send({ error: `invalid profile fields: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` });
    }
    const { peerCardDraft, ...fields } = parsed.data;

    const patch: ProfilePatch = { ...fields };
    if (peerCardDraft) patch.peer_card_draft = JSON.stringify(peerCardDraft);

    // Editing a source invalidates its fetch cache — stage 2 must refetch, so
    // the user never distills against stale "what Falkyr read" text.
    const existing = getProfile();
    if (fields.github_username !== undefined && fields.github_username !== existing?.github_username) {
      patch.github_md = null;
      patch.github_fetched_at = null;
      patch.github_error = null;
    }
    if (fields.portfolio_url !== undefined && fields.portfolio_url !== existing?.portfolio_url) {
      patch.portfolio_text = null;
      patch.portfolio_fetched_at = null;
      patch.portfolio_error = null;
    }

    return upsertProfile(patch);
  });

  // POST /api/profile/fetch {source?} — run the deterministic stage-2 fetchers.
  // No AI involved; works with no Claude installed. Per-source results + errors
  // persist so a GitHub rate-limit doesn't lose a good portfolio fetch.
  const fetchBodySchema = z.object({ source: z.enum(['github', 'portfolio']).optional() });
  app.post('/api/profile/fetch', async (req, reply) => {
    const parsed = fetchBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(422).send({ error: 'invalid fetch body' });
    const profile = getProfile();
    if (!profile) return reply.code(422).send({ error: 'save your profile inputs first' });

    return withIntakeLock('fetch', reply, async () => {
      const wanted = parsed.data.source;
      const patch: ProfilePatch = {};
      const now = () => new Date().toISOString();

      if ((!wanted || wanted === 'github') && profile.github_username?.trim()) {
        try {
          patch.github_md = await fetchGithubMarkdown(profile.github_username);
          patch.github_fetched_at = now();
          patch.github_error = null;
        } catch (e) {
          patch.github_error = e instanceof Error ? e.message : String(e);
        }
      }
      if ((!wanted || wanted === 'portfolio') && profile.portfolio_url?.trim()) {
        try {
          patch.portfolio_text = await fetchPortfolioText(profile.portfolio_url);
          patch.portfolio_fetched_at = now();
          patch.portfolio_error = null;
        } catch (e) {
          patch.portfolio_error = e instanceof Error ? e.message : String(e);
        }
      }
      if (Object.keys(patch).length === 0) {
        return reply
          .code(422)
          .send({ error: 'nothing to fetch — add a GitHub username or portfolio URL first' });
      }
      return upsertProfile(patch);
    });
  });

  // POST /api/profile/extract {filename, dataBase64} — PDF → Markdown via the
  // user's own Claude (cheap tier). Returns the text for REVIEW; never saves.
  const extractBodySchema = z.object({
    filename: z.string().trim().min(1).max(200),
    dataBase64: z.string().min(1),
  });
  app.post(
    '/api/profile/extract',
    { bodyLimit: 16 * 1024 * 1024 },
    async (req, reply) => {
      const parsed = extractBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(422).send({ error: 'invalid extract body' });
      if (!/\.pdf$/i.test(parsed.data.filename)) {
        return reply.code(422).send({ error: 'only PDF files are extracted — or paste your résumé as text' });
      }

      let pdf: Buffer;
      try {
        pdf = Buffer.from(parsed.data.dataBase64, 'base64');
      } catch {
        return reply.code(422).send({ error: 'dataBase64 is not valid base64' });
      }
      if (pdf.length < 5 || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        return reply.code(422).send({ error: 'that file does not look like a PDF' });
      }

      return withIntakeLock('extract', reply, async () => {
        // Server-generated temp path — never user-supplied — so the one
        // Read-enabled claude run can only see this file.
        const dir = await mkdtemp(join(tmpdir(), 'falkyr-extract-'));
        const pdfPath = join(dir, 'resume.pdf');
        try {
          await writeFile(pdfPath, pdf);
          const raw = await runClaude(
            [
              `Read the PDF file at this exact path: ${pdfPath}`,
              '',
              'Transcribe the résumé it contains into clean Markdown:',
              '- Start with a single H1 of the candidate name.',
              '- Preserve ALL factual content verbatim: employers, titles, dates, metrics, skills, education, links.',
              '- Use ## section headings and - bullets mirroring the document structure.',
              '- Do NOT summarize, embellish, reorder, or invent anything. This is transcription, not editing.',
              'Return ONLY the Markdown.',
            ].join('\n'),
            { timeoutMs: 120_000, model: TASK_MODELS.extract, allowedTools: ['Read'] },
          );
          const markdown = raw.trim();
          if (!markdown) return reply.code(502).send({ error: 'extraction produced no text — paste your résumé instead' });
          return { markdown };
        } catch (e) {
          return sendClaudeError(reply, e, 'PDF extraction');
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        }
      });
    },
  );

  // POST /api/profile/distill — the one judgment call. Saves the result as a
  // DRAFT (never touches the released card) so a closed tab can't lose a
  // multi-minute sonnet run. 422 without a saved résumé.
  app.post('/api/profile/distill', async (_req, reply) => {
    const profile = getProfile();
    if (!profile?.cv_md?.trim()) {
      return reply.code(422).send({ error: 'save your résumé first — distill reads it as the primary source' });
    }
    return withIntakeLock('distill', reply, async () => {
      try {
        const { card, thinInputs } = await distillPeerCard(profile);
        upsertProfile({
          peer_card_draft: JSON.stringify(card),
          draft_distilled_at: new Date().toISOString(),
          draft_inputs_hash: inputsHash(profile),
          draft_model: TASK_MODELS.distill,
        });
        return { card, thinInputs };
      } catch (e) {
        if (e instanceof ClaudeUnavailableError) return sendClaudeError(reply, e, 'Distilling the peer card');
        // Formatting failure after the corrective retry — honest error, the
        // previous draft (if any) is untouched.
        return reply.code(502).send({
          error: `distill produced no usable card (${errMsg(e)}) — try again`,
        });
      }
    });
  });

  // POST /api/profile/approve {card} — the release-to-hand moment. The client
  // sends the FULL card it is displaying, so what the human saw is exactly
  // what grounds. This is the ONLY writer of peer_card / approved_cv_md.
  const approveBodySchema = z.object({ card: peerCardSchema });
  app.post('/api/profile/approve', async (req, reply) => {
    const parsed = approveBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({
        error: `card failed validation: ${parsed.error.issues
          .slice(0, 6)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      });
    }
    const profile = getProfile();
    if (!profile?.cv_md?.trim()) {
      return reply.code(422).send({ error: 'a saved résumé is required before release — it grounds every application' });
    }
    const blockers = releaseBlockers(parsed.data.card);
    if (blockers.length > 0) {
      return reply.code(422).send({ error: blockers.join(' | '), blockers });
    }

    const released = upsertProfile({
      peer_card: JSON.stringify(parsed.data.card),
      peer_card_draft: JSON.stringify(parsed.data.card), // draft == released at the moment of release
      peer_card_approved_at: new Date().toISOString(),
      approved_inputs_hash: inputsHash(profile),
      approved_cv_md: profile.cv_md, // snapshot: post-release cv edits don't silently re-ground
    });
    addEvent(0, 'glove.released', `peer card released; grounding switched to the Glove`);
    return { profile: released, grounding: groundingStatus() };
  });

  // ------------------------------------------------------------------------
  // Connect-your-Claude wizard: wraps `claude setup-token`. The one-time code
  // travels request body -> CLI stdin; the resulting sk-ant-oat token is
  // stored on the data volume and injected into every claude spawn. Neither
  // is ever logged.
  // ------------------------------------------------------------------------

  // POST /api/claude/connect/start -> { url } (the Anthropic authorize link)
  app.post('/api/claude/connect/start', async (_req, reply) => {
    if (!claudeStatus().cli) {
      return reply.code(503).send({ error: 'the Claude CLI is not installed on this machine' });
    }
    try {
      const { url } = await startConnectSession();
      return { url };
    } catch (e) {
      return reply.code(502).send({ error: errMsg(e) });
    }
  });

  // POST /api/claude/connect/code {code} -> { connected: true } after a live test
  const codeBodySchema = z.object({ code: z.string().trim().min(4).max(200) });
  app.post('/api/claude/connect/code', async (req, reply) => {
    const parsed = codeBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(422).send({ error: 'missing authorization code' });
    try {
      await submitConnectCode(parsed.data.code);
    } catch (e) {
      return reply.code(502).send({ error: errMsg(e) });
    }
    // Live test on the cheap tier: proves the token actually authorizes.
    try {
      await runClaude('Reply with exactly: ok', {
        timeoutMs: 90_000,
        model: TASK_MODELS.extract,
      });
      return { connected: true };
    } catch (e) {
      // Token stored but the test call failed — report honestly (could be a
      // usage limit rather than a bad token).
      if (e instanceof ClaudeUnavailableError && e.kind === 'limit') {
        return { connected: true, note: `connected, but your Claude usage limit is active ${e.retryHint ?? ''}`.trim() };
      }
      clearClaudeToken();
      return reply
        .code(502)
        .send({ error: `the token did not authorize a test call — try connecting again (${errMsg(e).slice(0, 160)})` });
    }
  });

  // POST /api/claude/connect/cancel -> abort the in-flight session
  app.post('/api/claude/connect/cancel', async () => {
    cancelConnectSession();
    return { cancelled: true };
  });

  // POST /api/claude/token {token} — manual fallback: paste a token generated
  // by `claude setup-token` in a terminal. Same storage, same live test.
  const tokenBodySchema = z.object({ token: z.string().trim().min(10).max(500) });
  app.post('/api/claude/token', async (req, reply) => {
    const parsed = tokenBodySchema.safeParse(req.body ?? {});
    if (!parsed.success || !isValidTokenShape(parsed.data.token)) {
      return reply.code(422).send({ error: 'that does not look like a Claude Code token (sk-ant-oat…)' });
    }
    storeClaudeToken(parsed.data.token);
    try {
      await runClaude('Reply with exactly: ok', { timeoutMs: 90_000, model: TASK_MODELS.extract });
      return { connected: true };
    } catch (e) {
      if (e instanceof ClaudeUnavailableError && e.kind === 'limit') {
        return { connected: true, note: `connected, but your Claude usage limit is active ${e.retryHint ?? ''}`.trim() };
      }
      clearClaudeToken();
      return reply.code(502).send({ error: 'that token did not authorize a test call — generate a fresh one' });
    }
  });

  // POST /api/claude/disconnect -> remove the stored token
  app.post('/api/claude/disconnect', async () => {
    clearClaudeToken();
    return { disconnected: true, claude: claudeStatus() };
  });
}
