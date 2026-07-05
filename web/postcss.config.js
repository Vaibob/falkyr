// Vite runs from the repo root (jobpilot/) with root:'web', so Tailwind's
// auto-discovery can't find web/tailwind.config.js. Point it there explicitly,
// otherwise Tailwind falls back to a default empty `content` and emits only the
// base reset — no utility classes — leaving the UI completely unstyled.
export default {
  plugins: {
    tailwindcss: { config: './web/tailwind.config.js' },
    autoprefixer: {},
  },
};
