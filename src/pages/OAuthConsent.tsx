import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

type Details = { client: string; email: string; scope: string; redirect_uri: string; school_id: string | null };

export default function OAuthConsent() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const { user, loading } = useAuth();
    const requestId = params.get('request_id');
    const [message, setMessage] = useState(requestId ? '' : 'This authorization request is invalid.');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (requestId && !loading && !user) navigate(`/?request_id=${encodeURIComponent(requestId)}`, { replace: true });
    }, [navigate, requestId, user, loading]);

    const detailsQuery = useQuery({
        queryKey: ['oauth-consent-details', user?.id, requestId],
        enabled: !!requestId && !!user && !loading,
        queryFn: async ({ signal }): Promise<Details> => {
            const token = (await supabase.auth.getSession()).data.session?.access_token;
            if (!token) throw new Error('Sign in to connect your account.');
            const response = await fetch(`/api/oauth/details?request_id=${encodeURIComponent(requestId!)}`, {
                headers: { Authorization: `Bearer ${token}` }, signal,
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error ?? 'Authorization request expired.');
            return body as Details;
        },
    });
    const details = !loading && detailsQuery.isSuccess ? detailsQuery.data : null;

    const decide = async (approve: boolean) => {
        if (!requestId || !details || busy || detailsQuery.isFetching) return;
        setBusy(true);
        setMessage('');
        try {
            const token = (await supabase.auth.getSession()).data.session?.access_token;
            if (!token) throw new Error('Sign in again before continuing.');
            const response = await fetch('/api/oauth/consent', {
                method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                body: JSON.stringify({ request_id: requestId, approve }),
            });
            const result = await response.json();
            if (!response.ok || !result.redirect_url) throw new Error(result.error ?? 'Connection could not be completed.');
            window.location.assign(result.redirect_url);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Connection could not be completed.');
            setBusy(false);
        }
    };

    return <main className="flex min-h-screen items-center justify-center bg-cream px-5">
        <section className="w-full max-w-md rounded-3xl border border-emerald-900/10 bg-white p-7 shadow-xl">
            <div className="mb-6 flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-900 text-lime-300"><ShieldCheck className="h-5 w-5" /></div>
                <div><p className="font-bold text-emerald-950">Kryin Edu</p><p className="text-xs text-emerald-900/55">AI connection request</p></div>
            </div>
            {!details && !message && !detailsQuery.error && <p className="text-sm text-emerald-900/60">Checking authorization…</p>}
            {message && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{message}</p>}
            {detailsQuery.error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{detailsQuery.error.message}</p>}
            {details && <>
                <h1 className="text-xl font-bold text-emerald-950">Connect {details.client}?</h1>
                <p className="mt-2 text-sm leading-6 text-emerald-900/65">This client can use only your permitted school tools. Sensitive changes require approval in KryinEphor.</p>
                <div className="my-5 rounded-2xl bg-emerald-50 p-4 text-sm">
                    <p className="font-semibold text-emerald-950">Signed in as {details.email}</p>
                    <p className="mt-2 text-emerald-900/65">Access: {details.scope}</p>
                    <p className="mt-2 break-all text-xs text-emerald-900/65">School: {details.school_id ?? 'Select a school in each platform tool'}</p>
                    <p className="mt-2 break-all text-xs text-emerald-900/55">Return to: {details.redirect_uri}</p>
                </div>
                <div className="flex gap-3">
                    <button type="button" disabled={busy || detailsQuery.isFetching} onClick={() => void decide(false)} className="flex-1 rounded-xl border border-emerald-900/15 px-4 py-2.5 text-sm font-bold text-emerald-900 disabled:opacity-50">Deny</button>
                    <button type="button" disabled={busy || detailsQuery.isFetching} onClick={() => void decide(true)} className="flex-1 rounded-xl bg-emerald-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Connecting…' : 'Allow'}</button>
                </div>
            </>}
        </section>
    </main>;
}
