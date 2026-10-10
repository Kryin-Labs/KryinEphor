import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Settings, Mail, ShieldCheck, Database, Key, Save, RefreshCw, ExternalLink, Activity } from 'lucide-react';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';
import { supabase } from '../lib/supabase';
import { reconcileAlerts } from '../lib/operations';
import type { PlatformSettings, PlatformHealth } from '../lib/operations';
import { announceMaintenanceChange } from '../lib/maintenance';
import HealthConsole from '../components/settings/HealthConsole';

const tabs = [{ id: 'General', icon: Settings }, { id: 'Health console', icon: Activity }, { id: 'Email Service', icon: Mail },
    { id: 'Security', icon: ShieldCheck }, { id: 'Backups', icon: Database }, { id: 'API Access', icon: Key }];
const projectId = new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0];
const projectDashboard = `https://supabase.com/dashboard/project/${projectId}`;

export default function GlobalSetup() {
    const client = useQueryClient();
    const [tab, setTab] = useState('General');
    const [draft, setDraft] = useState<PlatformSettings | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [actionError, setActionError] = useState('');
    const [mailer, setMailer] = useState<{ status: string; latency_ms?: number; checked_at: string } | null>(null);
    const settings = useQuery({ queryKey: ['platform-settings'], refetchInterval: 15_000, refetchOnWindowFocus: true, queryFn: async () => {
        const { data, error } = await supabase.rpc('fn_get_platform_settings');
        if (error) throw error;
        return data as PlatformSettings;
    } });
    // Poll saved state without discarding unsaved message/contact edits.
    useEffect(() => { if (settings.data) setDraft(current => current ?? settings.data!); }, [settings.data]);
    const health = useQuery({ queryKey: ['platform-health'], refetchInterval: 60_000, queryFn: async () => {
        await reconcileAlerts();
        const { data, error } = await supabase.rpc('fn_platform_health');
        if (error) throw error;
        return data as PlatformHealth;
    } });
    const backups = useQuery({ queryKey: ['platform-backups'], enabled: tab === 'Backups', queryFn: async () => {
        const { data, error } = await supabase.from('backup_logs')
            .select('id,backup_type,status,started_at,completed_at,size_bytes').order('started_at', { ascending: false }).limit(20);
        if (error) throw error;
        return data ?? [];
    } });
    const schools = useQuery({ queryKey: ['platform-ai-schools'], enabled: tab === 'API Access', queryFn: async () => {
        const { data, error } = await supabase.from('schools').select('id,name,ai_connections_enabled').is('deleted_at', null).order('name');
        if (error) throw error;
        return data ?? [];
    } });
    const run = async (work: () => Promise<void>, success: string) => {
        setBusy(true); setMessage(''); setActionError('');
        try { await work(); setMessage(success); }
        catch (error) { setActionError(error instanceof Error ? error.message : String((error as { message?: string })?.message ?? 'Request failed.')); }
        finally { setBusy(false); }
    };
    const save = () => void run(async () => {
        if (!draft) throw new Error('Load settings before saving.');
        const { data, error } = await supabase.rpc('fn_update_platform_settings', { p_patch: {
            maintenance_message: draft.maintenance_message,
            support_email: draft.support_email, metrics_stale_minutes: Number(draft.metrics_stale_minutes),
        } });
        if (error) throw error;
        setDraft(data as PlatformSettings);
        client.setQueryData(['platform-settings'], data);
        announceMaintenanceChange();
        await Promise.all([client.invalidateQueries({ queryKey: ['platform-status'] }), client.invalidateQueries({ queryKey: ['platform-health-console'] }), health.refetch()]);
    }, 'Platform settings saved.');
    const toggleMaintenance = (enabled: boolean) => void run(async () => {
        const { data, error } = await supabase.rpc('fn_update_platform_settings', { p_patch: { maintenance_enabled: enabled } });
        if (error) throw error;
        client.setQueryData(['platform-settings'], data);
        announceMaintenanceChange();
        await Promise.all([client.invalidateQueries({ queryKey: ['platform-status'] }), client.invalidateQueries({ queryKey: ['platform-health-console'] }), health.refetch()]);
    }, `Maintenance ${enabled ? 'enabled' : 'disabled'}. The change is saved and takes effect across pages.`);
    const external = (path: string, label: string) => <a href={`${projectDashboard}${path}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-semibold text-primary underline">{label}<ExternalLink size={15} /></a>;
    const queryError = settings.error ?? health.error ?? (tab === 'Backups' ? backups.error : tab === 'API Access' ? schools.error : null);
    const fieldClass = 'mt-2 w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm';

    return <div className="flex min-h-screen bg-background"><Sidebar activePage="Global Setup" />
        <main className="flex min-h-screen flex-1 flex-col lg:ml-72"><Header title="System Configuration" />
            <div className="mx-auto w-full max-w-7xl space-y-5 p-4 pb-24 sm:p-8">
                <div><h1 className="text-3xl font-black">Platform settings</h1><p className="mt-2 text-sm text-muted">Saved platform controls and status from the connected services.</p></div>
                {message && <p role="status" className="rounded-xl bg-teal-50 p-4 text-sm text-teal-900">{message}</p>}
                {(actionError || queryError) && <div role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{actionError || queryError?.message}
                    <button onClick={() => void Promise.all([settings.refetch(), health.refetch(), tab === 'Backups' ? backups.refetch() : tab === 'API Access' ? schools.refetch() : Promise.resolve()])} className="ml-3 underline">Retry</button></div>}
                <div className="flex flex-col gap-6 lg:flex-row">
                    <nav aria-label="Settings sections" className="flex shrink-0 gap-2 overflow-x-auto lg:w-48 lg:flex-col">{tabs.map(({ id, icon: Icon }) => <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}
                        className={`flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold ${tab === id ? 'bg-primary text-white' : 'bg-white text-muted'}`}><Icon size={17} />{id}</button>)}</nav>
                    <div className="min-w-0 flex-1 space-y-6">
                        {tab === 'General' && <>
                            <section className="clay-card space-y-6 p-5 sm:p-8"><div className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-xl font-bold">General setup</h2>
                                <button onClick={save} disabled={busy || !draft || settings.isFetching} className="clay-btn flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50"><Save size={16} />{busy ? 'Saving…' : 'Save changes'}</button></div>
                                {!draft ? <p role="status">Loading saved settings…</p> : <>
                                    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4"><label className="flex items-start justify-between gap-6"><span><strong>Maintenance mode · {settings.data?.maintenance_enabled ? 'ON' : 'OFF'}</strong><span className="mt-1 block text-sm text-muted">Pause school and visitor access across pages. Superadmins keep access with a visible notice.</span></span><input type="checkbox" disabled={busy || !settings.data} checked={!!settings.data?.maintenance_enabled} onChange={e => toggleMaintenance(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-teal-700" /></label><p className="mt-3 text-xs text-muted">This switch saves immediately. Open tabs check within 10 seconds; school database changes are blocked immediately. Save the message below separately.</p></div>
                                    <label className="block text-sm font-semibold">Maintenance message<textarea maxLength={1000} value={draft.maintenance_message} onChange={e => setDraft({ ...draft, maintenance_message: e.target.value })} className={fieldClass} rows={3} /></label>
                                    <label className="block text-sm font-semibold">Support email<input type="email" maxLength={254} value={draft.support_email} onChange={e => setDraft({ ...draft, support_email: e.target.value })} className={fieldClass} /><span className="mt-1 block font-normal text-muted">Shown as the contact link during maintenance.</span></label>
                                    <label className="block text-sm font-semibold">Stale metric alert threshold (minutes)<input type="number" min={5} max={1440} step={1} value={draft.metrics_stale_minutes} onChange={e => setDraft({ ...draft, metrics_stale_minutes: Number(e.target.value) })} className={fieldClass} /></label>
                                    <p className="text-xs text-muted">Last saved: {new Date(settings.data?.updated_at ?? draft.updated_at).toLocaleString()}. Changes take effect when saved.</p>
                                </>}
                            </section>
                            <section className="clay-card space-y-5 p-5 sm:p-8"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">Platform health</h2><button disabled={busy} onClick={() => void run(async () => {
                                const { error } = await supabase.rpc('refresh_dashboard_metrics'); if (error) throw error;
                                await health.refetch();
                            }, 'Platform metrics refreshed.')} className="flex items-center gap-2 text-sm font-semibold text-primary"><RefreshCw size={16} />Refresh metrics</button></div>
                                {health.data ? <><div className="grid grid-cols-2 gap-4">{[['Active schools', health.data.schools], ['Active users', health.data.users], ['Unresolved alerts', health.data.active_alerts], ['Reported errors · last hour', health.data.errors_last_hour]].map(([label, value]) => <div key={label} className="rounded-xl border border-stone-200 p-4"><p className="text-xs text-muted">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>)}</div>
                                    <p className="text-sm text-muted">Metrics updated: {health.data.metrics_updated_at ? new Date(health.data.metrics_updated_at).toLocaleString() : 'No refresh recorded'}.</p>
                                    <p className="text-sm">Automatic refresh: {health.data.scheduler_enabled ? 'Scheduled every 5 minutes' : 'No active database schedule; use Refresh metrics or configure Supabase Cron'}.</p>
                                    </> : <p role="status" className="text-sm text-muted">{health.error ? 'Health status unavailable.' : 'Checking platform health…'}</p>}
                                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">{health.data && <Link to="/alerts" className="inline-block text-sm font-semibold text-primary underline">View alerts and activity history</Link>}<button onClick={() => setTab('Health console')} className="clay-btn px-4 py-2 text-sm">Open live health console</button></div>
                            </section>
                        </>}
                        {tab === 'Health console' && <HealthConsole />}
                        {tab === 'Email Service' && <section className="clay-card space-y-5 p-5 sm:p-8"><h2 className="text-xl font-bold">Email service</h2><p className="text-sm text-muted">Check the existing Brevo mailer connection without sending an email. Sender details and credentials are managed in Supabase Edge Function secrets.</p>
                            <button disabled={busy} className="clay-btn px-5 py-2 text-sm disabled:opacity-50" onClick={() => void run(async () => {
                                const result = await supabase.functions.invoke('mailer_health_check');
                                let data = result.data;
                                if (result.error?.context instanceof Response) data = await result.error.context.json().catch(() => null);
                                if (!data?.status) throw result.error ?? new Error('The mailer returned no health status.');
                                setMailer({ status: data.status, latency_ms: data.latency_ms, checked_at: new Date().toISOString() });
                                if (data.status !== 'ok') throw new Error(`Mailer status: ${data.status}. Check the server configuration.`);
                            }, 'Email provider connection verified.')}>{busy ? 'Checking…' : 'Check email connection'}</button>
                            {mailer && <p className="text-sm">Latest check: <strong>{mailer.status}</strong>{mailer.latency_ms !== undefined ? ` · ${mailer.latency_ms} ms` : ''} · {new Date(mailer.checked_at).toLocaleString()}</p>}{external('/settings/functions', 'Manage mailer secrets')}
                        </section>}
                        {tab === 'Security' && <section className="clay-card space-y-5 p-5 sm:p-8"><h2 className="text-xl font-bold">Security and access</h2><p className="text-sm text-muted">User and role changes use the existing guarded management workflows. Activity history records the actor, target, time, changed fields, and source. Credential fields are redacted.</p><div className="flex flex-wrap gap-4"><Link to="/users" className="clay-btn px-5 py-2 text-sm">Manage users and roles</Link><Link to="/alerts" className="clay-btn-outline px-5 py-2 text-sm">Review activity history</Link></div><p className="text-sm text-muted">Authentication providers, password rules, and session expiry are configured in the authentication service.</p>{external('/auth/providers', 'Open authentication settings')}</section>}
                        {tab === 'Backups' && <section className="clay-card space-y-5 p-5 sm:p-8"><h2 className="text-xl font-bold">Backup history</h2><p className="text-sm text-muted">Application backup records are listed below. Supabase-managed backups and restore operations are available in the database console.</p>{external('/database/backups', 'Open database backups and restore')}
                            {backups.isPending ? <p role="status">Loading backup records…</p> : !backups.data?.length ? <p className="rounded-xl bg-stone-50 p-4 text-sm text-muted">No application backup records are available. Check the database console for managed backups.</p> : <div className="space-y-3">{backups.data.map(b => <article key={b.id} className="rounded-xl border p-4 text-sm"><p className="font-bold">{b.backup_type} · {b.status}</p><p className="mt-1 text-muted">Started {new Date(b.started_at).toLocaleString()}{b.completed_at ? ` · Finished ${new Date(b.completed_at).toLocaleString()}` : ''}</p><p className="text-muted">{Number(b.size_bytes).toLocaleString()} bytes</p></article>)}</div>}
                        </section>}
                        {tab === 'API Access' && <section className="clay-card space-y-5 p-5 sm:p-8"><h2 className="text-xl font-bold">School AI access</h2><p className="text-sm text-muted">Enable or disable MCP connections for a school. Disabling access revokes its existing connections. Each user reviews connections and sensitive action approvals on AI Connections.</p><Link to="/ai-connections" className="text-sm font-semibold text-primary underline">Manage my AI connections</Link>
                            {schools.isPending ? <p role="status">Loading schools…</p> : !schools.data?.length ? <p className="text-sm text-muted">No active schools found.</p> : <div className="space-y-3">{schools.data.map(s => <article key={s.id} className="flex items-center justify-between gap-4 rounded-xl border p-4"><div><strong className="text-sm">{s.name}</strong><p className="text-xs text-muted">{s.ai_connections_enabled ? 'AI access enabled' : 'AI access disabled'}</p></div><button disabled={busy} className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={() => void run(async () => {
                                const { error } = await supabase.rpc('fn_set_school_ai_enabled', { p_school: s.id, p_enabled: !s.ai_connections_enabled }); if (error) throw error;
                                await Promise.all([schools.refetch(), client.invalidateQueries({ queryKey: ['ai-connections'] })]);
                            }, `${s.name}: AI access ${s.ai_connections_enabled ? 'disabled; existing connections revoked' : 'enabled'}.`)}>{s.ai_connections_enabled ? 'Disable' : 'Enable'}</button></article>)}</div>}
                        </section>}
                    </div>
                </div>
            </div>
        </main>
    </div>;
}
