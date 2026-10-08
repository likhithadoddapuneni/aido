import '@aidooi/ui-tokens/tokens.css';
import '@aidooi/ui-web/styles.css';
import './portal.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createSignedOutBus } from './lib/bus.ts';
import { createPortalApi, sessionStore } from './lib/session.ts';

const store = sessionStore();
const signedOut = createSignedOutBus();
const api = createPortalApi({ store, onSignedOut: signedOut.emit });

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App store={store} api={api} signedOut={signedOut} />
  </StrictMode>,
);
