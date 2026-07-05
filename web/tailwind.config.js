/** @type {import('tailwindcss').Config} */

// Falkyr design tokens (jobpilot-saas/DESIGN.md). Dark-first: night-sky ink,
// one gold accent — the falcon's eye. `thread.*` is a temporary alias of
// `gold.*` kept until every reference migrates; new code uses `gold.*`.
const gold = {
  300: '#F2B655', // accent hover
  400: '#E8A33D', // the eye — brand accent, primary CTA, focus ring
  600: '#B87615', // gold darkened for AA on paper (light theme)
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', './web/index.html', './web/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0B0E14', // page
          900: '#11151F', // surface
          850: '#171C29', // raised
          800: '#1B2130', // border subtle
          700: '#232A3B', // border strong
        },
        gold,
        thread: gold, // legacy alias — do not use in new code
        paper: '#FAFAF7',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', '-apple-system', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
      transitionTimingFunction: {
        settle: 'cubic-bezier(0.16, 1, 0.3, 1)',
        morph: 'cubic-bezier(0.76, 0, 0.24, 1)',
      },
    },
  },
  plugins: [],
};
