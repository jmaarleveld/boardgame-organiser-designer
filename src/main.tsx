import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import type { AppServices } from './integration';
import { registerAllBoxTypes } from './boxes';
import { createKernel } from './geometry/kernel';
import { createPersistence } from './services/persistence';
import { createExporter } from './services/exporter';
import { createBggClient } from './services/bgg';
import Preview3D from './preview/Preview3D';
import { useStore } from './state/store';

registerAllBoxTypes();

const services: AppServices = {
  persistence: createPersistence(),
  exporter: createExporter(createKernel),
  bgg: createBggClient(),
  Preview3D,
};

/** Load the manifold WASM in the background; the UI is usable meanwhile. */
function loadKernel(): void {
  const { setKernelReady, setKernelError } = useStore.getState();
  setKernelError(null);
  createKernel().then(
    () => setKernelReady(true),
    (e: unknown) => {
      console.error('Failed to load the geometry kernel', e);
      setKernelError(e instanceof Error ? e.message : String(e));
    },
  );
}

loadKernel();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App services={services} onRetryKernel={loadKernel} />
  </StrictMode>,
);
