import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export type SubStatus = 'active' | 'payment_due' | 'locked' | 'archived' | 'unknown';

export interface SubscriptionState {
    status: SubStatus;
    schoolId: string | null;
    schoolName: string | null;
    nextDueDate: string | null;
    outstanding: number;
    planName: string | null;
    loading: boolean;
    refresh: () => Promise<void>;
}

const ALLOWED_WHEN_LOCKED = ['/login', '/', '/reset-password', '/billing', '/payment', '/support', '/finance'];

export function useSubscriptionGate(): SubscriptionState {
    const { user, role } = useAuth();
    const [state, setState] = useState<Omit<SubscriptionState, 'refresh'>>({
        status: 'unknown',
        schoolId: null,
        schoolName: null,
        nextDueDate: null,
        outstanding: 0,
        planName: null,
        loading: true,
    });

    const load = useCallback(async () => {
        if (!user?.id) { setState(s => ({ ...s, loading: false, status: 'unknown' })); return; }
        // Super admin is never gated
        if (role === 'superadmin') {
            setState({ status: 'active', schoolId: null, schoolName: null, nextDueDate: null, outstanding: 0, planName: null, loading: false });
            return;
        }
        try {
            const { data: prof } = await supabase
                .from('profiles')
                .select('school_id')
                .eq('id', user.id)
                .maybeSingle();
            const schoolId = prof?.school_id ?? null;
            if (!schoolId) { setState(s => ({ ...s, loading: false, status: 'active' })); return; }

            const { data } = await supabase
                .from('v_school_subscription_summary')
                .select('id, name, plan_name, next_due_date, subscription_status, outstanding_amount')
                .eq('id', schoolId)
                .maybeSingle();

            setState({
                status: (data?.subscription_status as SubStatus) || 'active',
                schoolId,
                schoolName: data?.name || null,
                nextDueDate: data?.next_due_date || null,
                outstanding: Number(data?.outstanding_amount || 0),
                planName: data?.plan_name || null,
                loading: false,
            });
        } catch {
            setState(s => ({ ...s, loading: false, status: 'active' }));
        }
    }, [user?.id, role]);

    useEffect(() => { load(); }, [load]);

    // Realtime refresh on school status changes
    useEffect(() => {
        if (!state.schoolId) return;
        const ch = supabase
            .channel(`sub-gate-${state.schoolId}`)
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'schools', filter: `id=eq.${state.schoolId}` },
                () => load())
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [state.schoolId, load]);

    return { ...state, refresh: load };
}

export function isPathAllowedWhenLocked(pathname: string): boolean {
    return ALLOWED_WHEN_LOCKED.some(p => pathname === p || pathname.startsWith(p + '/'));
}
