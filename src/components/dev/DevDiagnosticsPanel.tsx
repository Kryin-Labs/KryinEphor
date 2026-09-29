import { useEffect, useState } from 'react';
import {
  subscribeDiagnostics,
  clearDiagnostics,
  isDiagnosticsEnabled,
  type DiagnosticEntry,
  type DiagnosticSource,
} from '../../lib/devDiagnostics';

const SOURCE_COLORS: Record<DiagnosticSource, string> = {
  'edge-function': 'bg-purple-500/20 text-purple-200 border-purple-400/40',
  auth: 'bg-amber-500/20 text-amber-200 border-amber-400/40',
  postgrest: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40',
  unhandled: 'bg-rose-500/20 text-rose-200 border-rose-400/40',
  manual: 'bg-sky-500/20 text-sky-200 border-sky-400/40',
};

const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString();

export default function DevDiagnosticsPanel() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [entries, setEntries] = useState<DiagnosticEntry[]>([]);

  useEffect(() => {
    if (!isDiagnosticsEnabled()) return;
    return subscribeDiagnostics(setEntries);
  }, []);

  if (!isDiagnosticsEnabled()) return null;

  const unread = entries.length;

  return (
    <div
      style={{ zIndex: 2147483646 }}
      className="fixed bottom-4 right-4 font-mono text-xs"
    >
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="rounded-full border border-white/10 bg-slate-900/90 px-3 py-2 text-slate-200 shadow-lg backdrop-blur hover:bg-slate-800"
          title="Dev diagnostics"
        >
          <span className="mr-2">🛠</span>
          diag
          {unread > 0 && (
            <span className="ml-2 rounded-full bg-rose-500/80 px-2 py-0.5 text-[10px] text-white">
              {unread}
            </span>
          )}
        </button>
      ) : (
        <div className="flex h-[440px] w-[420px] flex-col overflow-hidden rounded-lg border border-white/10 bg-slate-950/95 text-slate-200 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Dev Diagnostics</span>
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                {entries.length}/100
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={clearDiagnostics}
                className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-white/5 hover:text-slate-200"
              >
                clear
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-white/5 hover:text-slate-200"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {entries.length === 0 ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-slate-500">
                No Supabase errors captured yet. Edge function, auth, and
                unhandled failures will appear here.
              </div>
            ) : (
              <ul className="divide-y divide-white/5">
                {entries.map((e) => {
                  const isOpen = expanded === e.id;
                  return (
                    <li key={e.id} className="px-3 py-2">
                      <button
                        onClick={() => setExpanded(isOpen ? null : e.id)}
                        className="flex w-full items-start gap-2 text-left"
                      >
                        <span
                          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase ${SOURCE_COLORS[e.source]}`}
                        >
                          {e.source}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium text-slate-100">
                              {e.label}
                            </span>
                            <span className="shrink-0 text-[10px] text-slate-500">
                              {fmtTime(e.ts)}
                            </span>
                          </div>
                          <div className="truncate text-[11px] text-slate-400">
                            {e.message}
                          </div>
                        </div>
                      </button>
                      {isOpen && (
                        <pre className="mt-2 max-h-48 overflow-auto rounded bg-black/40 p-2 text-[10px] leading-relaxed text-slate-300">
                          {safeStringify(e.detail)}
                        </pre>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-white/10 px-3 py-1.5 text-[10px] text-slate-500">
            dev-only · captures edge fn, auth, unhandled
          </div>
        </div>
      )}
    </div>
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(
      v,
      (_k, val) => {
        if (val instanceof Error) {
          return { name: val.name, message: val.message, stack: val.stack };
        }
        return val;
      },
      2
    );
  } catch {
    return String(v);
  }
}
