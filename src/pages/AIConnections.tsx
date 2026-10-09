import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link2, ShieldCheck } from 'lucide-react';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

type Connection = { id: string; name: string; created_at: string; school_id: string | null;
    teacher_read_until: string | null };
type Action = { id: string; action: string; payload: Record<string, unknown>; status: string;
    created_at: string; expires_at: string; error: string | null; school_id: string; client_id: string;
    school_name: string; client_name: string };
type CallLog = { id: string; tool_name: string; outcome: string; error: string | null;
    created_at: string; school_name: string | null; client_name: string };

export default function AIConnections() {
    const { user, roles, isStaffUnlocked, openStaffPinModal } = useAuth();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [passwords, setPasswords] = useState<Record<string, string>>({});
    const schoolId = user?.schoolId;
    const isAdmin = roles.includes('admin');
    const isTeacher = roles.includes('teacher');
    const isSuperadmin = roles.includes('superadmin');
    const connectionQuery = useQuery({
        queryKey: ['ai-connections', user?.id, schoolId], enabled: !!user,
        queryFn: async () => {
            const [grants, history, school, callHistory] = await Promise.all([
                supabase.rpc('mcp_my_connections'), supabase.rpc('mcp_my_actions'),
                schoolId ? supabase.from('schools').select('ai_connections_enabled,combined_parent_student_account')
                    .eq('id', schoolId).single() : Promise.resolve({ data: null, error: null }),
                supabase.rpc('mcp_my_call_logs'),
            ]);
            if (grants.error || history.error || school.error || callHistory.error) throw grants.error ?? history.error ?? school.error ?? callHistory.error;
            return {
                connections: (grants.data ?? []) as Connection[], actions: (history.data ?? []) as Action[],
                calls: (callHistory.data ?? []) as CallLog[], enabled: Boolean(school.data?.ai_connections_enabled),
                combined: Boolean(school.data?.combined_parent_student_account),
            };
        },
    });
    const { connections = [], actions = [], calls = [], enabled = false, combined = false } = connectionQuery.data ?? {};
    const ready = connectionQuery.isSuccess && !connectionQuery.error;
    const eligible = isSuperadmin || isAdmin || isTeacher || (roles.includes('student') && roles.includes('parent') && combined);
    const refresh = async () => {
        const result = await connectionQuery.refetch();
        if (result.error) throw result.error;
    };

    const run = async (work: () => PromiseLike<{ error: { message: string } | null }>, success: string) => {
        setBusy(true); setMessage('');
        try {
            const result = await work();
            if (result.error) throw new Error(result.error.message);
            try { await refresh(); setMessage(success); }
            catch { setMessage(`${success} Refresh the page to see the latest status.`); }
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Request failed.'); }
        finally { setBusy(false); }
    };
    const decide = async (item: Action, approve: boolean) => {
        if (item.action.startsWith('teacher_') && !isStaffUnlocked) {
            openStaffPinModal();
            setMessage('Unlock staff mode, then review this action again.');
            return;
        }
        setBusy(true); setMessage('');
        try {
            const token = (await supabase.auth.getSession()).data.session?.access_token;
            if (!token) throw new Error('Sign in again to review this action.');
            const response = await fetch('/api/mcp-actions', {
                method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                body: JSON.stringify({ id: item.id, approve, ...(approve && passwords[item.id]
                    ? { password: passwords[item.id] } : {}) }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error ?? 'Action failed.');
            try { await refresh(); setMessage(`Action ${result.status}.`); }
            catch { setMessage(`Action ${result.status}. Refresh the page to see the latest status.`); }
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Action failed.'); }
        finally { setPasswords({}); setBusy(false); }
    };

    return <div className="flex min-h-screen bg-background">
        <Sidebar activePage="AI Connections" />
        <div className="flex min-h-screen flex-1 flex-col lg:ml-72">
            <Header title="AI Connections" />
            <main className="mx-auto w-full max-w-5xl space-y-5 p-4 pb-24 sm:p-8">
                <section className="clay-card space-y-4 p-5 sm:p-7">
                    <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-teal-50 text-primary"><Link2 size={21} /></span>
                        <div><h1 className="text-2xl font-extrabold">AI Connections</h1>
                            <p className="text-sm text-muted">Connect an MCP client to your permitted KryinEphor tools.</p></div></div>
                    {message && <p role="status" className="rounded-xl bg-teal-50 p-3 text-sm text-teal-900">{message}</p>}
                    {connectionQuery.error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">Could not load AI connections: {connectionQuery.error.message}</p>}
                    {!connectionQuery.error && !ready && <p role="status" className="text-sm text-muted">Loading AI connections…</p>}
                    {!eligible && <p className="text-sm text-muted">AI connections are available to school admins, teachers, superadmins, and combined student/parent accounts.</p>}
                    {isAdmin && schoolId && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4">
                        <div><strong>School AI access</strong><p className="text-sm text-muted">{!ready ? 'Checking school AI access…' : enabled ? 'Enabled for this school' : 'Disabled for this school'}</p></div>
                        <button type="button" disabled={busy || !ready || connectionQuery.isFetching} onClick={() => void run(
                            () => supabase.rpc('mcp_set_school_enabled', { p_enabled: !enabled }),
                            enabled ? 'School AI connections disabled. Existing connections were revoked.' : 'School AI connections enabled.',
                        )} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                            {enabled ? 'Disable AI access' : 'Enable AI access'}
                        </button></div>}
                    {ready && eligible && (enabled || isSuperadmin) && <div className="rounded-2xl border p-4 text-sm">
                        <div className="mb-2 flex items-center gap-2 font-semibold"><ShieldCheck size={16} /> Client setup</div>
                        <p>Use this MCP server URL in a client that supports OAuth and PKCE:</p>
                        <code className="mt-2 block break-all rounded-lg bg-stone-100 p-3">{window.location.origin}/api/mcp</code>
                        <p className="mt-2 text-muted">Approve the client on KryinEphor’s consent page. Access tokens expire after 10 minutes. You can revoke a client below.</p>
                    </div>}
                </section>
                <section className="clay-card p-5 sm:p-7">
                    <h2 className="text-lg font-bold">Connected clients</h2>
                    <div className="mt-4 space-y-3">{ready && connections.length === 0 && <p className="text-sm text-muted">No active connections.</p>}
                        {connections.map(connection => <div key={connection.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4">
                            <div><strong>{connection.name}</strong><p className="text-xs text-muted">Connected {new Date(connection.created_at).toLocaleString()}</p>
                                {connection.teacher_read_until && <p className="text-xs text-muted">Teacher read access until {new Date(connection.teacher_read_until).toLocaleString()}</p>}</div>
                            <div className="flex gap-2">{isTeacher && <button type="button" disabled={busy || !ready || connectionQuery.isFetching} onClick={() => {
                                if (!isStaffUnlocked) { openStaffPinModal(); setMessage('Unlock staff mode, then activate teacher AI reads.'); return; }
                                void run(() => supabase.rpc('mcp_activate_teacher_read', { p_grant: connection.id }), 'Teacher AI reads activated.');
                            }} className="rounded-xl border px-3 py-2 text-sm font-semibold">Activate teacher reads</button>}
                                <button type="button" disabled={busy || !ready || connectionQuery.isFetching} onClick={() => void run(
                                    () => supabase.rpc('mcp_revoke_grant', { p_grant: connection.id }), 'Connection revoked.',
                                )} className="rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700">Revoke</button></div>
                        </div>)}</div>
                </section>
                <section className="clay-card p-5 sm:p-7"><h2 className="text-lg font-bold">Action requests and history</h2>
                    <button type="button" disabled={busy || connectionQuery.isFetching} onClick={() => void refresh().catch(error => setMessage(error instanceof Error ? error.message : 'Refresh failed.'))} className="mt-3 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50">Refresh requests</button>
                    <p className="mt-1 text-sm text-muted">Review the exact payload before approving. Requests expire in 10 minutes and can run once.</p>
                    <div className="mt-4 space-y-3">{ready && actions.length === 0 && <p className="text-sm text-muted">No AI actions yet.</p>}
                        {actions.map(action => <article key={action.id} className="rounded-2xl border p-4">
                            <div className="flex flex-wrap justify-between gap-2"><strong>{action.action.replaceAll('_', ' ')}</strong><span className="text-xs font-semibold uppercase text-muted">{action.status}</span></div>
                            <p className="mt-1 text-xs text-muted">{new Date(action.created_at).toLocaleString()} · Expires {new Date(action.expires_at).toLocaleString()}</p>
                            <p className="mt-1 break-all text-xs text-muted">School: {action.school_name} · Client: {action.client_name}</p>
                            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-stone-100 p-3 text-xs">{JSON.stringify(action.payload, null, 2)}</pre>
                            {action.error && <p className="mt-2 text-sm text-rose-700">{action.error}</p>}
                            {action.status === 'pending' && ['admin_create_user', 'admin_reset_password'].includes(action.action)
                                && <label className="mt-3 block text-sm font-semibold">New password · enter only here
                                    <input type="password" autoComplete="new-password" minLength={8} maxLength={128}
                                        value={passwords[action.id] ?? ''}
                                        onChange={event => setPasswords(current => ({ ...current, [action.id]: event.target.value }))}
                                        className="mt-2 block w-full rounded-xl border p-3 font-normal" />
                                    <span className="mt-1 block text-xs font-normal text-muted">This password is not shared with the AI client or saved in action history. Use Users for recovery email verification.</span>
                                </label>}
                            {ready && action.status === 'pending' && new Date(action.expires_at).getTime() > Date.now() && <div className="mt-3 flex gap-2">
                                <button type="button" disabled={busy || connectionQuery.isFetching} onClick={() => void decide(action, false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Deny</button>
                                <button type="button" disabled={busy || connectionQuery.isFetching || (['admin_create_user', 'admin_reset_password'].includes(action.action)
                                    && (passwords[action.id]?.length ?? 0) < 8)} onClick={() => void decide(action, true)} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve and run</button>
                            </div>}</article>)}</div>
                </section>
                <section className="clay-card p-5 sm:p-7"><h2 className="text-lg font-bold">Recent AI activity</h2>
                    <div className="mt-4 space-y-3">{ready && !calls.length && <p className="text-sm text-muted">No tool calls yet.</p>}
                        {calls.map(call => <article key={call.id} className="rounded-xl border p-3 text-sm">
                            <p className="font-semibold">{call.tool_name.replaceAll('_', ' ')} · {call.outcome}</p>
                            <p className="mt-1 text-xs text-muted">{call.client_name} · {call.school_name ?? 'Platform discovery'} · {new Date(call.created_at).toLocaleString()}</p>
                            {call.error && <p className="mt-2 text-rose-700">{call.error}</p>}
                        </article>)}</div>
                </section>
            </main>
        </div>
    </div>;
}
