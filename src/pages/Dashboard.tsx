import React, { useEffect } from 'react';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';
import StudentDashboardExperience from '../components/dashboard/StudentDashboardExperience';
import AnnouncementPreview from '../components/announcements/AnnouncementPreview';
import { ChildSelector } from '../components/dashboard/ChildSelector';
import {
    Users, Presentation, Coins, GraduationCap, ArrowUp, UserPlus, Receipt,
    AlertTriangle, MessageSquare, Trophy, Calendar, Sparkles, Loader2, ClipboardCheck, BookOpen, ArrowLeftRight,
    type LucideIcon
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useAdminDashboardStats, useNotifications, qk } from '../hooks/queries';



const KPI: React.FC<{
    icon: LucideIcon;
    title: string;
    subtitle: string;
    trend?: string;
}> = ({ icon: Icon, title, subtitle, trend }) => (
    <div className="clay-card p-5 flex flex-col justify-between h-full relative overflow-hidden group">
        <div className="flex justify-between items-start mb-4">
            <div className="w-12 h-12 rounded-2xl bg-teal-50 flex items-center justify-center text-teal-600 shadow-inner transition-transform group-hover:scale-110">
                <Icon className="w-6 h-6" />
            </div>
            {trend && (
                <div className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100">
                    <ArrowUp className="w-3 h-3" />
                    {trend}
                </div>
            )}
        </div>
        <div>
            <h3 className="text-3xl font-extrabold text-foreground mb-1">{title}</h3>
            <p className="text-xs text-muted font-medium">{subtitle}</p>
        </div>
    </div>
);

const iconForType = (t: string | null): LucideIcon => {
    switch (t) {
        case 'enrollment': return UserPlus;
        case 'payment': return Receipt;
        case 'overdue': return AlertTriangle;
        default: return MessageSquare;
    }
};
const tintForType = (t: string | null) => {
    switch (t) {
        case 'enrollment': return { bg: 'bg-emerald-50', fg: 'text-emerald-600' };
        case 'payment': return { bg: 'bg-sky-50', fg: 'text-sky-600' };
        case 'overdue': return { bg: 'bg-rose-50', fg: 'text-rose-600' };
        default: return { bg: 'bg-stone-100', fg: 'text-stone-600' };
    }
};
const timeAgo = (iso: string | null) => {
    if (!iso) return '';
    const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24); return `${d}d ago`;
};

const money = (v: number) => {
    if (!v) return '₹0';
    if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`;
    if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
    if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
    return `₹${v.toFixed(0)}`;
};

const ComingSoon: React.FC<{ title: string; description: string; icon: LucideIcon }> = ({ title, description, icon: Icon }) => (
    <div className="clay-card p-6 relative overflow-hidden">
        <div className="absolute top-3 right-3">
            <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                <Sparkles className="w-3 h-3" /> Coming Soon
            </span>
        </div>
        <div className="flex items-center gap-3 mb-3">
            <div className="w-11 h-11 rounded-2xl bg-stone-100 flex items-center justify-center text-stone-500">
                <Icon className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-foreground">{title}</h3>
        </div>
        <p className="text-sm text-muted">{description}</p>
        <div className="mt-4 h-24 rounded-xl border-2 border-dashed border-stone-200 flex items-center justify-center text-stone-400 text-xs font-semibold">
            Available in a future release
        </div>
    </div>
);

const AttendanceSnapshot: React.FC<{ schoolId: string | null }> = ({ schoolId }) => {
    const today = new Date().toISOString().slice(0, 10);
    const { data, isLoading } = useQuery({
        queryKey: ['dashboard', 'attendance-snapshot', schoolId, today],
        enabled: !!schoolId,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('attendance')
                .select('status')
                .eq('school_id', schoolId!)
                .eq('date', today);
            if (error) throw error;
            const rows = (data ?? []) as { status: string | null }[];
            const total = rows.length;
            let present = 0, absent = 0, late = 0, excused = 0;
            for (const r of rows) {
                const s = (r.status || '').toLowerCase();
                if (s === 'present') present++;
                else if (s === 'absent') absent++;
                else if (s === 'late') late++;
                else if (s === 'excused') excused++;
            }
            const pct = total ? Math.round((present / total) * 100) : 0;
            return { total, present, absent, late, excused, pct };
        },
    });

    return (
        <div className="clay-card p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-lg font-bold text-foreground">Today's Attendance</h3>
                    <p className="text-xs text-muted">Live snapshot across all classes</p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-primary bg-teal-50 border border-teal-100 px-2 py-1 rounded-full">
                    <ClipboardCheck className="w-3 h-3" /> {new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                </span>
            </div>
            {isLoading ? (
                <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted" /></div>
            ) : !data || data.total === 0 ? (
                <div className="py-8 text-center">
                    <ClipboardCheck className="w-8 h-8 mx-auto text-stone-300 mb-2" />
                    <p className="text-sm font-semibold text-stone-600">No attendance marked yet today</p>
                    <p className="text-xs text-muted mt-1">Teachers can mark attendance from the Attendance page.</p>
                </div>
            ) : (
                <div>
                    <div className="flex items-end justify-between mb-4">
                        <div>
                            <div className="text-4xl font-extrabold text-foreground">{data.pct}%</div>
                            <div className="text-xs text-muted font-semibold">Present rate</div>
                        </div>
                        <div className="text-right">
                            <div className="text-sm font-bold text-foreground">{data.present} / {data.total}</div>
                            <div className="text-xs text-muted">students marked</div>
                        </div>
                    </div>
                    <div className="w-full h-2.5 rounded-full bg-stone-100 overflow-hidden flex">
                        <div className="bg-primary h-full" style={{ width: `${(data.present / data.total) * 100}%` }} />
                        <div className="bg-amber-400 h-full" style={{ width: `${(data.late / data.total) * 100}%` }} />
                        <div className="bg-sky-400 h-full" style={{ width: `${(data.excused / data.total) * 100}%` }} />
                        <div className="bg-rose-400 h-full" style={{ width: `${(data.absent / data.total) * 100}%` }} />
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-4">
                        <StatPill label="Present" value={data.present} dot="bg-primary" />
                        <StatPill label="Late" value={data.late} dot="bg-amber-400" />
                        <StatPill label="Excused" value={data.excused} dot="bg-sky-400" />
                        <StatPill label="Absent" value={data.absent} dot="bg-rose-400" />
                    </div>
                </div>
            )}
        </div>
    );
};

const StatPill: React.FC<{ label: string; value: number; dot: string }> = ({ label, value, dot }) => (
    <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-100 text-center">
        <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} /> {label}
        </div>
        <div className="text-lg font-extrabold text-foreground mt-0.5">{value}</div>
    </div>
);

const TeacherClasses: React.FC<{ teacherId: string; schoolId: string | null }> = ({ teacherId, schoolId }) => {
    const navigate = useNavigate();
    const { data: classes = [], isLoading } = useQuery({
        queryKey: ['dashboard', 'teacher-classes', teacherId, schoolId],
        enabled: !!teacherId && !!schoolId,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('classes')
                .select('id, name, section')
                .eq('school_id', schoolId!)
                .eq('teacher_id', teacherId)
                .order('name');
            if (error) throw error;
            return data ?? [];
        },
    });

    return (
        <section className="clay-card p-6" aria-labelledby="your-classes-title">
            <div className="flex items-start gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-teal-50 text-primary flex items-center justify-center flex-shrink-0">
                    <BookOpen className="w-5 h-5" />
                </div>
                <div>
                    <h3 id="your-classes-title" className="text-lg font-bold text-foreground">Your Classes</h3>
                    <p className="text-xs text-muted">Choose a class to manage its students and work.</p>
                </div>
            </div>

            {isLoading ? (
                <div className="h-10 rounded-xl bg-stone-100 animate-pulse" aria-label="Loading classes" />
            ) : classes.length === 0 ? (
                <div className="py-5 text-center rounded-xl bg-stone-50">
                    <p className="text-sm font-semibold text-stone-600">No classes assigned yet</p>
                    <p className="text-xs text-muted mt-1">Ask your administrator to assign a class.</p>
                </div>
            ) : (
                <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Your assigned classes">
                    {classes.map((classroom) => (
                        <button
                            key={classroom.id}
                            type="button"
                            onClick={() => navigate(`/classes?class=${classroom.id}`)}
                            className="shrink-0 px-3.5 py-2.5 rounded-xl border border-teal-100 bg-teal-50 text-left text-sm font-bold text-teal-800 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 transition-colors"
                        >
                            {classroom.name}{classroom.section ? ` · ${classroom.section}` : ''}
                        </button>
                    ))}
                </nav>
            )}
        </section>
    );
};

const Dashboard: React.FC = () => {
    const { user, role, roles, switchDashboardRole, linkedStudents, activeStudentId } = useAuth();
    const effectiveStudentId = activeStudentId
        ?? linkedStudents.find(s => s.isPrimary)?.studentId
        ?? linkedStudents[0]?.studentId
        ?? null;

    const navigate = useNavigate();
    const qc = useQueryClient();

    const statsQuery = useAdminDashboardStats();
    const activityQuery = useNotifications(user?.id, 8);

    const stats = statsQuery.data ?? null;
    const activity = (activityQuery.data ?? []).slice(0, 8);
    const loading = statsQuery.isLoading || activityQuery.isLoading;

    // Realtime: any new notification for me → also refresh admin stats.
    useEffect(() => {
        if (!user?.id) return;
        const ch = supabase
            .channel(`dashboard-live:${user.id}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
                () => {
                    qc.invalidateQueries({ queryKey: qk.adminDashboardStats });
                    qc.invalidateQueries({ queryKey: qk.notifications(user.id) });
                },
            )
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [user?.id, qc]);

    const greeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good Morning';
        if (hour < 17) return 'Good Afternoon';
        return 'Good Evening';
    };

    const userName = user?.fullName || user?.email?.split('@')[0] || 'Admin';
    const collectionPct = stats?.collection_pct ?? 0;
    const paid = stats?.paid_invoices ?? 0;
    const pending = stats?.pending_invoices ?? 0;

    // Simple stroke-based donut arithmetic (0..100)
    const paidLen = collectionPct;
    const pendingLen = Math.max(0, 100 - collectionPct);

    return (
        <div className="flex min-h-screen bg-background relative selection:bg-teal-100 selection:text-primary">
            <div className="beam beam-left fixed"></div>
            <div className="beam beam-right fixed"></div>

            <Sidebar activePage="Dashboard" />

            <div className="flex-1 lg:ml-72 flex flex-col min-h-screen">
                <Header title="Dashboard Overview" />

                <main className="flex-1 p-8 space-y-8 overflow-y-auto pb-24">

                    {/* Welcome Card */}
                    <div className="clay-card p-5 md:p-8 relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-5 md:gap-6 animate-fade-up">
                        <div className="relative z-10 w-full md:w-auto">
                            <h1 className="text-3xl font-bold text-foreground mb-1">{greeting()}, {userName}! 👋</h1>
                            <p className="text-muted">
                                {role === 'admin' ? 'Live snapshot of your school today.' : role === 'student' ? 'Track your learning, attendance, and school updates.' : role === 'parent' ? 'Track your ward’s attendance, fees, performance, and updates.' : "Here's an overview of your workspace."}
                            </p>
                        </div>
                        <div className="relative z-10 flex w-full items-end justify-between gap-4 md:w-auto md:flex-col md:items-end md:justify-start">
                            {((roles.includes('student') && roles.includes('parent')) || (roles.includes('parent') && linkedStudents.some(s => !s.studentStatus || s.studentStatus === 'active'))) && (
                                <button
                                    type="button"
                                    onClick={() => switchDashboardRole(role === 'student' ? 'parent' : 'student')}
                                    className="order-1 inline-flex items-center gap-2 rounded-xl border border-teal-200 bg-white px-3 py-2 text-xs font-bold text-primary hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 md:order-2 md:mt-3"
                                >
                                    <ArrowLeftRight className="w-3.5 h-3.5" /> Switch to {role === 'student' ? 'Parent' : 'Student'} Dashboard
                                </button>
                            )}
                            <div className="order-2 text-right md:order-1">
                                <span className="text-xs font-bold text-muted uppercase tracking-wider mb-1 block">Current Academic Year</span>
                                <div className="bg-primary text-white px-6 py-2 rounded-full font-bold text-lg shadow-lg shadow-teal-900/20">
                                    2025-26
                                </div>
                            </div>
                        </div>
                        <div className="absolute -top-20 -right-20 w-64 h-64 bg-teal-100 rounded-full blur-3xl opacity-50"></div>
                    </div>

                    <AnnouncementPreview />

                    {(role === 'student' || role === 'parent') && (
                        <div className="space-y-6 animate-fade-up">
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <ChildSelector />
                            </div>

                            {effectiveStudentId ? (
                                <StudentDashboardExperience
                                    key={effectiveStudentId}
                                    studentId={effectiveStudentId}
                                    schoolId={user?.schoolId ?? null}
                                    feed={activity}
                                    isFeedLoading={activityQuery.isLoading}
                                    isParentView={role === 'parent'}
                                />
                            ) : (
                                <div className="clay-card p-10 text-center text-stone-500 rounded-3xl">
                                    <GraduationCap className="w-12 h-12 mx-auto text-stone-300 mb-3" />
                                    <h3 className="text-lg font-bold text-foreground">No Student Profile Linked</h3>
                                    <p className="text-sm text-muted mt-1 max-w-md mx-auto">
                                        No active student profile is currently linked to this family account. Please contact your school administration to link your ward's profile.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {role !== 'student' && role !== 'parent' && <>
                    {/* KPI Grid — REAL data */}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 animate-fade-up delay-100">
                        <KPI icon={Users} title={loading ? '—' : (stats?.students ?? 0).toLocaleString()} subtitle="Students" />
                        <KPI icon={Presentation} title={loading ? '—' : (stats?.teachers ?? 0).toLocaleString()} subtitle="Teachers" />
                        <KPI icon={GraduationCap} title={loading ? '—' : (stats?.classes ?? 0).toLocaleString()} subtitle="Classes" />
                        <KPI
                            icon={Coins}
                            title={loading ? '—' : money(stats?.month_revenue ?? 0)}
                            subtitle={`This month • ${paid} paid / ${pending} pending`}
                        />
                    </div>

                    {/* Main Grid */}
                    <div className="grid grid-cols-1 xl:grid-cols-5 gap-8 animate-fade-up delay-300">

                        {/* Left: Activity feed */}
                        <div className="xl:col-span-3 space-y-8">
                            <div className="clay-card p-6">
                                <div className="flex justify-between items-center mb-6">
                                    <div>
                                        <h3 className="text-lg font-bold text-foreground">Recent Activity</h3>
                                        <p className="text-xs text-muted">Live from your school • auto-updates</p>
                                    </div>
                                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded-full">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> LIVE
                                    </span>
                                </div>
                                {loading ? (
                                    <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted" /></div>
                                ) : activity.length === 0 ? (
                                    <div className="py-10 text-center">
                                        <MessageSquare className="w-8 h-8 mx-auto text-stone-300 mb-2" />
                                        <p className="text-sm font-semibold text-stone-600">No activity yet</p>
                                        <p className="text-xs text-muted mt-1">New enrollments, payments and alerts will show up here.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-5">
                                        {activity.map(item => {
                                            const Icon = iconForType(item.type);
                                            const t = tintForType(item.type);
                                            return (
                                                <button
                                                    key={item.id}
                                                    onClick={() => item.action_url && navigate(item.action_url)}
                                                    className="w-full flex gap-4 items-start text-left group"
                                                >
                                                    <div className={`mt-1 w-9 h-9 rounded-xl ${t.bg} ${t.fg} flex items-center justify-center flex-shrink-0`}>
                                                        <Icon className="w-4 h-4" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-bold text-foreground group-hover:text-primary transition-colors truncate">
                                                            {item.title}
                                                        </p>
                                                        <p className="text-xs text-muted line-clamp-2">{item.message}</p>
                                                        <span className="text-[10px] text-stone-400 font-medium mt-0.5 block">{timeAgo(item.created_at)}</span>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Today's Attendance Snapshot */}
                            <AttendanceSnapshot schoolId={user?.schoolId ?? null} />

                        </div>

                        {/* Right: teacher classes or school finance overview */}
                        <div className="xl:col-span-2 space-y-8">
                            {role === 'teacher' ? (
                                <TeacherClasses teacherId={user!.id} schoolId={user?.schoolId ?? null} />
                            ) : <>
                            <div className="clay-card p-6">
                                <div className="flex justify-between items-center mb-6">
                                    <div>
                                        <h3 className="text-lg font-bold text-foreground">Fee Collection</h3>
                                        <p className="text-xs text-muted">Invoice completion rate</p>
                                    </div>
                                </div>

                                <div className="relative w-48 h-48 mx-auto mb-6">
                                    <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                                        <path className="text-rose-100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3.8" />
                                        <path className="text-rose-400" strokeDasharray={`${pendingLen}, 100`} strokeDashoffset={`-${paidLen}`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3.8" />
                                        <path className="text-primary" strokeDasharray={`${paidLen}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3.8" strokeLinecap="round" />
                                    </svg>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                        <span className="text-3xl font-extrabold text-foreground">{collectionPct.toFixed(0)}%</span>
                                        <span className="text-xs font-bold text-muted uppercase tracking-wider">Collected</span>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex justify-between items-center p-3 rounded-xl bg-teal-50 border border-teal-100">
                                        <div className="flex items-center gap-2 text-xs font-bold text-teal-800">
                                            <span className="w-2 h-2 rounded-full bg-primary"></span> Collected (this month)
                                        </div>
                                        <span className="text-sm font-extrabold text-primary">{money(stats?.month_revenue ?? 0)}</span>
                                    </div>
                                    <div className="flex justify-between items-center p-3 rounded-xl bg-amber-50 border border-amber-100">
                                        <div className="flex items-center gap-2 text-xs font-bold text-amber-800">
                                            <span className="w-2 h-2 rounded-full bg-amber-400"></span> Pending dues
                                        </div>
                                        <span className="text-sm font-extrabold text-amber-700">{money(stats?.pending_amount ?? 0)}</span>
                                    </div>
                                    <div className="flex justify-between items-center p-3 rounded-xl bg-rose-50 border border-rose-100">
                                        <div className="flex items-center gap-2 text-xs font-bold text-rose-800">
                                            <span className="w-2 h-2 rounded-full bg-rose-400"></span> Overdue
                                        </div>
                                        <span className="text-sm font-extrabold text-rose-600">{money(stats?.overdue_amount ?? 0)}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Coming Soon placeholders (starred for future) */}
                            <ComingSoon
                                title="Top Performers"
                                description="Ranked students based on exam results — will populate once exam scores are recorded."
                                icon={Trophy}
                            />
                            <ComingSoon
                                title="Upcoming Events"
                                description="School events, PTMs, holidays and exam schedules will appear here."
                                icon={Calendar}
                            />
                            </>}
                        </div>
                    </div>
                    </>}
                </main>
            </div>
        </div>
    );
};

export default Dashboard;
