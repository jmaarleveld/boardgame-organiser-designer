/**
 * Integration seam between the UI and the services / preview layers.
 * The integration step passes concrete implementations to <App services={...} />;
 * any member left undefined disables the corresponding UI affordance.
 */
import { createContext, createElement, useContext } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { AssemblyViewProps, BggClient, Exporter, Persistence, Preview3DProps } from './services/contracts';

export interface AppServices {
  persistence?: Persistence;
  exporter?: Exporter;
  bgg?: BggClient;
  Preview3D?: ComponentType<Preview3DProps>;
  /** Whole-box 3D view with every placed item (reads the store itself). */
  AssemblyView?: ComponentType<AssemblyViewProps>;
}

const ServicesContext = createContext<AppServices>({});

export function ServicesProvider(props: { services: AppServices; children?: ReactNode }) {
  return createElement(ServicesContext.Provider, { value: props.services }, props.children);
}

export function useServices(): AppServices {
  return useContext(ServicesContext);
}
