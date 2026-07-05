// Falkyr auth — Clerk, activated by configuration, never required.
//
// LOCAL MODE (default): no VITE_CLERK_PUBLISHABLE_KEY → no Clerk, no external
// requests, the app behaves exactly as the local-first tool it is.
// CLOUD MODE: set the key (web/.env.local for dev; build arg for Docker) and
// the Perch is sign-in-gated, with Clerk handling sign-in/up/user profile.
//
// Everything Clerk-related routes through this module so the rest of the app
// only ever touches <AuthProvider>, <AuthGate>, and <AuthControls>.

import type { ReactNode } from 'react';
import { ClerkProvider, Show, SignIn, SignInButton, UserButton } from '@clerk/react';
import { FalkyrMark } from './components/brand/FalkyrMark.js';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '';

/** True when a Clerk publishable key is configured — the auth on/off switch. */
export const AUTH_ENABLED = PUBLISHABLE_KEY !== '';

/** Clerk widgets themed to the Falkyr ink/gold system (DESIGN.md §2). */
const appearance = {
  variables: {
    colorPrimary: '#E8A33D',
    colorBackground: '#11151F',
    colorText: '#EDEFF4',
    colorTextSecondary: '#A7AFC2',
    colorInputBackground: '#171C29',
    colorInputText: '#EDEFF4',
    colorDanger: '#E5484D',
    borderRadius: '10px',
    fontFamily: "Inter, -apple-system, 'Segoe UI', system-ui, sans-serif",
  },
} as const;

/** Wraps the app in ClerkProvider when auth is on; a no-op passthrough when off. */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (!AUTH_ENABLED) return <>{children}</>;
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/" appearance={appearance}>
      {children}
    </ClerkProvider>
  );
}

/** Full-screen sign-in — shown in place of a gated page when signed out. */
function SignInScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-ink-950 px-4 py-12">
      <a href="/" aria-label="falkyr — home" className="inline-flex items-center gap-2 text-[#EDEFF4]">
        <FalkyrMark size={30} />
        <span className="font-display text-2xl font-semibold" style={{ letterSpacing: '-0.02em' }}>
          falkyr
        </span>
      </a>
      <p className="max-w-xs text-center text-sm leading-relaxed text-[#A7AFC2]">
        Sign in to open the Perch. Your CV and materials stay on your machine — the account only
        keeps the board yours.
      </p>
      <SignIn routing="hash" />
      <a href="/" className="text-sm text-[#6B7488] transition-colors duration-150 hover:text-[#A7AFC2]">
        ← Back to falkyr.in
      </a>
    </div>
  );
}

/** Gate a page behind sign-in. Local mode (no key): renders children directly. */
export function AuthGate({ children }: { children: ReactNode }) {
  if (!AUTH_ENABLED) return <>{children}</>;
  return (
    <Show when="signed-in" fallback={<SignInScreen />}>
      {children}
    </Show>
  );
}

/**
 * Header auth controls: a quiet "Sign in" when signed out, the Clerk user
 * button when signed in. Renders nothing in local mode, so headers keep their
 * exact current layout unless auth is configured.
 */
export function AuthControls() {
  if (!AUTH_ENABLED) return null;
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-[#A7AFC2] ring-1 ring-ink-700 transition hover:bg-ink-850 hover:text-[#EDEFF4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
          >
            Sign in
          </button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </>
  );
}
