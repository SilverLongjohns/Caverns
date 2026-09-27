import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { getSandboxRequest } from './sandbox/sandboxMode.js';
import { installSandboxHook } from './sandbox/sandboxHook.js';
import './styles/index.css';
import './styles/relic.css';
import './styles/menu.css';
import './styles/closeup.css';

if (getSandboxRequest()) installSandboxHook();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
