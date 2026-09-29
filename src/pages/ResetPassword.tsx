import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { KeyRound, Lock, Eye, EyeOff, CheckCircle2, AlertCircle, ArrowRight, ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

/**
 * /reset-password
 *
 * Public route. Reached via the Supabase password-recovery email link.
 * Supabase parses the recovery token from the URL hash and fires a
 * `PASSWORD_RECOVERY` auth event, after which `supabase.auth.updateUser({ password })`
 * can set a new password for the recovering user.
 *
 * Flow:
 *   1. User arrives with `#access_token=...&type=recovery` in the URL.
 *   2. Supabase establishes a recovery session automatically.
 *   3. User enters a new password and submits.
 *   4. Redirect back to "/" so they can log in fresh.
 */
const ResetPassword: React.FC = () => {
    const navigate = useNavigate();
    const [ready, setReady] = useState(false);
    const [recoveryValid, setRecoveryValid] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<{ type: 'error' | 'success' | 'info' | null; message: string }>({ type: null, message: '' });

    useEffect(() => {
        // Detect recovery session. Supabase fires PASSWORD_RECOVERY when it
        // processes the hash. We also check existing session in case the
        // event already fired before we mounted.
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') {
                setRecoveryValid(true);
                setReady(true);
            }
        });

        supabase.auth.getSession().then(({ data: { session } }) => {
            // Hash flag confirms this is a recovery URL.
            const isRecoveryHash = typeof window !== 'undefined' && window.location.hash.includes('type=recovery');
            if (session && isRecoveryHash) {
                setRecoveryValid(true);
            }
            setReady(true);
        });

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword.length < 8) {
            setStatus({ type: 'error', message: 'Password must be at least 8 characters.' });
            return;
        }
        if (newPassword !== confirmPassword) {
            setStatus({ type: 'error', message: 'Passwords do not match.' });
            return;
        }

        setLoading(true);
        setStatus({ type: 'info', message: 'Updating password...' });

        try {
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) {
                setStatus({ type: 'error', message: error.message });
                await logger.warn('auth', 'Password reset failed', { details: { error: error.message } });
                return;
            }

            setStatus({ type: 'success', message: 'Password updated. Redirecting to login...' });
            await logger.info('auth', 'Password reset successful');

            // Sign out so the user re-authenticates with the new password.
            await supabase.auth.signOut();
            setTimeout(() => navigate('/', { replace: true }), 1500);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Something went wrong.';
            setStatus({ type: 'error', message });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-cream flex items-center justify-center p-4 sm:p-6">
            <h1 className="sr-only">Reset Your Password</h1>
            <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="relative w-full max-w-lg bg-[#FAF9F6] rounded-[40px] shadow-2xl shadow-emerald-900/20 border-[8px] border-white overflow-hidden flex flex-col"
            >
                {status.type && (
                    <div
                        className={`px-8 py-3 flex items-center gap-3 text-sm font-bold border-b border-white/20
                            ${status.type === 'error' ? 'bg-rose-500 text-white' :
                                status.type === 'success' ? 'bg-emerald-500 text-white' :
                                    'bg-lime-400 text-emerald-900'}`}
                    >
                        {status.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                        {status.message}
                    </div>
                )}

                <div className="p-8 pb-4 flex justify-between items-start">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-900 flex items-center justify-center shadow-lg shadow-emerald-900/20">
                            <KeyRound className="text-lime-400 w-7 h-7" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-emerald-900 tracking-tight">Set New Password</h2>
                            <p className="text-sm font-bold text-emerald-900/40 uppercase tracking-widest">Account recovery</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => navigate('/', { replace: true })}
                        className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-emerald-900/40 hover:text-emerald-900 transition-colors border border-gray-100"
                        aria-label="Back to home"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-8 pt-0">
                    {!ready ? (
                        <div className="py-16 flex flex-col items-center gap-4">
                            <div className="w-12 h-12 border-4 border-emerald-900/10 border-t-emerald-900 rounded-full animate-spin" />
                            <p className="text-sm font-bold text-emerald-900/60">Verifying recovery link...</p>
                        </div>
                    ) : !recoveryValid ? (
                        <div className="py-10 flex flex-col items-center text-center gap-4">
                            <div className="w-16 h-16 rounded-full bg-rose-50 flex items-center justify-center">
                                <AlertCircle className="w-8 h-8 text-rose-500" />
                            </div>
                            <h3 className="text-xl font-black text-emerald-900">Recovery link invalid or expired</h3>
                            <p className="text-sm font-medium text-emerald-900/60 max-w-xs">
                                Open the most recent password reset email and click the link again, or request a new one from the login screen.
                            </p>
                            <button
                                type="button"
                                onClick={() => navigate('/', { replace: true })}
                                className="mt-4 bg-emerald-900 text-white rounded-3xl py-3 px-6 font-bold text-sm shadow-lg shadow-emerald-900/20 hover:bg-emerald-800 transition-all flex items-center justify-center gap-2"
                            >
                                Back to login
                                <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <p className="text-sm text-emerald-900/60 font-medium px-1">
                                Choose a strong new password. Minimum 8 characters.
                            </p>

                            <div className="space-y-2">
                                <label htmlFor="reset-new-password" className="text-xs font-bold text-emerald-900/60 uppercase tracking-wider ml-4">New Password</label>
                                <div className="relative">
                                    <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-emerald-900/20 w-5 h-5" />
                                    <input
                                        id="reset-new-password"
                                        type={showPassword ? 'text' : 'password'}
                                        required
                                        minLength={8}
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className="w-full bg-white border border-gray-100 rounded-3xl px-14 py-4 text-emerald-900 font-bold placeholder:text-emerald-900/10 focus:ring-4 focus:ring-emerald-900/5 transition-all outline-none shadow-sm"
                                        placeholder="Min 8 characters"
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-5 top-1/2 -translate-y-1/2 text-emerald-900/20 hover:text-emerald-900 transition-colors"
                                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    >
                                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="reset-confirm-password" className="text-xs font-bold text-emerald-900/60 uppercase tracking-wider ml-4">Confirm Password</label>
                                <div className="relative">
                                    <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-emerald-900/20 w-5 h-5" />
                                    <input
                                        id="reset-confirm-password"
                                        type="password"
                                        required
                                        minLength={8}
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="w-full bg-white border border-gray-100 rounded-3xl px-14 py-4 text-emerald-900 font-bold placeholder:text-emerald-900/10 focus:ring-4 focus:ring-emerald-900/5 transition-all outline-none shadow-sm"
                                        placeholder="Re-enter password"
                                    />
                                </div>
                                {confirmPassword && newPassword !== confirmPassword && (
                                    <p className="text-xs text-rose-500 font-bold ml-4">Passwords do not match</p>
                                )}
                            </div>

                            <button
                                type="submit"
                                disabled={loading || newPassword.length < 8 || newPassword !== confirmPassword}
                                className="w-full bg-emerald-900 text-white rounded-3xl py-5 font-bold text-lg shadow-xl shadow-emerald-900/20 hover:bg-emerald-800 transition-all flex items-center justify-center gap-2 hover:-translate-y-1 disabled:opacity-50 disabled:translate-y-0"
                            >
                                {loading ? (
                                    <div className="w-6 h-6 border-4 border-white/20 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <>
                                        Update Password
                                        <KeyRound className="w-5 h-5" />
                                    </>
                                )}
                            </button>
                        </form>
                    )}
                </div>

                <div className="absolute bottom-0 left-0 right-0 h-2 bg-gradient-to-r from-lime-400 via-emerald-800 to-lime-500"></div>
            </motion.div>
        </div>
    );
};

export default ResetPassword;
