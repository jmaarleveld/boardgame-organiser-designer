import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

/**
 * Register the box types if src/boxes/index.ts exists. import.meta.glob keeps
 * this working (and building) while that module is still absent; the
 * integration step can replace it with a plain `import { registerAllBoxTypes } from './boxes'`.
 */
async function registerBoxes(): Promise<void> {
  const mods = import.meta.glob<{ registerAllBoxTypes?: () => void }>('./boxes/index.ts');
  const load = mods['./boxes/index.ts'];
  if (!load) return;
  try {
    const mod = await load();
    mod.registerAllBoxTypes?.();
  } catch (e) {
    console.error('Failed to register box types', e);
  }
}

void registerBoxes().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App services={{}} />
    </StrictMode>,
  );
});
