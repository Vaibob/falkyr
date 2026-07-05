// The Glove — Falkyr's peer-card intake. Four stages on one page:
//   1 Gather      — résumé (paste/PDF), sources, essays
//   2 What Falkyr read — deterministic fetch results, shown verbatim
//   3 Distill     — one model call builds the draft card
//   4 Review & release — human edits everything; release makes it ground
//
// TRUST RULES surfaced in this UI: extracted PDF text lands in the editor
// (not the DB) until saved; fetched text is shown byte-identical to what
// distill reads; nothing grounds until the human releases the card; the
// release gate requires every honest-gap question answered.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError } from '../api.js';
import type { PeerCard, Profile, ProfileStatus } from '../types.js';
import { FalkyrLogo } from './brand/FalkyrMark.js';

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400';

const INPUT_CLS =
  'w-full rounded-[10px] border border-ink-700 bg-ink-900 px-3 py-2 text-[15px] text-[#EDEFF4] placeholder:text-[#6B7488] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400';

const LABEL_CLS = 'block text-[13px] font-medium text-[#A7AFC2]';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

function SaveChip({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const map: Record<Exclude<SaveState, 'idle'>, [string, string]> = {
    dirty: ['unsaved', 'text-[#E8A33D]'],
    saving: ['saving…', 'text-[#A7AFC2]'],
    saved: ['saved', 'text-emerald-300'],
    error: ['save failed', 'text-red-300'],
  };
  const [label, cls] = map[state];
  return <span className={`text-xs ${cls}`}>{label}</span>;
}

function Section({
  n,
  title,
  children,
  chip,
}: {
  n: string;
  title: string;
  children: ReactNode;
  chip?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-ink-800 bg-ink-900/60 p-5 md:p-7">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xs font-medium tabular-nums text-gold-400">{n}</span>
        <h2 className="font-display text-xl font-semibold text-[#EDEFF4]">{title}</h2>
        <span className="ml-auto">{chip}</span>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** Editable list of short strings (chips + add box). */
function ChipListEditor({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
    setDraft('');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-850 px-2.5 py-1 text-xs text-[#A7AFC2]"
          >
            {v}
            <button
              type="button"
              aria-label={`remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className={`text-[#6B7488] hover:text-red-300 ${FOCUS_RING} rounded`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className={`${INPUT_CLS} max-w-xs !py-1.5 text-sm`}
        />
        <button
          type="button"
          onClick={add}
          className={`rounded-[10px] px-3 py-1.5 text-sm text-[#A7AFC2] ring-1 ring-ink-700 hover:bg-ink-850 hover:text-[#EDEFF4] ${FOCUS_RING}`}
        >
          Add
        </button>
      </div>
    </div>
  );
}

const PROVENANCE_LABEL: Record<string, string> = {
  resume: 'résumé',
  github: 'GitHub',
  portfolio: 'portfolio',
  essay: 'essay',
  'linkedin-paste': 'LinkedIn paste',
  user: 'you',
};

function ProvenanceChips({ provenance }: { provenance: { source: string; excerpt?: string }[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {provenance.map((p, i) => (
        <span
          key={i}
          title={p.excerpt ? `“${p.excerpt}”` : undefined}
          className="rounded-full bg-gold-400/10 px-2 py-0.5 text-[11px] font-medium text-gold-400 ring-1 ring-gold-400/25"
        >
          {PROVENANCE_LABEL[p.source] ?? p.source}
        </span>
      ))}
    </span>
  );
}

export default function GlovePage() {
  const [status, setStatus] = useState<ProfileStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stage-1 form fields (mirrors of the profile row).
  const [cvMd, setCvMd] = useState('');
  const [essayWork, setEssayWork] = useState('');
  const [essayTarget, setEssayTarget] = useState('');
  const [essayEdge, setEssayEdge] = useState('');
  const [github, setGithub] = useState('');
  const [portfolio, setPortfolio] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [linkedinPaste, setLinkedinPaste] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [extracting, setExtracting] = useState(false);
  const [extractNote, setExtractNote] = useState<string | null>(null);

  // Stage 2/3/4 state.
  const [fetching, setFetching] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [distillNote, setDistillNote] = useState<string | null>(null);
  const [card, setCard] = useState<PeerCard | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [released, setReleased] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const profile = status?.profile ?? null;

  const applyProfile = useCallback((p: Profile | null, s?: ProfileStatus) => {
    if (s) setStatus(s);
    else if (p) setStatus((prev) => (prev ? { ...prev, profile: p } : prev));
    if (!p) return;
    setCvMd(p.cv_md ?? '');
    setEssayWork(p.essay_work ?? '');
    setEssayTarget(p.essay_target ?? '');
    setEssayEdge(p.essay_edge ?? '');
    setGithub(p.github_username ?? '');
    setPortfolio(p.portfolio_url ?? '');
    setLinkedinUrl(p.linkedin_url ?? '');
    setLinkedinPaste(p.linkedin_paste ?? '');
    // Prefer the draft for the review editor; fall back to the released card.
    const raw = p.peer_card_draft ?? p.peer_card;
    if (raw) {
      try {
        setCard(JSON.parse(raw) as PeerCard);
      } catch {
        /* invalid stored draft — leave editor empty */
      }
    }
    setReleased(Boolean(p.peer_card_approved_at));
  }, []);

  useEffect(() => {
    api
      .getProfile()
      .then((s) => applyProfile(s.profile, s))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load profile'));
  }, [applyProfile]);

  const save = useCallback(async () => {
    setSaveState('saving');
    try {
      const p = await api.saveProfile({
        cv_md: cvMd || null,
        essay_work: essayWork || null,
        essay_target: essayTarget || null,
        essay_edge: essayEdge || null,
        github_username: github || null,
        portfolio_url: portfolio || null,
        linkedin_url: linkedinUrl || null,
        linkedin_paste: linkedinPaste || null,
      });
      setStatus((prev) => (prev ? { ...prev, profile: p } : prev));
      setSaveState('saved');
    } catch (e) {
      setSaveState('error');
      setError(e instanceof Error ? e.message : 'save failed');
    }
  }, [cvMd, essayWork, essayTarget, essayEdge, github, portfolio, linkedinUrl, linkedinPaste]);

  const markDirty = () => setSaveState('dirty');

  const onPdfPick = useCallback(async (file: File) => {
    setExtracting(true);
    setExtractNote(null);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const { markdown } = await api.extractCv(file.name, btoa(bin));
      setCvMd(markdown);
      setSaveState('dirty');
      setExtractNote(
        'Extracted from your PDF by your own Claude — read it over, fix anything off, then save. Nothing is stored until you do.',
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'extraction failed');
    } finally {
      setExtracting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, []);

  const runFetch = useCallback(async (source?: 'github' | 'portfolio') => {
    setFetching(true);
    setError(null);
    try {
      const p = await api.fetchSources(source);
      applyProfile(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setFetching(false);
    }
  }, [applyProfile]);

  const runDistill = useCallback(async () => {
    setDistilling(true);
    setDistillNote(null);
    setError(null);
    try {
      const { card: fresh, thinInputs } = await api.distill();
      setCard(fresh);
      if (thinInputs.length > 0) setDistillNote(`Thin inputs: ${thinInputs.join(' · ')}.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'distill failed');
    } finally {
      setDistilling(false);
    }
  }, []);

  const release = useCallback(async () => {
    if (!card) return;
    setReleasing(true);
    setError(null);
    try {
      // Persist the edited draft first so what's released is also what's stored.
      await api.saveProfile({ peerCardDraft: card });
      const { profile: p, grounding } = await api.approveCard(card);
      setStatus((prev) => (prev ? { ...prev, profile: p, grounding } : prev));
      setReleased(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'release failed');
    } finally {
      setReleasing(false);
    }
  }, [card]);

  const patchCard = (fn: (c: PeerCard) => PeerCard) => {
    setCard((c) => (c ? fn(c) : c));
    setReleased(false); // draft now differs from the released card
  };

  const unsureCount = card?.honestGaps.filter((g) => g.status === 'unsure').length ?? 0;
  const staleInputs =
    profile?.draft_inputs_hash &&
    profile?.approved_inputs_hash &&
    profile.draft_inputs_hash !== profile.approved_inputs_hash;

  return (
    <div className="min-h-screen bg-ink-950 text-[#EDEFF4] antialiased">
      <header className="border-b border-ink-800 bg-ink-950">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-4 px-5">
          <a href="/" aria-label="falkyr — home" className="text-[#EDEFF4]">
            <FalkyrLogo size={24} />
          </a>
          <span className="text-[13px] text-[#6B7488]">the Glove</span>
          <a
            href="/app"
            className={`ml-auto rounded-md px-3 py-1.5 text-sm font-medium text-[#A7AFC2] ring-1 ring-ink-700 transition hover:bg-ink-850 hover:text-[#EDEFF4] ${FOCUS_RING}`}
          >
            ← the Perch
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-5 py-10">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-[-0.025em]">
            One honest reading of who you are.
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[#A7AFC2]">
            Bring your real material. Falkyr reads it, shows you exactly what it read, and distills
            a peer card — you edit every word, then release it. Only what you release is ever used
            to write in your name.
          </p>
          {status?.grounding.active === 'glove' && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">
              Your released card grounds every application.
            </p>
          )}
        </div>

        {error && (
          <div role="alert" className="rounded-[10px] bg-red-400/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-400/25">
            {error}
          </div>
        )}

        {/* ------------------------------------------------ 1 · Gather */}
        <Section n="01" title="Gather" chip={<SaveChip state={saveState} />}>
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="cv" className={LABEL_CLS}>
                  Résumé (Markdown) — the primary source everything is cut from
                </label>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf"
                    className="sr-only"
                    id="pdf-pick"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onPdfPick(f);
                    }}
                  />
                  <button
                    type="button"
                    disabled={extracting || !status?.claudeAvailable}
                    onClick={() => fileRef.current?.click()}
                    title={
                      status?.claudeAvailable
                        ? 'Extract text from a PDF with your own Claude'
                        : 'PDF extraction needs the Claude CLI on this machine — paste your résumé instead'
                    }
                    className={`rounded-[10px] px-3 py-1.5 text-sm text-[#A7AFC2] ring-1 ring-ink-700 transition hover:bg-ink-850 hover:text-[#EDEFF4] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                  >
                    {extracting ? 'Extracting…' : 'Upload PDF'}
                  </button>
                </div>
              </div>
              {extractNote && (
                <p className="mt-2 rounded-[10px] bg-gold-400/10 px-3 py-2 text-[13px] text-gold-400 ring-1 ring-gold-400/25">
                  {extractNote}
                </p>
              )}
              <textarea
                id="cv"
                rows={12}
                value={cvMd}
                onChange={(e) => {
                  setCvMd(e.target.value);
                  markDirty();
                }}
                placeholder={'# Your Name\n\n## Experience\n- …'}
                className={`${INPUT_CLS} mt-2 font-mono text-[13px]`}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="gh" className={LABEL_CLS}>GitHub username</label>
                <input
                  id="gh"
                  value={github}
                  onChange={(e) => { setGithub(e.target.value); markDirty(); }}
                  placeholder="octocat"
                  className={`${INPUT_CLS} mt-1.5`}
                />
              </div>
              <div>
                <label htmlFor="pf" className={LABEL_CLS}>Portfolio URL</label>
                <input
                  id="pf"
                  value={portfolio}
                  onChange={(e) => { setPortfolio(e.target.value); markDirty(); }}
                  placeholder="https://yoursite.dev"
                  className={`${INPUT_CLS} mt-1.5`}
                />
              </div>
            </div>

            <div>
              <label htmlFor="li" className={LABEL_CLS}>LinkedIn URL</label>
              <input
                id="li"
                value={linkedinUrl}
                onChange={(e) => { setLinkedinUrl(e.target.value); markDirty(); }}
                placeholder="https://linkedin.com/in/you"
                className={`${INPUT_CLS} mt-1.5 max-w-md`}
              />
              <p className="mt-1.5 text-[13px] text-[#6B7488]">
                Stored for filling application forms only — we never scrape LinkedIn. Paste anything
                from it you want Falkyr to read:
              </p>
              <textarea
                aria-label="LinkedIn paste"
                rows={3}
                value={linkedinPaste}
                onChange={(e) => { setLinkedinPaste(e.target.value); markDirty(); }}
                placeholder="(optional) paste your About / experience text here"
                className={`${INPUT_CLS} mt-2 text-sm`}
              />
            </div>

            <div className="space-y-4">
              {(
                [
                  ['ew', 'How your work actually looks, day to day', essayWork, setEssayWork],
                  ['et', 'Where you want to land, and why', essayTarget, setEssayTarget],
                  ['ee', 'The one thing you are better at than everyone else', essayEdge, setEssayEdge],
                ] as const
              ).map(([id, label, value, set]) => (
                <div key={id}>
                  <label htmlFor={id} className={LABEL_CLS}>{label}</label>
                  <textarea
                    id={id}
                    rows={3}
                    value={value}
                    onChange={(e) => { set(e.target.value); markDirty(); }}
                    className={`${INPUT_CLS} mt-1.5 text-sm`}
                  />
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void save()}
              disabled={saveState === 'saving'}
              className={`rounded-[10px] bg-gold-400 px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-gold-300 disabled:opacity-60 ${FOCUS_RING}`}
            >
              {saveState === 'saving' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Section>

        {/* --------------------------------------- 2 · What Falkyr read */}
        <Section
          n="02"
          title="What Falkyr read"
          chip={
            <button
              type="button"
              onClick={() => void runFetch()}
              disabled={fetching || (!profile?.github_username && !profile?.portfolio_url)}
              className={`rounded-[10px] px-3 py-1.5 text-sm text-[#A7AFC2] ring-1 ring-ink-700 transition hover:bg-ink-850 hover:text-[#EDEFF4] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
            >
              {fetching ? 'Fetching…' : 'Fetch'}
            </button>
          }
        >
          <p className="text-[13px] text-[#6B7488]">
            No summaries, no hidden inputs — the text below is byte-for-byte what the distill step
            reads. Save your sources above, then fetch.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {(
              [
                ['GitHub', profile?.github_md, profile?.github_fetched_at, profile?.github_error, 'github'],
                ['Portfolio', profile?.portfolio_text, profile?.portfolio_fetched_at, profile?.portfolio_error, 'portfolio'],
              ] as const
            ).map(([label, text, at, err, key]) => (
              <div key={label} className="rounded-[10px] border border-ink-800 bg-ink-950 p-3">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="font-medium text-[#A7AFC2]">{label}</span>
                  {err ? (
                    <span className="text-red-300">failed: {err}</span>
                  ) : at ? (
                    <span className="text-emerald-300">fetched {new Date(at).toLocaleTimeString()}</span>
                  ) : (
                    <span className="text-[#6B7488]">never fetched</span>
                  )}
                  <button
                    type="button"
                    onClick={() => void runFetch(key)}
                    disabled={fetching}
                    className={`ml-auto rounded px-2 py-0.5 text-xs text-[#6B7488] hover:text-[#A7AFC2] ${FOCUS_RING}`}
                  >
                    refetch
                  </button>
                </div>
                {text && (
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-[#A7AFC2]">
                    {text}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </Section>

        {/* -------------------------------------------------- 3 · Distill */}
        <Section n="03" title="Distill">
          <p className="max-w-2xl text-[15px] leading-relaxed text-[#A7AFC2]">
            One call on your own Claude reads everything above and drafts your peer card — a minute
            or two. Nothing it writes is used until you review and release it below.
          </p>
          {distillNote && <p className="mt-2 text-[13px] text-gold-400">{distillNote}</p>}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void runDistill()}
              disabled={distilling || !profile?.cv_md?.trim() || !status?.claudeAvailable}
              title={
                !status?.claudeAvailable
                  ? 'Distilling needs the Claude CLI on this machine (run Falkyr on the host)'
                  : !profile?.cv_md?.trim()
                    ? 'Save your résumé first'
                    : undefined
              }
              className={`rounded-[10px] bg-gold-400 px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
            >
              {distilling ? 'Reading everything you brought…' : card ? 'Re-distill (overwrites draft edits)' : 'Distill the peer card'}
            </button>
            {profile?.draft_distilled_at && (
              <span className="text-[13px] text-[#6B7488]">
                draft from {new Date(profile.draft_distilled_at).toLocaleString()}
              </span>
            )}
          </div>
          {!status?.claudeAvailable && (
            <p className="mt-3 text-[13px] text-[#6B7488]">
              This machine has no Claude CLI (containers don't). Run <code className="rounded bg-ink-850 px-1">npm run dev</code> on
              the host for the AI steps — everything else here still works.
            </p>
          )}
        </Section>

        {/* ---------------------------------------- 4 · Review & release */}
        <Section
          n="04"
          title="Review & release"
          chip={
            released ? (
              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-0.5 text-xs text-emerald-300">
                released
              </span>
            ) : card ? (
              <span className="rounded-full border border-gold-400/25 bg-gold-400/10 px-2.5 py-0.5 text-xs text-gold-400">
                draft differs from released
              </span>
            ) : null
          }
        >
          {!card ? (
            <p className="text-[15px] text-[#6B7488]">The glove is empty — distill a draft above.</p>
          ) : (
            <div className="space-y-7">
              {staleInputs && (
                <p className="rounded-[10px] bg-gold-400/10 px-3 py-2 text-[13px] text-gold-400 ring-1 ring-gold-400/25">
                  Your inputs changed after this draft was distilled — consider re-distilling.
                </p>
              )}

              <div>
                <h3 className="text-sm font-semibold text-[#EDEFF4]">Identity</h3>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  {(
                    [
                      ['Full name', card.identity.fullName, (v: string) => patchCard((c) => ({ ...c, identity: { ...c.identity, fullName: v } }))],
                      ['Headline', card.identity.headline ?? '', (v: string) => patchCard((c) => ({ ...c, identity: { ...c.identity, headline: v || undefined } }))],
                      ['Email', card.identity.email ?? '', (v: string) => patchCard((c) => ({ ...c, identity: { ...c.identity, email: v || undefined } }))],
                      ['Phone', card.identity.phone ?? '', (v: string) => patchCard((c) => ({ ...c, identity: { ...c.identity, phone: v || undefined } }))],
                      ['Location', card.identity.location ?? '', (v: string) => patchCard((c) => ({ ...c, identity: { ...c.identity, location: v || undefined } }))],
                      ['City', card.identity.city ?? '', (v: string) => patchCard((c) => ({ ...c, identity: { ...c.identity, city: v || undefined } }))],
                      ['Country', card.identity.country ?? '', (v: string) => patchCard((c) => ({ ...c, identity: { ...c.identity, country: v || undefined } }))],
                    ] as const
                  ).map(([label, value, set]) => (
                    <div key={label}>
                      <label className={LABEL_CLS}>{label}</label>
                      <input value={value} onChange={(e) => set(e.target.value)} className={`${INPUT_CLS} mt-1`} />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[#EDEFF4]">How you read</h3>
                <ul className="mt-2 space-y-3">
                  {card.archetypes.map((a, i) => (
                    <li key={i} className="rounded-[10px] border border-ink-800 bg-ink-950 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={a.title}
                          onChange={(e) =>
                            patchCard((c) => ({
                              ...c,
                              archetypes: c.archetypes.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                            }))
                          }
                          className={`${INPUT_CLS} !w-auto flex-1 !py-1 text-sm font-medium`}
                        />
                        <span className="text-[11px] uppercase tracking-wide text-[#6B7488]">{a.strength}</span>
                        <ProvenanceChips provenance={a.provenance} />
                      </div>
                      <textarea
                        value={a.why}
                        rows={2}
                        onChange={(e) =>
                          patchCard((c) => ({
                            ...c,
                            archetypes: c.archetypes.map((x, j) => (j === i ? { ...x, why: e.target.value } : x)),
                          }))
                        }
                        className={`${INPUT_CLS} mt-2 text-[13px]`}
                      />
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[#EDEFF4]">Proof points</h3>
                <ul className="mt-2 space-y-3">
                  {card.proofPoints.map((p, i) => (
                    <li key={i} className="rounded-[10px] border border-ink-800 bg-ink-950 p-3">
                      <div className="flex items-start gap-2">
                        <textarea
                          value={p.claim}
                          rows={2}
                          onChange={(e) =>
                            patchCard((c) => ({
                              ...c,
                              proofPoints: c.proofPoints.map((x, j) => (j === i ? { ...x, claim: e.target.value } : x)),
                            }))
                          }
                          className={`${INPUT_CLS} flex-1 !py-1.5 text-sm`}
                        />
                        <button
                          type="button"
                          aria-label="remove proof point"
                          onClick={() =>
                            patchCard((c) => ({ ...c, proofPoints: c.proofPoints.filter((_, j) => j !== i) }))
                          }
                          className={`rounded px-2 py-1 text-[#6B7488] hover:text-red-300 ${FOCUS_RING}`}
                        >
                          ×
                        </button>
                      </div>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-[#6B7488]">{p.evidence}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {p.metrics.length > 0 && (
                          <span className="font-mono text-[11px] tabular-nums text-[#A7AFC2]">{p.metrics.join(' · ')}</span>
                        )}
                        <ProvenanceChips provenance={p.provenance} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[#EDEFF4]">Where Falkyr hunts for you</h3>
                <p className="mt-1 text-[13px] text-[#6B7488]">These words steer the job scan.</p>
                <div className="mt-3 space-y-4">
                  <div>
                    <span className={LABEL_CLS}>Target titles</span>
                    <div className="mt-1.5">
                      <ChipListEditor
                        values={card.huntingGrounds.targetTitles}
                        onChange={(v) => patchCard((c) => ({ ...c, huntingGrounds: { ...c.huntingGrounds, targetTitles: v } }))}
                        placeholder="data engineer"
                      />
                    </div>
                  </div>
                  <div>
                    <span className={LABEL_CLS}>Title keywords</span>
                    <div className="mt-1.5">
                      <ChipListEditor
                        values={card.huntingGrounds.keywords}
                        onChange={(v) =>
                          patchCard((c) => ({ ...c, huntingGrounds: { ...c.huntingGrounds, keywords: v.map((x) => x.toLowerCase()) } }))
                        }
                        placeholder="etl"
                      />
                    </div>
                  </div>
                  <div>
                    <span className={LABEL_CLS}>Never show me</span>
                    <div className="mt-1.5">
                      <ChipListEditor
                        values={card.huntingGrounds.avoidTitles}
                        onChange={(v) => patchCard((c) => ({ ...c, huntingGrounds: { ...c.huntingGrounds, avoidTitles: v } }))}
                        placeholder="sales engineer"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[#EDEFF4]">Honest gaps</h3>
                <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[#6B7488]">
                  What you do <em>not</em> have that peers often claim. Confirmed gaps become hard
                  tripwires — the verifier blocks any application that claims one. Answer every
                  question to release.
                </p>
                <ul className="mt-3 space-y-2">
                  {card.honestGaps.map((g, i) => (
                    <li key={i} className="rounded-[10px] border border-ink-800 bg-ink-950 p-3">
                      <p className="text-sm text-[#EDEFF4]">{g.question}</p>
                      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={g.label}>
                        {(
                          [
                            ['confirmed-gap', "That's a gap", 'text-gold-400 ring-gold-400/40'],
                            ['have-it', 'I have it', 'text-emerald-300 ring-emerald-400/40'],
                          ] as const
                        ).map(([value, label, active]) => (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={g.status === value}
                            onClick={() =>
                              patchCard((c) => ({
                                ...c,
                                honestGaps: c.honestGaps.map((x, j) => (j === i ? { ...x, status: value } : x)),
                              }))
                            }
                            className={`rounded-full px-3 py-1 text-xs ring-1 transition ${FOCUS_RING} ${
                              g.status === value ? active : 'text-[#6B7488] ring-ink-700 hover:text-[#A7AFC2]'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                        {g.status === 'unsure' && <span className="text-xs text-red-300">unanswered</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-ink-800 pt-5">
                <button
                  type="button"
                  onClick={() => void release()}
                  disabled={releasing || unsureCount > 0 || released}
                  title={unsureCount > 0 ? `${unsureCount} honest-gap question${unsureCount === 1 ? '' : 's'} unanswered` : undefined}
                  className={`rounded-[10px] bg-gold-400 px-6 py-3 text-sm font-semibold text-ink-950 transition hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                >
                  {releasing ? 'Releasing…' : released ? 'Released' : 'Release this card'}
                </button>
                <p className="mt-2 text-[13px] text-[#6B7488]">
                  {released
                    ? 'This card is what Falkyr speaks from. Edit anything above and release again to update it.'
                    : 'On release, this exact card — every edit you made — becomes the only thing Falkyr speaks from.'}
                </p>
              </div>
            </div>
          )}
        </Section>

        {released && (
          <div className="rounded-2xl border border-ink-800 bg-ink-900/60 p-6 text-center">
            <p className="font-display text-lg font-semibold">The bird knows you now.</p>
            <p className="mx-auto mt-1 max-w-md text-[14px] text-[#A7AFC2]">
              Run a scan from the Perch — discovered roles are filtered by your card's target titles
              and keywords.
            </p>
            <a
              href="/app"
              className={`mt-4 inline-block rounded-[10px] bg-gold-400 px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-gold-300 ${FOCUS_RING}`}
            >
              Open the Perch
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
