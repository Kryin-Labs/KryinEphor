import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Building2, Calendar, MoreVertical, CheckCircle2, Clock, Lock, Archive, PlayCircle, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { ExtendDueModal, UnlockModal, MarkPaidModal, ArchiveModal, UnarchiveModal } from './ActionModals';

interface Row {
    id: string;
    name: string;
    plan_id: string | null;
    plan_name: string | null;
    amount: number | null;
    next_due_date: string | null;
    subscription_status: 'active' | 'payment_due' | 'locked' | 'archived';
    outstanding_amount: number;
}

const statusConfig = {
    active:      { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200', Icon: CheckCircle2, label: 'Active' },
    payment_due: { bg: 'bg-amber-50',   text: 'text-amber-700',   ring: 'ring-amber-200',   Icon: Clock,        label: 'Payment Due' },
    locked:      { bg: 'bg-rose-50',    text: 'text-rose-700',    ring: 'ring-rose-200',    Icon: Lock,         label: 'Locked' },
    archived:    { bg: 'bg-stone-100',  text: 'text-stone-600',   ring: 'ring-stone-200',   Icon: Archive,      label: 'Archived' },
};

const StatusPill: React.FC<{ s: Row['subscription_status'] }> = ({ s }) => {
    const c = statusConfig[s] || statusConfig.active;
    const I = c.Icon;
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ring-1 ${c.bg} ${c.text} ${c.ring}`}>
            <I className="w-3 h-3" /> {c.label}
        </span>
    );
};

type MenuKind = 'extend' | 'unlock' | 'paid' | 'archive' | 'unarchive';

const RowMenu: React.FC<{
    open: boolean;
    isArchived: boolean;
    onToggle: () => void;
    onClose: () => void;
    onPick: (kind: MenuKind) => void;
}> = ({ open, isArchived, onToggle, onClose, onPick }) => {
    const btnRef = useRef<HTMLButtonElement>(null);
    const popRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

    useLayoutEffect(() => {
        if (!open || !btnRef.current) return;
        const compute = () => {
            const r = btnRef.current!.getBoundingClientRect();
            const popW = 208;
            const popH = popRef.current?.offsetHeight ?? 200;
            const spaceBelow = window.innerHeight - r.bottom;
            const top = spaceBelow < popH + 16 && r.top > popH + 16
                ? Math.max(8, r.top - popH - 6)
                : Math.min(window.innerHeight - popH - 8, r.bottom + 6);
            const left = Math.min(window.innerWidth - popW - 8, Math.max(8, r.right - popW));
            setPos({ top, left });
        };
        compute();
        window.addEventListener('scroll', compute, true);
        window.addEventListener('resize', compute);
        return () => {
            window.removeEventListener('scroll', compute, true);
            window.removeEventListener('resize', compute);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            const t = e.target as Node;
            if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
            onClose();
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open, onClose]);

    const items: { k: MenuKind; label: string; danger?: boolean }[] = isArchived
        ? [
            { k: 'unarchive', label: 'Unarchive school' },
        ]
        : [
            { k: 'paid', label: 'Mark invoice paid' },
            { k: 'extend', label: 'Extend due date' },
            { k: 'unlock', label: 'Manual unlock' },
            { k: 'archive', label: 'Archive school', danger: true },
        ];

    return (
        <>
            <button ref={btnRef} onClick={onToggle} className="p-1.5 rounded-full hover:bg-stone-100" aria-label="Row actions">
                <MoreVertical className="w-4 h-4 text-muted" />
            </button>
            {open && pos && createPortal(
                <AnimatePresence>
                    <motion.div
                        ref={popRef}
                        initial={{ opacity: 0, scale: 0.96, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ duration: 0.12 }}
                        style={{ position: 'fixed', top: pos.top, left: pos.left, width: 208, zIndex: 1000, maxHeight: '80vh', overflowY: 'auto' }}
                        className="bg-white rounded-2xl shadow-2xl ring-1 ring-stone-200 py-1.5 text-xs font-bold"
                    >
                        {items.map(opt => (
                            <button key={opt.k}
                                onClick={() => onPick(opt.k)}
                                className={`w-full text-left px-4 py-2 hover:bg-stone-50 ${opt.danger ? 'text-rose-700' : 'text-foreground'}`}>
                                {opt.label}
                            </button>
                        ))}
                    </motion.div>
                </AnimatePresence>,
                document.body
            )}
        </>
    );
};



const SchoolsSubscriptionPanel: React.FC = () => {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [planFilter, setPlanFilter] = useState<string>('all');
    const [running, setRunning] = useState(false);
    const [menuOpen, setMenuOpen] = useState<string | null>(null);
    const [modal, setModal] = useState<{ kind: MenuKind; school: Row } | null>(null);

    const load = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('v_school_subscription_summary')
            .select('*')
            .order('name');
        if (error) toast.error(error.message);
        setRows((data || []) as Row[]);
        setLoading(false);
    };
    useEffect(() => { load(); }, []);

    const runBilling = async () => {
        setRunning(true);
        const { data, error } = await supabase.rpc('fn_billing_run');
        setRunning(false);
        if (error) { toast.error(error.message); return; }
        const r = data as { invoices_created: number; status_changes: number };
        toast.success(`Billing run: ${r.invoices_created} invoices · ${r.status_changes} status changes`);
        load();
    };

    const filtered = useMemo(() => rows.filter(r => {
        if (statusFilter !== 'all' && r.subscription_status !== statusFilter) return false;
        if (planFilter !== 'all' && r.plan_id !== planFilter) return false;
        if (search.trim() && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    }), [rows, statusFilter, planFilter, search]);

    return (
        <motion.section
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-3xl ring-1 ring-stone-200/70 shadow-sm overflow-hidden"
        >
            {/* Header / controls */}
            <div className="p-6 border-b border-stone-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                    <h2 className="text-xl font-extrabold text-foreground flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-emerald-700" /> School Subscriptions
                    </h2>
                    <p className="text-sm text-muted mt-0.5">Plan, next due date, status and outstanding amount per school.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search school…"
                            className="pl-9 pr-3 py-2 rounded-full bg-stone-50 ring-1 ring-stone-200 text-sm font-medium focus:ring-emerald-500 outline-none w-52" />
                    </div>
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                        className="px-3 py-2 rounded-full bg-stone-50 ring-1 ring-stone-200 text-xs font-bold uppercase tracking-wider">
                        <option value="all">All status</option>
                        <option value="active">Active</option>
                        <option value="payment_due">Payment Due</option>
                        <option value="locked">Locked</option>
                        <option value="archived">Archived</option>
                    </select>
                    <select value={planFilter} onChange={e => setPlanFilter(e.target.value)}
                        className="px-3 py-2 rounded-full bg-stone-50 ring-1 ring-stone-200 text-xs font-bold uppercase tracking-wider">
                        <option value="all">All plans</option>
                        <option value="monthly">Monthly</option>
                        <option value="six_month">6-Month</option>
                    </select>
                    <button onClick={runBilling} disabled={running}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-foreground text-white text-xs font-bold uppercase tracking-wider disabled:opacity-60 hover:scale-105 transition">
                        {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                        Run billing
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-[10px] uppercase tracking-widest text-muted font-bold bg-stone-50/60">
                            <th className="text-left px-6 py-3">School</th>
                            <th className="text-left px-4 py-3">Plan</th>
                            <th className="text-right px-4 py-3">Amount</th>
                            <th className="text-left px-4 py-3">Next Due</th>
                            <th className="text-left px-4 py-3">Status</th>
                            <th className="text-right px-4 py-3">Outstanding</th>
                            <th className="px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={7} className="text-center py-10 text-muted">Loading…</td></tr>
                        ) : filtered.length === 0 ? (
                            <tr><td colSpan={7} className="text-center py-10 text-muted">No schools match.</td></tr>
                        ) : filtered.map(r => (
                            <tr key={r.id} className="border-t border-stone-100 hover:bg-stone-50/60 transition">
                                <td className="px-6 py-3 font-bold text-foreground">{r.name}</td>
                                <td className="px-4 py-3 text-muted">{r.plan_name || '—'}</td>
                                <td className="px-4 py-3 text-right font-mono">₹{Number(r.amount || 0).toLocaleString('en-IN')}</td>
                                <td className="px-4 py-3 text-muted">
                                    {r.next_due_date ? (
                                        <span className="inline-flex items-center gap-1.5">
                                            <Calendar className="w-3.5 h-3.5" />
                                            {format(new Date(r.next_due_date), 'dd MMM yyyy')}
                                        </span>
                                    ) : '—'}
                                </td>
                                <td className="px-4 py-3"><StatusPill s={r.subscription_status} /></td>
                                <td className="px-4 py-3 text-right font-extrabold text-rose-700">
                                    {r.outstanding_amount > 0 ? `₹${Number(r.outstanding_amount).toLocaleString('en-IN')}` : <span className="text-stone-300 font-medium">—</span>}
                                </td>
                                <td className="px-4 py-3">
                                    <RowMenu
                                        open={menuOpen === r.id}
                                        isArchived={r.subscription_status === 'archived'}
                                        onToggle={() => setMenuOpen(menuOpen === r.id ? null : r.id)}
                                        onClose={() => setMenuOpen(null)}
                                        onPick={(kind) => { setMenuOpen(null); setModal({ kind, school: r }); }}
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {modal?.kind === 'extend'    && <ExtendDueModal  open onClose={() => setModal(null)} onDone={load} schoolId={modal.school.id} schoolName={modal.school.name} />}
            {modal?.kind === 'unlock'    && <UnlockModal     open onClose={() => setModal(null)} onDone={load} schoolId={modal.school.id} schoolName={modal.school.name} />}
            {modal?.kind === 'paid'      && <MarkPaidModal   open onClose={() => setModal(null)} onDone={load} schoolId={modal.school.id} schoolName={modal.school.name} />}
            {modal?.kind === 'archive'   && <ArchiveModal    open onClose={() => setModal(null)} onDone={load} schoolId={modal.school.id} schoolName={modal.school.name} />}
            {modal?.kind === 'unarchive' && <UnarchiveModal  open onClose={() => setModal(null)} onDone={load} schoolId={modal.school.id} schoolName={modal.school.name} />}
        </motion.section>
    );
};

export default SchoolsSubscriptionPanel;
