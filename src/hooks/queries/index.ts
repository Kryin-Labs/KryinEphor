/**
 * Shared React Query hooks.
 *
 * Every hook here owns a stable queryKey so React Query dedupes concurrent
 * calls, caches results across mounts (staleTime), and refetches
 * predictably on mutation via `queryClient.invalidateQueries`.
 *
 * QueryClient defaults (see src/main.tsx):
 *   staleTime: 30s · gcTime: 5m · refetchOnWindowFocus: false · retry: 1
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '../../lib/supabase';

import { qk as centralQk } from '../../lib/queryKeys';

// ── keys ─────────────────────────────────────────────────────────────────────
export const qk = {
    ...centralQk,
    schoolsSummary: ['schools-summary'] as const,
    adminDashboardStats: ['admin-dashboard-stats'] as const,
    superAdminMetrics: ['super-admin-metrics'] as const,
    notifications: (userId: string) => ['notifications', userId] as const,
    dashboardActivity: (userId: string) => ['dashboard-activity', userId] as const,
    userManagement: ['user-management-bundle'] as const,
    invoicesPage: (schoolId: string, status: string, q: string, page: number, pageSize: number) =>
        ['invoices', schoolId, status, q, page, pageSize] as const,
    receiptsPage: (schoolId: string, q: string, page: number, pageSize: number) =>
        ['receipts', schoolId, q, page, pageSize] as const,
    schoolStudents: (schoolId: string) => ['school-students', schoolId] as const,
};

// ── super-admin: schools summary view ────────────────────────────────────────
export interface SchoolSummaryRow {
    id: string;
    name: string;
    subdomain: string | null;
    email_domain: string | null;
    subscription_tier: string | null;
    status: string | null;
    created_at: string | null;
    max_students: number | null;
    student_count: number;
    admin_count: number;
    revenue: number;
    admin_id: string | null;
    admin_email: string | null;
    admin_name: string | null;
    [key: string]: unknown;
}

export function useSchoolsSummary() {
    return useQuery({
        queryKey: qk.schoolsSummary,
        queryFn: async (): Promise<SchoolSummaryRow[]> => {
            const { data, error } = await supabase
                .from('school_summary_metrics' as never)
                .select('*')
                .order('created_at', { ascending: false });
            if (error) throw error;
            return ((data as unknown as SchoolSummaryRow[]) ?? [])
                .map((s) => ({
                    ...s,
                    student_count: Number(s.student_count) || 0,
                    revenue: Number(s.revenue) || 0,
                    admin_email: s.admin_email || 'No admin assigned',
                    admin_name: s.admin_name || '',
                }))
                // Security: drop schools without a domain, or where the admin
                // email doesn't match the school's domain.
                .filter((s) => {
                    if (!s.email_domain) return false;
                    if (!s.admin_email || s.admin_email === 'No admin assigned') return true;
                    return String(s.admin_email).toLowerCase()
                        .endsWith('@' + String(s.email_domain).toLowerCase());
                });
        },
    });
}

// ── admin dashboard RPC ──────────────────────────────────────────────────────
export interface AdminDashboardStats {
    students: number;
    teachers: number;
    classes: number;
    month_revenue: number;
    pending_amount: number;
    overdue_amount: number;
    paid_invoices: number;
    pending_invoices: number;
    collection_pct: number;
    top_payers: { name: string; student_id: string; total_paid: number }[];
}

export function useAdminDashboardStats(enabled = true) {
    return useQuery({
        queryKey: qk.adminDashboardStats,
        enabled,
        queryFn: async (): Promise<AdminDashboardStats | null> => {
            const { data, error } = await supabase.rpc('fn_admin_dashboard_stats' as never);
            if (error) throw error;
            return (data as unknown as AdminDashboardStats) ?? null;
        },
    });
}

// ── super-admin dashboard metrics rollup ─────────────────────────────────────
export interface DashboardMetricRow {
    metric_key: string;
    metric_value: number;
    previous_value: number | null;
    updated_at: string | null;
}

export function useSuperAdminMetrics(enabled = true) {
    return useQuery({
        queryKey: qk.superAdminMetrics,
        enabled,
        queryFn: async (): Promise<DashboardMetricRow[]> => {
            const { data, error } = await supabase
                .from('dashboard_metrics')
                .select('metric_key,metric_value,previous_value,updated_at')
                .is('school_id', null);
            if (error) throw error;
            return (data as DashboardMetricRow[]) ?? [];
        },
    });
}

// ── notifications feed (per user) ────────────────────────────────────────────
export interface NotificationRow {
    id: string;
    title: string;
    message: string;
    type: string | null;
    is_read: boolean | null;
    action_url: string | null;
    created_at: string | null;
}

export function useNotifications(userId: string | undefined | null, limit = 30) {
    const qc = useQueryClient();
    const query = useQuery({
        queryKey: userId ? qk.notifications(userId) : ['notifications', 'anon'],
        enabled: !!userId,
        queryFn: async (): Promise<NotificationRow[]> => {
            const { data, error } = await supabase
                .from('notifications')
                .select('id,title,message,type,is_read,action_url,created_at')
                .eq('user_id', userId!)
                .is('deleted_at', null)
                .order('created_at', { ascending: false })
                .limit(limit);
            if (error) throw error;
            return (data as NotificationRow[]) ?? [];
        },
    });

    // Realtime: invalidate on any change to this user's notifications.
    useEffect(() => {
        if (!userId) return;
        const channel = supabase
            .channel(`notifications-live:${userId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
                () => { qc.invalidateQueries({ queryKey: qk.notifications(userId) }); },
            )
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [userId, qc]);

    return query;
}

// ── user management bundle (profiles + schools + permissions) ────────────────
export interface UMProfile {
    id: string; full_name: string | null; role: string; school_id: string | null;
    is_active: boolean; metadata: unknown; updated_at: string; email: string;
    avatar_url: string | null; recovery_email: string | null; recovery_email_verified: boolean | null;
    roles?: string[];
    student_status?: string | null;
}
export interface UMSchool { id: string; name: string; email_domain: string | null; combined_parent_student_account: boolean; }
export interface UMPermission { id: string; [k: string]: unknown; }

export function useUserManagementData() {
    return useQuery({
        queryKey: qk.userManagement,
        queryFn: async () => {
            const [profilesRes, schoolsRes, permsRes, userRolesRes] = await Promise.all([
                supabase.from('profiles').select('id,full_name,role,school_id,is_active,metadata,updated_at,email,avatar_url,recovery_email,recovery_email_verified,student_status'),
                supabase.from('schools').select('id, name, email_domain, combined_parent_student_account').is('deleted_at', null),
                supabase.from('permissions').select('*'),
                supabase.from('user_roles').select('user_id, role'),
            ]);
            if (profilesRes.error) throw profilesRes.error;
            if (schoolsRes.error) throw schoolsRes.error;
            if (permsRes.error) throw permsRes.error;

            const rolesByUser = new Map<string, string[]>();
            if (userRolesRes?.data) {
                for (const row of (userRolesRes.data as { user_id: string; role: string }[])) {
                    if (!rolesByUser.has(row.user_id)) {
                        rolesByUser.set(row.user_id, []);
                    }
                    rolesByUser.get(row.user_id)!.push(row.role);
                }
            }

            const rawProfiles = (profilesRes.data ?? []) as UMProfile[];
            const profiles = rawProfiles.map(p => {
                const assigned = rolesByUser.get(p.id) || [];
                const allRoles = Array.from(new Set([p.role, ...assigned].filter(Boolean)));
                return {
                    ...p,
                    roles: allRoles,
                };
            });

            return {
                profiles,
                schools: (schoolsRes.data ?? []) as UMSchool[],
                permissions: (permsRes.data ?? []) as UMPermission[],
            };
        },
    });
}

// ── school teachers (including multi-role users with teacher tag) ───────────
export interface SchoolTeacherOption {
    id: string;
    full_name: string | null;
    email: string;
    role: string;
    roles?: string[];
    avatar_url?: string | null;
    is_active?: boolean | null;
    staff_name?: string | null;
    designation?: string | null;
}

export async function fetchSchoolTeachers(schoolId: string): Promise<SchoolTeacherOption[]> {
    if (!schoolId) return [];

    // Query active staff memberships, teacher profiles, and user_roles in parallel
    const [staffRes, primaryTeachersRes, additionalRolesRes] = await Promise.all([
        supabase
            .from('employees')
            .select('id, profile_id, school_id, designation, department, status, staff_person_name')
            .eq('school_id', schoolId)
            .eq('status', 'active')
            .is('deleted_at', null),
        supabase
            .from('profiles')
            .select('id, full_name, email, role, avatar_url, is_active')
            .eq('school_id', schoolId)
            .is('deleted_at', null)
            .eq('role', 'teacher')
            .limit(300),
        supabase
            .from('user_roles')
            .select('user_id, role')
            .eq('role', 'teacher'),
    ]);

    const teacherMap = new Map<string, SchoolTeacherOption>();
    const teacherUserRoleSet = new Set((additionalRolesRes.data ?? []).map(r => r.user_id));
    const staffByProfileId = new Map<string, { staff_person_name: string | null; designation: string | null }>();

    (staffRes.data ?? []).forEach(emp => {
        staffByProfileId.set(emp.profile_id, {
            staff_person_name: emp.staff_person_name,
            designation: emp.designation,
        });
    });

    // 1. Process staff records with teaching capacity
    if (staffByProfileId.size > 0) {
        const staffProfileIds = Array.from(staffByProfileId.keys());
        const { data: staffProfiles } = await supabase
            .from('profiles')
            .select('id, full_name, email, role, avatar_url, is_active')
            .eq('school_id', schoolId)
            .in('id', staffProfileIds)
            .is('deleted_at', null);

        (staffProfiles ?? []).forEach(p => {
            if (p.is_active === false) return;
            const staff = staffByProfileId.get(p.id);
            const isTeacher =
                p.role === 'teacher' ||
                teacherUserRoleSet.has(p.id) ||
                (staff?.designation?.toLowerCase().includes('teacher') ?? true);

            if (isTeacher) {
                const canonicalName = staff?.staff_person_name?.trim() || p.full_name?.trim() || p.email?.split('@')[0] || 'Teacher';
                teacherMap.set(p.id, {
                    id: p.id,
                    full_name: canonicalName,
                    email: p.email,
                    role: p.role === 'student' ? 'teacher' : p.role,
                    roles: Array.from(new Set([p.role, 'teacher'])).filter(r => r !== 'student'),
                    avatar_url: p.avatar_url,
                    is_active: p.is_active,
                    staff_name: canonicalName,
                    designation: staff?.designation || 'Teacher',
                });
            }
        });
    }

    // 2. Add primary teacher profiles (fallback / existing accounts)
    (primaryTeachersRes.data ?? []).forEach(p => {
        if (teacherMap.has(p.id) || p.is_active === false) return;
        const staff = staffByProfileId.get(p.id);
        const canonicalName = staff?.staff_person_name?.trim() || p.full_name?.trim() || p.email?.split('@')[0] || 'Teacher';
        teacherMap.set(p.id, {
            id: p.id,
            full_name: canonicalName,
            email: p.email,
            role: 'teacher',
            roles: ['teacher'],
            avatar_url: p.avatar_url,
            is_active: p.is_active,
            staff_name: canonicalName,
            designation: staff?.designation || 'Teacher',
        });
    });

    // 3. Add profiles with additional 'teacher' role in user_roles (strictly excluding pure students without staff records)
    const extraUserIds = Array.from(teacherUserRoleSet).filter(uid => !teacherMap.has(uid));
    if (extraUserIds.length > 0) {
        const { data: extraProfiles } = await supabase
            .from('profiles')
            .select('id, full_name, email, role, avatar_url, is_active')
            .eq('school_id', schoolId)
            .in('id', extraUserIds)
            .neq('role', 'student')
            .is('deleted_at', null);

        (extraProfiles ?? []).forEach(p => {
            if (p.is_active === false) return;
            const staff = staffByProfileId.get(p.id);
            const canonicalName = staff?.staff_person_name?.trim() || p.full_name?.trim() || p.email?.split('@')[0] || 'Teacher';
            teacherMap.set(p.id, {
                id: p.id,
                full_name: canonicalName,
                email: p.email,
                role: p.role,
                roles: Array.from(new Set([p.role, 'teacher'])).filter(r => r !== 'student'),
                avatar_url: p.avatar_url,
                is_active: p.is_active,
                staff_name: canonicalName,
                designation: staff?.designation || 'Teacher',
            });
        });
    }

    return Array.from(teacherMap.values()).sort((a, b) =>
        (a.full_name || '').localeCompare(b.full_name || '')
    );
}

export function useSchoolTeachers(schoolId: string | null | undefined) {
    return useQuery({
        queryKey: qk.teachers.bySchool(schoolId ?? ''),
        enabled: !!schoolId,
        queryFn: () => fetchSchoolTeachers(schoolId!),
    });
}

// ── invoices with server-side pagination ─────────────────────────────────────
export interface InvoiceRow {
    id: string; invoice_number: string | null; student_id: string | null;
    amount: number; paid_amount: number | null; late_fee: number | null;
    status: string; due_date: string; period_label: string | null;
    created_at: string; discount: number | null;
}

export function useInvoicesPage(
    schoolId: string,
    status: string,
    q: string,
    page: number,
    pageSize = 50,
) {
    return useQuery({
        queryKey: qk.invoicesPage(schoolId, status, q, page, pageSize),
        enabled: !!schoolId,
        placeholderData: (prev) => prev,
        queryFn: async () => {
            const from = page * pageSize;
            const to = from + pageSize - 1;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let query: any = supabase
                .from('invoices')
                .select(
                    'id,invoice_number,student_id,amount,paid_amount,late_fee,status,due_date,period_label,created_at,discount',
                    { count: 'exact' },
                )
                .eq('school_id', schoolId)
                .is('deleted_at', null)
                .order('created_at', { ascending: false })
                .range(from, to);
            if (status !== 'all') query = query.eq('status', status);
            if (q) query = query.ilike('invoice_number', `%${q}%`);
            const { data, count, error } = await query;
            if (error) throw error;
            return { rows: (data ?? []) as InvoiceRow[], total: count ?? 0 };
        },
    });
}

// ── receipts (payment transactions) with server-side pagination ──────────────
export interface ReceiptRow {
    id: string; invoice_id: string | null; student_id: string | null; amount: number;
    payment_method: string | null; reference_number: string | null; created_at: string; type: string;
}

export function useReceiptsPage(schoolId: string, q: string, page: number, pageSize = 50) {
    return useQuery({
        queryKey: qk.receiptsPage(schoolId, q, page, pageSize),
        enabled: !!schoolId,
        placeholderData: (prev) => prev,
        queryFn: async () => {
            const from = page * pageSize;
            const to = from + pageSize - 1;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let query: any = supabase
                .from('transactions')
                .select(
                    'id,invoice_id,student_id,amount,payment_method,reference_number,created_at,type',
                    { count: 'exact' },
                )
                .eq('school_id', schoolId)
                .eq('type', 'payment')
                .order('created_at', { ascending: false })
                .range(from, to);
            if (q) query = query.ilike('reference_number', `%${q}%`);
            const { data, count, error } = await query;
            if (error) throw error;
            return { rows: (data ?? []) as ReceiptRow[], total: count ?? 0 };
        },
    });
}

// ── school students (cached lookup for invoices/receipts joins) ──────────────
export function useSchoolStudents(schoolId: string) {
    return useQuery({
        queryKey: qk.schoolStudents(schoolId),
        enabled: !!schoolId,
        staleTime: 60_000,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('profiles')
                .select('id,full_name,email')
                .eq('school_id', schoolId)
                .limit(2000);
            if (error) throw error;
            return (data ?? []) as { id: string; full_name: string | null; email: string }[];
        },
    });
}
