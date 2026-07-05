// src/apply/adapters.ts
//
// Lightweight per-ATS detection + hints. Pure (URL/string based). The DOM-level
// filling in autofill.ts is intentionally GENERIC — it works across ATSes that
// use standard HTML controls plus React-Select comboboxes — and these hints add
// provider-specific context for logging and for setting expectations on
// multi-step wizards (Workday/iCIMS) that a single fill pass can't complete.

export type AtsProvider =
  | 'greenhouse'
  | 'ashby'
  | 'lever'
  | 'workable'
  | 'smartrecruiters'
  | 'workday'
  | 'icims'
  | 'generic';

/** Detect the ATS from a job/application URL host. */
export function detectAts(url: string): AtsProvider {
  let host = '';
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/\.+$/, '');
  } catch {
    return 'generic';
  }
  if (host.includes('greenhouse.io')) return 'greenhouse';
  if (host.includes('ashbyhq.com')) return 'ashby';
  if (host.includes('lever.co')) return 'lever';
  if (host.includes('workable.com')) return 'workable';
  if (host.includes('smartrecruiters.com')) return 'smartrecruiters';
  if (host.includes('myworkdayjobs.com') || host.includes('workday')) return 'workday';
  if (host.includes('icims.com')) return 'icims';
  return 'generic';
}

export interface AtsHints {
  provider: AtsProvider;
  /** Multi-step wizard: a single fill pass covers only the current step. */
  multiStep: boolean;
  /** ATS commonly renders dropdowns as React-Select comboboxes (not native <select>). */
  reactSelect: boolean;
  /** One-line operator note surfaced in the activity log. */
  note: string;
}

export function atsHints(provider: AtsProvider): AtsHints {
  switch (provider) {
    case 'greenhouse':
      return { provider, multiStep: false, reactSelect: true, note: 'Single-page form; demographic section optional; custom questions mix native selects + React-Select.' };
    case 'ashby':
      return { provider, multiStep: false, reactSelect: true, note: 'React app; many dropdowns are comboboxes; EEO section optional.' };
    case 'lever':
      return { provider, multiStep: false, reactSelect: false, note: 'Single-page form; mostly native inputs.' };
    case 'workable':
      return { provider, multiStep: false, reactSelect: true, note: 'Single-page form; some React-Select dropdowns.' };
    case 'smartrecruiters':
      return { provider, multiStep: true, reactSelect: true, note: 'Often multi-step; fill covers the current step only.' };
    case 'workday':
      return { provider, multiStep: true, reactSelect: true, note: 'Multi-step wizard + custom widgets; autofill is partial — expect to complete several steps by hand.' };
    case 'icims':
      return { provider, multiStep: true, reactSelect: false, note: 'Legacy multi-step; autofill is partial.' };
    default:
      return { provider: 'generic', multiStep: false, reactSelect: false, note: 'Unknown ATS; generic best-effort fill.' };
  }
}
