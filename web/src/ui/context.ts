// App-wide context: snapshot + lookups + navigation actions, so panels avoid prop drilling.
import { createContext, useContext } from 'react';
import type { Activity, CompanySnapshot, DeptId } from '../../../shared/types';
import { buildLookups, type Lookups, type TabId } from './labels';
import type { ToastInput } from './Toasts';

export interface AppCtx {
  snapshot: CompanySnapshot | null;
  lookups: Lookups;
  activity: Activity[];
  demo: boolean;
  godMode: boolean;
  runId: string;
  toast(t: ToastInput): void;
  openAgent(id: string, fromDept?: DeptId | null): void;
  openDept(id: DeptId): void;
  centerAgent(id: string): void;
  centerDept(id: DeptId): void;
  setTab(tab: TabId): void;
  openBrainNote(path: string): void;
  refresh(): void;
}

const EMPTY: AppCtx = {
  snapshot: null,
  lookups: buildLookups(null),
  activity: [],
  demo: false,
  godMode: false,
  runId: '',
  toast: () => undefined,
  openAgent: () => undefined,
  openDept: () => undefined,
  centerAgent: () => undefined,
  centerDept: () => undefined,
  setTab: () => undefined,
  openBrainNote: () => undefined,
  refresh: () => undefined,
};

export const AppContext = createContext<AppCtx>(EMPTY);

export function useApp(): AppCtx {
  return useContext(AppContext);
}
