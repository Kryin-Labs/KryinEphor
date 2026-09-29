import { createClient } from '@supabase/supabase-js';
import { recordDiagnostic, isDiagnosticsEnabled } from './devDiagnostics';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabasePublishableKey);

// ─── Dev diagnostics instrumentation ────────────────────────────────
// Wraps supabase.functions.invoke and supabase.auth methods so failures
// surface in the DevDiagnosticsPanel without changing call sites.
if (isDiagnosticsEnabled()) {
  // Edge functions
  const fns = supabase.functions;
  const originalInvoke = fns.invoke.bind(fns);
  (fns as unknown as Record<string, unknown>).invoke = async (name: string, options?: unknown): Promise<{ data: unknown; error: unknown }> => {
    try {
      const res = await originalInvoke(name, options as never);
      if (res.error) {
        recordDiagnostic({
          source: 'edge-function',
          label: `${name} failed`,
          message: res.error.message || String(res.error),
          detail: { name, error: res.error, data: res.data, options },
        });
      }
      return res;
    } catch (err) {
      recordDiagnostic({
        source: 'edge-function',
        label: `${name} threw`,
        message: err instanceof Error ? err.message : String(err),
        detail: { name, err, options },
      });
      throw err;
    }
  };

  // Auth state changes that carry errors / sign-outs
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      // benign — skip
      return;
    }
    if (!session && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) {
      // benign — skip
    }
  });

  // Wrap common auth methods that return { error }
  const auth = supabase.auth;
  const wrap = <T extends (...args: never[]) => Promise<{ error: unknown } | unknown>>(
    methodName: keyof typeof auth,
    fn: T
  ): T => {
    return (async (...args: Parameters<T>) => {
      try {
        const res = await fn(...args);
        const maybeErr = (res as { error?: unknown })?.error;
        if (maybeErr) {
          recordDiagnostic({
            source: 'auth',
            label: `auth.${String(methodName)} failed`,
            message:
              (maybeErr as Error)?.message ||
              (typeof maybeErr === 'string' ? maybeErr : JSON.stringify(maybeErr)),
            detail: { method: methodName, error: maybeErr, args },
          });
        }
        return res;
      } catch (err) {
        recordDiagnostic({
          source: 'auth',
          label: `auth.${String(methodName)} threw`,
          message: err instanceof Error ? err.message : String(err),
          detail: { method: methodName, err, args },
        });
        throw err;
      }
    }) as T;
  };

  const methods = [
    'signInWithPassword',
    'signUp',
    'signOut',
    'resetPasswordForEmail',
    'updateUser',
    'verifyOtp',
  ] as const;
  for (const m of methods) {
    const original = (auth as unknown as Record<string, unknown>)[m];
    if (typeof original === 'function') {
      (auth as unknown as Record<string, unknown>)[m] = wrap(m, original.bind(auth) as never);
    }
  }

  // Global handlers — anything unhandled that mentions supabase
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? '');
    if (/supabase|functions|auth|postgrest/i.test(msg)) {
      recordDiagnostic({
        source: 'unhandled',
        label: 'unhandled rejection',
        message: msg,
        detail: e.reason,
      });
    }
  });
}
