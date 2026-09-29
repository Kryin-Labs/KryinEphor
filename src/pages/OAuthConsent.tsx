import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

type AuthorizationDetails = {
    authorization_id: string;
    redirect_uri: string;
    client: { name: string; uri: string; logo_uri: string };
    user: { email: string };
    scope: string;
};

const OAuthConsent = () => {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const authorizationId = params.get('authorization_id');
    const [details, setDetails] = useState<AuthorizationDetails | null>(null);
    const [message, setMessage] = useState(() => authorizationId ? '' : 'This authorization request is invalid.');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!authorizationId) return;
        if (!user) { navigate(`/?authorization_id=${encodeURIComponent(authorizationId)}`, { replace: true }); return; }
        const load = async () => {
            const { data: profile, error: profileError } = await supabase.from('profiles').select('role, school_id').eq('id', user.id).is('deleted_at', null).single();
            const { data: roles, error: rolesError } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
            if (profileError || rolesError || !profile?.school_id) { setMessage('Your school account could not be verified.'); return; }
            const accountRoles = new Set([profile.role, ...(roles ?? []).map(({ role }) => role)]);
            if (profile.role !== 'admin' && profile.role !== 'teacher' && (!accountRoles.has('student') || !accountRoles.has('parent'))) {
                setMessage('MCP is available only to school administrators, teachers, and combined student/parent accounts.');
                return;
            }
            const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
            if (error || !data) { setMessage(error?.message ?? 'This authorization request has expired.'); return; }
            if ('redirect_url' in data) { window.location.assign(data.redirect_url); return; }
            setDetails(data);
        };
        void load();
    }, [authorizationId, navigate, user]);

    const decide = async (approved: boolean) => {
        if (!authorizationId) return;
        setBusy(true); setMessage('');
        const action = approved ? supabase.auth.oauth.approveAuthorization : supabase.auth.oauth.denyAuthorization;
        const { error } = await action(authorizationId);
        if (error) { setMessage(error.message); setBusy(false); }
    };

    return (
        <main className="min-h-screen bg-cream px-5 flex items-center justify-center">
            <section className="w-full max-w-md rounded-3xl border border-emerald-900/10 bg-white p-7 shadow-xl">
                <div className="mb-6 flex items-center gap-3">
                    <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-900 text-lime-300"><ShieldCheck className="h-5 w-5" /></div>
                    <div><p className="font-bold text-emerald-950">Kryin Edu</p><p className="text-xs text-emerald-900/55">Secure account connection</p></div>
                </div>
                {!details && !message && <p className="text-sm text-emerald-900/60">Loading authorization request…</p>}
                {message && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{message}</p>}
                {details && <>
                    <h1 className="text-xl font-bold text-emerald-950">Connect {details.client.name}?</h1>
                    <p className="mt-2 text-sm leading-6 text-emerald-900/65">This app will act only with your Kryin Edu account permissions.</p>
                    <div className="my-5 rounded-2xl bg-emerald-50 p-4 text-sm">
                        <p className="font-semibold text-emerald-950">Signed in as {details.user.email}</p>
                        <p className="mt-2 text-emerald-900/65">Requested access: {details.scope || 'basic account access'}</p>
                    </div>
                    <div className="flex gap-3"><button disabled={busy} onClick={() => void decide(false)} className="flex-1 rounded-xl border border-emerald-900/15 px-4 py-2.5 text-sm font-bold text-emerald-900 disabled:opacity-50">Deny</button><button disabled={busy} onClick={() => void decide(true)} className="flex-1 rounded-xl bg-emerald-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Connecting…' : 'Allow'}</button></div>
                </>}
            </section>
        </main>
    );
};

export default OAuthConsent;
