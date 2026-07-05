import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import TrustPage from './components/TrustPage.js';
import Landing from './components/Landing.js';
import NotFound from './components/NotFound.js';
import { AuthProvider, AuthGate } from './auth.js';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

// Minimal pathname router (no dependency). The container serves index.html for
// any non-/api GET (SPA fallback), so deep-links + refreshes work.
//   /        → marketing landing
//   /app     → the board (dashboard; sign-in-gated when Clerk is configured)
//   /trust   → trust & safety page
//   anything else → 404
const path = window.location.pathname.replace(/\/+$/, '') || '/';
const page =
  path === '/' ? (
    <Landing />
  ) : path === '/app' ? (
    <AuthGate>
      <App />
    </AuthGate>
  ) : path === '/trust' ? (
    <TrustPage />
  ) : (
    <NotFound />
  );

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <AuthProvider>{page}</AuthProvider>
  </React.StrictMode>,
);
