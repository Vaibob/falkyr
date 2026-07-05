/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clerk publishable key — auth is OFF (local mode) when absent. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
