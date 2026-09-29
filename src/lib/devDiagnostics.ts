/**
 * Dev-only diagnostics bus.
 *
 * Collects Supabase-related failures (edge functions, auth, postgrest)
 * and lets the DevDiagnosticsPanel subscribe. No-op in production.
 */

export type DiagnosticSource =
  | 'edge-function'
  | 'auth'
  | 'postgrest'
  | 'unhandled'
  | 'manual';

export interface DiagnosticEntry {
  id: string;
  ts: number;
  source: DiagnosticSource;
  label: string;          // short title, e.g. "update_admin (400)"
  message: string;        // primary error message
  detail?: unknown;       // raw payload, status, stack, etc.
}

type Listener = (entries: DiagnosticEntry[]) => void;

const MAX_ENTRIES = 100;
const entries: DiagnosticEntry[] = [];
const listeners = new Set<Listener>();

export const isDiagnosticsEnabled = (): boolean =>
  Boolean(import.meta.env.DEV);

export function recordDiagnostic(
  entry: Omit<DiagnosticEntry, 'id' | 'ts'>
): void {
  if (!isDiagnosticsEnabled()) return;
  const full: DiagnosticEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    ...entry,
  };
  entries.unshift(full);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  listeners.forEach((l) => l([...entries]));
}

export function subscribeDiagnostics(listener: Listener): () => void {
  listener([...entries]);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearDiagnostics(): void {
  entries.length = 0;
  listeners.forEach((l) => l([]));
}

export function getDiagnostics(): DiagnosticEntry[] {
  return [...entries];
}
