import { useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { canClearQuery, clearDownloadedCaches } from '../../lib/healthUsage';
import { reconcileAlerts } from '../../lib/operations';
import { logger } from '../../lib/logger';

type CacheStatus = { expired_rows: number; expired_logical_bytes: number; retention_days: number };
type Props = { cacheEntries: number | null | undefined; onRefresh(): Promise<unknown> };

export default function CacheCleanup({ cacheEntries, onRefresh }: Props) {
    const client = useQueryClient();
    const cache = client.getQueryCache();
    const unusedQueries = useSyncExternalStore(callback => cache.subscribe(callback), () => cache.getAll().filter(canClearQuery).length);
    const [busy, setBusy] = useState('');
    const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
    const status = useQuery({ queryKey: ['platform-cache-status'], refetchInterval: 30_000, queryFn: async () => {
        const { data, error } = await supabase.rpc('fn_platform_cache_status');
        if (error) throw error;
        return data as CacheStatus;
    } });
    const run = async (name: string, action: () => Promise<string>) => {
        setBusy(name); setNotice(null);
        try {
            const text = await action();
            setNotice({ error: false, text });
            await Promise.all([onRefresh(), status.refetch()]);
        } catch (error) {
            setNotice({ error: true, text: error instanceof Error ? error.message : (error as { message?: string }).message ?? 'Cleanup failed. Refresh and retry.' });
        } finally { setBusy(''); }
    };
    const buttonClass = 'mt-3 rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50';

    return <section className="clay-card space-y-4 p-5 sm:p-7">
        <div><h3 className="text-lg font-bold">Clear unused cache</h3><p className="mt-1 text-xs text-muted">These actions keep sign-ins, preferences, school records, uploaded files and activity history.</p></div>
        {notice && <p role={notice.error ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-rose-50 text-rose-800' : 'bg-teal-50 text-teal-900'}`}>{notice.text}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border p-4"><h4 className="text-sm font-semibold">Unused app queries</h4><p className="mt-1 text-xs text-muted">{unusedQueries.toLocaleString()} inactive, idle entries can be discarded. Active pages and availability settings stay cached.</p><button className={buttonClass} disabled={!!busy || unusedQueries === 0} onClick={() => void run('queries', async () => {
                const before = cache.getAll().filter(canClearQuery).length;
                client.removeQueries({ predicate: canClearQuery });
                await logger.info('system', 'Cleared unused app query cache', { action: 'cache.browser_queries_cleanup', details: { removed_entries: before } });
                return `Cleared ${before.toLocaleString()} unused app query entries. Pages load fresh data when reopened.`;
            })}>{busy === 'queries' ? 'Clearing…' : unusedQueries === 0 ? 'No unused queries' : 'Clear unused app cache'}</button></div>
            <div className="rounded-xl border p-4"><h4 className="text-sm font-semibold">Downloaded browser cache</h4><p className="mt-1 text-xs text-muted">{cacheEntries == null ? 'Cache API measurements unavailable.' : `${cacheEntries.toLocaleString()} entries in this origin’s Cache API.`} Downloads can be fetched again. Local and session storage are preserved.</p><button className={buttonClass} disabled={!!busy || cacheEntries == null || cacheEntries === 0} onClick={() => void run('browser', async () => {
                const removed = await clearDownloadedCaches(caches);
                await logger.info('system', 'Cleared downloaded browser cache', { action: 'cache.browser_downloads_cleanup', details: { removed_entries: removed } });
                return `Cleared ${removed.toLocaleString()} downloaded browser cache entries. Your sign-in is preserved.`;
            })}>{busy === 'browser' ? 'Clearing…' : cacheEntries === 0 ? 'No downloaded cache' : 'Clear downloaded cache'}</button></div>
            <div className="rounded-xl border p-4"><h4 className="text-sm font-semibold">Expired request measurements</h4><p className="mt-1 text-xs text-muted">{status.data ? `${status.data.expired_rows.toLocaleString()} rows older than ${status.data.retention_days} days can be removed. Automatic cleanup also runs hourly.` : 'Checking eligible rows…'}</p>{status.error && <p role="alert" className="mt-2 text-xs text-rose-800">{status.error.message}</p>}<button className={buttonClass} disabled={!!busy || !status.data?.expired_rows || status.isFetching} onClick={() => void run('telemetry', async () => {
                const { data, error } = await supabase.rpc('fn_cleanup_request_metrics'); if (error) throw error;
                return `Removed ${Number(data.removed_rows).toLocaleString()} expired request measurement rows. Recent measurements stay intact; PostgreSQL reuses freed space automatically.`;
            })}>{busy === 'telemetry' ? 'Cleaning…' : status.data?.expired_rows === 0 ? 'No expired measurements' : 'Clean expired measurements'}</button></div>
            <div className="rounded-xl border p-4"><h4 className="text-sm font-semibold">Dashboard metric cache</h4><p className="mt-1 text-xs text-muted">Recalculate saved school and platform totals from current records. This refreshes the cache and its stale alert.</p><button className={buttonClass} disabled={!!busy} onClick={() => void run('metrics', async () => {
                const { error } = await supabase.rpc('refresh_dashboard_metrics'); if (error) throw error;
                await reconcileAlerts();
                await client.invalidateQueries({ queryKey: ['platform-health'] });
                return 'Dashboard metric cache rebuilt from current platform records.';
            })}>{busy === 'metrics' ? 'Rebuilding…' : 'Rebuild metric cache'}</button></div>
        </div>
        <p className="text-xs text-muted">PostgreSQL removes temporary query files automatically after the operation finishes. Cumulative spill counters are historical measurements; clearing them would not free storage. Incomplete uploads must be reviewed through the storage provider.</p>
    </section>;
}
