// Thin fetch wrapper around the JobPilot Fastify API.
// All requests hit /api/* which Vite proxies to http://localhost:3001 in dev.
import type {
  Job,
  JobDetail,
  Answer,
  Stage,
  StrategyReport,
  GroundingReport,
  PeerCard,
  Profile,
  ProfileStatus,
} from './types.js';

const BASE = '/api';

/** Result of POST /api/scan (mirrors SourceIngestResult on the server). */
export interface ScanResult {
  bySource: { source: string; fetched: number; kept: number; ok: boolean; error?: string }[];
  totalKept: number;
  upserted: number;
  totalJobs: number;
}

/** Error carrying the HTTP status so callers can special-case (e.g. 409 approval gate). */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch (networkErr) {
    throw new ApiError(0, `Network error contacting API: ${(networkErr as Error).message}`);
  }

  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    // The Fastify routes send errors as `{ error: '...' }`; also tolerate
    // `{ message }`. Reading only `message` before made every server error
    // surface as a generic "Request failed (N)".
    const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const serverMsg = rec
      ? (typeof rec.error === 'string' && rec.error) ||
        (typeof rec.message === 'string' && rec.message) ||
        ''
      : typeof body === 'string'
        ? body
        : '';
    throw new ApiError(res.status, serverMsg || `Request failed (${res.status})`, body);
  }

  return body as T;
}

export const api = {
  health(): Promise<{ ok: boolean }> {
    return request('/health');
  },

  /** GET /api/jobs?stage= — omit stage to fetch all. */
  listJobs(stage?: Stage): Promise<Job[]> {
    const q = stage ? `?stage=${encodeURIComponent(stage)}` : '';
    return request<Job[]>(`/jobs${q}`);
  },

  /** GET /api/jobs/:id -> {job, answers, events} */
  getJob(id: number): Promise<JobDetail> {
    return request<JobDetail>(`/jobs/${id}`);
  },

  /** GET /api/jobs/:id/answers */
  getAnswers(id: number): Promise<Answer[]> {
    return request<Answer[]>(`/jobs/${id}/answers`);
  },

  /** POST /api/jobs/:id/stage {stage} -> updated Job */
  setStage(id: number, stage: Stage): Promise<Job> {
    return request<Job>(`/jobs/${id}/stage`, {
      method: 'POST',
      body: JSON.stringify({ stage }),
    });
  },

  /** POST /api/jobs/:id/approve -> sets stage='approved' */
  approve(id: number): Promise<Job> {
    return request<Job>(`/jobs/${id}/approve`, { method: 'POST' });
  },

  /** POST /api/jobs/:id/generate -> {queued:true} */
  generate(id: number): Promise<{ queued: boolean }> {
    return request<{ queued: boolean }>(`/jobs/${id}/generate`, { method: 'POST' });
  },

  /** GET /api/jobs/:id/verify -> non-fabrication report for the tailored CV (null if none). */
  verify(id: number): Promise<{ report: GroundingReport | null }> {
    return request<{ report: GroundingReport | null }>(`/jobs/${id}/verify`);
  },

  /** POST /api/scan -> run the multi-source scan; resolves with per-source counts (~30s). */
  scan(): Promise<ScanResult> {
    return request<ScanResult>('/scan', { method: 'POST' });
  },

  /** GET /api/jobs/:id/strategy -> StrategyReport (advisory anti-monoculture report). */
  strategy(id: number): Promise<StrategyReport> {
    return request<StrategyReport>(`/jobs/${id}/strategy`);
  },

  /** POST /api/jobs/:id/rewrite -> {queued:true} — fire-and-forget grounded résumé rewrite. */
  rewrite(id: number): Promise<{ queued: boolean }> {
    return request<{ queued: boolean }>(`/jobs/${id}/rewrite`, { method: 'POST' });
  },

  /**
   * POST /api/jobs/:id/apply {mode} -> {started:true}
   * mode 'fill'  : autofill the form and STOP at the submit button (always safe).
   * mode 'submit': only allowed when job.stage==='approved' (server 409s otherwise).
   */
  apply(id: number, mode: 'fill' | 'submit'): Promise<{ started: boolean }> {
    return request<{ started: boolean }>(`/jobs/${id}/apply`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    });
  },

  // ------------------------------------------------------------- the Glove

  /** GET /api/profile -> profile row + which grounding source is active. */
  getProfile(): Promise<ProfileStatus> {
    return request<ProfileStatus>('/profile');
  },

  /** POST /api/profile — partial save (gathered fields and/or edited draft card). */
  saveProfile(
    patch: Partial<{
      cv_md: string | null;
      essay_work: string | null;
      essay_target: string | null;
      essay_edge: string | null;
      github_username: string | null;
      portfolio_url: string | null;
      linkedin_url: string | null;
      linkedin_paste: string | null;
      peerCardDraft: PeerCard;
    }>,
  ): Promise<Profile> {
    return request<Profile>('/profile', { method: 'POST', body: JSON.stringify(patch) });
  },

  /** POST /api/profile/fetch — deterministic stage-2 fetchers (no AI). */
  fetchSources(source?: 'github' | 'portfolio'): Promise<Profile> {
    return request<Profile>('/profile/fetch', {
      method: 'POST',
      body: JSON.stringify(source ? { source } : {}),
    });
  },

  /** POST /api/profile/extract — PDF → Markdown for review (never saved). */
  extractCv(filename: string, dataBase64: string): Promise<{ markdown: string }> {
    return request<{ markdown: string }>('/profile/extract', {
      method: 'POST',
      body: JSON.stringify({ filename, dataBase64 }),
    });
  },

  /** POST /api/profile/distill — build the draft card (~1-3 min on your Claude). */
  distill(): Promise<{ card: PeerCard; thinInputs: string[] }> {
    return request<{ card: PeerCard; thinInputs: string[] }>('/profile/distill', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  /** POST /api/profile/approve — release the card; it becomes the grounding source. */
  approveCard(card: PeerCard): Promise<{ profile: Profile; grounding: ProfileStatus['grounding'] }> {
    return request<{ profile: Profile; grounding: ProfileStatus['grounding'] }>(
      '/profile/approve',
      { method: 'POST', body: JSON.stringify({ card }) },
    );
  },

  // --------------------------------------------- connect-your-Claude wizard

  /** POST /api/claude/connect/start -> the Anthropic authorize link. */
  connectStart(): Promise<{ url: string }> {
    return request<{ url: string }>('/claude/connect/start', { method: 'POST', body: '{}' });
  },

  /** POST /api/claude/connect/code — exchange the one-time code, store + test the token. */
  connectCode(code: string): Promise<{ connected: true; note?: string }> {
    return request<{ connected: true; note?: string }>('/claude/connect/code', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },

  /** POST /api/claude/token — manual fallback: paste a setup-token result. */
  connectToken(token: string): Promise<{ connected: true; note?: string }> {
    return request<{ connected: true; note?: string }>('/claude/token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  /** POST /api/claude/disconnect — remove the stored token. */
  claudeDisconnect(): Promise<{ disconnected: true }> {
    return request<{ disconnected: true }>('/claude/disconnect', { method: 'POST', body: '{}' });
  },
};
