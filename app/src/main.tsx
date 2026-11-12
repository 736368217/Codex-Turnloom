import React from 'react';
import { createRoot } from 'react-dom/client';
import './theme/globals.css';
import AppRoot from './AppRoot';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <AppRoot />
    </React.StrictMode>,
  );
}
