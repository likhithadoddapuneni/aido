import '@aidooi/ui-tokens/tokens.css';
import '@aidooi/ui-web/styles.css';
import './console.css';
import { createBrowserSessionStore } from '@aidooi/ui-web';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createConsoleApi, createSignedOutBus } from './lib/api.ts';

// Staff sessions live in sessionStorage: per tab, gone when the tab closes (docs/web.md explains why not localStorage).
const store = createBrowserSessionStore({ persist: true, key: 'aidooi.ops.session' });
const bus = createSignedOutBus();
const api = createConsoleApi({ store, bus });

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App api={api} store={store} bus={bus} />
  </StrictMode>,
);
