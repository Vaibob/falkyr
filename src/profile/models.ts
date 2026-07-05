// Model-tier policy for the Glove's AI intake steps, all running on the
// user's own Claude CLI: cheap/mechanical work goes to a small model, the one
// judgment call (distill) to a mid model. Tailor/rewrite (src/generate/) keep
// the CLI's default model — unchanged by design.
//
// SECURITY: these values end up on `claude` argv (runClaude whitelists the
// shape). Env overrides exist for power users (FALKYR_MODEL_*), but are
// re-validated by runClaude's MODEL_RE either way — never request-derived.

function tier(envKey: string, fallback: string): string {
  const v = process.env[envKey]?.trim();
  return v && /^[a-z0-9.:-]+$/i.test(v) ? v : fallback;
}

export const TASK_MODELS = {
  /** PDF → Markdown transcription (mechanical). */
  get extract(): string {
    return tier('FALKYR_MODEL_EXTRACT', 'haiku');
  },
  /** Peer-card distillation (the one judgment call). */
  get distill(): string {
    return tier('FALKYR_MODEL_DISTILL', 'sonnet');
  },
} as const;
