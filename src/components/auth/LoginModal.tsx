import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    Mail,
    Lock,
    ArrowRight,
    ArrowLeft,
    GraduationCap,
    Github,
    Chrome,
    Eye,
    EyeOff,
    AlertCircle,
    CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface LoginModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type ModalView = 'login' | 'forgot-email';

const OAUTH_DISABLED_MESSAGE = 'OAuth login is not yet configured.';

const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose }) => {
    const { login, isTransitioning } = useAuth();
    const navigate = useNavigate();

    // Login state
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [status, setStatus] = useState<{ type: 'error' | 'success' | 'info' | null, message: string }>({ type: null, message: '' });

    // Forgot password state
    const [view, setView] = useState<ModalView>('login');
    const [resetEmail, setResetEmail] = useState('');

    const resetForgotState = () => {
        setView('login');
        setResetEmail('');
        setStatus({ type: null, message: '' });
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setStatus({ type: 'info', message: 'Verifying credentials...' });

        try {
            const currentRole = await login(email, password);

            setStatus({ type: 'success', message: `Welcome ${email.split('@')[0]}! Initiating workspace...` });

            setTimeout(() => {
                onClose();
                const targetRoute = currentRole === 'superadmin' ? '/super-admin' : '/dashboard';
                navigate(targetRoute);
                setStatus({ type: null, message: '' });
            }, 300);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
            setStatus({ type: 'error', message });
        } finally {
            setLoading(false);
        }
    };

    // ───────────────────────────────────────────────────────────────
    // Forgot password — Phase 4A.2:
    // Routes through the request_password_recovery edge function which
    // looks up the user's verified recovery_email and delivers the link
    // there (institutional login_ids may be non-deliverable fake inboxes).
    // Response is intentionally identical regardless of account state.
    // ───────────────────────────────────────────────────────────────
    const handleForgotEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = resetEmail.trim().toLowerCase();
        if (!trimmed) return;

        setLoading(true);
        setStatus({ type: 'info', message: 'Sending reset link...' });

        try {
            const { error } = await supabase.functions.invoke('request_password_recovery', {
                body: {
                    loginId: trimmed,
                },
            });

            if (error) {
                // Network / function-level failure — show generic copy too;
                // never leak whether the account exists.
                setStatus({
                    type: 'success',
                    message:
                        'If a verified recovery email is configured for that account, reset instructions have been sent. If not, contact your school admin to reset your password.',
                });
            } else {
                setStatus({
                    type: 'success',
                    message:
                        'If a verified recovery email is configured for that account, reset instructions have been sent. If not, contact your school admin to reset your password.',
                });
            }
            setTimeout(() => {
                resetForgotState();
            }, 3500);
        } catch {
            setStatus({ type: 'error', message: 'Something went wrong. Please try again.' });
        } finally {
            setLoading(false);
        }
    };

    const getHeaderTitle = () => view === 'forgot-email' ? 'Reset Password' : 'Welcome Back';
    const getHeaderSubtitle = () => view === 'forgot-email' ? 'Enter your email' : 'Kryin School OS';
    const getHeaderIcon = () =>
        view === 'forgot-email'
            ? <Mail className="text-lime-400 w-7 h-7" />
            : <GraduationCap className="text-lime-400 w-7 h-7" />;

    return (
        <AnimatePresence>
            {(isOpen && !isTransitioning) && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1 }}
                    className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
                >
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-emerald-950/40 backdrop-blur-md"
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 20 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="relative w-full max-w-lg bg-[#FAF9F6] rounded-[40px] shadow-2xl shadow-emerald-900/20 border-[8px] border-white overflow-hidden flex flex-col"
                    >
                        {/* Status Bar */}
                        <AnimatePresence>
                            {status.type && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className={`px-8 py-3 flex items-center gap-3 text-sm font-bold border-b border-white/20
                                        ${status.type === 'error' ? 'bg-rose-500 text-white' :
                                            status.type === 'success' ? 'bg-emerald-500 text-white' :
                                                'bg-lime-400 text-emerald-900'}`}
                                >
                                    {status.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                                    {status.message}
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Header */}
                        <div className="p-8 pb-4 flex justify-between items-start">
                            <div className="flex items-center gap-3">
                                {view !== 'login' && (
                                    <button
                                        type="button"
                                        onClick={resetForgotState}
                                        aria-label="Back to login"
                                        className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-emerald-900/40 hover:text-emerald-900 transition-colors border border-gray-100 mr-1"
                                    >
                                        <ArrowLeft className="w-5 h-5" />
                                    </button>
                                )}
                                <div className="w-12 h-12 rounded-2xl bg-emerald-900 flex items-center justify-center shadow-lg shadow-emerald-900/20">
                                    {getHeaderIcon()}
                                </div>
                                <div>
                                    <h2 className="text-2xl font-black text-emerald-900 tracking-tight">{getHeaderTitle()}</h2>
                                    <p className="text-sm font-bold text-emerald-900/40 uppercase tracking-widest">{getHeaderSubtitle()}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => { onClose(); resetForgotState(); }}
                                aria-label="Close login dialog"
                                className="w-10 h-10 rounded-full bg-white shadow-soft flex items-center justify-center text-emerald-900/40 hover:text-emerald-900 transition-colors border border-gray-100"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-8 pt-0">
                            <AnimatePresence mode="wait">
                                {/* ═══ LOGIN VIEW ═══ */}
                                {view === 'login' && (
                                    <motion.div key="login" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.2 }}>
                                        <form onSubmit={handleLogin} className="space-y-6">
                                            <div className="space-y-4">
                                                <div className="space-y-2">
                                                    <label htmlFor="login-email" className="text-xs font-bold text-emerald-900/60 uppercase tracking-wider ml-4">Email Address</label>
                                                    <div className="relative">
                                                        <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-emerald-900/20 w-5 h-5" />
                                                        <input
                                                            id="login-email"
                                                            type="email"
                                                            required
                                                            value={email}
                                                            onChange={(e) => setEmail(e.target.value)}
                                                            className="w-full bg-white border border-gray-100 rounded-3xl px-14 py-4 text-emerald-900 font-bold placeholder:text-emerald-900/10 focus:ring-4 focus:ring-emerald-900/5 transition-all outline-none shadow-sm"
                                                            placeholder="Enter your email"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="space-y-2">
                                                    <label htmlFor="login-password" className="text-xs font-bold text-emerald-900/60 uppercase tracking-wider ml-4">Password</label>
                                                    <div className="relative">
                                                        <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-emerald-900/20 w-5 h-5" />
                                                        <input
                                                            id="login-password"
                                                            type={showPassword ? "text" : "password"}
                                                            required
                                                            value={password}
                                                            onChange={(e) => setPassword(e.target.value)}
                                                            className="w-full bg-white border border-gray-100 rounded-3xl px-14 py-4 text-emerald-900 font-bold placeholder:text-emerald-900/10 focus:ring-4 focus:ring-emerald-900/5 transition-all outline-none shadow-sm"
                                                            placeholder="••••••••"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowPassword(!showPassword)}
                                                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                                                            className="absolute right-5 top-1/2 -translate-y-1/2 text-emerald-900/20 hover:text-emerald-900 transition-colors"
                                                        >
                                                            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between px-2">
                                                <label className="flex items-center gap-2 cursor-pointer group">
                                                    <input type="checkbox" className="w-5 h-5 rounded-lg border-2 border-emerald-900/10 text-emerald-900 focus:ring-0 transition-all" />
                                                    <span className="text-sm font-bold text-emerald-900/60 group-hover:text-emerald-900">Remember me</span>
                                                </label>
                                                <button
                                                    type="button"
                                                    onClick={() => { setView('forgot-email'); setStatus({ type: null, message: '' }); }}
                                                    className="text-sm font-bold text-emerald-900 hover:text-emerald-700 underline decoration-lime-400 decoration-2 underline-offset-4"
                                                >
                                                    Forgot password?
                                                </button>
                                            </div>

                                            <button
                                                type="submit"
                                                disabled={loading}
                                                className="w-full bg-emerald-900 text-white rounded-3xl py-5 font-bold text-lg shadow-xl shadow-emerald-900/20 hover:bg-emerald-800 transition-all flex items-center justify-center gap-2 hover:-translate-y-1 disabled:opacity-50 disabled:translate-y-0"
                                            >
                                                {loading && !isTransitioning ? (
                                                    <div className="w-6 h-6 border-4 border-white/20 border-t-white rounded-full animate-spin" />
                                                ) : (
                                                    <>
                                                        Enter Workspace
                                                        <ArrowRight className="w-5 h-5" />
                                                    </>
                                                )}
                                            </button>
                                        </form>

                                        <div className="mt-10 mb-2 flex items-center gap-4">
                                            <div className="flex-1 h-px bg-emerald-900/5"></div>
                                            <span className="text-[10px] font-black text-emerald-900/20 uppercase tracking-[0.2em]">Or social log-in</span>
                                            <div className="flex-1 h-px bg-emerald-900/5"></div>
                                        </div>

                                        {/*
                                            OAuth buttons — intentionally disabled until providers
                                            are configured in Supabase. Extension point: replace the
                                            disabled handler with `supabase.auth.signInWithOAuth({ provider })`
                                            once Authentication → Providers is set up.
                                        */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <button
                                                type="button"
                                                disabled
                                                aria-disabled="true"
                                                title={OAUTH_DISABLED_MESSAGE}
                                                className="flex items-center justify-center gap-3 py-4 bg-white border border-gray-100 rounded-2xl font-bold text-emerald-900/40 shadow-sm cursor-not-allowed"
                                            >
                                                <Chrome className="w-5 h-5" />
                                                Google
                                            </button>
                                            <button
                                                type="button"
                                                disabled
                                                aria-disabled="true"
                                                title={OAUTH_DISABLED_MESSAGE}
                                                className="flex items-center justify-center gap-3 py-4 bg-white border border-gray-100 rounded-2xl font-bold text-emerald-900/40 shadow-sm cursor-not-allowed"
                                            >
                                                <Github className="w-5 h-5" />
                                                GitHub
                                            </button>
                                        </div>
                                        <p className="mt-3 text-center text-[11px] font-bold text-emerald-900/40 italic">
                                            {OAUTH_DISABLED_MESSAGE}
                                        </p>
                                    </motion.div>
                                )}

                                {/* ═══ FORGOT PASSWORD — EMAIL ═══ */}
                                {view === 'forgot-email' && (
                                    <motion.div key="forgot-email" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                                        <form onSubmit={handleForgotEmail} className="space-y-6">
                                            <p className="text-sm text-emerald-900/60 font-medium px-1">
                                                Enter the email associated with your account. We'll send you a secure link to reset your password.
                                            </p>
                                            <div className="space-y-2">
                                                <label htmlFor="forgot-email" className="text-xs font-bold text-emerald-900/60 uppercase tracking-wider ml-4">Email Address</label>
                                                <div className="relative">
                                                    <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-emerald-900/20 w-5 h-5" />
                                                    <input
                                                        id="forgot-email"
                                                        type="email"
                                                        required
                                                        value={resetEmail}
                                                        onChange={(e) => setResetEmail(e.target.value)}
                                                        className="w-full bg-white border border-gray-100 rounded-3xl px-14 py-4 text-emerald-900 font-bold placeholder:text-emerald-900/10 focus:ring-4 focus:ring-emerald-900/5 transition-all outline-none shadow-sm"
                                                        placeholder="your@email.com"
                                                        autoFocus
                                                    />
                                                </div>
                                            </div>

                                            <button
                                                type="submit"
                                                disabled={loading}
                                                className="w-full bg-emerald-900 text-white rounded-3xl py-5 font-bold text-lg shadow-xl shadow-emerald-900/20 hover:bg-emerald-800 transition-all flex items-center justify-center gap-2 hover:-translate-y-1 disabled:opacity-50 disabled:translate-y-0"
                                            >
                                                {loading ? (
                                                    <div className="w-6 h-6 border-4 border-white/20 border-t-white rounded-full animate-spin" />
                                                ) : (
                                                    <>
                                                        Send Reset Link
                                                        <ArrowRight className="w-5 h-5" />
                                                    </>
                                                )}
                                            </button>
                                        </form>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Footer Decoration */}
                        <div className="absolute bottom-0 left-0 right-0 h-2 bg-gradient-to-r from-lime-400 via-emerald-800 to-lime-500"></div>
                    </motion.div>
                </motion.div>
            )}

            {/* Transition overlay handled globally by <GlobalLoader /> in App.tsx */}
        </AnimatePresence>
    );
};

export default LoginModal;
