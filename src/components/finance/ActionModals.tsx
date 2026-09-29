import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Unlock, CalendarClock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'sonner';
import AnimatedDatePicker from '../ui/AnimatedDatePicker';


interface BaseProps { open: boolean; onClose: () => void; onDone: () => void; }

const Shell: React.FC<{ open: boolean; onClose: () => void; title: string; children: React.ReactNode }> = ({ open, onClose, title, children }) => (
    <AnimatePresence>
        {open && (
            <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
                    onClick={e => e.stopPropagation()}
                    className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 ring-1 ring-stone-200"
                >
                    <div className="flex items-start justify-between mb-4">
                        <h2 className="text-xl font-extrabold text-foreground">{title}</h2>
                        <button onClick={onClose} className="p-1.5 rounded-full hover:bg-stone-100">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    {children}
                </motion.div>
            </motion.div>
        )}
    </AnimatePresence>
);

const SubmitBtn: React.FC<{ loading: boolean; label: string }> = ({ loading, label }) => (
    <button type="submit" disabled={loading}
        className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-60">
        {loading && <Loader2 className="w-4 h-4 animate-spin" />} {label}
    </button>
);

// ── Extend due date ─────────────────────────────────────────────────
export const ExtendDueModal: React.FC<BaseProps & { schoolId: string; schoolName: string }> = ({ open, onClose, onDone, schoolId, schoolName }) => {
    const { user } = useAuth();
    const [days, setDays] = useState(7);
    const [loading, setLoading] = useState(false);
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        const { error } = await supabase.rpc('fn_extend_due_date', { p_school: schoolId, p_days: days, p_actor: user?.id });
        setLoading(false);
        if (error) { toast.error(error.message); return; }
        toast.success(`Extended by ${days} days`); onDone(); onClose();
    };
    return (
        <Shell open={open} onClose={onClose} title="Extend Due Date">
            <form onSubmit={submit} className="space-y-4">
                <p className="text-sm text-muted">Push all pending invoices for <b>{schoolName}</b> forward.</p>
                <label className="block">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted">Days</span>
                    <input type="number" min={1} max={365} value={days} onChange={e => setDays(Number(e.target.value))}
                        className="mt-1 w-full px-4 py-3 rounded-2xl ring-1 ring-stone-200 bg-stone-50 font-bold text-foreground focus:ring-emerald-500 outline-none" />
                </label>
                <SubmitBtn loading={loading} label={`Extend by ${days} days`} />
            </form>
        </Shell>
    );
};

// ── Manual unlock ───────────────────────────────────────────────────
export const UnlockModal: React.FC<BaseProps & { schoolId: string; schoolName: string }> = ({ open, onClose, onDone, schoolId, schoolName }) => {
    const { user } = useAuth();
    const [until, setUntil] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() + 7);
        return d.toISOString().slice(0, 10);
    });
    const [loading, setLoading] = useState(false);
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        const { error } = await supabase.rpc('fn_manual_unlock', { p_school: schoolId, p_until: until, p_actor: user?.id });
        setLoading(false);
        if (error) { toast.error(error.message); return; }
        toast.success('School unlocked'); onDone(); onClose();
    };
    return (
        <Shell open={open} onClose={onClose} title="Manual Unlock">
            <form onSubmit={submit} className="space-y-5">
                <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 ring-1 ring-emerald-100">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                        <Unlock className="w-5 h-5" />
                    </div>
                    <div className="text-sm">
                        <p className="font-bold text-emerald-900">{schoolName}</p>
                        <p className="text-emerald-800/80 text-xs mt-0.5">Restore full access until the date you choose below.</p>
                    </div>
                </div>

                <AnimatedDatePicker
                    label="Unlock until"
                    value={until}
                    onChange={setUntil}
                    accent="emerald"
                />

                <motion.button
                    type="submit"
                    disabled={loading}
                    whileHover={!loading ? { scale: 1.01 } : undefined}
                    whileTap={!loading ? { scale: 0.98 } : undefined}
                    className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 text-white font-extrabold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 disabled:opacity-60"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
                    Unlock until {new Date(until).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </motion.button>
            </form>
        </Shell>
    );
};


// ── Mark paid ───────────────────────────────────────────────────────
export const MarkPaidModal: React.FC<BaseProps & { schoolId: string; schoolName: string }> = ({ open, onClose, onDone, schoolId, schoolName }) => {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [invoices, setInvoices] = useState<{ id: string; invoice_number: string | null; amount: number; due_date: string }[]>([]);
    const [pickedId, setPickedId] = useState<string>('');

    useEffect(() => {
        if (!open) return;
        (async () => {
            const { data } = await supabase
                .from('invoices')
                .select('id, invoice_number, amount, due_date')
                .eq('school_id', schoolId)
                .in('status', ['pending', 'overdue'])
                .is('deleted_at', null)
                .order('due_date', { ascending: true });
            setInvoices(data || []);
            if (data && data[0]) setPickedId(data[0].id);
        })();
    }, [open, schoolId]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!pickedId) return;
        setLoading(true);
        const { error } = await supabase.rpc('fn_mark_invoice_paid', { p_invoice: pickedId, p_actor: user?.id });
        setLoading(false);
        if (error) { toast.error(error.message); return; }
        toast.success('Invoice marked paid'); onDone(); onClose();
    };
    return (
        <Shell open={open} onClose={onClose} title={`Mark Invoice Paid — ${schoolName}`}>
            <form onSubmit={submit} className="space-y-4">
                {invoices.length === 0 ? (
                    <p className="text-sm text-muted">No pending invoices.</p>
                ) : (
                    <div className="space-y-2 max-h-64 overflow-auto">
                        {invoices.map(i => (
                            <label key={i.id} className={`block px-4 py-3 rounded-2xl ring-1 cursor-pointer transition ${pickedId === i.id ? 'ring-emerald-500 bg-emerald-50' : 'ring-stone-200 hover:ring-stone-300'}`}>
                                <input type="radio" name="inv" className="sr-only" checked={pickedId === i.id} onChange={() => setPickedId(i.id)} />
                                <div className="flex justify-between text-sm">
                                    <span className="font-bold">{i.invoice_number || i.id.slice(0, 8).toUpperCase()}</span>
                                    <span className="font-extrabold">₹{Number(i.amount).toLocaleString('en-IN')}</span>
                                </div>
                                <div className="text-xs text-muted mt-0.5">Due {new Date(i.due_date).toLocaleDateString('en-IN')}</div>
                            </label>
                        ))}
                    </div>
                )}
                <SubmitBtn loading={loading} label="Mark as paid" />
            </form>
        </Shell>
    );
};

// ── Archive ─────────────────────────────────────────────────────────
export const ArchiveModal: React.FC<BaseProps & { schoolId: string; schoolName: string }> = ({ open, onClose, onDone, schoolId, schoolName }) => {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [confirm, setConfirm] = useState('');
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (confirm !== schoolName) { toast.error('School name does not match'); return; }
        setLoading(true);
        const { error } = await supabase.rpc('fn_archive_school', { p_school: schoolId, p_actor: user?.id });
        setLoading(false);
        if (error) { toast.error(error.message); return; }
        toast.success('School archived'); onDone(); onClose();
    };
    return (
        <Shell open={open} onClose={onClose} title="Archive School">
            <form onSubmit={submit} className="space-y-4">
                <p className="text-sm text-muted">Type <b>{schoolName}</b> to confirm. The school will be locked out and marked archived. Data is retained for recovery.</p>
                <input value={confirm} onChange={e => setConfirm(e.target.value)} required
                    className="w-full px-4 py-3 rounded-2xl ring-1 ring-stone-200 bg-stone-50 font-bold focus:ring-rose-500 outline-none" />
                <button type="submit" disabled={loading || confirm !== schoolName}
                    className="w-full py-3 rounded-2xl bg-gradient-to-r from-rose-600 to-red-700 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />} Archive school
                </button>
            </form>
        </Shell>
    );
};

export const UnarchiveModal: React.FC<BaseProps & { schoolId: string; schoolName: string }> = ({ open, onClose, onDone, schoolId, schoolName }) => {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        const { error } = await supabase.rpc('fn_restore_school', { p_school: schoolId, p_actor: user?.id });
        setLoading(false);
        if (error) { toast.error(error.message); return; }
        toast.success(`${schoolName} restored — active for 30 days`); onDone(); onClose();
    };
    return (
        <Shell open={open} onClose={onClose} title="Unarchive School">
            <form onSubmit={submit} className="space-y-4">
                <p className="text-sm text-muted">
                    Restore <b>{schoolName}</b>? The school will be set back to <b>active</b> and granted a
                    30-day manual unlock window so admins can settle payment without being locked out again.
                </p>
                <button type="submit" disabled={loading}
                    className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />} Unarchive & Reactivate
                </button>
            </form>
        </Shell>
    );
};
