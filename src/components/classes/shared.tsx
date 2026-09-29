import React from 'react';
import { motion } from 'framer-motion';

export const gradientMap: Record<string, string> = {
    teal: 'from-teal-500 to-emerald-600',
    amber: 'from-amber-500 to-orange-500',
    violet: 'from-indigo-500 to-violet-600',
    rose: 'from-rose-500 to-pink-600',
    sky: 'from-sky-500 to-cyan-600',
};

export const Chip: React.FC<{ children: React.ReactNode; tone?: 'teal' | 'stone' | 'amber' | 'rose' | 'sky' }> = ({ children, tone = 'stone' }) => {
    const map = {
        teal: 'bg-teal-50 text-primary ring-teal-100',
        stone: 'bg-stone-100 text-stone-600 ring-stone-200',
        amber: 'bg-amber-50 text-amber-700 ring-amber-200',
        rose: 'bg-rose-50 text-rose-700 ring-rose-200',
        sky: 'bg-sky-50 text-sky-700 ring-sky-200',
    } as const;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md ring-1 text-[10px] font-bold uppercase tracking-wide ${map[tone]}`}>
            {children}
        </span>
    );
};

export const Drawer: React.FC<{ open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }> = ({ open, onClose, title, subtitle, children, footer }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[80]">
            <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={onClose}
            />
            <motion.aside
                initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 26, stiffness: 240 }}
                className="absolute right-0 top-0 h-full w-full sm:max-w-2xl xl:max-w-4xl bg-[#FAF9F6] shadow-2xl flex flex-col"
            >
                <div className="p-5 sm:p-6 border-b border-stone-200 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-xl font-extrabold truncate">{title}</h2>
                        {subtitle && <p className="text-xs text-muted mt-0.5 truncate">{subtitle}</p>}
                    </div>
                    <button onClick={onClose} className="w-10 h-10 rounded-xl bg-white border border-stone-200 shadow-sm hover:text-rose-500 flex items-center justify-center transition shrink-0">✕</button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 sm:p-6">{children}</div>
                {footer && <div className="p-4 border-t border-stone-200 bg-white/60">{footer}</div>}
            </motion.aside>
        </div>
    );
};

export const EmptyState: React.FC<{ title: string; hint?: string; icon?: React.ReactNode }> = ({ title, hint, icon }) => (
    <div className="p-10 text-center text-muted">
        {icon && <div className="mx-auto mb-3 w-12 h-12 rounded-2xl bg-stone-100 flex items-center justify-center text-stone-400">{icon}</div>}
        <p className="text-sm font-bold text-stone-700">{title}</p>
        {hint && <p className="text-xs mt-1 text-stone-500">{hint}</p>}
    </div>
);
