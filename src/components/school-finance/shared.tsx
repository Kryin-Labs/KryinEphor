import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown } from 'lucide-react';

export const currency = (n: number | null | undefined) =>
    '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export const statusStyles: Record<string, string> = {
    paid: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    partial: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
    pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    overdue: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
    waived: 'bg-stone-100 text-stone-600 ring-1 ring-stone-200',
    processed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    active: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    invoiced: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
};

export const StatCard: React.FC<{
    label: string; value: string; sub?: string;
    icon: React.ElementType; accent: string; trend?: number;
}> = ({ label, value, sub, icon: Icon, accent, trend }) => (
    <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="clay-card p-5 relative overflow-hidden group"
    >
        <div className={`absolute -right-8 -top-8 h-28 w-28 rounded-full ${accent} opacity-20 blur-2xl group-hover:opacity-30 transition`} />
        <div className="flex items-start justify-between relative">
            <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted">{label}</p>
                <p className="mt-2 text-2xl font-extrabold text-foreground">{value}</p>
                {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
            </div>
            <div className={`rounded-2xl ${accent} p-3 text-white shadow-md`}>
                <Icon size={18} />
            </div>
        </div>
        {trend !== undefined && (
            <div className={`mt-3 inline-flex items-center gap-1 text-xs font-semibold ${trend >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {Math.abs(trend)}% vs last month
            </div>
        )}
    </motion.div>
);

export const Pill: React.FC<{ status: string }> = ({ status }) => (
    <span className={`inline-flex px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wide ${statusStyles[status] ?? 'bg-stone-100 text-stone-600'}`}>
        {status}
    </span>
);

export const Modal: React.FC<{ open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }> = ({ open, onClose, title, children, wide }) => {
    if (!open) return null;
    return (
        <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }}
                transition={{ type: 'spring', damping: 22, stiffness: 260 }}
                className={`clay-card p-6 w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-extrabold text-foreground">{title}</h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-stone-100 flex items-center justify-center text-muted">✕</button>
                </div>
                {children}
            </motion.div>
        </motion.div>
    );
};
