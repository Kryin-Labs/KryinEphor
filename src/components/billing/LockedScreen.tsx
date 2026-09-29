import React from 'react';
import { motion } from 'framer-motion';
import { Lock, CreditCard, LifeBuoy, LogOut, Building2, ShieldCheck, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSubscriptionGate } from '../../hooks/useSubscriptionGate';
import { format } from 'date-fns';

const LockedScreen: React.FC = () => {
    const { signOut } = useAuth();
    const { schoolName, outstanding, nextDueDate, planName } = useSubscriptionGate();

    return (
        <div className="min-h-screen bg-gradient-to-br from-stone-50 via-rose-50/60 to-amber-50/60 flex items-center justify-center px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
            <motion.div
                initial={{ scale: 0.94, opacity: 0, y: 16 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="w-full max-w-2xl bg-white rounded-[28px] sm:rounded-[32px] shadow-[0_30px_80px_-20px_rgba(190,18,60,0.25)] ring-1 ring-rose-100/80 overflow-hidden"
                role="alertdialog"
                aria-labelledby="lockdown-title"
                aria-describedby="lockdown-desc"
            >
                {/* Hero */}
                <div className="relative bg-gradient-to-br from-rose-600 via-rose-700 to-red-800 px-6 sm:px-10 py-10 sm:py-14 text-white text-center overflow-hidden">
                    <div className="absolute inset-0 opacity-[0.08] pointer-events-none [background-image:radial-gradient(circle_at_25%_15%,white_0,transparent_45%),radial-gradient(circle_at_80%_80%,white_0,transparent_40%)]" />
                    <motion.div
                        initial={{ rotate: -12, scale: 0 }}
                        animate={{ rotate: 0, scale: 1 }}
                        transition={{ delay: 0.18, type: 'spring', stiffness: 180, damping: 14 }}
                        className="relative inline-flex p-5 rounded-2xl bg-white/15 backdrop-blur-md ring-1 ring-white/20 mb-5 shadow-xl"
                    >
                        <Lock className="w-10 h-10 sm:w-11 sm:h-11" strokeWidth={2.5} />
                    </motion.div>
                    <h1
                        id="lockdown-title"
                        className="relative text-3xl sm:text-4xl font-black tracking-tight"
                    >
                        Account Locked
                    </h1>
                    <p
                        id="lockdown-desc"
                        className="relative mt-3 text-sm sm:text-base text-rose-50/95 font-medium max-w-md mx-auto leading-relaxed"
                    >
                        Your subscription payment is overdue. Access to the workspace has been temporarily restricted.
                    </p>
                </div>

                {/* Body */}
                <div className="px-6 sm:px-10 py-8 sm:py-10 space-y-7 sm:space-y-8">
                    {/* Meta grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div className="rounded-2xl bg-stone-50 ring-1 ring-stone-200/70 p-4 sm:p-5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">
                                School
                            </div>
                            <div className="mt-1.5 flex items-center gap-2 font-bold text-stone-900 truncate">
                                <Building2 className="w-4 h-4 text-emerald-700 shrink-0" />
                                <span className="truncate">{schoolName || '—'}</span>
                            </div>
                        </div>
                        <div className="rounded-2xl bg-stone-50 ring-1 ring-stone-200/70 p-4 sm:p-5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">
                                Plan
                            </div>
                            <div className="mt-1.5 font-bold text-stone-900 truncate">
                                {planName || '—'}
                            </div>
                        </div>
                        <div className="rounded-2xl bg-gradient-to-br from-rose-50 to-rose-100/70 ring-1 ring-rose-200 p-5 sm:p-6 sm:col-span-2">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-rose-700">
                                        Outstanding
                                    </div>
                                    <div className="mt-1.5 text-3xl sm:text-4xl font-black text-rose-700 tracking-tight">
                                        ₹{outstanding.toLocaleString('en-IN')}
                                    </div>
                                    {nextDueDate && (
                                        <div className="mt-1.5 text-xs sm:text-sm text-rose-600/85 font-semibold">
                                            Due since {format(new Date(nextDueDate), 'dd MMM yyyy')}
                                        </div>
                                    )}
                                </div>
                                <div className="hidden sm:flex p-3 rounded-xl bg-white/70 ring-1 ring-rose-200/70 text-rose-600">
                                    <ShieldCheck className="w-6 h-6" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="space-y-3">
                        <Link
                            to="/finance"
                            className="group w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-bold text-sm sm:text-base shadow-lg shadow-emerald-700/20 hover:shadow-emerald-700/30 hover:-translate-y-0.5 active:translate-y-0 transition-all focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300"
                        >
                            <CreditCard className="w-5 h-5" />
                            <span>Pay Now &amp; Restore Access</span>
                            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                        </Link>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <a
                                href="mailto:support@example.com"
                                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-stone-100 hover:bg-stone-200 text-stone-900 font-bold text-sm transition focus:outline-none focus-visible:ring-4 focus-visible:ring-stone-300"
                            >
                                <LifeBuoy className="w-4 h-4" />
                                Contact Support
                            </a>
                            <button
                                type="button"
                                onClick={() => signOut()}
                                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-white ring-1 ring-stone-200 hover:bg-stone-50 hover:ring-stone-300 text-stone-700 hover:text-stone-900 font-bold text-sm transition focus:outline-none focus-visible:ring-4 focus-visible:ring-rose-200"
                            >
                                <LogOut className="w-4 h-4" />
                                Sign out
                            </button>
                        </div>
                    </div>

                    <div className="pt-2 border-t border-stone-100">
                        <p className="text-[11px] sm:text-xs text-center text-stone-500 leading-relaxed">
                            Once payment is received, full access is restored automatically. Data remains safe and untouched during this hold.
                        </p>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default LockedScreen;
