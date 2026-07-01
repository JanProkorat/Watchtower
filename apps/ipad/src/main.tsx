import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';

const el = document.getElementById('root');
if (!el) throw new Error('#root missing');
createRoot(el).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
