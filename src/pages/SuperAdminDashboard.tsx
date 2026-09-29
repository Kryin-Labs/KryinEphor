import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    School,
    Users,
    ArrowUp,
    ArrowDown,
    Plus,
    Database,
    AlertTriangle,
    ShieldAlert,
    FileSignature,
    Clock,
    Crown,
    Eye,
    X,
    DollarSign,
    Activity,
    UserCheck,
    Shield,
    MessageSquare,
    Calendar,
    Bell,
    Flag,
    Briefcase,
    Mail,
    Key,
    Edit2,
    Loader2,
    CheckCircle2,
    Building2,
    Save,
    Trash2,
    ChevronDown,
    Terminal,
    Maximize2,
    RefreshCw
} from 'lucide-react';
import Sidebar from '../components/dashboard/Sidebar';
import AnnouncementPreview from '../components/announcements/AnnouncementPreview';
import Header from '../components/dashboard/Header';
import { supabase } from '../lib/supabase';
import { getFunctionErrorMessage } from '../lib/functionErrors';
import { formatDistanceToNow } from 'date-fns';

interface Stat {
    label: string;
    value: string;
    change: string;
    trend: 'up' | 'down' | 'neutral';
    icon: React.ElementType;
    color: string;
    bg: string;
}

interface SchoolNetwork {
    id: string;
    name: string;
    students: number;
    maxStudents: number;
    status: string;
    tier: string;
    revenue: number;
    admins: number;
}

interface SystemLog {
    id: string;
    action: string;
    message: string;
    time: string;
    raw_time: string;
    type: 'success' | 'info' | 'warning' | 'danger';
    icon: React.ElementType;
    ip_address: string;
    status: string;
    details: unknown;
    school_id: string | null;
    school_name: string;
    user_name: string;
    user_agent: string;
    level: string;
    category: string;
}

interface QuickStat {
    label: string;
    value: string | number;
    icon: React.ElementType;
    color: string;
}

interface AdminData {
    id: string;
    email: string;
    full_name: string;
    role: string;
    school_id: string | null;
    school_name: string;
}

const SuperAdminDashboard: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [userName, setUserName] = useState('System Core');
    const [systemHealth, setSystemHealth] = useState<'operational' | 'degraded' | 'down'>('operational');
    const [healthDetails, setHealthDetails] = useState<{ alerts: { title?: string | null; message?: string | null; created_at: string }[], errors: { action?: string | null; message?: string | null; created_at: string }[] }>({ alerts: [], errors: [] });
    const [showHealthTooltip, setShowHealthTooltip] = useState(false);

    const [stats, setStats] = useState<Stat[]>([
        { label: "Total Schools", value: "0", change: "—", trend: "neutral", icon: School, color: "text-blue-600", bg: "bg-blue-50" },
        { label: "Total Students", value: "0", change: "—", trend: "neutral", icon: Users, color: "text-teal-600", bg: "bg-teal-50" },
        { label: "Total Revenue", value: "₹0", change: "—", trend: "neutral", icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-50" },
        { label: "Active Admins", value: "0", change: "—", trend: "neutral", icon: ShieldAlert, color: "text-amber-600", bg: "bg-amber-50" }
    ]);

    const [schools, setSchools] = useState<SchoolNetwork[]>([]);
    const [logs, setLogs] = useState<SystemLog[]>([]);
    const [allLogs, setAllLogs] = useState<SystemLog[]>([]);
    const [selectedLog, setSelectedLog] = useState<SystemLog | null>(null);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [showLogsPanel, setShowLogsPanel] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deletingLogs, setDeletingLogs] = useState(false);
    const [chartData, setChartData] = useState<number[]>(new Array(12).fill(0));
    const [chartLabels, setChartLabels] = useState<string[]>([]);

    // Quick stats from new tables
    const [quickStats, setQuickStats] = useState<QuickStat[]>([]);

    // Admin management state
    const [showAdminsModal, setShowAdminsModal] = useState(false);
    const [allAdmins, setAllAdmins] = useState<AdminData[]>([]);
    const [adminsLoading, setAdminsLoading] = useState(false);
    const [editingAdmin, setEditingAdmin] = useState<AdminData | null>(null);
    const [editAdminEmail, setEditAdminEmail] = useState('');
    const [editAdminPassword, setEditAdminPassword] = useState('');
    const [editAdminSchoolId, setEditAdminSchoolId] = useState('');
    const [editAdminRole, setEditAdminRole] = useState('');
    const [editAdminSaving, setEditAdminSaving] = useState(false);
    const [editAdminError, setEditAdminError] = useState('');
    const [editAdminSuccess, setEditAdminSuccess] = useState('');
    const [allSchoolsList, setAllSchoolsList] = useState<{ id: string; name: string }[]>([]);
    const [allRolesList, setAllRolesList] = useState<{ id: string; name: string; permissions: string[] }[]>([]);

    const fetchDashboardData = async () => {
        try {
            setLoading(true);

            // ─── Fetch current user name ───
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('full_name')
                    .eq('id', user.id)
                    .single();
                if (profile?.full_name) setUserName(profile.full_name);
            }

            // ─── 1. KPI Counts (current month) ───
            const now = new Date();
            const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
            const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
            const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

            // Schools
            const { count: schoolsCount } = await supabase
                .from('schools')
                .select('*', { count: 'exact', head: true })
                .is('deleted_at', null);

            const { count: schoolsLastMonth } = await supabase
                .from('schools')
                .select('*', { count: 'exact', head: true })
                .is('deleted_at', null)
                .lte('created_at', lastMonthEnd);

            // Students
            const { count: studentsCount } = await supabase
                .from('profiles')
                .select('*', { count: 'exact', head: true })
                .in('role', ['student', 'Student', 'Parent/Student'])
                .is('deleted_at', null);

            const { count: studentsLastMonth } = await supabase
                .from('profiles')
                .select('*', { count: 'exact', head: true })
                .in('role', ['student', 'Student', 'Parent/Student'])
                .is('deleted_at', null)
                .lte('created_at', lastMonthEnd);

            // Revenue (from transactions table first, fallback to invoices)
            const { data: revenueData } = await supabase
                .from('invoices')
                .select('amount, created_at')
                .eq('status', 'paid')
                .is('deleted_at', null);

            const { data: transactionsData } = await supabase
                .from('transactions')
                .select('amount, type, created_at')
                .eq('status', 'completed');

            // Use transactions if available, otherwise invoices
            let totalRevenue = 0;
            let thisMonthRevenue = 0;
            let lastMonthRevenue = 0;

            if (transactionsData && transactionsData.length > 0) {
                transactionsData.forEach(t => {
                    const amt = t.type === 'refund' ? -Number(t.amount) : Number(t.amount);
                    totalRevenue += amt;
                    const d = new Date(t.created_at);
                    if (d >= new Date(thisMonthStart)) thisMonthRevenue += amt;
                    if (d >= new Date(lastMonthStart) && d <= new Date(lastMonthEnd)) lastMonthRevenue += amt;
                });
            } else {
                (revenueData || []).forEach(inv => {
                    totalRevenue += Number(inv.amount);
                    const d = new Date(inv.created_at);
                    if (d >= new Date(thisMonthStart)) thisMonthRevenue += Number(inv.amount);
                    if (d >= new Date(lastMonthStart) && d <= new Date(lastMonthEnd)) lastMonthRevenue += Number(inv.amount);
                });
            }

            // Admins
            const { count: adminsCount } = await supabase
                .from('profiles')
                .select('*', { count: 'exact', head: true })
                .in('role', ['admin', 'Admin', 'superadmin', 'SuperAdmin', 'Superadmin'])
                .is('deleted_at', null);

            const { count: adminsLastMonth } = await supabase
                .from('profiles')
                .select('*', { count: 'exact', head: true })
                .in('role', ['admin', 'Admin', 'superadmin', 'SuperAdmin', 'Superadmin'])
                .is('deleted_at', null)
                .lte('created_at', lastMonthEnd);

            // Calculate real percentage changes
            const calcChange = (current: number, previous: number): { change: string; trend: 'up' | 'down' | 'neutral' } => {
                if (previous === 0 && current === 0) return { change: '—', trend: 'neutral' };
                if (previous === 0) return { change: '—', trend: 'neutral' };
                const pct = ((current - previous) / previous) * 100;
                if (pct === 0) return { change: '—', trend: 'neutral' };
                return {
                    change: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`,
                    trend: pct > 0 ? 'up' : 'down'
                };
            };

            const schoolChange = calcChange(schoolsCount || 0, schoolsLastMonth || 0);
            const studentChange = calcChange(studentsCount || 0, studentsLastMonth || 0);
            const revenueChange = calcChange(thisMonthRevenue, lastMonthRevenue);
            const adminChange = calcChange(adminsCount || 0, adminsLastMonth || 0);

            setStats([
                { label: "Total Schools", value: (schoolsCount || 0).toString(), ...schoolChange, icon: School, color: "text-blue-600", bg: "bg-blue-50" },
                { label: "Total Students", value: (studentsCount || 0).toLocaleString(), ...studentChange, icon: Users, color: "text-teal-600", bg: "bg-teal-50" },
                { label: "Total Revenue", value: `₹${totalRevenue.toLocaleString()}`, ...revenueChange, icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-50" },
                { label: "Active Admins", value: (adminsCount || 0).toString(), ...adminChange, icon: ShieldAlert, color: "text-amber-600", bg: "bg-amber-50" }
            ]);

            // ─── 2. Monthly Revenue Chart (last 12 months) ───
            const monthlyRevenue = new Array(12).fill(0);
            const labels: string[] = [];
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

            for (let i = 11; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                labels.push(monthNames[d.getMonth()]);
            }

            const allPayments = transactionsData && transactionsData.length > 0
                ? transactionsData.map(t => ({ amount: t.type === 'refund' ? -Number(t.amount) : Number(t.amount), created_at: t.created_at }))
                : (revenueData || []).map(inv => ({ amount: Number(inv.amount), created_at: inv.created_at }));

            allPayments.forEach(p => {
                const date = new Date(p.created_at);
                const monthDiff = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
                if (monthDiff >= 0 && monthDiff < 12) {
                    monthlyRevenue[11 - monthDiff] += p.amount;
                }
            });

            setChartData(monthlyRevenue);
            setChartLabels(labels);

            // ─── 3. School Network (real data) ───
            const { data: viewData, error: viewError } = await supabase
                .from('school_summary_metrics')
                .select('id, name, status, subscription_tier, max_students, student_count, admin_count, revenue')
                .order('created_at', { ascending: false })
                .limit(8);

            if (viewError) throw viewError;

            const enhanced: SchoolNetwork[] = (viewData || []).map((s) => ({
                id: s.id,
                name: s.name,
                students: Number(s.student_count) || 0,
                maxStudents: s.max_students || 500,
                status: (s.status || 'active').charAt(0).toUpperCase() + (s.status || 'active').slice(1),
                tier: s.subscription_tier || 'starter',
                revenue: Number(s.revenue) || 0,
                admins: Number(s.admin_count) || 0
            }));
            setSchools(enhanced);

            // ─── 4. Quick Stats from new tables ───
            const { count: totalTeachers } = await supabase
                .from('profiles')
                .select('*', { count: 'exact', head: true })
                .eq('role', 'teacher')
                .is('deleted_at', null);

            const { count: totalEmployees } = await supabase
                .from('employees')
                .select('*', { count: 'exact', head: true })
                .is('deleted_at', null);

            const { count: pendingLeaves } = await supabase
                .from('leave_requests')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending');

            const { count: activeFeatures } = await supabase
                .from('feature_flags')
                .select('*', { count: 'exact', head: true })
                .eq('is_enabled', true);

            const { count: totalRoles } = await supabase
                .from('roles')
                .select('*', { count: 'exact', head: true });

            const { count: totalPermissions } = await supabase
                .from('permissions')
                .select('*', { count: 'exact', head: true });

            const { count: unreadNotifs } = await supabase
                .from('notifications')
                .select('*', { count: 'exact', head: true })
                .eq('is_read', false)
                .is('deleted_at', null);

            const { count: openInquiries } = await supabase
                .from('inquiries')
                .select('*', { count: 'exact', head: true })
                .in('status', ['new', 'contacted', 'follow_up']);

            setQuickStats([
                { label: 'Teachers', value: totalTeachers || 0, icon: UserCheck, color: 'text-indigo-600' },
                { label: 'Employees', value: totalEmployees || 0, icon: Briefcase, color: 'text-purple-600' },
                { label: 'Pending Leaves', value: pendingLeaves || 0, icon: Calendar, color: 'text-orange-600' },
                { label: 'Active Features', value: activeFeatures || 0, icon: Flag, color: 'text-cyan-600' },
                { label: 'Roles', value: totalRoles || 0, icon: Shield, color: 'text-violet-600' },
                { label: 'Permissions', value: totalPermissions || 0, icon: Activity, color: 'text-rose-600' },
                { label: 'Unread Alerts', value: unreadNotifs || 0, icon: Bell, color: 'text-red-600' },
                { label: 'Open Inquiries', value: openInquiries || 0, icon: MessageSquare, color: 'text-sky-600' },
            ]);

            // ─── 5. System Health Check ───
            const { data: criticalAlertsData, count: criticalAlertsCount } = await supabase
                .from('system_alerts')
                .select('title, message, created_at', { count: 'exact' })
                .eq('severity', 'critical')
                .eq('is_resolved', false)
                .order('created_at', { ascending: false })
                .limit(5);

            const { data: errorLogsData, count: errorLogsCount } = await supabase
                .from('system_logs')
                .select('action, message, created_at, school_id', { count: 'exact' })
                .eq('level', 'error')
                .gte('created_at', new Date(Date.now() - 3600000).toISOString())
                .order('created_at', { ascending: false })
                .limit(5);

            setHealthDetails({
                alerts: criticalAlertsData || [],
                errors: errorLogsData || []
            });

            if ((criticalAlertsCount || 0) > 0) {
                setSystemHealth('down');
            } else if ((errorLogsCount || 0) > 5) {
                setSystemHealth('degraded');
            } else {
                setSystemHealth('operational');
            }

            // Fetch fresh activity logs
            const { data: logsData } = await supabase
                .from('system_logs')
                .select('*, schools!school_id(name)')
                .order('created_at', { ascending: false })
                .limit(100); // Get more for expanded view

            // Fetch profiles for logs
            const userIds = Array.from(new Set((logsData || []).map(l => l.user_id).filter(Boolean)));
            const { data: profilesData } = await supabase
                .from('profiles')
                .select('id, full_name')
                .in('id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000']);

            const profileMap = (profilesData || []).reduce((acc: Record<string, string | null>, p) => {
                acc[p.id] = p.full_name;
                return acc;
            }, {});

            const iconMap: Record<string, React.ElementType> = {
                'auth': ShieldAlert,
                'audit': FileSignature,
                'tenant': Plus,
                'error': AlertTriangle,
                'system': Database
            };

            const typeMap: Record<string, SystemLog['type']> = {
                'auth': 'info',
                'audit': 'info',
                'tenant': 'success',
                'error': 'danger',
                'system': 'info'
            };

            const transformedLogs: SystemLog[] = (logsData || []).map(l => ({
                id: l.id,
                action: l.action || 'System Event',
                message: l.message,
                time: formatDistanceToNow(new Date(l.created_at)) + ' ago',
                raw_time: new Date(l.created_at).toLocaleString(),
                type: (l.status === 'failed' || l.status === 'error') ? 'danger' : (typeMap[l.category] || 'info'),
                icon: iconMap[l.category] || Database,
                ip_address: l.ip_address || '—',
                status: l.status || 'success',
                details: l.details || {},
                school_id: l.school_id,
                school_name: l.schools?.name || 'Platform Core',
                user_name: (l.user_id ? profileMap[l.user_id] : null) || 'System',
                user_agent: l.user_agent || '—',
                level: l.level || 'info',
                category: l.category || 'system'
            }));

            setAllLogs(transformedLogs);
            setLogs(transformedLogs.slice(0, 12));

        } catch (err) {
            console.error("Dashboard Load Error:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDashboardData();
    }, []);

    const handleDeleteAllLogs = async () => {
        try {
            setDeletingLogs(true);
            const { error } = await supabase.from('system_logs').delete().not('id', 'is', null);
            if (error) throw error;
            setAllLogs([]);
            setLogs([]);
            setShowDeleteConfirm(false);
        } catch (err) {
            console.error("Error deleting logs:", err);
        } finally {
            setDeletingLogs(false);
        }
    };

    const fetchAllAdmins = async () => {
        setAdminsLoading(true);
        try {
            // Fetch all admins
            const { data: adminsData } = await supabase
                .from('profiles')
                .select('id, email, full_name, role, school_id')
                .in('role', ['admin', 'Admin'])
                .is('deleted_at', null)
                .order('full_name');

            // Fetch all schools for mapping
            const { data: schoolsData } = await supabase
                .from('schools')
                .select('id, name')
                .is('deleted_at', null);

            // Fetch all roles with permissions
            const { data: rolesData } = await supabase
                .from('roles')
                .select('id, name, permissions')
                .order('name');

            setAllRolesList((rolesData || []).map(r => ({
                id: r.id,
                name: r.name,
                permissions: r.permissions || []
            })));

            const schoolMap = new Map((schoolsData || []).map(s => [s.id, s.name]));
            setAllSchoolsList(schoolsData || []);

            const enriched: AdminData[] = (adminsData || []).map(a => ({
                id: a.id,
                email: a.email || '',
                full_name: a.full_name || 'Unknown',
                role: a.role,
                school_id: a.school_id,
                school_name: a.school_id ? schoolMap.get(a.school_id) || 'Unknown School' : 'Unassigned'
            }));

            setAllAdmins(enriched);
        } catch (err) {
            console.error('Error fetching admins:', err);
        } finally {
            setAdminsLoading(false);
        }
    };

    const openAdminsModal = () => {
        setShowAdminsModal(true);
        fetchAllAdmins();
    };

    const startEditAdmin = (admin: AdminData) => {
        setEditingAdmin(admin);
        setEditAdminEmail(admin.email);
        setEditAdminPassword('');
        setEditAdminSchoolId(admin.school_id || '');
        setEditAdminRole(admin.role || '');
        setEditAdminError('');
        setEditAdminSuccess('');
    };

    const handleSaveAdmin = async () => {
        if (!editingAdmin) return;
        setEditAdminSaving(true);
        setEditAdminError('');
        setEditAdminSuccess('');

        try {
            // Verify session is active (per SCHEMARULE.md §6)
            const { data: { user: currentUser }, error: sessionErr } = await supabase.auth.getUser();
            if (sessionErr || !currentUser) throw new Error('No active session. Please log in again.');

            const body: Record<string, string> = { adminId: editingAdmin.id };
            if (editAdminEmail !== editingAdmin.email) body.email = editAdminEmail;
            if (editAdminPassword) body.password = editAdminPassword;
            if (editAdminSchoolId !== (editingAdmin.school_id || '')) body.schoolId = editAdminSchoolId;
            if (editAdminRole !== editingAdmin.role) body.role = editAdminRole;

            // SDK automatically sends Authorization header — do NOT add manual header
            const { data: fnData, error: fnError } = await supabase.functions.invoke('update_admin', {
                body
            });

            if (fnError) {
                const realError = await getFunctionErrorMessage(fnError, 'Failed to update admin');
                throw new Error(realError);
            }
            if (fnData?.error) throw new Error(fnData.error);

            // NOTE: role + permissions changes are now applied server-side by
            // the `update_admin` edge function (which writes role into the
            // profile under the service-role key). Client-side direct
            // `profiles.update` for role/permissions has been removed in
            // Phase 3 backend-boundary hardening.

            setEditAdminSuccess('Admin updated successfully!');
            setTimeout(() => {
                setEditingAdmin(null);
                fetchAllAdmins();
            }, 1000);
        } catch (err) {
            setEditAdminError(err instanceof Error ? err.message : 'Failed to update admin');
        } finally {
            setEditAdminSaving(false);
        }
    };

    const healthConfig = {
        operational: { label: 'All Systems Operational', color: 'bg-emerald-50 text-emerald-700 border-emerald-100', dot: 'bg-emerald-500', ping: 'bg-emerald-400' },
        degraded: { label: 'Degraded Performance', color: 'bg-amber-50 text-amber-700 border-amber-100', dot: 'bg-amber-500', ping: 'bg-amber-400' },
        down: { label: 'Critical Issues Detected', color: 'bg-red-50 text-red-700 border-red-100', dot: 'bg-red-500', ping: 'bg-red-400' },
    };

    const health = healthConfig[systemHealth];

    return (
        // ─────────────────────────────────────────────────────────────
        // 📝 Author: Narco / Arth
        // 🔗 GitHub: https://github.com/ArthOfficial
        // 🌐 Website: https://arth-hub.vercel.app
        // © 2026 Arth — All rights reserved.
        // ─────────────────────────────────────────────────────────────
        <div className="min-h-screen bg-[#FAF9F6] flex">
            <Sidebar activePage="Dashboard" />

            <main className="flex-1 lg:ml-72 min-h-screen flex flex-col">
                <Header title="Super Admin Dashboard" />

                <div className="p-6 md:p-8 lg:p-10 pb-20">
                    {/* Welcome Banner */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="clay-card p-6 md:p-8 mb-8 relative"
                    >
                        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                            <div>
                                <div className="flex items-center gap-3 mb-2">
                                    <h2 className="text-2xl md:text-3xl font-bold text-foreground">
                                        Welcome back, {loading ? '...' : userName}
                                    </h2>
                                    <Crown className="w-8 h-8 text-amber-500" />
                                </div>
                                <p className="text-muted">Here's what's happening across your educational network today.</p>
                            </div>
                            <div 
                                className={`relative flex items-center gap-2 ${health.color} px-4 py-2 rounded-full border shadow-sm cursor-help`}
                                onMouseEnter={() => setShowHealthTooltip(true)}
                                onMouseLeave={() => setShowHealthTooltip(false)}
                            >
                                <span className="relative flex h-3 w-3">
                                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${health.ping} opacity-75`}></span>
                                    <span className={`relative inline-flex rounded-full h-3 w-3 ${health.dot}`}></span>
                                </span>
                                <span className="text-sm font-semibold">{health.label}</span>

                                <AnimatePresence>
                                    {showHealthTooltip && (
                                        <motion.div 
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: 10 }}
                                            className="absolute top-full right-0 mt-3 w-80 lg:w-96 bg-white rounded-2xl shadow-2xl border border-gray-100 p-5 z-[200] text-left cursor-default pointer-events-none"
                                        >
                                            <h4 className="font-bold text-stone-800 mb-3 border-b pb-3 flex items-center justify-between">
                                                System Health Details
                                                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${health.color}`}>
                                                    {systemHealth}
                                                </span>
                                            </h4>
                                            
                                            {systemHealth === 'operational' ? (
                                                <div className="flex items-start gap-3 text-sm text-stone-600 bg-emerald-50/50 p-3 rounded-xl">
                                                    <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                                                    <p className="leading-relaxed">All core systems, databases, and network modules are running smoothly. No critical issues or offline nodes detected across the platform.</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-1 pointer-events-auto cursor-auto">
                                                    {healthDetails.alerts.length > 0 && (
                                                        <div>
                                                            <h5 className="text-xs font-bold text-red-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                                                <AlertTriangle className="w-3.5 h-3.5" /> Critical / Offline Problems
                                                            </h5>
                                                            <ul className="text-xs text-stone-700 space-y-2">
                                                                {healthDetails.alerts.map((alert, i) => (
                                                                    <li key={i} className="bg-red-50/50 border border-red-100/50 p-2.5 rounded-xl flex flex-col gap-1">
                                                                        <strong className="text-red-700">{alert.title || 'System Alert'}</strong> 
                                                                        <span className="text-stone-600 leading-snug">{alert.message || 'Node offline or system degraded'}</span>
                                                                        <span className="text-[9px] text-stone-400 font-medium mt-1 uppercase tracking-wider">{new Date(alert.created_at).toLocaleString()}</span>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    )}
                                                    {healthDetails.errors.length > 0 && (
                                                        <div>
                                                            <h5 className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-2 flex items-center gap-1.5 mt-4">
                                                                <Activity className="w-3.5 h-3.5" /> Recent Network Errors (Last Hr)
                                                            </h5>
                                                            <ul className="text-xs text-stone-700 space-y-2">
                                                                {healthDetails.errors.map((err, i) => (
                                                                    <li key={i} className="bg-amber-50/50 border border-amber-100/50 p-2.5 rounded-xl flex flex-col gap-1">
                                                                        <strong className="text-amber-700">{err.action || 'System Error'}</strong>
                                                                        <span className="text-stone-600 leading-snug">{err.message || 'Error occurred during operation'}</span>
                                                                        <span className="text-[9px] text-stone-400 font-medium mt-1 uppercase tracking-wider">{new Date(err.created_at).toLocaleString()}</span>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    )}
                                                    {healthDetails.alerts.length === 0 && healthDetails.errors.length === 0 && (
                                                        <p className="text-xs text-stone-500 italic">Connecting to reporting modules to fetch details...</p>
                                                    )}
                                                </div>
                                            )}
                                            <div className="mt-4 pt-3 text-[10px] text-stone-400 border-t flex justify-between items-center font-medium uppercase tracking-wider">
                                                <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> Real-time network</span>
                                                <span>Live</span>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-teal-50 to-transparent opacity-50 rounded-bl-[100px] pointer-events-none"></div>
                    </motion.div>

                    <div className="mb-8"><AnnouncementPreview /></div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
                        {stats.map((stat: Stat, index: number) => {
                            const Icon = stat.icon;
                            return (
                                <motion.div
                                    key={index}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: index * 0.1 }}
                                    className="clay-card p-6 flex flex-col justify-between h-full hover:z-10 relative"
                                >
                                    <div className="flex justify-between items-start mb-4">
                                        <div className={`w-12 h-12 rounded-2xl ${stat.bg} ${stat.color} flex items-center justify-center text-xl shadow-inner`}>
                                            <Icon className="w-6 h-6" />
                                        </div>
                                        {stat.trend !== 'neutral' && !loading && stat.label !== 'Active Admins' && (
                                            <div className={`flex items-center gap-1 text-sm font-semibold ${stat.trend === 'up' ? 'text-emerald-600' : 'text-red-600'} bg-white px-2 py-1 rounded-lg shadow-sm border border-gray-50`}>
                                                {stat.trend === 'up' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                                                {stat.change}
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        {loading ? (
                                            <div className="h-9 w-24 bg-gray-100 animate-pulse rounded-lg mb-1" />
                                        ) : (
                                            <div className="text-3xl font-extrabold text-foreground mb-1">{stat.value}</div>
                                        )}
                                        <div className="text-muted font-medium text-sm">{stat.label}</div>
                                    </div>
                                    {stat.label === 'Active Admins' && !loading && (
                                        <button
                                            onClick={openAdminsModal}
                                            className="absolute bottom-4 right-4 w-8 h-8 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 hover:bg-amber-100 hover:shadow-md transition-all"
                                            title="View All Admins"
                                        >
                                            <Eye className="w-4 h-4" />
                                        </button>
                                    )}
                                </motion.div>
                            );
                        })}
                    </div>

                    {/* Quick Stats Bar (from new tables) */}
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="clay-card p-4 mb-8"
                    >
                        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
                            {quickStats.map((qs, i) => {
                                const QsIcon = qs.icon;
                                return (
                                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-[#FAF9F6] border border-white shadow-[inset_1px_1px_3px_#E6E4E0,inset_-1px_-1px_3px_#FFFFFF]">
                                        <QsIcon className={`w-4 h-4 ${qs.color} flex-shrink-0`} />
                                        <div className="min-w-0">
                                            <div className="text-lg font-extrabold text-foreground leading-none">
                                                {loading ? '—' : qs.value}
                                            </div>
                                            <div className="text-[10px] text-muted font-medium truncate">{qs.label}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </motion.div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                        {/* School Network */}
                        <div className="lg:col-span-1">
                            <div className="clay-card p-6 h-full flex flex-col">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="text-lg font-bold text-foreground">School Network</h3>
                                    <span className="text-xs text-muted font-medium bg-gray-100 px-2.5 py-1 rounded-full">
                                        {loading ? '—' : `${schools.length} schools`}
                                    </span>
                                </div>

                                <div className="flex-1 overflow-y-auto space-y-4 pr-2 max-h-[400px]">
                                    {loading ? (
                                        [1, 2, 3].map(i => (
                                            <div key={i} className="flex items-center gap-4 p-3 animate-pulse">
                                                <div className="w-10 h-10 rounded-xl bg-gray-100" />
                                                <div className="flex-1">
                                                    <div className="h-4 w-3/4 bg-gray-100 rounded mb-2" />
                                                    <div className="h-3 w-1/2 bg-gray-50 rounded" />
                                                </div>
                                            </div>
                                        ))
                                    ) : schools.length === 0 ? (
                                        <div className="text-center py-8 text-muted text-sm">No schools registered yet.</div>
                                    ) : (
                                        schools.map((school: SchoolNetwork) => {
                                            const capacityPct = Math.min(Math.round((school.students / school.maxStudents) * 100), 100);
                                            return (
                                                <div key={school.id} className="group flex items-center gap-4 p-3 rounded-2xl hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
                                                    <div className="w-10 h-10 rounded-xl bg-white shadow-sm border border-gray-100 flex items-center justify-center text-stone-700 font-bold">
                                                        {school.name.charAt(0)}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex justify-between items-center mb-1">
                                                            <h4 className="text-sm font-bold text-foreground truncate">{school.name}</h4>
                                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide
                                                                ${school.status === 'Active' ? 'bg-emerald-100 text-emerald-700' :
                                                                    school.status === 'Trial' ? 'bg-blue-100 text-blue-700' :
                                                                        school.status === 'Suspended' ? 'bg-red-100 text-red-700' :
                                                                            'bg-amber-100 text-amber-700'}`}>
                                                                {school.status}
                                                            </span>
                                                        </div>
                                                        <div className="flex justify-between text-xs text-muted mb-1.5">
                                                            <span>{school.students.toLocaleString()} / {school.maxStudents.toLocaleString()} Students</span>
                                                            <span className="text-emerald-600 font-medium">₹{school.revenue.toLocaleString()}</span>
                                                        </div>
                                                        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full transition-all ${capacityPct > 90 ? 'bg-red-400' : capacityPct > 70 ? 'bg-amber-400' : 'bg-primary'}`}
                                                                style={{ width: `${capacityPct}%` }}
                                                            ></div>
                                                        </div>
                                                        <div className="flex items-center gap-3 mt-1.5">
                                                            <span className="text-[10px] text-muted">{school.tier.toUpperCase()}</span>
                                                            <span className="text-[10px] text-muted">•</span>
                                                            <span className="text-[10px] text-muted">{school.admins} admin{school.admins !== 1 ? 's' : ''}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Revenue Overview */}
                        <div className="lg:col-span-2">
                            <div className="clay-card p-6 h-full flex flex-col relative overflow-hidden">
                                <div className="flex justify-between items-center mb-8 relative z-10">
                                    <div>
                                        <h3 className="text-lg font-bold text-foreground">Revenue Overview</h3>
                                        <p className="text-xs text-muted mt-1">Monthly recurring revenue (last 12 months)</p>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-2xl font-extrabold text-foreground">
                                            {loading ? '—' : `₹${chartData.reduce((a, b) => a + b, 0).toLocaleString()}`}
                                        </div>
                                        <div className="text-xs text-muted">Total (12 mo.)</div>
                                    </div>
                                </div>

                                <div className="flex-1 flex items-end justify-between gap-1 sm:gap-2 relative z-10 min-h-[200px]">
                                    {chartData.map((val, i) => {
                                        const max = Math.max(...chartData, 1);
                                        const height = (val / max) * 100;
                                        return (
                                            <div key={i} className="flex flex-col items-center flex-1 gap-1">
                                                <motion.div
                                                    initial={{ height: 0 }}
                                                    whileInView={{ height: `${Math.max(height, 3)}%` }}
                                                    viewport={{ once: true }}
                                                    transition={{ duration: 0.8, delay: i * 0.05, ease: "easeOut" }}
                                                    className="w-full relative group min-h-[4px]"
                                                >
                                                    <div className={`w-full h-full rounded-t-lg transition-all duration-300 ${i === chartData.length - 1 ? 'bg-primary' : 'bg-primary/20 hover:bg-primary/40'}`}></div>
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-stone-800 text-white text-[10px] px-2 py-1 rounded shadow-lg pointer-events-none whitespace-nowrap z-20">
                                                        ₹{val.toLocaleString()}
                                                    </div>
                                                </motion.div>
                                                <span className="text-[9px] text-muted font-medium">{chartLabels[i] || ''}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-white to-transparent pointer-events-none z-0"></div>
                            </div>
                        </div>
                    </div>

                    {/* Activity Logs */}
                    <div className="clay-card p-6">
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h3 className="text-lg font-bold text-foreground">System Activity</h3>
                                <p className="text-xs text-muted mt-1">Real-time cross-network logs</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {allLogs.length > 0 && !loading && (
                                    <button
                                        onClick={() => setShowDeleteConfirm(true)}
                                        className="w-8 h-8 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center text-red-500 hover:bg-red-100 hover:text-red-600 transition-all"
                                        title="Clear All Logs"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                )}
                                <button
                                    onClick={() => setShowLogsPanel(!showLogsPanel)}
                                    className="px-3 py-1.5 rounded-lg bg-gray-50 text-xs font-bold text-stone-600 hover:bg-gray-100 flex items-center gap-2 transition-colors border border-gray-100"
                                >
                                    {showLogsPanel ? <ChevronDown className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                                    {showLogsPanel ? 'Collapse' : 'Expand'}
                                </button>
                            </div>
                        </div>

                        {loading ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                {[1, 2, 3, 4].map(i => (
                                    <div key={i} className="bg-[#FAF9F6] rounded-2xl p-4 animate-pulse h-24" />
                                ))}
                            </div>
                        ) : logs.length === 0 ? (
                            <div className="text-center py-12 text-muted border-2 border-dashed border-gray-100 rounded-2xl">
                                <Terminal className="w-12 h-12 mx-auto text-gray-200 mb-3" />
                                <p className="font-medium text-sm">No recent activity found.</p>
                            </div>
                        ) : (
                            <>
                                {!showLogsPanel ? (
                                    // COMPACT VIEW (Grid)
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                        {logs.map((log: SystemLog) => {
                                            const Icon = log.icon;
                                            return (
                                                <div key={log.id} className="bg-[#FAF9F6] rounded-2xl p-4 border border-white shadow-[inset_2px_2px_4px_#E6E4E0,inset_-2px_-2px_4px_#FFFFFF] flex gap-3 hover:bg-white transition-all duration-200 group/item relative cursor-pointer" onClick={() => { setSelectedLog(log); setShowDetailModal(true); }}>
                                                    <div className={`mt-0.5 w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs border-2 border-white shadow-sm
                                                        ${log.type === 'success' || log.status === 'success' ? 'bg-emerald-100 text-emerald-600' :
                                                            log.type === 'warning' ? 'bg-amber-100 text-amber-600' :
                                                                log.type === 'danger' || log.status === 'failed' ? 'bg-red-100 text-red-600' :
                                                                    'bg-blue-100 text-blue-600'}`}>
                                                        <Icon className="w-4 h-4" />
                                                    </div>
                                                    <div className="flex-1 min-w-0 pr-2">
                                                        <div className="font-bold text-sm text-foreground truncate">{log.action}</div>
                                                        <div className="text-xs text-muted truncate mt-0.5">{log.message}</div>
                                                        <div className="text-[10px] text-gray-400 font-medium flex items-center gap-1 mt-2">
                                                            <Clock className="w-3 h-3" /> {log.time}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    // EXPANDED VIEW (List)
                                    <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                                        {allLogs.map((log: SystemLog) => {
                                            const Icon = log.icon;

                                            // Assign a stable color set based on school name
                                            const colors = [
                                                'bg-blue-50 text-blue-700 border-blue-100',
                                                'bg-indigo-50 text-indigo-700 border-indigo-100',
                                                'bg-violet-50 text-violet-700 border-violet-100',
                                                'bg-emerald-50 text-emerald-700 border-emerald-100',
                                                'bg-teal-50 text-teal-700 border-teal-100',
                                                'bg-amber-50 text-amber-700 border-amber-100',
                                                'bg-rose-50 text-rose-700 border-rose-100',
                                                'bg-cyan-50 text-cyan-700 border-cyan-100'
                                            ];
                                            const colorIndex = log.school_name === 'Platform Core' ? 0 : Math.abs(log.school_name.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % colors.length;
                                            const schoolColorClass = log.school_name === 'Platform Core' ? 'bg-stone-100 text-stone-700 border-stone-200' : colors[colorIndex];

                                            return (
                                                <div key={log.id} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm flex items-center gap-4 hover:border-gray-300 transition-colors cursor-pointer" onClick={() => { setSelectedLog(log); setShowDetailModal(true); }}>
                                                    <div className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center 
                                                        ${log.type === 'success' || log.status === 'success' ? 'bg-emerald-50 text-emerald-600' :
                                                            log.type === 'warning' ? 'bg-amber-50 text-amber-600' :
                                                                log.type === 'danger' || log.status === 'failed' ? 'bg-red-50 text-red-600' :
                                                                    'bg-blue-50 text-blue-600'}`}>
                                                        <Icon className="w-5 h-5" />
                                                    </div>

                                                    <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                                                        <div className="col-span-1 md:col-span-2">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <h4 className="font-bold text-sm text-foreground truncate">{log.action}</h4>
                                                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${log.status === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
                                                                    {log.status}
                                                                </span>
                                                            </div>
                                                            <p className="text-xs text-muted truncate">{log.message}</p>
                                                        </div>

                                                        <div className="col-span-1 flex flex-col items-start justify-center gap-1.5">
                                                            <div className={`text-[10px] font-bold px-2 py-0.5 rounded border flex items-center gap-1 max-w-full truncate ${schoolColorClass}`}>
                                                                <Building2 className="w-3 h-3 flex-shrink-0" />
                                                                <span className="truncate">{log.school_name}</span>
                                                            </div>
                                                            <div className="text-[10px] text-stone-500 font-medium flex items-center gap-1">
                                                                <UserCheck className="w-3 h-3" /> {log.user_name}
                                                            </div>
                                                        </div>

                                                        <div className="col-span-1 flex flex-col items-end justify-center text-right">
                                                            <div className="text-[11px] font-bold text-stone-600">{log.time}</div>
                                                            <div className="text-[10px] text-stone-400 mt-0.5">{log.raw_time}</div>
                                                        </div>
                                                    </div>

                                                    <div className="pl-4 border-l border-gray-100 flex items-center justify-center text-gray-300">
                                                        <ChevronDown className="w-5 h-5 -rotate-90" />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-auto border-t border-gray-200 py-6 text-center text-sm text-muted font-medium bg-[#FAF9F6]">
                    © {new Date().getFullYear()} Kryin School. Super Admin Access Level 1.
                </div>

                {/* Detail Modal */}
                {showDetailModal && selectedLog && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="clay-card w-full max-w-lg p-0 overflow-hidden"
                        >
                            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${selectedLog.status === 'failed' ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500'}`}>
                                        <selectedLog.icon className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-foreground">{selectedLog.action}</h3>
                                        <p className="text-xs text-muted">ID: {selectedLog.id.slice(0, 8)}...</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowDetailModal(false)}
                                    className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="p-6 space-y-6">
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Status</label>
                                            <div className={`text-sm font-bold uppercase ${selectedLog.status === 'failed' ? 'text-red-500' : 'text-emerald-500'}`}>
                                                {selectedLog.status}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Status</label>
                                                <div className={`text-sm font-bold uppercase ${selectedLog.status === 'failed' ? 'text-red-500' : 'text-emerald-500'}`}>
                                                    {selectedLog.status}
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Time</label>
                                                <div className="text-sm font-medium text-foreground">{selectedLog.raw_time}</div>
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Target Domain</label>
                                                <div className="text-sm font-medium text-foreground flex items-center gap-2">
                                                    <Building2 className="w-4 h-4 text-primary" /> {selectedLog.school_name}
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Actor</label>
                                                <div className="text-sm font-medium text-foreground flex items-center gap-2">
                                                    <UserCheck className="w-4 h-4 text-primary" /> {selectedLog.user_name}
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">IP Address</label>
                                                <div className="text-sm font-mono font-medium text-stone-600 bg-stone-50 px-2 py-1 rounded inline-block">
                                                    {selectedLog.ip_address}
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">User Agent</label>
                                                <div className="text-xs font-mono text-stone-500 truncate" title={selectedLog.user_agent}>
                                                    {selectedLog.user_agent}
                                                </div>
                                            </div>
                                        </div>

                                    </div>
                                </div>
                            </div>

                            <div className="p-6 pt-0 flex justify-end">
                                <button
                                    onClick={() => setShowDetailModal(false)}
                                    className="clay-btn py-2 px-6 text-sm font-bold"
                                >
                                    Close
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}

                {/* ═══ ALL ADMINS MODAL ═══ */}
                {showAdminsModal && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="bg-white rounded-[24px] shadow-2xl relative w-full max-w-3xl max-h-[85vh] flex flex-col"
                        >
                            {/* Header */}
                            <div className="p-6 border-b border-gray-100 flex justify-between items-center flex-shrink-0">
                                <div className="flex items-center gap-3">
                                    <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center">
                                        <ShieldAlert className="w-5 h-5 text-amber-600" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold text-foreground">All School Admins</h2>
                                        <p className="text-xs text-muted">Manage admin accounts across all schools</p>
                                    </div>
                                </div>
                                <button onClick={() => { setShowAdminsModal(false); setEditingAdmin(null); }} className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-muted hover:text-foreground transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Body */}
                            <div className="flex-1 overflow-y-auto p-6 space-y-3">
                                {adminsLoading ? (
                                    <div className="flex flex-col items-center justify-center py-12">
                                        <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
                                        <p className="text-muted text-sm">Loading admins...</p>
                                    </div>
                                ) : allAdmins.length === 0 ? (
                                    <div className="text-center py-12 text-muted">
                                        <Users className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                                        <p className="font-medium">No admin accounts found.</p>
                                    </div>
                                ) : (
                                    allAdmins.map((admin) => (
                                        <div key={admin.id} className="bg-[#FAF9F6] rounded-2xl border border-white shadow-[inset_2px_2px_4px_#E6E4E0,inset_-2px_-2px_4px_#FFFFFF] p-4 hover:bg-white transition-all">
                                            {editingAdmin?.id === admin.id ? (
                                                /* ── EDIT MODE ── */
                                                <div className="space-y-4">
                                                    <div className="flex items-center justify-between">
                                                        <h4 className="font-bold text-foreground flex items-center gap-2">
                                                            <Edit2 className="w-4 h-4 text-primary" />
                                                            Editing: {admin.full_name}
                                                        </h4>
                                                        <button onClick={() => setEditingAdmin(null)} className="text-xs text-muted hover:text-foreground">
                                                            Cancel
                                                        </button>
                                                    </div>

                                                    {editAdminError && (
                                                        <div className="p-3 bg-rose-50 text-rose-600 text-xs font-medium rounded-lg border border-rose-100 flex items-center gap-2">
                                                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                                            {editAdminError}
                                                        </div>
                                                    )}
                                                    {editAdminSuccess && (
                                                        <div className="p-3 bg-emerald-50 text-emerald-600 text-xs font-medium rounded-lg border border-emerald-100 flex items-center gap-2">
                                                            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                                                            {editAdminSuccess}
                                                        </div>
                                                    )}

                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                        <div className="space-y-1">
                                                            <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Email</label>
                                                            <div className="relative">
                                                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                                                <input
                                                                    type="email"
                                                                    value={editAdminEmail}
                                                                    onChange={e => setEditAdminEmail(e.target.value)}
                                                                    className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm"
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="text-[10px] font-bold text-muted uppercase tracking-wider">New Password</label>
                                                            <div className="relative">
                                                                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                                                <input
                                                                    type="password"
                                                                    value={editAdminPassword}
                                                                    onChange={e => setEditAdminPassword(e.target.value)}
                                                                    placeholder="Leave blank to keep"
                                                                    className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm"
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Role</label>
                                                            <div className="relative">
                                                                <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                                                <select
                                                                    value={editAdminRole}
                                                                    onChange={e => setEditAdminRole(e.target.value)}
                                                                    className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm appearance-none"
                                                                >
                                                                    <option value="admin">Admin</option>
                                                                    <option value="superadmin">Super Admin</option>
                                                                    {allRolesList.map(r => (
                                                                        <option key={r.id} value={r.name}>{r.name}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                            {editAdminRole !== editingAdmin?.role && (
                                                                <p className="text-[10px] text-amber-600 flex items-center gap-1 mt-1">
                                                                    <AlertTriangle className="w-3 h-3" />
                                                                    Role changed — permissions will be updated automatically
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Assigned School</label>
                                                            <div className="relative">
                                                                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                                                <select
                                                                    value={editAdminSchoolId}
                                                                    onChange={e => setEditAdminSchoolId(e.target.value)}
                                                                    className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm appearance-none"
                                                                >
                                                                    <option value="">Unassigned</option>
                                                                    {allSchoolsList.map(s => (
                                                                        <option key={s.id} value={s.id}>{s.name}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="flex justify-end">
                                                        <button
                                                            onClick={handleSaveAdmin}
                                                            disabled={editAdminSaving}
                                                            className="bg-primary text-white px-6 py-2 rounded-xl font-bold text-sm hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
                                                        >
                                                            {editAdminSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                                            {editAdminSaving ? 'Saving...' : 'Save Changes'}
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                /* ── VIEW MODE ── */
                                                <div className="flex items-center gap-4">
                                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100 flex items-center justify-center text-amber-600 font-bold text-sm shadow-inner">
                                                        {admin.full_name.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <h4 className="font-bold text-foreground text-sm">{admin.full_name}</h4>
                                                        <div className="flex items-center gap-2 mt-0.5">
                                                            <Mail className="w-3 h-3 text-gray-400" />
                                                            <span className="text-xs text-muted truncate">{admin.email}</span>
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <Building2 className="w-3 h-3 text-gray-400" />
                                                            <span className="text-xs text-muted">{admin.school_name}</span>
                                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100 uppercase">{admin.role}</span>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => startEditAdmin(admin)}
                                                        className="w-9 h-9 rounded-lg bg-white shadow-sm border border-gray-100 flex items-center justify-center text-gray-400 hover:text-primary hover:border-primary/30 transition-all hover:shadow-md"
                                                        title="Edit Admin"
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Footer */}
                            <div className="p-4 border-t border-gray-100 flex justify-between items-center flex-shrink-0">
                                <span className="text-xs text-muted">{allAdmins.length} admin(s) total</span>
                                <button
                                    onClick={() => { setShowAdminsModal(false); setEditingAdmin(null); }}
                                    className="px-5 py-2 text-sm font-bold text-muted hover:text-foreground transition-colors"
                                >
                                    Close
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}

                {/* ═══ DELETE ALL LOGS CONFIRMATION MODAL ═══ */}
                {showDeleteConfirm && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="bg-white rounded-[24px] shadow-2xl relative w-full max-w-md overflow-hidden"
                        >
                            <div className="p-6 text-center">
                                <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-sm">
                                    <AlertTriangle className="w-8 h-8 text-red-500" />
                                </div>
                                <h3 className="text-xl font-bold text-foreground mb-2">Clear All System Logs?</h3>
                                <p className="text-sm text-muted mb-6">
                                    This action cannot be undone. All activity logs across all schools and the core platform will be permanently deleted.
                                </p>
                                <div className="flex gap-3 w-full">
                                    <button
                                        onClick={() => setShowDeleteConfirm(false)}
                                        disabled={deletingLogs}
                                        className="flex-1 px-4 py-3 rounded-xl font-bold text-stone-600 bg-gray-50 hover:bg-gray-100 transition-colors disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleDeleteAllLogs}
                                        disabled={deletingLogs}
                                        className="flex-1 px-4 py-3 rounded-xl font-bold text-white bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/20 hover:shadow-red-500/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        {deletingLogs ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                        {deletingLogs ? 'Clearing...' : 'Yes, Clear All'}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </main>
        </div>
    );
};

export default SuperAdminDashboard;
