// Connect your Claude — the authorization wizard. Wraps `claude setup-token`:
// Falkyr's server starts the flow and hands us Anthropic's authorize link; the
// user approves on claude.ai and pastes the one-time code back here; the
// server exchanges it for a long-lived token, stores it on this machine, and
// live-tests it. Falkyr never sees an Anthropic password, and the token never
// leaves this box.
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import type { ProfileStatus } from '../types.js';
import { FalkyrLogo } from './brand/FalkyrMark.js';

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400';
const INPUT_CLS =
  'w-full rounded-[10px] border border-ink-700 bg-ink-900 px-3 py-2 text-[15px] text-[#EDEFF4] placeholder:text-[#6B7488] font-mono ' +
  FOCUS_RING;

type Phase = 'idle' | 'starting' | 'awaiting-code' | 'linking' | 'connected';

export default function ConnectClaudePage() {
  const [status, setStatus] = useState<ProfileStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [authUrl, setAuthUrl] = useState('');
  const [code, setCode] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [manualToken, setManualToken] = useState('');

  const refresh = useCallback(async () => {
    const s = await api.getProfile();
    setStatus(s);
    if (s.claude.connected) setPhase('connected');
    return s;
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : 'failed to load status'));
  }, [refresh]);

  const start = useCallback(async () => {
    setPhase('starting');
    setError(null);
    try {
      const { url } = await api.connectStart();
      setAuthUrl(url);
      setPhase('awaiting-code');
    } catch (e) {
      setPhase('idle');
      setError(e instanceof ApiError ? e.message : 'could not start the authorization');
      setShowPaste(true); // the always-works fallback
    }
  }, []);

  const link = useCallback(async () => {
    if (!code.trim()) return;
    setPhase('linking');
    setError(null);
    try {
      const r = await api.connectCode(code.trim());
      setNote(r.note ?? null);
      setCode('');
      await refresh();
      setPhase('connected');
    } catch (e) {
      setPhase('awaiting-code');
      setError(e instanceof ApiError ? e.message : 'linking failed');
    }
  }, [code, refresh]);

  const submitManualToken = useCallback(async () => {
    if (!manualToken.trim()) return;
    setPhase('linking');
    setError(null);
    try {
      const r = await api.connectToken(manualToken.trim());
      setNote(r.note ?? null);
      setManualToken('');
      await refresh();
      setPhase('connected');
    } catch (e) {
      setPhase('idle');
      setError(e instanceof ApiError ? e.message : 'that token did not work');
    }
  }, [manualToken, refresh]);

  const disconnect = useCallback(async () => {
    setError(null);
    await api.claudeDisconnect();
    setNote(null);
    setPhase('idle');
    await refresh();
  }, [refresh]);

  const cli = status?.claude.cli ?? false;
  const connected = status?.claude.connected ?? false;

  return (
    <div className="min-h-screen bg-ink-950 text-[#EDEFF4] antialiased">
      <header className="border-b border-ink-800">
        <div className="mx-auto flex h-16 max-w-2xl items-center gap-4 px-5">
          <a href="/" aria-label="falkyr — home" className="text-[#EDEFF4]">
            <FalkyrLogo size={24} />
          </a>
          <span className="text-[13px] text-[#6B7488]">connect your Claude</span>
          <a
            href="/glove"
            className={`ml-auto rounded-md px-3 py-1.5 text-sm font-medium text-[#A7AFC2] ring-1 ring-ink-700 transition hover:bg-ink-850 hover:text-[#EDEFF4] ${FOCUS_RING}`}
          >
            the Glove →
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-5 py-12">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-[-0.025em]">
            Falkyr flies on your Claude.
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#A7AFC2]">
            Every application it writes runs on the Claude subscription you already pay for — not
            our servers, not our models, no second AI bill. Authorize once and you're set. Falkyr
            never sees your Anthropic password, and the resulting key never leaves this machine.
          </p>
        </div>

        {error && (
          <div role="alert" className="rounded-[10px] bg-red-400/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-400/25">
            {error}
          </div>
        )}

        {!cli && status && (
          <div className="rounded-2xl border border-ink-800 bg-ink-900/60 p-6 text-[15px] text-[#A7AFC2]">
            The Claude CLI isn't installed on this machine, so there's nothing to connect to.
            Rebuild the container (the current image includes it) or install{' '}
            <code className="rounded bg-ink-850 px-1 text-[13px]">@anthropic-ai/claude-code</code>.
          </div>
        )}

        {cli && connected && (
          <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/5 p-6">
            <p className="flex items-center gap-2 font-display text-lg font-semibold text-emerald-300">
              ✓ Claude connected
            </p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-[#A7AFC2]">
              Runs on your subscription. Distill, extraction, and tailored generation are live
              everywhere Falkyr runs on this machine.
            </p>
            {note && <p className="mt-2 text-[13px] text-gold-400">{note}</p>}
            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href="/glove"
                className={`rounded-[10px] bg-gold-400 px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-gold-300 ${FOCUS_RING}`}
              >
                Build your peer card
              </a>
              {status?.claude.tokenStored && (
                <button
                  type="button"
                  onClick={() => void disconnect()}
                  className={`rounded-[10px] px-4 py-2.5 text-sm text-[#A7AFC2] ring-1 ring-ink-700 transition hover:bg-ink-850 hover:text-[#EDEFF4] ${FOCUS_RING}`}
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>
        )}

        {cli && !connected && (
          <div className="rounded-2xl border border-ink-800 bg-ink-900/60 p-6">
            <ol className="space-y-6">
              <li>
                <p className="text-sm font-semibold text-[#EDEFF4]">
                  <span className="mr-2 font-mono text-xs text-gold-400">1</span>
                  Authorize on claude.ai
                </p>
                {phase === 'idle' || phase === 'starting' ? (
                  <button
                    type="button"
                    disabled={phase === 'starting'}
                    onClick={() => void start()}
                    className={`mt-3 rounded-[10px] bg-gold-400 px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-gold-300 disabled:opacity-60 ${FOCUS_RING}`}
                  >
                    {phase === 'starting' ? 'Preparing…' : 'Get the authorize link'}
                  </button>
                ) : (
                  <a
                    href={authUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={`mt-3 inline-block max-w-full truncate rounded-[10px] border border-gold-400/40 px-4 py-2.5 text-sm font-medium text-gold-400 transition hover:border-gold-400 ${FOCUS_RING}`}
                  >
                    Open claude.ai and click Authorize ↗
                  </a>
                )}
                <p className="mt-2 text-[13px] text-[#6B7488]">
                  Signs you into your own Anthropic account, in your own browser tab.
                </p>
              </li>
              <li>
                <p className="text-sm font-semibold text-[#EDEFF4]">
                  <span className="mr-2 font-mono text-xs text-gold-400">2</span>
                  Paste the code it gives you
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && phase === 'awaiting-code') void link();
                    }}
                    disabled={phase !== 'awaiting-code'}
                    placeholder="paste the authorization code"
                    aria-label="authorization code"
                    className={`${INPUT_CLS} disabled:opacity-50`}
                  />
                  <button
                    type="button"
                    disabled={phase !== 'awaiting-code' || !code.trim()}
                    onClick={() => void link()}
                    className={`shrink-0 rounded-[10px] bg-gold-400 px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                  >
                    {phase === 'linking' ? 'Linking…' : 'Link'}
                  </button>
                </div>
                {phase === 'linking' && (
                  <p className="mt-2 text-[13px] text-[#A7AFC2]">
                    Exchanging the code and running a one-line test on your Claude…
                  </p>
                )}
              </li>
            </ol>

            <div className="mt-6 border-t border-ink-800 pt-4">
              <button
                type="button"
                onClick={() => setShowPaste((v) => !v)}
                aria-expanded={showPaste}
                className={`text-[13px] text-[#6B7488] transition hover:text-[#A7AFC2] ${FOCUS_RING} rounded`}
              >
                {showPaste ? '▾' : '▸'} Or paste a token from a terminal
              </button>
              {showPaste && (
                <div className="mt-3">
                  <p className="text-[13px] leading-relaxed text-[#6B7488]">
                    Run <code className="rounded bg-ink-850 px-1">claude setup-token</code> in any
                    terminal on this machine, finish the browser approval there, then paste the
                    printed token:
                  </p>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={manualToken}
                      onChange={(e) => setManualToken(e.target.value)}
                      placeholder="sk-ant-oat…"
                      aria-label="Claude Code token"
                      type="password"
                      className={INPUT_CLS}
                    />
                    <button
                      type="button"
                      disabled={!manualToken.trim() || phase === 'linking'}
                      onClick={() => void submitManualToken()}
                      className={`shrink-0 rounded-[10px] px-4 py-2.5 text-sm text-[#A7AFC2] ring-1 ring-ink-700 transition hover:bg-ink-850 hover:text-[#EDEFF4] disabled:opacity-50 ${FOCUS_RING}`}
                    >
                      Connect
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <p className="text-[13px] leading-relaxed text-[#6B7488]">
          The key is stored only on this machine, reachable only from this machine, and revocable
          any time from your Anthropic account settings — or the Disconnect button here. Read the
          guarantees on the{' '}
          <a href="/trust" className={`text-[#A7AFC2] underline-offset-2 hover:underline ${FOCUS_RING} rounded`}>
            trust page
          </a>
          .
        </p>
      </main>
    </div>
  );
}
