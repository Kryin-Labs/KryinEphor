import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Lock, CreditCard, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSubscriptionGate } from '../../hooks/useSubscriptionGate';
import { format, differenceInDays } from 'date-fns';

const SubscriptionBanner: React.FC = () => {
    const { status, nextDueDate, outstanding, loading } = useSubscriptionGate();
    const [dismissed, setDismissed] = React.useState(false);

    if (loading || dismissed) return null;
    if (status !== 'payment_due' && status !== 'locked') return null;

    const daysOver = nextDueDate ? differenceInDays(new Date(), new Date(nextDueDate)) : 0;
    const isLocked = status === 'locked';

    const cfg = isLocked
        ? { bg: 'from-rose-600 to-red-700', icon: Lock, label: 'Account locked', detail: `Pay outstanding ₹${outstanding.toLocaleString('en-IN')} to restore access.` }
        : { bg: 'from-amber-500 to-orange-600', icon: AlertTriangle, label: 'Payment due', detail: `₹${outstanding.toLocaleString('en-IN')} due ${nextDueDate ? `on ${format(new Date(nextDueDate), 'dd MMM yyyy')}` : 'soon'}${daysOver > 0 ? ` · ${daysOver} day${daysOver > 1 ? 's' : ''} overdue` : ''}.` };
    const Icon = cfg.icon;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -60, opacity: 0 }}
                className={`sticky top-0 z-50 bg-gradient-to-r ${cfg.bg} text-white shadow-lg`}
            >
                <div className="max-w-screen-2xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="p-1.5 rounded-full bg-white/15 flex-shrink-0">
                            <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                            <span className="font-bold text-sm">{cfg.label}.</span>
                            <span className="ml-2 text-sm opacity-95 truncate">{cfg.detail}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <Link to="/finance" className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white text-foreground text-xs font-bold hover:scale-105 transition">
                            <CreditCard className="w-3.5 h-3.5" /> Pay now
                        </Link>
                        {!isLocked && (
                            <button onClick={() => setDismissed(true)} className="p-1.5 rounded-full hover:bg-white/10" aria-label="Dismiss">
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};

export default SubscriptionBanner;
