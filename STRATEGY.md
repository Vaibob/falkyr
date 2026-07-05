# The Non-Rejection Strategy

JobPilot's playbook for beating algorithmic hiring filters — grounded in
**"Algorithmic Monocultures in Hiring"** (Bommasani, Bana, Creel, Jurafsky, Liang;
Stanford et al., *FAccT 2026*; [arXiv:2605.27371](https://arxiv.org/abs/2605.27371)).

> The strategy engine is **advisory only.** It never auto-submits, never edits an
> application, and never touches the safety invariants (the `approved +
> JOBPILOT_ALLOW_SUBMIT` submit gate, or the LinkedIn/Indeed hard block in
> `config.BLOCKED_APPLY_HOSTS`). It scores risk and hands the human a plan.

---

## The problem: algorithmic monoculture

Bommasani et al. document that **~90% of US employers now screen candidates with
algorithms**, and a small handful of shared vendors dominate the market — a single
provider (HireVue) touches roughly **60% of the Fortune 100**, and vendors like
pymetrics are layered on top. This shared dependence is what the paper calls
**algorithmic monoculture**: a large fraction of employers outsource the same
screening decision to the same few models.

The consequence is statistical, not anecdotal. When many employers run the same
model, **identical inputs produce correlated outcomes.** Applying to *N* roles that
are all screened by the same vendor is far closer to *one decision repeated N
times* than to *N independent chances*. The paper measures the effect directly:
systemic rejection far exceeds what chance would predict (**χ² = 18,481, p <
0.001**). And the arithmetic of dependence is brutal — to reach a **99.9% chance of
at least one recommendation** you need about **25 applications under monoculture**,
versus only **~10** if the screens were independent.

So the counter-strategy is not "apply to more jobs." It is **restore independence**:
make each application a genuinely different draw, and route applications around the
shared filter entirely.

---

## The five tactics

| # | Tactic | The paper's finding | JobPilot module |
|---|--------|---------------------|-----------------|
| 1 | **De-correlate applications** | N apps through one vendor ≈ one repeated bet. Vary lead projects, framing, and keywords so you become independent draws. | `src/strategy/decorrelate.ts` |
| 2 | **Route around the filter** | The monoculture only has power over apps that flow *through* it. Referrals, direct-to-hiring-manager, and smaller companies bypass the mega-vendors. | `src/strategy/monoculture.ts` |
| 3 | **Sound human** | 33% of managers run AI-detectors; "too perfect," generic, zero-variation copy reads as machine. Keep the candidate's real voice and lived detail. | `src/strategy/voice.ts` |
| 4 | **Lead with impact** | Every bullet should move a number — money made/saved — not recite duties. | `src/generate/resume.ts` (rewriter) |
| 5 | **Proof that can't be faked** | GitHub, shipped projects, demos, blog posts — evidence a screen can't fabricate. | `src/generate/resume.ts` (rewriter) |

Tactics 1–3 are the **strategy engine** (`src/strategy/`): they read the pipeline
and score risk. Tactics 4–5 are the **résumé rewriter** (`src/generate/resume.ts`):
they act on a single job, grounded in the career-ops source-of-truth files.

---

### 1. De-correlate applications — `decorrelate.ts`

**The finding.** Under monoculture, submitting near-identical materials to many
roles is one bet placed N times. To get N *independent* draws, each application has
to look meaningfully different to the model: a different lead project, a different
framing, a different keyword emphasis.

**How JobPilot implements it.**
`decorrelation(jobId: number): DecorrelationInfo` compares a job's already-generated
materials (and the JD it targets) against the materials for every other job in the
pipeline. It returns:

- `score` — how independent this application is from the rest (higher = more
  de-correlated, the goal);
- `similarTo` — the specific jobs it most resembles (`{ jobId, company, similarity }`),
  so the human can see *which* applications have collapsed into the same bet;
- `advice` — a concrete instruction ("lead with the DPO framework here instead of
  the Land Registry RL project, which already anchors 3 other applications").

The output is surfaced in the `StrategyReport.decorrelation` field. It is advice,
not an action — the human decides whether to re-run the rewriter with a different
lead project.

---

### 2. Route around the filter — `monoculture.ts`

**The finding.** The monoculture only has power over applications that pass through
it. Referrals and warm intros, going straight to a hiring manager, and targeting
smaller companies and startups that aren't on the mega-vendors all *remove the
filter from the path.*

**How JobPilot implements it.**
`classifyMonoculture(job: Job): MonocultureRisk` inspects the job's `ats_provider`
and company signals and assigns a `RiskTier` (`low` | `medium` | `high`) with the
`vendor` it detected and a human-readable `reason`. A role screened by a dominant
shared vendor is high risk; a small company with no detectable mega-vendor is low.

`routingFor(job: Job, risk: MonocultureRisk): RoutingSuggestion[]` turns that risk
into channel advice. Each `RoutingSuggestion` names a `channel`
(`'portal' | 'referral' | 'hiring-manager' | 'smaller-company'`), a `rationale`
tied to the risk, and a concrete `action`. The higher the monoculture risk, the
harder JobPilot pushes the human toward channels that bypass the shared screen —
find a referral, email the hiring manager directly, prioritize the startups on the
list.

This is where the safety invariants matter most: LinkedIn and Indeed are in
`config.BLOCKED_APPLY_HOSTS` and are never auto-applied to; routing advice respects
that block. The engine suggests a human channel — it does not open a submission path.

---

### 3. Sound human — `voice.ts`

**The finding.** A third of hiring managers run AI-detectors, and beyond the
detectors, screens and humans alike read "too perfect" as a tell: generic phrasing,
no specific lived detail, and unnaturally uniform sentence length all signal
machine-generated copy.

**How JobPilot implements it.**
`scoreVoice(text: string): VoiceRisk` scores a piece of generated text (a cover
letter, a form answer, a rewritten CV) for machine tells and returns:

- `tier` — overall `RiskTier`;
- `score` — a numeric "reads-as-machine" measure;
- `flags` — the specific tells it found (uniform sentence length, generic
  buzzwords, no concrete numbers or lived detail, etc.);
- `suggestions` — how to break each tell (add a specific project detail, vary
  sentence length, cut the boilerplate opener).

The result lands in `StrategyReport.voice`. The human uses it to decide whether the
draft is safe to send or needs another pass. Nothing is rewritten automatically.

---

### 4. Lead with impact — the résumé rewriter

**The finding.** Every bullet should show money made or saved, or a number moved —
not a job duty. Impact is what survives a screen *and* a skim.

**How JobPilot implements it.**
`rewriteResumeForJob(jobId: number)` tailors the candidate's résumé to a specific
job. It follows the exact generation pattern already in `src/generate/`: it loads
the career-ops source-of-truth files via `loadCareerOpsSources()`, builds a grounded
prompt, and **shells out to the Claude Code CLI (`claude -p`, reusing the local
auth — no API key)**. On any failure it falls back to a deterministic template and
marks the output for review — the same `backend: 'claude' | 'fallback'` contract as
the rest of the generator.

The prompt instructs the rewriter to recast every bullet around a moved number,
drawing on the candidate's quantified proof points — the West Bengal Land Registry
GRPO zero-label RL work (**~30% CER reduction per round**) and the DPO framework
(**+40% / −50%**). The result is persisted as a `cv` answer via `addAnswer`, and the
function returns `{ backend, answerId, note }`.

---

### 5. Proof that can't be faked — the résumé rewriter

**The finding.** A screen can fabricate polish but not a shipped artifact. GitHub
repos, demos, and blog posts are evidence the filter can't invent.

**How JobPilot implements it.**
The same `rewriteResumeForJob` prompt is instructed to surface hard proof: the
candidate's GitHub ([github.com/Vaibob](https://github.com/Vaibob)) and shipped
projects — Land Registry RL, FiscalAI RAG, the DPO framework — as verifiable links
and artifacts rather than claims.

Critically, the rewriter stays **grounded in the career-ops files and never
fabricates.** It respects the candidate's honest gaps and never inflates them:
**no PhD or top-tier papers, no frontier multi-node distributed RL, no robotics.**
Proof that can't be faked only works if it's true — so the rewriter leads with the
real, provable work and leaves the gaps honest.

---

## How it fits together

`buildStrategyReport(jobId: number): StrategyReport` (in `src/strategy/index.ts`) is
the single entry point. It runs monoculture classification and routing (tactic 2),
de-correlation analysis (tactic 1), and voice scoring on the job's generated
materials (tactic 3), then composes a plain-language `summary`. The résumé rewriter
(tactics 4–5) is invoked separately via the `rewrite` npm script
(`tsx src/generate/resume-cli.ts`).

Everything the engine produces is **advice for a human.** The strategy engine
reads and scores; it never submits, never edits, and never weakens the submit gate
or the LinkedIn/Indeed block. The point of the whole system, per Bommasani et al.,
is to turn a string of correlated rejections back into independent, human-routed
chances — and to keep every one of them honest.
