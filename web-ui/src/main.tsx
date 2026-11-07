import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as KonstaApp } from 'konsta/react';
import App from './App';
import './index.css';

// Phase 1 shell: iOS light only, safe areas on, no dark variants.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <KonstaApp theme="ios" dark={false} safeAreas>
      <App />
    </KonstaApp>
  </React.StrictMode>,
);
