import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import {
    format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
    addDays, isSameMonth, isSameDay, isBefore, startOfDay, parseISO
} from 'date-fns';

interface Props {
    value: string;          // YYYY-MM-DD
    onChange: (v: string) => void;
    min?: Date;
    accent?: 'emerald' | 'indigo' | 'rose';
    label?: string;
}

const ACCENT = {
    emerald: { ring: 'focus:ring-emerald-500', selBg: 'bg-emerald-600', selRing: 'ring-emerald-500', soft: 'bg-emerald-50 text-emerald-700', grad: 'from-emerald-500 to-teal-600' },
    indigo: { ring: 'focus:ring-indigo-500', selBg: 'bg-indigo-600', selRing: 'ring-indigo-500', soft: 'bg-indigo-50 text-indigo-700', grad: 'from-indigo-500 to-violet-600' },
    rose: { ring: 'focus:ring-rose-500', selBg: 'bg-rose-600', selRing: 'ring-rose-500', soft: 'bg-rose-50 text-rose-700', grad: 'from-rose-500 to-red-600' },
};

const PRESETS = [
    { label: '+7 days', days: 7 },
    { label: '+15 days', days: 15 },
    { label: '+30 days', days: 30 },
    { label: '+90 days', days: 90 },
];

export const AnimatedDatePicker: React.FC<Props> = ({ value, onChange, min, accent = 'emerald', label }) => {
    const A = ACCENT[accent];
    const today = startOfDay(new Date());
    const minDate = min ? startOfDay(min) : today;
    const selected = value ? parseISO(value) : null;
    const [open, setOpen] = useState(false);
    const [cursor, setCursor] = useState<Date>(selected || today);
    const ref = useRef<HTMLDivElement>(null);
    const btnRef = useRef<HTMLButtonElement>(null);
    const popRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

    const computePos = () => {
        const btn = btnRef.current;
        if (!btn) return;
        const r = btn.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const popW = Math.min(340, vw - 16);
        const popH = 380; // approx
        let left = r.left + r.width / 2 - popW / 2;
        left = Math.max(8, Math.min(left, vw - popW - 8));
        let top = r.bottom + 8;
        if (top + popH > vh - 8 && r.top - 8 - popH > 8) {
            top = r.top - 8 - popH;
        } else if (top + popH > vh - 8) {
            top = Math.max(8, vh - popH - 8);
        }
        setPos({ top, left, width: popW });
    };

    useLayoutEffect(() => {
        if (!open) return;
        computePos();
        const onScroll = () => computePos();
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
        return () => {
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onScroll);
        };
    }, [open, cursor]);

    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            const t = e.target as Node;
            if (ref.current?.contains(t)) return;
            if (popRef.current?.contains(t)) return;
            setOpen(false);
        };
        if (open) document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [open]);

    useEffect(() => { if (selected) setCursor(selected);   }, [value]);

    const monthStart = startOfMonth(cursor);
    const monthEnd = endOfMonth(cursor);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    const days: Date[] = [];
    let d = gridStart;
    while (d <= gridEnd) { days.push(d); d = addDays(d, 1); }

    const pick = (date: Date) => {
        if (isBefore(date, minDate)) return;
        onChange(format(date, 'yyyy-MM-dd'));
        setOpen(false);
    };

    const applyPreset = (n: number) => {
        const target = addDays(today, n);
        pick(target);
    };

    return (
        <div ref={ref} className="relative">
            {label && <span className="text-xs font-bold uppercase tracking-wider text-muted">{label}</span>}
            <button
                ref={btnRef}
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`mt-1 w-full px-4 py-3.5 rounded-2xl ring-1 ring-stone-200 bg-stone-50 font-bold text-foreground flex items-center justify-between gap-3 transition hover:ring-stone-300 ${A.ring} focus:ring-2 outline-none`}
            >
                <span className="flex items-center gap-2.5">
                    <span className={`w-9 h-9 rounded-xl bg-gradient-to-br ${A.grad} text-white flex items-center justify-center shadow-sm`}>
                        <CalendarIcon className="w-4 h-4" />
                    </span>
                    <span className="flex flex-col items-start leading-tight">
                        <span className="text-[10px] uppercase tracking-wider text-muted font-semibold">Selected date</span>
                        <span className="text-sm font-extrabold">
                            {selected ? format(selected, 'EEE, dd MMM yyyy') : 'Pick a date'}
                        </span>
                    </span>
                </span>
                <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-muted text-xs">▾</motion.span>
            </button>

            {typeof document !== 'undefined' && createPortal(
                <AnimatePresence>
                    {open && pos && (
                        <motion.div
                            ref={popRef}
                            initial={{ opacity: 0, y: -8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -8, scale: 0.96 }}
                            transition={{ duration: 0.18, ease: 'easeOut' }}
                            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 1000 }}
                            className="bg-white rounded-3xl shadow-2xl ring-1 ring-stone-200 p-4 max-h-[90vh] overflow-auto"
                        >
                            {/* Header */}
                        <div className="flex items-center justify-between mb-3">
                            <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => setCursor(subMonths(cursor, 1))}
                                className="w-9 h-9 rounded-xl hover:bg-stone-100 flex items-center justify-center">
                                <ChevronLeft className="w-4 h-4" />
                            </motion.button>
                            <div className="text-sm font-extrabold text-foreground">{format(cursor, 'MMMM yyyy')}</div>
                            <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => setCursor(addMonths(cursor, 1))}
                                className="w-9 h-9 rounded-xl hover:bg-stone-100 flex items-center justify-center">
                                <ChevronRight className="w-4 h-4" />
                            </motion.button>
                        </div>

                        {/* Weekdays */}
                        <div className="grid grid-cols-7 gap-1 mb-1.5">
                            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
                                <div key={i} className="h-7 flex items-center justify-center text-[10px] font-bold uppercase tracking-wider text-muted">{w}</div>
                            ))}
                        </div>

                        {/* Days */}
                        <motion.div
                            key={format(cursor, 'yyyy-MM')}
                            initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.15 }}
                            className="grid grid-cols-7 gap-1"
                        >
                            {days.map((day, i) => {
                                const isSel = selected && isSameDay(day, selected);
                                const isToday = isSameDay(day, today);
                                const outside = !isSameMonth(day, cursor);
                                const disabled = isBefore(day, minDate);
                                return (
                                    <motion.button
                                        key={i}
                                        type="button"
                                        whileHover={!disabled ? { scale: 1.08 } : undefined}
                                        whileTap={!disabled ? { scale: 0.92 } : undefined}
                                        onClick={() => pick(day)}
                                        disabled={disabled}
                                        className={`h-9 rounded-xl text-sm font-semibold transition relative
                                            ${disabled ? 'text-stone-300 cursor-not-allowed' : 'cursor-pointer'}
                                            ${outside && !disabled ? 'text-stone-400' : ''}
                                            ${!outside && !disabled && !isSel ? 'text-foreground hover:bg-stone-100' : ''}
                                            ${isSel ? `${A.selBg} text-white shadow-md shadow-black/10` : ''}
                                            ${isToday && !isSel ? `ring-1 ${A.selRing}` : ''}`}
                                    >
                                        {format(day, 'd')}
                                    </motion.button>
                                );
                            })}
                        </motion.div>

                        {/* Presets */}
                        <div className="mt-4 pt-3 border-t border-stone-100">
                            <div className="text-[10px] uppercase tracking-wider text-muted font-bold mb-2">Quick pick</div>
                            <div className="grid grid-cols-4 gap-1.5">
                                {PRESETS.map(p => {
                                    const target = addDays(today, p.days);
                                    const active = selected && isSameDay(target, selected);
                                    return (
                                        <motion.button
                                            key={p.days}
                                            type="button"
                                            whileTap={{ scale: 0.95 }}
                                            onClick={() => applyPreset(p.days)}
                                            className={`py-2 rounded-xl text-xs font-bold transition ${active ? `${A.soft} ring-1 ${A.selRing}` : 'bg-stone-50 hover:bg-stone-100 text-foreground'}`}
                                        >
                                            {p.label}
                                        </motion.button>
                                    );
                                })}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>,
            document.body
            )}
        </div>
    );
};

export default AnimatedDatePicker;
