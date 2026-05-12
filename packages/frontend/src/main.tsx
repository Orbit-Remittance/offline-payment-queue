import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueueProvider } from './QueueContext';
import { App } from './App';
import './index.css';

// In production, derive password from user auth (e.g., wallet key or PIN).
// For demo, use a fixed dev password; replace with real auth flow.
const QUEUE_PASSWORD = import.meta.env.VITE_QUEUE_PASSWORD || 'dev-password-change-me';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueueProvider password={QUEUE_PASSWORD}>
      <App />
    </QueueProvider>
  </React.StrictMode>
);
