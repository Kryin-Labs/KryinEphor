import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, useInView, useMotionValue, useSpring, useTransform } from 'framer-motion';
import {
    TrendingUp, TrendingDown, FileText, Wallet, Download,
    CheckCircle2, Clock, AlertCircle, Sparkles, Search, ArrowUpRight,
    Activity, Building2, CreditCard, ChevronRight, DollarSign,
    BarChart3, PieChart, RefreshCcw, Calendar
} from 'lucide-react';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';
import SchoolsSubscriptionPanel from '../components/finance/SchoolsSubscriptionPanel';
import { supabase } from '../lib/supabase';
import { format, subMonths, startOfMonth, endOfMonth, differenceInDays } from 'date-fns';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────
interface Invoice {
    id: string;
    rawId: string;
    school_name: string;
    amount: number;
    status: string;
    due_date: string;
    raw_due: string;
    plan_type: string;
    created_at: string;
}
interface SchoolRevenue { name: string; revenue: number; tier: string }
interface MonthlyPoint { label: string; value: number }

// ─────────────────────────────────────────────────────────────────────
// Animated number counter — rolls up from 0 on mount
// ─────────────────────────────────────────────────────────────────────
const AnimatedNumber: React.FC<{ value: number; prefix?: string; decimals?: number }> = ({ value, prefix = '', decimals = 0 }) => {
    const ref = useRef<HTMLSpanElement>(null);
    const inView = useInView(ref, { once: true, margin: '-50px' });
    const mv = useMotionValue(0);
    const spring = useSpring(mv, { duration: 1.4, bounce: 0 });
    const rounded = useTransform(spring, (v) => {
        const n = Number(v.toFixed(decimals));
        return `${prefix}${n.toLocaleString('en-IN')}`;
    });
    useEffect(() => { if (inView) mv.set(value); }, [inView, value, mv]);
    const [display, setDisplay] = useState(`${prefix}0`);
    useEffect(() => rounded.on('change', setDisplay), [rounded]);
    return <span ref={ref}>{display}</span>;
};

// ─────────────────────────────────────────────────────────────────────
// Tiny SVG sparkline
// ─────────────────────────────────────────────────────────────────────
const Sparkline: React.FC<{ data: number[]; color?: string; height?: number }> = ({ data, color = '#0F766E', height = 36 }) => {
    if (!data.length) return null;
    const w = 120;
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const step = w / Math.max(data.length - 1, 1);
    const pts = data.map((v, i) => `${i * step},${height - ((v - min) / range) * (height - 4) - 2}`).join(' ');
    return (
        <svg width={w} height={height} className="overflow-visible">
            <defs>
                <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            <polyline points={`0,${height} ${pts} ${w},${height}`} fill={`url(#spark-${color.replace('#', '')})`} stroke="none" />
            <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
};

// ─────────────────────────────────────────────────────────────────────
// Full-width area chart for revenue trend
// ─────────────────────────────────────────────────────────────────────
const AreaChart: React.FC<{ data: MonthlyPoint[] }> = ({ data }) => {
    const w = 720, h = 220, pad = { l: 44, r: 16, t: 16, b: 28 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const max = Math.max(...data.map(d => d.value), 1);
    const step = iw / Math.max(data.length - 1, 1);
    const pts = data.map((d, i) => [pad.l + i * step, pad.t + ih - (d.value / max) * ih] as [number, number]);
    const path = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
    const area = `${path} L${pts[pts.length - 1][0]},${pad.t + ih} L${pts[0][0]},${pad.t + ih} Z`;
    const gridLines = 4;
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
            <defs>
                <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0F766E" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#B8F28B" stopOpacity="0.05" />
                </linearGradient>
            </defs>
            {Array.from({ length: gridLines + 1 }).map((_, i) => {
                const y = pad.t + (ih / gridLines) * i;
                return <line key={i} x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="#E7E5E0" strokeWidth="1" strokeDasharray="3 4" />;
            })}
            {Array.from({ length: gridLines + 1 }).map((_, i) => {
                const v = max - (max / gridLines) * i;
                const y = pad.t + (ih / gridLines) * i;
                return <text key={i} x={pad.l - 8} y={y + 4} fontSize="10" fill="#78716C" textAnchor="end" fontWeight="600">
                    {v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)}
                </text>;
            })}
            <motion.path d={area} fill="url(#areaFill)"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.4 }} />
            <motion.path d={path} fill="none" stroke="#0F766E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: 'easeOut' }} />
            {pts.map((p, i) => (
                <motion.circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="#FFFFFF" stroke="#0F766E" strokeWidth="2"
                    initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.8 + i * 0.04 }} />
            ))}
            {data.map((d, i) => (
                <text key={i} x={pad.l + i * step} y={h - 8} fontSize="10" fill="#78716C" textAnchor="middle" fontWeight="600">{d.label}</text>
            ))}
        </svg>
    );
};

// ─────────────────────────────────────────────────────────────────────
// Circular progress ring (for collection rate)
// ─────────────────────────────────────────────────────────────────────
const Ring: React.FC<{ pct: number; size?: number; label: string }> = ({ pct, size = 160, label }) => {
    const stroke = 14;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const clamped = Math.max(0, Math.min(100, pct));
    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
                <defs>
                    <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#0F766E" />
                        <stop offset="100%" stopColor="#B8F28B" />
                    </linearGradient>
                </defs>
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F0EDE6" strokeWidth={stroke} />
                <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#ringGrad)" strokeWidth={stroke} strokeLinecap="round"
                    strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c - (clamped / 100) * c }}
                    transition={{ duration: 1.4, ease: 'easeOut' }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-3xl font-extrabold text-foreground"><AnimatedNumber value={clamped} decimals={1} />%</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted mt-1">{label}</div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────
// Status pill
// ─────────────────────────────────────────────────────────────────────
const StatusPill: React.FC<{ status: string }> = ({ status }) => {
    const s = status.toLowerCase();
    const cfg = s.includes('paid') ? { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200', Icon: CheckCircle2 }
        : s.includes('pending') || s.includes('partial') ? { bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200', Icon: Clock }
        : s.includes('overdue') || s.includes('failed') ? { bg: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-200', Icon: AlertCircle }
        : { bg: 'bg-stone-100', text: 'text-stone-600', ring: 'ring-stone-200', Icon: FileText };
    const I = cfg.Icon;
    return (
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ring-1 ${cfg.bg} ${cfg.text} ${cfg.ring}`}>
            <I className="w-3 h-3" />{status}
        </span>
    );
};

// ─────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────
type Period = '30d' | '90d' | 'ytd' | 'all';

const FinanceBilling: React.FC = () => {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [allTransactions, setAllTransactions] = useState<Array<{ amount: number; type: string; status: string; created_at: string }>>([]);
    const [topSchools, setTopSchools] = useState<SchoolRevenue[]>([]);
    const [stats, setStats] = useState({ totalPaid: 0, outstanding: 0, pendingCount: 0, paidCount: 0 });
    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState<Period>('90d');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [search, setSearch] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const fetchFinanceData = async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true); else setLoading(true);
        try {
            const { data: invoiceData } = await supabase
                .from('invoices')
                .select(`id, amount, status, due_date, items, created_at, schools(name, subscription_tier)`)
                .is('deleted_at', null)
                .order('created_at', { ascending: false })
                .limit(50);

            const transformed: Invoice[] = (invoiceData || []).map((inv: {
                id: string; amount: number; status: string; due_date: string; created_at: string;
                schools: { name: string; subscription_tier: string | null }[] | null | { name: string; subscription_tier: string | null };
            }) => {
                const school = Array.isArray(inv.schools) ? inv.schools[0] : inv.schools;
                const tier = school?.subscription_tier || 'starter';
                return {
                    id: inv.id.substring(0, 8).toUpperCase(),
                    rawId: inv.id,
                    school_name: school?.name || 'Unknown School',
                    amount: Number(inv.amount),
                    status: inv.status.charAt(0).toUpperCase() + inv.status.slice(1),
                    due_date: format(new Date(inv.due_date), 'MMM dd, yyyy'),
                    raw_due: inv.due_date,
                    plan_type: tier.charAt(0).toUpperCase() + tier.slice(1) + ' Plan',
                    created_at: inv.created_at,
                };
            });
            setInvoices(transformed);

            const { data: aggData } = await supabase.from('invoice_aggregates').select('*').maybeSingle();
            const paidCount = transformed.filter(i => i.status.toLowerCase() === 'paid').length;
            setStats({
                totalPaid: Number(aggData?.total_paid || 0),
                outstanding: Number(aggData?.total_outstanding || 0),
                pendingCount: Number(aggData?.pending_count || 0),
                paidCount,
            });

            const { data: txData } = await supabase
                .from('transactions')
                .select('amount, type, status, created_at')
                .order('created_at', { ascending: false })
                .limit(500);
            setAllTransactions(txData || []);

            const { data: schoolData } = await supabase
                .from('schools')
                .select('name, subscription_tier, revenue')
                .is('deleted_at', null)
                .order('revenue', { ascending: false, nullsFirst: false })
                .limit(5);
            setTopSchools((schoolData || []).map(s => ({
                name: s.name, tier: s.subscription_tier || 'starter', revenue: Number(s.revenue || 0)
            })));
        } catch (err) {
            console.error('finance fetch failed:', err);
        } finally {
            setLoading(false); setRefreshing(false);
        }
    };

    useEffect(() => { fetchFinanceData(); }, []);

    // ── derived metrics ─────────────────────────────────────────────
    const formatINR = (v: number) =>
        new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v);

    const periodStart = useMemo(() => {
        const now = new Date();
        switch (period) {
            case '30d': return subMonths(now, 1);
            case '90d': return subMonths(now, 3);
            case 'ytd': return new Date(now.getFullYear(), 0, 1);
            default: return new Date(2000, 0, 1);
        }
    }, [period]);

    const periodTx = useMemo(() => allTransactions.filter(t => new Date(t.created_at) >= periodStart), [allTransactions, periodStart]);

    const periodRevenue = useMemo(() =>
        periodTx.reduce((sum, t) => sum + (t.type === 'refund' ? -Number(t.amount) : Number(t.amount)), 0)
    , [periodTx]);

    // MRR = last 30 days completed revenue
    const mrr = useMemo(() => {
        const cutoff = subMonths(new Date(), 1);
        return allTransactions
            .filter(t => t.status === 'completed' && new Date(t.created_at) >= cutoff)
            .reduce((s, t) => s + (t.type === 'refund' ? -Number(t.amount) : Number(t.amount)), 0);
    }, [allTransactions]);
    const arr = mrr * 12;

    // Collection rate = paid / (paid + outstanding)
    const collectionRate = useMemo(() => {
        const denom = stats.totalPaid + stats.outstanding;
        return denom > 0 ? (stats.totalPaid / denom) * 100 : 0;
    }, [stats]);

    // 12-month revenue trend from transactions
    const monthlyTrend: MonthlyPoint[] = useMemo(() => {
        const buckets: MonthlyPoint[] = [];
        for (let i = 11; i >= 0; i--) {
            const d = subMonths(new Date(), i);
            const s = startOfMonth(d), e = endOfMonth(d);
            const v = allTransactions
                .filter(t => { const td = new Date(t.created_at); return td >= s && td <= e; })
                .reduce((sum, t) => sum + (t.type === 'refund' ? -Number(t.amount) : Number(t.amount)), 0);
            buckets.push({ label: format(d, 'MMM'), value: Math.max(0, v) });
        }
        return buckets;
    }, [allTransactions]);

    // Sparkline for revenue card (last 7 monthly points)
    const revenueSpark = monthlyTrend.slice(-7).map(m => m.value);
    const mrrSpark = monthlyTrend.slice(-7).map(m => m.value);
    const arrSpark = monthlyTrend.slice(-7).map(m => m.value * 12);
    const outstandingSpark = useMemo(() => {
        // proxy: pending invoice count per recent week
        return Array.from({ length: 7 }, (_, i) => Math.max(0, stats.pendingCount - (6 - i)));
    }, [stats.pendingCount]);

    // Plan distribution
    const planDist = useMemo(() => {
        const m: Record<string, number> = {};
        invoices.forEach(i => { m[i.plan_type] = (m[i.plan_type] || 0) + 1; });
        const total = Object.values(m).reduce((s, n) => s + n, 0) || 1;
        return Object.entries(m).map(([name, n]) => ({ name, count: n, pct: (n / total) * 100 })).sort((a, b) => b.count - a.count).slice(0, 4);
    }, [invoices]);

    // Filtered table view
    const filteredInvoices = useMemo(() => invoices.filter(inv => {
        if (statusFilter !== 'all' && inv.status.toLowerCase() !== statusFilter) return false;
        if (search.trim() && !inv.school_name.toLowerCase().includes(search.toLowerCase()) && !inv.id.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    }), [invoices, statusFilter, search]);

    // Period delta vs previous equivalent window
    const prevRevenue = useMemo(() => {
        const span = differenceInDays(new Date(), periodStart);
        const prevEnd = periodStart;
        const start = new Date(prevEnd.getTime() - span * 86400000);
        return allTransactions
            .filter(t => { const d = new Date(t.created_at); return d >= start && d < prevEnd; })
            .reduce((s, t) => s + (t.type === 'refund' ? -Number(t.amount) : Number(t.amount)), 0);
    }, [allTransactions, periodStart]);
    const revDelta = prevRevenue > 0 ? ((periodRevenue - prevRevenue) / prevRevenue) * 100 : null;

    // CSV export
    const exportCSV = () => {
        const rows = [
            ['Invoice ID', 'School', 'Plan', 'Due Date', 'Amount (INR)', 'Status'],
            ...filteredInvoices.map(i => [`INV-${i.id}`, i.school_name, i.plan_type, i.due_date, i.amount.toString(), i.status])
        ];
        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `finance-invoices-${format(new Date(), 'yyyy-MM-dd')}.csv`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // ─────────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-[#FAF9F6] flex">
            <Sidebar activePage="Finance" />
            <main className="flex-1 lg:ml-72 flex flex-col min-h-screen">
                <Header title="Finance & Billing" />

                <div className="p-6 md:p-10 space-y-8">
                    {/* ─── Hero header ─── */}
                    <motion.header
                        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
                        className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-6"
                    >
                        <div>
                            <div className="inline-flex items-center gap-2 mb-3 px-3 py-1 rounded-full bg-emerald-50 ring-1 ring-emerald-100">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600" />
                                </span>
                                <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-700">Live revenue · INR</span>
                            </div>
                            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-foreground">
                                Financial <span className="bg-gradient-to-r from-emerald-700 via-emerald-600 to-lime-500 bg-clip-text text-transparent">Command Center</span>
                            </h1>
                            <p className="text-muted mt-2 font-medium max-w-2xl">
                                Monitor MRR, ARR, outstanding receivables, and subscription health across every school on the platform.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="clay-card !rounded-full !shadow-none ring-1 ring-stone-200/70 px-1.5 py-1.5 flex items-center gap-1">
                                {(['30d', '90d', 'ytd', 'all'] as Period[]).map(p => (
                                    <button key={p} onClick={() => setPeriod(p)}
                                        className={`px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all
                                            ${period === p ? 'bg-foreground text-white shadow-sm' : 'text-muted hover:text-foreground'}`}>
                                        {p === 'ytd' ? 'YTD' : p === 'all' ? 'All-time' : p.replace('d', ' days')}
                                    </button>
                                ))}
                            </div>
                            <button onClick={() => fetchFinanceData(true)} disabled={refreshing}
                                className="clay-card !rounded-full !shadow-none ring-1 ring-stone-200/70 p-2.5 hover:ring-emerald-300 transition disabled:opacity-50">
                                <RefreshCcw className={`w-4 h-4 text-foreground ${refreshing ? 'animate-spin' : ''}`} />
                            </button>
                            <button onClick={exportCSV}
                                className="clay-btn py-2.5 px-5 flex items-center gap-2 text-sm font-bold">
                                <Download className="w-4 h-4" /> Export CSV
                            </button>
                        </div>
                    </motion.header>

                    {/* ─── KPI row (4 cards) ─── */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
                        {[
                            { label: 'Total Revenue', value: stats.totalPaid, icon: DollarSign, color: '#0F766E', bg: 'bg-emerald-50', spark: revenueSpark, sub: `Lifetime, ${stats.paidCount} paid invoices`, delta: revDelta },
                            { label: 'MRR', value: mrr, icon: TrendingUp, color: '#0F766E', bg: 'bg-teal-50', spark: mrrSpark, sub: 'Last 30 days, completed' },
                            { label: 'ARR', value: arr, icon: Sparkles, color: '#65A30D', bg: 'bg-lime-50', spark: arrSpark, sub: 'MRR × 12 projection' },
                            { label: 'Outstanding', value: stats.outstanding, icon: AlertCircle, color: '#D97706', bg: 'bg-amber-50', spark: outstandingSpark, sub: `${stats.pendingCount} pending invoices`, warn: stats.pendingCount > 0 },
                        ].map((k, i) => {
                            const I = k.icon;
                            return (
                                <motion.div key={k.label}
                                    initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08, duration: 0.5 }}
                                    whileHover={{ y: -4 }}
                                    className="clay-card p-6 group relative overflow-hidden">
                                    <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                                        style={{ background: `radial-gradient(circle, ${k.color}22 0%, transparent 70%)` }} />
                                    <div className="flex items-start justify-between mb-5 relative">
                                        <div className={`w-11 h-11 rounded-2xl ${k.bg} flex items-center justify-center shadow-inner`}>
                                            <I className="w-5 h-5" style={{ color: k.color }} />
                                        </div>
                                        {k.delta != null && (
                                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-0.5
                                                ${k.delta >= 0 ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'}`}>
                                                {k.delta >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                                                {k.delta >= 0 ? '+' : ''}{k.delta.toFixed(1)}%
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[10px] font-black text-muted uppercase tracking-[0.15em] mb-1.5">{k.label}</div>
                                    <div className="text-3xl font-extrabold text-foreground mb-1 tabular-nums">
                                        <AnimatedNumber value={k.value} prefix="₹" />
                                    </div>
                                    <div className="text-[11px] font-medium text-muted mb-3">{k.sub}</div>
                                    <Sparkline data={k.spark} color={k.color} />
                                </motion.div>
                            );
                        })}
                    </div>

                    {/* ─── Bento row: revenue trend (wide) + collection ring + plan dist ─── */}
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                        {/* Trend chart */}
                        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
                            className="clay-card p-6 xl:col-span-2">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <BarChart3 className="w-4 h-4 text-emerald-700" />
                                        <h3 className="text-base font-bold text-foreground">Revenue Trend</h3>
                                    </div>
                                    <p className="text-xs text-muted font-medium">Last 12 months · completed transactions</p>
                                </div>
                                <div className="text-right">
                                    <div className="text-2xl font-extrabold text-foreground tabular-nums">
                                        {formatINR(monthlyTrend.reduce((s, m) => s + m.value, 0))}
                                    </div>
                                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted">12-month total</div>
                                </div>
                            </div>
                            <AreaChart data={monthlyTrend} />
                        </motion.div>

                        {/* Collection rate + plan distribution stacked */}
                        <div className="flex flex-col gap-6">
                            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
                                className="clay-card p-6 flex flex-col items-center">
                                <div className="flex items-center gap-2 self-start mb-1">
                                    <Activity className="w-4 h-4 text-emerald-700" />
                                    <h3 className="text-sm font-bold text-foreground">Collection Rate</h3>
                                </div>
                                <p className="text-[11px] text-muted self-start font-medium mb-4">Paid ÷ (paid + outstanding)</p>
                                <Ring pct={collectionRate} label="Collected" />
                                <div className="mt-3 grid grid-cols-2 gap-3 w-full text-center">
                                    <div className="bg-emerald-50/60 rounded-xl py-2">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Paid</div>
                                        <div className="text-sm font-extrabold text-foreground tabular-nums">{formatINR(stats.totalPaid)}</div>
                                    </div>
                                    <div className="bg-amber-50/60 rounded-xl py-2">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Open</div>
                                        <div className="text-sm font-extrabold text-foreground tabular-nums">{formatINR(stats.outstanding)}</div>
                                    </div>
                                </div>
                            </motion.div>

                            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
                                className="clay-card p-6">
                                <div className="flex items-center gap-2 mb-1">
                                    <PieChart className="w-4 h-4 text-emerald-700" />
                                    <h3 className="text-sm font-bold text-foreground">Plan Distribution</h3>
                                </div>
                                <p className="text-[11px] text-muted font-medium mb-4">Recent invoices by plan tier</p>
                                <div className="space-y-3">
                                    {planDist.length === 0 ? (
                                        <p className="text-xs text-muted italic">No plan data yet</p>
                                    ) : planDist.map((p, i) => (
                                        <div key={p.name}>
                                            <div className="flex justify-between mb-1">
                                                <span className="text-xs font-bold text-foreground">{p.name}</span>
                                                <span className="text-xs font-bold text-muted tabular-nums">{p.count} · {p.pct.toFixed(0)}%</span>
                                            </div>
                                            <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                                                <motion.div initial={{ width: 0 }} animate={{ width: `${p.pct}%` }} transition={{ delay: 0.7 + i * 0.1, duration: 0.8 }}
                                                    className="h-full rounded-full"
                                                    style={{ background: `linear-gradient(90deg, #0F766E, #B8F28B)` }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </motion.div>
                        </div>
                    </div>

                    {/* ─── Bento row: top schools + status breakdown ─── */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
                            className="clay-card p-6 lg:col-span-2">
                            <div className="flex items-center justify-between mb-5">
                                <div className="flex items-center gap-2">
                                    <Building2 className="w-4 h-4 text-emerald-700" />
                                    <h3 className="text-base font-bold text-foreground">Top Revenue Schools</h3>
                                </div>
                                <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Lifetime</span>
                            </div>
                            {topSchools.length === 0 ? (
                                <div className="text-center py-10 text-sm text-muted italic">No revenue data yet</div>
                            ) : (
                                <div className="space-y-2">
                                    {topSchools.map((s, i) => {
                                        const maxR = Math.max(...topSchools.map(x => x.revenue), 1);
                                        return (
                                            <motion.div key={s.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8 + i * 0.06 }}
                                                className="group flex items-center gap-4 p-3 rounded-2xl hover:bg-emerald-50/40 transition-colors">
                                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-100 to-lime-100 flex items-center justify-center text-sm font-extrabold text-emerald-800">
                                                    #{i + 1}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2 mb-1.5">
                                                        <div className="truncate">
                                                            <span className="text-sm font-bold text-foreground">{s.name}</span>
                                                            <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-muted">{s.tier}</span>
                                                        </div>
                                                        <span className="text-sm font-extrabold text-foreground tabular-nums">{formatINR(s.revenue)}</span>
                                                    </div>
                                                    <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                                                        <motion.div initial={{ width: 0 }} animate={{ width: `${(s.revenue / maxR) * 100}%` }} transition={{ delay: 0.9 + i * 0.06, duration: 0.7 }}
                                                            className="h-full bg-gradient-to-r from-emerald-600 to-lime-400 rounded-full" />
                                                    </div>
                                                </div>
                                                <ArrowUpRight className="w-4 h-4 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            )}
                        </motion.div>

                        {/* Status breakdown */}
                        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}
                            className="clay-card p-6">
                            <div className="flex items-center gap-2 mb-1">
                                <CreditCard className="w-4 h-4 text-emerald-700" />
                                <h3 className="text-sm font-bold text-foreground">Invoice Status</h3>
                            </div>
                            <p className="text-[11px] text-muted font-medium mb-4">Last {invoices.length} invoices</p>
                            {(() => {
                                const counts: Record<string, number> = {};
                                invoices.forEach(i => { const k = i.status.toLowerCase(); counts[k] = (counts[k] || 0) + 1; });
                                const items = [
                                    { k: 'paid', label: 'Paid', color: 'bg-emerald-500', text: 'text-emerald-700' },
                                    { k: 'pending', label: 'Pending', color: 'bg-amber-500', text: 'text-amber-700' },
                                    { k: 'overdue', label: 'Overdue', color: 'bg-rose-500', text: 'text-rose-700' },
                                    { k: 'partial', label: 'Partial', color: 'bg-blue-500', text: 'text-blue-700' },
                                ];
                                const total = invoices.length || 1;
                                return (
                                    <div className="space-y-4">
                                        <div className="h-3 rounded-full overflow-hidden flex bg-stone-100">
                                            {items.map(it => {
                                                const c = counts[it.k] || 0;
                                                if (!c) return null;
                                                return <motion.div key={it.k} className={it.color}
                                                    initial={{ width: 0 }} animate={{ width: `${(c / total) * 100}%` }} transition={{ duration: 0.9, delay: 0.9 }} />;
                                            })}
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            {items.map(it => (
                                                <div key={it.k} className="flex items-center gap-2">
                                                    <span className={`w-2.5 h-2.5 rounded-full ${it.color}`} />
                                                    <span className="text-xs font-bold text-foreground">{it.label}</span>
                                                    <span className="ml-auto text-xs font-bold text-muted tabular-nums">{counts[it.k] || 0}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="pt-3 border-t border-stone-100">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Period revenue</span>
                                                <Calendar className="w-3 h-3 text-muted" />
                                            </div>
                                            <div className="text-2xl font-extrabold text-foreground tabular-nums">{formatINR(periodRevenue)}</div>
                                        </div>
                                    </div>
                                );
                            })()}
                        </motion.div>
                    </div>

                    {/* ─── Invoices table ─── */}
                    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}
                        className="clay-card overflow-hidden">
                        <div className="p-6 md:p-8 border-b border-stone-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <h3 className="text-xl font-bold text-foreground">Invoice Ledger</h3>
                                <p className="text-xs text-muted mt-1 font-medium">{filteredInvoices.length} of {invoices.length} invoices shown</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="relative">
                                    <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
                                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search school or invoice…"
                                        className="clay-input !pl-10 !py-2 !text-xs !rounded-full w-full md:w-64" />
                                </div>
                                <div className="flex items-center gap-1 bg-stone-100/60 rounded-full p-1">
                                    {['all', 'paid', 'pending', 'overdue'].map(s => (
                                        <button key={s} onClick={() => setStatusFilter(s)}
                                            className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider transition
                                                ${statusFilter === s ? 'bg-white text-foreground shadow-sm' : 'text-muted hover:text-foreground'}`}>
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-[#FAF9F6]/60">
                                    <tr>
                                        {['Invoice', 'School', 'Plan', 'Due Date', 'Amount', 'Status', ''].map(h => (
                                            <th key={h} className="px-6 py-4 text-left text-[10px] font-black text-muted uppercase tracking-[0.15em]">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-stone-100">
                                    {loading ? (
                                        <tr><td colSpan={7} className="px-6 py-16 text-center">
                                            <div className="inline-flex items-center gap-2 text-muted text-sm italic">
                                                <RefreshCcw className="w-4 h-4 animate-spin" /> Loading invoice ledger…
                                            </div>
                                        </td></tr>
                                    ) : filteredInvoices.length === 0 ? (
                                        <tr><td colSpan={7} className="px-6 py-20 text-center">
                                            <Wallet className="w-10 h-10 mx-auto mb-3 opacity-20 text-muted" />
                                            <p className="text-sm text-muted italic">No invoices match your filters.</p>
                                        </td></tr>
                                    ) : filteredInvoices.map((inv, idx) => (
                                        <motion.tr key={inv.rawId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(idx * 0.02, 0.4) }}
                                            className="hover:bg-emerald-50/30 transition-colors group">
                                            <td className="px-6 py-4">
                                                <span className="text-sm font-extrabold text-foreground">#INV-{inv.id}</span>
                                            </td>
                                            <td className="px-6 py-4 text-sm font-bold text-stone-700">{inv.school_name}</td>
                                            <td className="px-6 py-4">
                                                <span className="text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider bg-stone-100 text-stone-600">{inv.plan_type}</span>
                                            </td>
                                            <td className="px-6 py-4 text-xs text-muted font-medium">{inv.due_date}</td>
                                            <td className="px-6 py-4 text-sm font-extrabold text-foreground tabular-nums">{formatINR(inv.amount)}</td>
                                            <td className="px-6 py-4"><StatusPill status={inv.status} /></td>
                                            <td className="px-6 py-4 text-right">
                                                <ChevronRight className="w-4 h-4 text-muted opacity-0 group-hover:opacity-100 transition-opacity inline" />
                                            </td>
                                        </motion.tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </motion.div>

                    {/* ─── School Subscriptions panel (lifecycle + admin actions) ─── */}
                    <SchoolsSubscriptionPanel />
                </div>



                <footer className="mt-auto border-t border-stone-200/60 py-6 text-center text-xs text-muted font-medium bg-[#FAF9F6]">
                    Finance Console · INR · Superadmin access
                </footer>
            </main>
        </div>
    );
};

export default FinanceBilling;
