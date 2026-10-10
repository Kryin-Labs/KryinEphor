import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import type { PlatformSettings } from '../../lib/operations';
import { maintenanceView } from '../../lib/maintenance';
import LoginModal from './LoginModal';

export default function MaintenanceGate({ children }: { children: ReactNode }) {
    const { user, roles, loading, signOut } = useAuth();
    const superadmin = roles.includes('superadmin');
    const { pathname } = useLocation();
    const client = useQueryClient();
    const [loginOpen, setLoginOpen] = useState(false);
    const status = useQuery({ queryKey: ['platform-status', user?.id ?? 'visitor'], refetchInterval: 10_000,
        refetchIntervalInBackground: true, refetchOnWindowFocus: true,
        queryFn: async () => {
            const { data, error } = await supabase.rpc('fn_platform_status'); if (error) throw error;
            if (typeof data?.maintenance_enabled !== 'boolean') throw new Error('No saved platform status was returned.');
            return data as PlatformSettings;
        },
    });
    useEffect(() => { void client.invalidateQueries({ queryKey: ['platform-status'] }); }, [client, pathname]);
    useEffect(() => {
        if (typeof BroadcastChannel === 'undefined') return;
        const channel = new BroadcastChannel('platform-availability');
        channel.onmessage = () => { void client.invalidateQueries({ queryKey: ['platform-status'] }); };
        return () => channel.close();
    }, [client]);
    const view = maintenanceView({ enabled: !!status.data?.maintenance_enabled, superadmin, path: pathname });
    const sidebarPage = superadmin && !['/', '/homepage-v2', '/reset-password', '/oauth/consent', '/blog/best-school-management-software'].includes(pathname);
    if (superadmin && (view === 'open' || status.error)) return <>{status.error && <p role="alert" className="bg-amber-50 p-3 text-center text-sm">Maintenance status could not be checked. <Link to="/settings" className="underline">Open settings</Link></p>}{children}</>;
    if (loading || status.isPending) return <div role="status" className="grid min-h-screen place-items-center">Checking platform availability…</div>;
    if (view === 'banner') return <><div role="status" className={`sticky top-0 z-40 flex flex-wrap items-center justify-center gap-3 bg-amber-100 px-4 py-3 text-sm text-amber-950 ${sidebarPage ? 'lg:ml-72' : ''}`}><Wrench size={17} />
        <strong>Maintenance is enabled</strong><span>{superadmin ? 'School and visitor access is paused. You have superadmin access.' : status.data?.maintenance_message}</span>
        {superadmin && <Link to="/settings" className="font-bold underline">Manage maintenance</Link>}</div>{children}</>;
    if (status.error || view === 'blocked') return <div className="grid min-h-screen place-items-center bg-background p-6">
        <section role="dialog" aria-modal="true" aria-labelledby="maintenance-title" className="clay-card w-full max-w-lg space-y-5 p-8 text-center">
            <Wrench className="mx-auto text-amber-700" size={36} /><h1 id="maintenance-title" className="text-2xl font-bold">{status.error ? 'Platform status unavailable' : 'Scheduled maintenance'}</h1>
            <p role={status.error ? 'alert' : 'status'} className="text-sm text-muted">{status.error ? 'We could not check platform availability. Please retry.' : status.data?.maintenance_message}</p>
            <p className="text-xs text-muted">This notice applies across the platform. Access resumes automatically when maintenance ends.</p>
            {status.data?.support_email && <a href={`mailto:${status.data.support_email}`} className="block text-sm text-primary underline">Contact support</a>}
            <div className="flex flex-wrap justify-center gap-4"><button disabled={status.isFetching} onClick={() => void status.refetch()} className="clay-btn px-4 py-2 text-sm">{status.isFetching ? 'Checking…' : 'Check again'}</button>
                {user ? <button onClick={() => void signOut()} className="text-sm underline">Sign out</button> : <button onClick={() => setLoginOpen(true)} className="text-sm underline">Administrator sign in</button>}</div>
        </section>{!user && <LoginModal isOpen={loginOpen} onClose={() => setLoginOpen(false)} />}
    </div>;
    return children;
}
