import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { getSandboxRequest } from './sandbox/sandboxMode.js';
import { installSandboxHook } from './sandbox/sandboxHook.js';
import './styles/index.css';
import './styles/relic.css';
import './styles/menu.css';
import './styles/closeup.css';
import './styles/boardfx.css';

if (getSandboxRequest()) installSandboxHook();

const auditionMode = import.meta.env.DEV && new URLSearchParams(window.location.search).has('audition');
const AuditionPage = lazy(() => import('./audio/audition/AuditionPage.js').then((m) => ({ default: m.AuditionPage })));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {auditionMode ? <Suspense fallback={null}><AuditionPage /></Suspense> : <App />}
  </React.StrictMode>
);
