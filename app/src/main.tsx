import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// StrictMode is intentionally off: its dev-only double-invoke of effects
// interferes with the r3f render loop / frame-driven providers.
createRoot(document.getElementById('root')!).render(<App />);
