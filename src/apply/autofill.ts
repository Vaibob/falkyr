// src/apply/autofill.ts
//
// The autofill engine. Given a job id and a mode, it launches a VISIBLE chromium
// on the user's machine, navigates to the job URL, and heuristically fills the
// application form from (a) the candidate identity in career-ops' profile.yml
// and (b) the generated form answers stored in the `answers` table.
//
// SAFETY INVARIANT (see clickSubmit below and SAFETY.md): the submit path is
// HARD-GATED. There is exactly one place that can click submit, and it refuses
// unless job.stage === 'approved' AND config.SUBMIT_ALLOWED. Mode 'fill' NEVER
// reaches it — it stops at the submit button and leaves the browser open for
// the user. There is no batch path and no way to submit an un-approved job.

import { existsSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Locator, Page } from 'playwright';
import { SUBMIT_ALLOWED, CAREER_OPS_ROOT, BLOCKED_APPLY_HOSTS } from '../config.js';
import { getJob, getAnswers, addEvent } from '../db/index.js';
import type { Job } from '../types.js';
import { loadCandidateProfile } from './profile.js';
import {
  IDENTITY_FIELDS,
  bestIdentityField,
  bestAnswerForLabel,
  classifyQuestion,
  pickDeclineOption,
  matchOption,
  type GeneratedAnswer,
} from './fields.js';
import { detectAts, atsHints } from './adapters.js';
import { launchHeadedChromium } from './browser.js';

export type ApplyMode = 'fill' | 'submit';

/** Outcome returned to callers (CLI + API). */
export interface ApplyResult {
  jobId: number;
  mode: ApplyMode;
  /** True when a real submit click happened. Always false in 'fill' mode. */
  submitted: boolean;
  /** Number of form controls we filled. */
  filledCount: number;
  /** Whether a CV file was attached. */
  cvAttached: boolean;
  /** Human-readable notes (also mirrored into the events log). */
  notes: string[];
}

/** Fields that should be typed slowly / triggered as text inputs. */
const TEXTUAL_INPUT_TYPES = new Set([
  'text', 'email', 'tel', 'url', 'search', 'number', '',
]);

// ---------------------------------------------------------------------------
// CV resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the tailored CV file path for a job, if one is available.
 *
 * Contract with the `generate` lane: when a tailored CV is produced, its
 * absolute (or career-ops-relative) file path is stored as an answer row with
 * kind='cv' whose `answer` column is the path. We accept that first. As a
 * fallback we scan career-ops' `output/` directory for the most recent PDF, so
 * a manually-generated CV still gets attached.
 *
 * Returns an existing file path, or null if none is found.
 */
export function resolveCvPath(jobId: number): string | null {
  // Only attach a CV FILE that belongs to THIS job. A kind='cv' answer normally
  // holds Markdown CONTENT (the tailored résumé), not a path — so we only treat
  // it as a path when it is a single line pointing at an existing file, and
  // (for relative values) one that stays inside career-ops. We deliberately do
  // NOT fall back to "newest PDF in career-ops/output": that scan is not
  // job-scoped and would upload a DIFFERENT job's CV. Returning null just means
  // "no file to attach" — the tailored CV still lives as Markdown in the DB for
  // the user to review.
  const rootAbs = resolve(CAREER_OPS_ROOT);
  for (const a of getAnswers(jobId)) {
    if (a.kind !== 'cv' || !a.answer) continue;
    const raw = a.answer.trim();
    // Multi-line = Markdown content, not a path. Skip.
    if (!raw || /[\r\n]/.test(raw)) continue;
    const isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(raw);
    const abs = resolve(isAbs ? raw : join(CAREER_OPS_ROOT, raw));
    // Reject relative values that escape the career-ops root (path traversal).
    if (!isAbs && abs !== rootAbs && !abs.startsWith(rootAbs + sep)) continue;
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Label discovery
// ---------------------------------------------------------------------------

/**
 * Best-effort visible label for a control: associated <label>, then aria-label,
 * placeholder, name, and id — concatenated so the fuzzy matcher has the richest
 * text to work with.
 */
async function describeControl(page: Page, control: Locator): Promise<string> {
  const parts: string[] = [];
  try {
    const id = await control.getAttribute('id');
    if (id) {
      const lbl = page.locator(`label[for="${cssEscape(id)}"]`).first();
      if (await lbl.count()) {
        const t = (await lbl.textContent())?.trim();
        if (t) parts.push(t);
      }
    }
    // A wrapping <label> ancestor (label > input pattern).
    const wrap = control.locator('xpath=ancestor::label[1]');
    if (await wrap.count()) {
      const t = (await wrap.first().textContent())?.trim();
      if (t) parts.push(t);
    }
    for (const attr of ['aria-label', 'placeholder', 'name', 'id']) {
      const v = await control.getAttribute(attr);
      if (v) parts.push(v);
    }
  } catch {
    /* detached / cross-origin frame — skip */
  }
  return parts.join(' ').trim();
}

/** Minimal CSS.escape for attribute selectors (ids can contain special chars). */
function cssEscape(s: string): string {
  return s.replace(/["\\\]]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Filling
// ---------------------------------------------------------------------------

async function fillTextual(control: Locator, value: string): Promise<boolean> {
  try {
    if (!(await control.isVisible()) || !(await control.isEditable())) return false;
    const existing = await control.inputValue().catch(() => '');
    if (existing && existing.trim()) return false; // never clobber pre-filled data
    await control.fill(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fill all recognizable fields on the current page. Returns the count filled
 * and per-field notes. Identity fields win; unmatched text areas fall back to
 * fuzzy-matched generated answers.
 */
async function fillForm(
  page: Page,
  profile: ReturnType<typeof loadCandidateProfile>,
  answers: readonly GeneratedAnswer[],
  onProgress?: (note: string) => void,
): Promise<{ filled: number; notes: string[] }> {
  const notes: string[] = [];
  // Record a note locally AND emit it live (so the UI's activity feed updates
  // field-by-field as the form fills, Tsenta-style).
  const record = (n: string) => {
    notes.push(n);
    onProgress?.(n);
  };
  let filled = 0;

  const filledIdentityKeys = new Set<string>();

  // Inputs + textareas that accept free text.
  const controls = page.locator(
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea',
  );
  const count = await controls.count();

  for (let i = 0; i < count; i++) {
    const control = controls.nth(i);
    let type = '';
    try {
      type = (await control.getAttribute('type')) ?? '';
    } catch {
      continue;
    }
    const tag = await control.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
    const isTextArea = tag === 'textarea';
    if (!isTextArea && !TEXTUAL_INPUT_TYPES.has(type)) continue;

    const label = await describeControl(page, control);
    if (!label) continue;

    // 1. Identity fields (name/email/phone/links/location).
    const id = bestIdentityField(label, profile);
    if (id && !filledIdentityKeys.has(id.field.key)) {
      if (await fillTextual(control, id.value)) {
        filled++;
        filledIdentityKeys.add(id.field.key);
        record(`Filled ${id.field.label} ← "${truncate(id.value)}"`);
        continue;
      }
    }

    // 2. Free-text custom questions -> fuzzy-matched generated answers.
    //    Only for textareas (or long text inputs) to avoid stuffing prose into
    //    short single-line fields.
    if (isTextArea && answers.length) {
      const match = bestAnswerForLabel(label, answers);
      if (match && (await fillTextual(control, match.answer.answer))) {
        filled++;
        record(
          `Filled answer for "${truncate(match.answer.question)}" (match ${match.score.toFixed(2)})`,
        );
        continue;
      }
    }
  }

  return { filled, notes };
}

/**
 * Fill the typed controls the text pass doesn't touch: native <select>, radio
 * groups, checkboxes, and (flag-only) combobox widgets.
 *
 * SAFE-BY-DEFAULT policy:
 *   - Demographic / EEO questions → DECLINE (pick "prefer not to say" etc.) or
 *     leave blank. Never guessed.
 *   - Work-authorization / sponsorship → LEAVE BLANK + emit a "⚠ NEEDS YOU"
 *     flag so the user answers before the human submit step (wrong yes/no here
 *     can misrepresent the candidate or trigger an auto-reject).
 *   - Consent / "I agree" checkboxes → checked (the user still reviews before submit).
 *   - Benign dropdowns → filled only from a confident profile match (e.g. country).
 *   - Custom comboboxes (React-Select) → flagged for the user, not guessed.
 */
async function fillTypedControls(
  page: Page,
  profile: ReturnType<typeof loadCandidateProfile>,
  _answers: readonly GeneratedAnswer[],
  onProgress?: (note: string) => void,
): Promise<{ filled: number; notes: string[]; flags: number }> {
  const notes: string[] = [];
  let filled = 0;
  let flags = 0;
  const record = (n: string): void => {
    notes.push(n);
    onProgress?.(n);
  };
  const flag = (n: string): void => {
    const m = `⚠ NEEDS YOU: ${n}`;
    notes.push(m);
    onProgress?.(m);
    flags++;
  };

  // ---- native <select> ----
  const selects = page.locator('select');
  const sc = await selects.count().catch(() => 0);
  for (let i = 0; i < sc; i++) {
    const el = selects.nth(i);
    try {
      if (!(await el.isVisible())) continue;
      const label = await describeControl(page, el);
      const cat = classifyQuestion(label);
      const optionTexts = (await el.locator('option').allTextContents())
        .map((s) => s.trim())
        .filter(Boolean);

      // Skip if a real (non-placeholder) option is already selected.
      const selText = ((await el.locator('option:checked').first().textContent().catch(() => '')) ?? '').trim();
      if (selText && !/^(select|choose|please|-{2,})/i.test(selText)) continue;

      if (cat === 'eeo') {
        const decline = pickDeclineOption(optionTexts);
        if (decline) {
          await el.selectOption({ label: decline });
          filled++;
          record(`Declined demographic question "${truncate(label)}" → "${truncate(decline)}"`);
        } else {
          flag(`demographic question "${truncate(label)}" — no decline option; left blank`);
        }
      } else if (cat === 'work-auth' || cat === 'sponsorship') {
        flag(`${cat} question "${truncate(label)}" — sensitive; set it yourself before submitting`);
      } else {
        // Benign: fill only country/location-type dropdowns from the profile.
        const idf = bestIdentityField(label, profile);
        const desired = idf?.value;
        const match = desired ? matchOption(optionTexts, desired) : null;
        if (match && idf) {
          await el.selectOption({ label: match });
          filled++;
          record(`Selected ${idf.field.label} → "${truncate(match)}"`);
        }
        // else: leave optional benign dropdowns at their default (don't guess).
      }
    } catch {
      /* detached / non-standard select — skip */
    }
  }

  // ---- radio groups (by name) ----
  const radios = page.locator('input[type=radio]');
  const rc = await radios.count().catch(() => 0);
  const seenGroups = new Set<string>();
  for (let i = 0; i < rc; i++) {
    const el = radios.nth(i);
    try {
      if (!(await el.isVisible())) continue;
      const name = (await el.getAttribute('name')) ?? `__r${i}`;
      if (seenGroups.has(name)) continue;
      seenGroups.add(name);

      const legend = el.locator('xpath=ancestor::fieldset[1]/legend');
      const groupLabel = (await legend.count())
        ? ((await legend.first().textContent()) ?? '').trim()
        : await describeControl(page, el);
      const cat = classifyQuestion(groupLabel);
      const group = page.locator(`input[type=radio][name="${cssEscape(name)}"]`);
      const gcount = await group.count();

      if (cat === 'eeo') {
        let declined = false;
        for (let k = 0; k < gcount; k++) {
          const opt = group.nth(k);
          const optLabel = await describeControl(page, opt);
          if (pickDeclineOption([optLabel])) {
            await opt.check().catch(() => {});
            filled++;
            declined = true;
            record(`Declined demographic question "${truncate(groupLabel)}"`);
            break;
          }
        }
        if (!declined) flag(`demographic question "${truncate(groupLabel)}" — no decline option; left blank`);
      } else {
        // work-auth / sponsorship / benign multiple-choice: never guess a yes/no.
        const kind = cat === 'benign' ? 'multiple-choice question' : `${cat} question`;
        flag(`${kind} "${truncate(groupLabel)}" — pick the right option yourself before submitting`);
      }
    } catch {
      /* skip */
    }
  }

  // ---- checkboxes (auto-check consent only) ----
  const checks = page.locator('input[type=checkbox]');
  const cc = await checks.count().catch(() => 0);
  for (let i = 0; i < cc; i++) {
    const el = checks.nth(i);
    try {
      if (!(await el.isVisible()) || (await el.isChecked())) continue;
      const label = await describeControl(page, el);
      if (classifyQuestion(label) === 'consent') {
        await el.check().catch(() => {});
        filled++;
        record(`Checked consent "${truncate(label)}"`);
      }
      // EEO / other checkboxes: never auto-check — leave for the user.
    } catch {
      /* skip */
    }
  }

  // ---- combobox widgets (React-Select etc.): flag, don't guess ----
  const combos = page.locator('[role=combobox], div[class*="select__control"]');
  const cbc = await combos.count().catch(() => 0);
  let comboFlags = 0;
  for (let i = 0; i < cbc && comboFlags < 12; i++) {
    const el = combos.nth(i);
    try {
      if (!(await el.isVisible())) continue;
      const label = await describeControl(page, el);
      if (classifyQuestion(label) === 'eeo') continue; // demographic combobox: leave blank quietly
      flag(`dropdown "${truncate(label || 'custom select')}" — choose it yourself before submitting`);
      comboFlags++;
    } catch {
      /* skip */
    }
  }

  return { filled, notes, flags };
}

/** Attach the CV to the first file input that looks like a resume upload. */
async function attachCv(page: Page, cvPath: string): Promise<boolean> {
  const fileInputs = page.locator('input[type=file]');
  const n = await fileInputs.count();
  if (n === 0) return false;

  // Prefer an input whose surrounding text mentions resume/cv; else first one.
  let target = fileInputs.first();
  for (let i = 0; i < n; i++) {
    const inp = fileInputs.nth(i);
    const label = (await describeControl(page, inp)).toLowerCase();
    if (/resume|cv|curriculum|attachment/.test(label)) {
      target = inp;
      break;
    }
  }
  try {
    await target.setInputFiles(cvPath);
    return true;
  } catch {
    return false;
  }
}

/** Locate the submit control on the page (for pointing at / clicking). */
function submitLocator(page: Page): Locator {
  return page
    .locator(
      [
        'button[type=submit]',
        'input[type=submit]',
        'button:has-text("Submit application")',
        'button:has-text("Submit Application")',
        'button:has-text("Submit")',
        'button:has-text("Apply")',
        'button:has-text("Send application")',
      ].join(', '),
    )
    .first();
}

// ---------------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------------

/*
 * ─────────────────────────────────────────────────────────────────────────
 * TERMS-OF-SERVICE / ETHICAL REASONING FOR THE SUBMIT PATH — READ BEFORE EDIT
 * ─────────────────────────────────────────────────────────────────────────
 * Clicking "Submit" sends a real job application to a real company on the
 * user's behalf. That is a consequential, non-reversible action a human should
 * own. Most ATS platforms (Greenhouse, Lever, Ashby, Workday, etc.) also
 * prohibit automated/bot submissions in their Terms of Service, and mass or
 * unattended auto-submission both violates those terms and wastes recruiters'
 * attention — the exact opposite of career-ops' "quality over quantity" ethic.
 *
 * Therefore submission is HARD-GATED behind TWO independent conditions that a
 * human must have deliberately set:
 *   1. job.stage === 'approved'  — the user explicitly approved THIS job after
 *      reviewing its tailored materials (recorded via the approval workflow).
 *   2. config.SUBMIT_ALLOWED     — env JOBPILOT_ALLOW_SUBMIT === 'true', a
 *      machine-level opt-in the user must set themselves.
 *
 * Both must be true. If either is missing we refuse, record the refusal, and
 * leave the browser open on the review step so the user can submit by hand.
 * There is intentionally NO override flag, NO "force" argument, and NO
 * batch/submit-all code path anywhere in this module. Default behavior (mode
 * 'fill') never calls this function at all.
 * ─────────────────────────────────────────────────────────────────────────
 */
async function clickSubmit(page: Page, job: Job): Promise<{ submitted: boolean; note: string }> {
  // Re-check the gate at the moment of action (defense in depth — do NOT trust
  // an earlier check; stage could have been read stale).
  const fresh = getJob(job.id) ?? job;
  const approved = fresh.stage === 'approved';

  if (!approved || !SUBMIT_ALLOWED) {
    const reasons: string[] = [];
    if (!approved) reasons.push(`job.stage is '${fresh.stage}' (needs 'approved')`);
    if (!SUBMIT_ALLOWED) reasons.push(`JOBPILOT_ALLOW_SUBMIT is not 'true'`);
    const note = `Submit REFUSED by safety gate: ${reasons.join(' and ')}.`;
    return { submitted: false, note };
  }

  const submit = submitLocator(page);
  if (!(await submit.count())) {
    return { submitted: false, note: 'Submit approved by gate but no submit button was found.' };
  }
  await submit.scrollIntoViewIfNeeded().catch(() => {});
  await submit.click();
  return { submitted: true, note: 'Submit clicked (gate satisfied: approved + JOBPILOT_ALLOW_SUBMIT).' };
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Apply to a job.
 *
 * @param id    job id in the jobs table
 * @param mode  'fill'  -> fill everything, STOP at submit, leave browser open.
 *              'submit' -> fill, then attempt the HARD-GATED submit.
 *
 * Records events regardless of mode. Never throws for an un-approved submit —
 * it records the refusal and behaves like 'fill'.
 */
export async function applyToJob(id: number, mode: ApplyMode = 'fill'): Promise<ApplyResult> {
  const job = getJob(id);
  if (!job) throw new Error(`Job ${id} not found.`);
  if (!job.url) throw new Error(`Job ${id} has no url to navigate to.`);

  const result: ApplyResult = {
    jobId: id,
    mode,
    submitted: false,
    filledCount: 0,
    cvAttached: false,
    notes: [],
  };

  // HARD HOST BLOCK (before anything else): JobPilot never opens, fills, or
  // submits on LinkedIn/Indeed — ToS §8.2 bans automation there and the user
  // instructed us never to apply via LinkedIn. This is a code-level refusal
  // with no override, not a preference. No browser is launched.
  const applyHost = (() => {
    try {
      // Normalize: lowercase AND strip a trailing dot — "linkedin.com." is a
      // valid FQDN that resolves to the same servers but would slip past the
      // block (=== fails on the extra dot, endsWith('.linkedin.com') fails too).
      return new URL(job.url).hostname.toLowerCase().replace(/\.+$/, '');
    } catch {
      return '';
    }
  })();
  if (BLOCKED_APPLY_HOSTS.some((h) => applyHost === h || applyHost.endsWith('.' + h))) {
    const note = `Apply BLOCKED: '${applyHost}' is on the no-apply list (LinkedIn/Indeed). JobPilot never auto-applies there — open it by hand if you choose. No browser opened.`;
    result.notes.push(note);
    addEvent(id, 'apply.blocked_host', note);
    return result;
  }

  // EARLY GATE (fail fast, before opening a browser): if the user asked to
  // submit but the gate can't be satisfied, we do NOT silently proceed to a
  // real submit later — we degrade to a fill-and-stop and record why.
  let effectiveMode: ApplyMode = mode;
  if (mode === 'submit' && !(job.stage === 'approved' && SUBMIT_ALLOWED)) {
    const why: string[] = [];
    if (job.stage !== 'approved') why.push(`stage='${job.stage}' (needs 'approved')`);
    if (!SUBMIT_ALLOWED) why.push(`JOBPILOT_ALLOW_SUBMIT!=='true'`);
    const note = `Requested mode 'submit' but safety gate not satisfied (${why.join('; ')}). Falling back to 'fill' — filling form and STOPPING at submit.`;
    result.notes.push(note);
    addEvent(id, 'apply.submit_refused', note);
    effectiveMode = 'fill';
  }

  const profile = loadCandidateProfile();
  const formAnswers: GeneratedAnswer[] = getAnswers(id)
    .filter((a) => a.kind === 'form' && a.question && a.answer)
    .map((a) => ({ question: a.question as string, answer: a.answer as string }));
  const cvPath = resolveCvPath(id);

  addEvent(
    id,
    'apply.start',
    `mode=${effectiveMode} url=${job.url} answers=${formAnswers.length} cv=${cvPath ? 'yes' : 'no'}`,
  );

  const { browser, page } = await launchHeadedChromium();
  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const ats = detectAts(job.url);
    addEvent(id, 'apply.nav', `opened ${job.url} (ATS: ${ats})`);
    if (atsHints(ats).multiStep) {
      addEvent(id, 'apply.ats', `${ats} is a multi-step form — this pass fills the current step only`);
    }
    // Give SPA-based ATS forms a moment to render their fields.
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const emit = (n: string): void => {
      addEvent(id, 'apply.field', n);
    };
    const { filled, notes } = await fillForm(page, profile, formAnswers, emit);
    const typed = await fillTypedControls(page, profile, formAnswers, emit);
    result.filledCount = filled + typed.filled;
    result.notes.push(...notes, ...typed.notes);
    if (typed.flags > 0) {
      addEvent(id, 'apply.review', `${typed.flags} question(s) need your input before submit — see the ⚠ NEEDS YOU notes`);
    }

    if (cvPath) {
      result.cvAttached = await attachCv(page, cvPath);
      result.notes.push(result.cvAttached ? `Attached CV: ${cvPath}` : `CV present but no file input found: ${cvPath}`);
    } else {
      result.notes.push('No tailored CV path available to attach.');
    }

    addEvent(
      id,
      'apply.filled',
      `filled=${result.filledCount} text=${filled} typed=${typed.filled} cvAttached=${result.cvAttached}`,
    );

    if (effectiveMode === 'submit') {
      const { submitted, note } = await clickSubmit(page, job);
      result.submitted = submitted;
      result.notes.push(note);
      addEvent(id, submitted ? 'apply.submitted' : 'apply.submit_refused', note);
      if (submitted) {
        // Leave a short beat so the confirmation page can register visually.
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        addEvent(id, 'apply.done', 'submitted; browser will close');
        await browser.close();
        return result;
      }
    }

    // FILL MODE (or refused submit): STOP at the submit button, leave the
    // browser OPEN so the user can review and submit by hand. We intentionally
    // do NOT close the browser here.
    const submit = submitLocator(page);
    if (await submit.count()) {
      await submit.scrollIntoViewIfNeeded().catch(() => {});
    }
    const stopNote =
      'Form filled. STOPPED at submit button — browser left open for your review. Submit manually when ready.';
    result.notes.push(stopNote);
    addEvent(id, 'apply.stopped', stopNote);
    // NOTE: browser deliberately left open; not calling browser.close().
    return result;
  } catch (err) {
    addEvent(id, 'apply.error', (err as Error).message);
    result.notes.push(`Error: ${(err as Error).message}`);
    // Close the browser on genuine errors so we never leak a headed chromium.
    // (The intentional "leave open for review" behavior is only the successful
    // fill-and-stop path above, which returns before it can reach this catch.)
    await browser.close().catch(() => {});
    throw err;
  }
}

function truncate(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Re-export for callers that want to introspect the catalogue.
export { IDENTITY_FIELDS };
