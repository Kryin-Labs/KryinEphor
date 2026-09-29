import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, Lock, KeyRound, AlertCircle, X, CheckCircle2, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface StaffPinModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    initialMode?: 'unlock' | 'setup';
}

export const StaffPinModal: React.FC<StaffPinModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
    initialMode = 'unlock'
}) => {
    const {
        staffPinStatus,
        checkStaffPinStatus,
        unlockStaffMode,
        setupStaffPin
    } = useAuth();

    const [mode, setMode] = useState<'unlock' | 'setup'>(initialMode);
    const [pin, setPin] = useState('');
    const [currentPin, setCurrentPin] = useState('');
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
    const [isLocked, setIsLocked] = useState(false);
    const [lockedUntil, setLockedUntil] = useState<string | null>(null);

    const inputRef = useRef<HTMLInputElement>(null);

    // Sync mode with initialMode and check status when modal opens
    useEffect(() => {
        if (isOpen) {
            setPin('');
            setCurrentPin('');
            setNewPin('');
            setConfirmPin('');
            setError(null);
            setLoading(true);

            checkStaffPinStatus().then(status => {
                setLoading(false);
                if (status) {
                    setIsLocked(status.isLocked);
                    setLockedUntil(status.lockedUntil);
                    setAttemptsRemaining(status.attemptsRemaining);
                    if (!status.hasPin) {
                        setMode('setup');
                    } else {
                        setMode(initialMode);
                    }
                }
            }).catch(() => setLoading(false));

            setTimeout(() => {
                inputRef.current?.focus();
            }, 100);
        }
    }, [isOpen, initialMode, checkStaffPinStatus]);

    if (!isOpen) return null;

    const handlePinInput = (val: string) => {
        const cleaned = val.replace(/\D/g, '').slice(0, 8);
        setPin(cleaned);
        setError(null);
    };

    const handleUnlock = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (pin.length < 6) {
            setError('Please enter at least 6 digits');
            return;
        }

        setLoading(true);
        setError(null);

        const res = await unlockStaffMode(pin);
        setLoading(false);

        if (res.success) {
            setPin('');
            onSuccess?.();
            onClose();
        } else {
            if (res.error === 'NO_PIN_CONFIGURED') {
                setMode('setup');
                setError('No Staff PIN is configured yet. Please set one now.');
            } else if (res.error === 'ACCOUNT_LOCKED') {
                setIsLocked(true);
                setLockedUntil(res.lockedUntil || null);
                setError('Too many failed attempts. Staff mode is locked for 15 minutes.');
            } else {
                if (res.attemptsRemaining !== undefined) {
                    setAttemptsRemaining(res.attemptsRemaining);
                    setError(`Incorrect PIN. ${res.attemptsRemaining} attempt${res.attemptsRemaining === 1 ? '' : 's'} remaining.`);
                } else {
                    setError(res.error || 'Failed to unlock staff mode');
                }
            }
        }
    };

    const handleSetup = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (staffPinStatus?.hasPin && currentPin.length < 6) {
            setError('Please enter your current 6-digit PIN');
            return;
        }

        if (newPin.length < 6 || newPin.length > 8) {
            setError('New PIN must be between 6 and 8 numeric digits');
            return;
        }

        if (newPin !== confirmPin) {
            setError('New PIN and confirmation PIN do not match');
            return;
        }

        setLoading(true);
        const res = await setupStaffPin(newPin, staffPinStatus?.hasPin ? currentPin : undefined);
        setLoading(false);

        if (res.success) {
            // Automatically unlock with the new PIN
            setLoading(true);
            const unlockRes = await unlockStaffMode(newPin);
            setLoading(false);

            if (unlockRes.success) {
                onSuccess?.();
                onClose();
            } else {
                setMode('unlock');
                setPin('');
                setError('PIN saved successfully. Please enter your PIN to unlock.');
            }
        } else {
            setError(res.error || 'Failed to save Staff PIN');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-stone-200/80 overflow-hidden">
                {/* Top Accent Header */}
                <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 px-6 py-5 text-white flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center shadow-inner">
                            <ShieldCheck className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h3 className="font-bold text-base leading-tight">
                                {mode === 'unlock' ? 'Unlock Teacher View' : 'Setup Staff PIN'}
                            </h3>
                            <p className="text-[11px] text-amber-100/90 font-medium">
                                Secure Staff Access Protection
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white/90 hover:text-white flex items-center justify-center transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-6">
                    {/* Error Banner */}
                    {error && (
                        <div className="mb-4 p-3 rounded-2xl bg-rose-50 border border-rose-200/80 flex items-start gap-2.5 text-rose-800 text-xs animate-in fade-in">
                            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                            <div className="leading-relaxed font-medium">{error}</div>
                        </div>
                    )}

                    {/* Mode: UNLOCK */}
                    {mode === 'unlock' && (
                        <div>
                            <div className="text-center mb-6">
                                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200/60 text-amber-700 mb-3 shadow-xs">
                                    <Lock className="w-7 h-7" />
                                </div>
                                <h4 className="text-stone-900 font-bold text-lg">Enter 6-Digit Staff PIN</h4>
                                <p className="text-xs text-stone-500 mt-1 max-w-xs mx-auto">
                                    Protects confidential grades, attendance records, and educator privileges on shared devices.
                                </p>
                            </div>

                            {isLocked ? (
                                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-center space-y-2 mb-4">
                                    <AlertCircle className="w-6 h-6 text-rose-600 mx-auto" />
                                    <h5 className="text-sm font-bold text-rose-900">Staff Mode Temporarily Locked</h5>
                                    <p className="text-xs text-rose-700">
                                        Too many consecutive failed attempts.
                                        {lockedUntil && (
                                            <span className="block mt-1 font-semibold">
                                                Unlocks at {new Date(lockedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        )}
                                    </p>
                                </div>
                            ) : (
                                <form onSubmit={handleUnlock} className="space-y-5">
                                    {/* Masked PIN Box Display */}
                                    <div className="flex justify-center gap-2 relative">
                                        {[0, 1, 2, 3, 4, 5].map((i) => {
                                            const digit = pin[i];
                                            const isFocused = pin.length === i;
                                            return (
                                                <div
                                                    key={i}
                                                    className={`w-11 h-13 rounded-xl border-2 flex items-center justify-center text-xl font-bold transition-all duration-150 ${
                                                        digit
                                                            ? 'border-amber-500 bg-amber-50/50 text-amber-900'
                                                            : isFocused
                                                            ? 'border-amber-500 bg-white ring-4 ring-amber-500/20'
                                                            : 'border-stone-200 bg-stone-50 text-stone-400'
                                                    }`}
                                                >
                                                    {digit ? '•' : ''}
                                                </div>
                                            );
                                        })}
                                        <input
                                            ref={inputRef}
                                            type="password"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            value={pin}
                                            onChange={(e) => handlePinInput(e.target.value)}
                                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                            autoComplete="one-time-code"
                                            autoFocus
                                            disabled={loading}
                                        />
                                    </div>

                                    {attemptsRemaining !== null && attemptsRemaining < 5 && (
                                        <p className="text-center text-[11px] text-amber-700 font-semibold">
                                            ⚠️ {attemptsRemaining} attempt{attemptsRemaining === 1 ? '' : 's'} remaining before lockout
                                        </p>
                                    )}

                                    <div className="flex gap-2.5 pt-2">
                                        <button
                                            type="button"
                                            onClick={onClose}
                                            className="flex-1 px-4 py-2.5 rounded-xl border border-stone-200 bg-white text-stone-700 text-xs font-bold hover:bg-stone-50 transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={loading || pin.length < 6}
                                            className="flex-1 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-amber-600/20 transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
                                        >
                                            {loading ? (
                                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                                <KeyRound className="w-3.5 h-3.5" />
                                            )}
                                            Unlock Mode
                                        </button>
                                    </div>

                                    <div className="pt-2 text-center border-t border-stone-100">
                                        <button
                                            type="button"
                                            onClick={() => { setMode('setup'); setError(null); }}
                                            className="text-xs text-amber-700 hover:text-amber-800 font-semibold hover:underline"
                                        >
                                            Change or Reset Staff PIN
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    )}

                    {/* Mode: SETUP */}
                    {mode === 'setup' && (
                        <form onSubmit={handleSetup} className="space-y-4">
                            <div className="text-center mb-4">
                                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200/60 text-amber-700 mb-2 shadow-xs">
                                    <KeyRound className="w-6 h-6" />
                                </div>
                                <h4 className="text-stone-900 font-bold text-base">
                                    {staffPinStatus?.hasPin ? 'Change Staff PIN' : 'Create Staff PIN'}
                                </h4>
                                <p className="text-xs text-stone-500">
                                    Numeric 6-8 digit PIN required to enter Teacher mode.
                                </p>
                            </div>

                            {staffPinStatus?.hasPin && (
                                <div>
                                    <label className="text-xs font-semibold text-stone-700 block mb-1">
                                        Current PIN
                                    </label>
                                    <input
                                        type="password"
                                        inputMode="numeric"
                                        maxLength={8}
                                        value={currentPin}
                                        onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                                        placeholder="Enter current 6-digit PIN"
                                        className="clay-input w-full text-sm bg-white"
                                        required
                                    />
                                </div>
                            )}

                            <div>
                                <label className="text-xs font-semibold text-stone-700 block mb-1">
                                    New Staff PIN (6-8 digits)
                                </label>
                                <input
                                    type="password"
                                    inputMode="numeric"
                                    maxLength={8}
                                    value={newPin}
                                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                                    placeholder="Enter new 6-digit PIN"
                                    className="clay-input w-full text-sm bg-white"
                                    required
                                />
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-stone-700 block mb-1">
                                    Confirm New Staff PIN
                                </label>
                                <input
                                    type="password"
                                    inputMode="numeric"
                                    maxLength={8}
                                    value={confirmPin}
                                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                                    placeholder="Confirm new 6-digit PIN"
                                    className="clay-input w-full text-sm bg-white"
                                    required
                                />
                            </div>

                            <div className="flex gap-2.5 pt-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (staffPinStatus?.hasPin) {
                                            setMode('unlock');
                                            setError(null);
                                        } else {
                                            onClose();
                                        }
                                    }}
                                    className="flex-1 px-4 py-2.5 rounded-xl border border-stone-200 bg-white text-stone-700 text-xs font-bold hover:bg-stone-50 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading || newPin.length < 6 || newPin !== confirmPin}
                                    className="flex-1 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-amber-600/20 transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
                                >
                                    {loading ? (
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                    )}
                                    Save & Unlock
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};
