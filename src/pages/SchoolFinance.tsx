import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Wallet, Receipt, Coins, Briefcase, Loader2, FileText, Users, AlertCircle, LayoutList, ClipboardList
} from 'lucide-react';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { currency, StatCard } from '../components/school-finance/shared';
import FeeHeadsTab from '../components/school-finance/FeeHeadsTab';
import FeePlansTab from '../components/school-finance/FeePlansTab';
import AssignmentsTab from '../components/school-finance/AssignmentsTab';
import InvoicesTab from '../components/school-finance/InvoicesTab';
import ReceiptsTab from '../components/school-finance/ReceiptsTab';
import AdditionalChargesTab from '../components/school-finance/AdditionalChargesTab';

type Tab = 'overview' | 'heads' | 'plans' | 'assign' | 'invoices' | 'receipts' | 'charges' | 'salary';

interface Kpis {
    collected: number; pending: number; overdue: number; salary: number; students: number; plans: number;
}

const SchoolFinance: React.FC = () => {
    const { user } = useAuth();
    const [tab, setTab] = useState<Tab>(() => new URLSearchParams(window.location.search).get('tab') === 'plans' ? 'plans' : 'overview');
    const [openNewPlan] = useState(() => new URLSearchParams(window.location.search).get('newPlan') === '1');
    const [schoolId, setSchoolId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [kpis, setKpis] = useState<Kpis>({ collected: 0, pending: 0, overdue: 0, salary: 0, students: 0, plans: 0 });
    const [salary, setSalary] = useState<Array<{ id: string; employee_id: string; month: number; year: number; net_salary: number; status: string }>>([]);

    useEffect(() => {
        (async () => {
            if (!user) return;
            const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single();
            if (!profile?.school_id) { setLoading(false); return; }
            setSchoolId(profile.school_id);
        })();
    }, [user]);

    useEffect(() => {
        if (!schoolId) return;
        (async () => {
            setLoading(true);
            const [inv, sal, stu, pln] = await Promise.all([
                supabase.from('invoices').select('amount,paid_amount,status').eq('school_id', schoolId).is('deleted_at', null),
                supabase.from('salary').select('id,employee_id,month,year,net_salary,status').eq('school_id', schoolId).order('year', { ascending: false }).order('month', { ascending: false }).limit(50),
                supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('role', 'student'),
                supabase.from('fee_plans').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('is_active', true),
            ]);
            const invs = inv.data ?? [];
            const collected = invs.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
            const pending = invs.filter(i => ['pending', 'partial'].includes(i.status)).reduce((s, i) => s + (Number(i.amount) - Number(i.paid_amount || 0)), 0);
            const overdue = invs.filter(i => i.status === 'overdue').length;
            const salaryTot = (sal.data ?? []).reduce((s, r) => s + Number(r.net_salary || 0), 0);
            setKpis({ collected, pending, overdue, salary: salaryTot, students: stu.count ?? 0, plans: pln.count ?? 0 });
            setSalary(sal.data ?? []);
            setLoading(false);
        })();
    }, [schoolId, tab]);

    const tabs: Array<{ key: Tab; label: string; short?: string; icon: React.ElementType }> = [
        { key: 'overview', label: 'Overview', icon: LayoutList },
        { key: 'heads', label: 'Fee Heads (Other Fees)', icon: Coins },
        { key: 'plans', label: 'Fee Plans', icon: ClipboardList },
        { key: 'assign', label: 'Assignments', short: 'Assign', icon: Users },
        { key: 'invoices', label: 'Invoices', icon: FileText },
        { key: 'receipts', label: 'Receipts', icon: Receipt },
        { key: 'charges', label: 'Additional', short: 'Charges', icon: AlertCircle },
        { key: 'salary', label: 'Salary', icon: Briefcase },
    ];

    if (loading && !schoolId) {
        return (
            <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!schoolId) {
        return (
            <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center p-6">
                <div className="clay-card p-8 max-w-md text-center">
                    <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
                    <h3 className="text-lg font-bold">No school linked to your account</h3>
                    <p className="text-sm text-muted mt-2">Contact your administrator.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen bg-background relative selection:bg-teal-100 selection:text-primary">
            <Sidebar activePage="School Finance" />
            <div className="flex-1 lg:ml-72 flex flex-col min-h-screen min-w-0 transition-[margin] duration-300 ease-out">
                <Header title="School Finance" />
                <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 overflow-x-hidden overflow-y-auto pb-24 min-w-0">

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard label="Collected" value={currency(kpis.collected)} icon={Wallet} accent="bg-gradient-to-br from-emerald-500 to-teal-600" sub="All time" />
                        <StatCard label="Pending" value={currency(kpis.pending)} icon={Coins} accent="bg-gradient-to-br from-amber-500 to-orange-500" sub="Not yet paid" />
                        <StatCard label="Overdue Invoices" value={String(kpis.overdue)} icon={AlertCircle} accent="bg-gradient-to-br from-rose-500 to-pink-600" sub="Past due date" />
                        <StatCard label="Salary Paid" value={currency(kpis.salary)} icon={Briefcase} accent="bg-gradient-to-br from-indigo-500 to-violet-600" sub="Recent 50 records" />
                    </div>

                    {/* Mobile / tablet: dropdown switcher */}
                    <div className="xl:hidden">
                        <label className="block text-xs font-bold text-muted uppercase tracking-wider mb-2">Section</label>
                        <div className="relative">
                            <select
                                value={tab}
                                onChange={(e) => setTab(e.target.value as Tab)}
                                className="clay-input w-full appearance-none pl-4 pr-10 py-3 text-sm font-semibold rounded-xl border border-gray-200 bg-white focus:ring-2 focus:ring-primary/20 outline-none"
                            >
                                {tabs.map(t => (
                                    <option key={t.key} value={t.key}>{t.label}</option>
                                ))}
                            </select>
                            <svg className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd"/></svg>
                        </div>
                    </div>

                    {/* Desktop XL+: wrapping pill tabs (no horizontal scroll) */}
                    <div className="hidden xl:block clay-card p-1.5">
                        <div className="flex flex-wrap gap-1">
                            {tabs.map(t => {
                                const Icon = t.icon;
                                const active = tab === t.key;
                                return (
                                    <button key={t.key} onClick={() => setTab(t.key)}
                                        className={`px-4 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2 transition ${active ? 'bg-primary text-white shadow-md' : 'text-muted hover:bg-stone-100'}`}>
                                        <Icon size={14} />
                                        <span>{t.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <AnimatePresence mode="wait">
                        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} className="min-w-0 w-full">
                            {tab === 'overview' && (
                                <div className="grid gap-4 lg:grid-cols-2">
                                    <div className="clay-card p-6">
                                        <h3 className="text-lg font-extrabold mb-3">Quick Stats</h3>
                                        <ul className="text-sm space-y-2">
                                            <li className="flex justify-between"><span className="text-muted">Active students</span><span className="font-bold">{kpis.students}</span></li>
                                            <li className="flex justify-between"><span className="text-muted">Active fee plans</span><span className="font-bold">{kpis.plans}</span></li>
                                            <li className="flex justify-between"><span className="text-muted">Collection ratio</span><span className="font-bold">{kpis.collected + kpis.pending > 0 ? Math.round(kpis.collected * 100 / (kpis.collected + kpis.pending)) : 0}%</span></li>
                                        </ul>
                                    </div>
                                    <div className="clay-card p-6">
                                        <h3 className="text-lg font-extrabold mb-3">How it works</h3>
                                        <ol className="text-sm text-muted space-y-2 list-decimal list-inside">
                                            <li>Create <b>Fee Heads</b> (Tuition, Bus, Lab…)</li>
                                            <li>Group them into <b>Fee Plans</b> per class + frequency</li>
                                            <li><b>Assign</b> plans to students (with discounts / scholarships)</li>
                                            <li>Invoices auto-generate daily; late fees apply after grace</li>
                                            <li>Record full or <b>partial payments</b> → receipts auto-issued</li>
                                        </ol>
                                    </div>
                                </div>
                            )}
                            {tab === 'heads' && <FeeHeadsTab schoolId={schoolId} />}
                            {tab === 'plans' && <FeePlansTab schoolId={schoolId} autoOpen={openNewPlan} />}
                            {tab === 'assign' && <AssignmentsTab schoolId={schoolId} />}
                            {tab === 'invoices' && <InvoicesTab schoolId={schoolId} />}
                            {tab === 'receipts' && <ReceiptsTab schoolId={schoolId} />}
                            {tab === 'charges' && <AdditionalChargesTab schoolId={schoolId} />}
                            {tab === 'salary' && (
                                <div className="clay-card overflow-hidden">
                                    {salary.length === 0 ? (
                                        <div className="p-10 text-center text-muted text-sm">No salary records.</div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead className="bg-stone-50 text-muted uppercase text-[11px] tracking-wider">
                                                    <tr><th className="px-4 py-3 text-left">Employee</th><th className="px-4 py-3 text-left">Period</th><th className="px-4 py-3 text-right">Net Salary</th><th className="px-4 py-3 text-center">Status</th></tr>
                                                </thead>
                                                <tbody className="divide-y divide-stone-100">
                                                    {salary.map(r => (
                                                        <tr key={r.id}>
                                                            <td className="px-4 py-3 font-mono text-xs">{r.employee_id.slice(0, 8)}</td>
                                                            <td className="px-4 py-3">{r.month}/{r.year}</td>
                                                            <td className="px-4 py-3 text-right font-mono">{currency(r.net_salary)}</td>
                                                            <td className="px-4 py-3 text-center capitalize">{r.status}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </main>
            </div>
        </div>
    );
};

export default SchoolFinance;
