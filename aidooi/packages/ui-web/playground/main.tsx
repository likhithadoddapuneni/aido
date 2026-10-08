import '@aidooi/ui-tokens/tokens.css';
import '../src/styles.css';
import { createRoot } from 'react-dom/client';
import { Gallery } from './gallery.tsx';

createRoot(document.getElementById('root') as HTMLElement).render(<Gallery />);
