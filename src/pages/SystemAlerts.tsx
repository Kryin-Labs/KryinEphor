import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, ChevronDown, RefreshCw, Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';
import { supabase } from '../lib/supabase';
import { fetchSystemActivity, reconcileAlerts } from '../lib/operations';
import type { ActivityEvent } from '../lib/operations';
import ActivityDetail from '../components/activity/ActivityDetail';
import { describeClient } from '../lib/activityClient';

export default function SystemAlerts() {
    const [tab, setTab] = useState<'alerts' | 'logs'>('alerts');
    const [resolved, setResolved] = useState(false);
    const [severity, setSeverity] = useState('');
    const [level, setLevel] = useState('');
    const [search, setSearch] = useState('');
    const [searchDraft, setSearchDraft] = useState('');
    const [offset, setOffset] = useState(0);
    const [selected, setSelected] = useState<ActivityEvent | null>(null);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');
    const alerts = useQuery({ queryKey: ['system-alerts', resolved], refetchInterval: 30_000, queryFn: async () => {
        await reconcileAlerts();
        const { data, error } = await supabase.from('system_alerts').select('*').eq('is_resolved', resolved)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data ?? [];
    } });
    const logs = useQuery({ queryKey: ['system-activity', offset, search, level], enabled: tab === 'logs', refetchInterval: 30_000,
        queryFn: () => fetchSystemActivity({ limit: 100, offset, search, level }),
    });
    const resolveAlert = async (id: string) => {
        setBusy(true); setActionError('');
        try {
            const { error } = await supabase.rpc('fn_resolve_system_alert', { p_id: id });
            if (error) throw error;
            await alerts.refetch();
        } catch (error) { setActionError(String((error as { message?: string })?.message ?? 'Could not resolve alert.')); }
        finally { setBusy(false); }
    };
    const rows = (alerts.data ?? []).filter(a => !severity || a.severity === severity);
    const error = actionError || (tab === 'alerts' ? alerts.error?.message : logs.error?.message);
    const color = (value: string) => value === 'critical' || value === 'error' ? 'bg-rose-50 text-rose-700' : value === 'warning' || value === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-teal-50 text-teal-800';
    return <div className="flex min-h-screen bg-background"><Sidebar activePage="System Alerts" />
        <main className="flex min-h-screen flex-1 flex-col lg:ml-72"><Header title="System Status" />
            <div className="mx-auto w-full max-w-6xl space-y-6 p-4 pb-24 sm:p-8">
                <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-black">System management</h1><p className="mt-2 text-sm text-muted">Current alerts and recorded activity across the platform.</p></div>
                    <button onClick={() => void (tab === 'alerts' ? alerts.refetch() : logs.refetch())} className="clay-btn-outline flex items-center gap-2 px-4 py-2 text-sm"><RefreshCw size={16} />Refresh</button></header>
                <div className="flex gap-3">{(['alerts', 'logs'] as const).map(t => <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={`rounded-xl px-5 py-3 text-sm font-bold ${tab === t ? 'bg-primary text-white' : 'bg-white text-muted'}`}>{t === 'alerts' ? 'Alerts' : 'System logs'}</button>)}</div>
                {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
                {tab === 'alerts' ? <>
                    <div className="flex flex-wrap gap-3"><select aria-label="Alert status" value={resolved ? 'resolved' : 'active'} onChange={e => setResolved(e.target.value === 'resolved')} className="rounded-xl border bg-white px-4 py-2 text-sm"><option value="active">Active alerts</option><option value="resolved">Resolved history</option></select>
                        <select aria-label="Alert severity" value={severity} onChange={e => setSeverity(e.target.value)} className="rounded-xl border bg-white px-4 py-2 text-sm"><option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option></select></div>
                    {alerts.isPending ? <p role="status">Loading alerts…</p> : !rows.length && !alerts.error ? <div className="clay-card flex items-center gap-3 p-8 text-muted"><CheckCircle2 size={23} />{resolved ? 'No resolved alerts recorded.' : 'No active alerts.'}</div> : rows.map(a => <article key={a.id} className="clay-card space-y-4 p-5 sm:p-7"><div className="flex items-start gap-3"><AlertCircle className="mt-1 shrink-0 text-muted" size={22} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-3 text-xs text-muted"><span>{a.category}</span><time dateTime={a.created_at} title={new Date(a.created_at).toLocaleString()}>{formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}</time><span className={`rounded-full px-3 py-1 font-bold ${color(a.severity)}`}>{a.severity}</span></div><h2 className="mt-2 text-lg font-bold">{a.title}</h2><p className="mt-2 whitespace-pre-wrap text-sm text-muted">{a.message}</p>
                        {resolved && a.resolved_at && <p className="mt-2 text-xs text-muted">Resolved {new Date(a.resolved_at).toLocaleString()}</p>}
                    </div></div>{!resolved && <button disabled={busy} onClick={() => void resolveAlert(a.id)} className="clay-btn flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50"><CheckCircle2 size={16} />Resolve alert</button>}</article>)}
                </> : <>
                    <form onSubmit={e => { e.preventDefault(); setSearch(searchDraft.trim()); setOffset(0); }} className="flex flex-wrap gap-3"><div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border bg-white px-3"><Search size={16} /><input aria-label="Search activity" value={searchDraft} onChange={e => setSearchDraft(e.target.value)} placeholder="Search name, username, email, action or record" className="w-full bg-transparent py-3 text-sm outline-none" /></div><button type="submit" className="clay-btn px-4 py-2 text-sm">Search</button><select aria-label="Log level" value={level} onChange={e => { setLevel(e.target.value); setOffset(0); }} className="rounded-xl border bg-white px-4 py-2 text-sm"><option value="">All levels</option><option value="info">Info</option><option value="warn">Warning</option><option value="error">Error</option></select></form>
                    <p className="text-xs text-muted">History includes database changes, security actions, AI tool calls, and browser-reported lifecycle events. Recorded activity is preserved when an account or school is deleted.</p>
                    {logs.isPending ? <p role="status">Loading activity…</p> : !logs.data?.length && !logs.error ? <p className="clay-card p-8 text-muted">No matching activity recorded.</p> : <div className="space-y-3">{logs.data?.map(l => <button key={l.id} onClick={() => setSelected(l)} className="clay-card flex w-full items-start justify-between gap-4 p-4 text-left sm:p-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{l.action}</strong><span className={`rounded-full px-2 py-0.5 text-xs ${color(l.level)}`}>{l.status}</span></div><p className="mt-1 break-words text-sm text-muted">{l.message}</p><p className="mt-2 text-xs text-muted">{l.user_name} · {l.school_name ?? 'Platform'} · {l.category}</p><p className="mt-1 break-words text-xs text-muted">{l.user_email || l.user_username || 'Identity not captured'} · {describeClient(l.user_agent).browser} · {describeClient(l.user_agent).device}{l.ip_address && <> · {l.ip_address}</>}</p></div><time className="shrink-0 text-right text-xs text-muted" dateTime={l.created_at} title={new Date(l.created_at).toLocaleString()}>{formatDistanceToNow(new Date(l.created_at), { addSuffix: true })}<ChevronDown className="ml-auto mt-2" size={16} /></time></button>)}</div>}
                    <div className="flex items-center justify-center gap-4"><button disabled={offset === 0 || logs.isFetching} onClick={() => setOffset(Math.max(0, offset - 100))} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40">Previous</button><span className="text-sm">Page {offset / 100 + 1}</span><button disabled={(logs.data?.length ?? 0) < 100 || logs.isFetching} onClick={() => setOffset(offset + 100)} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40">Next</button></div>
                </>}
            </div>
        </main>
        {selected && <ActivityDetail event={selected} onClose={() => setSelected(null)} />}
    </div>;
}
