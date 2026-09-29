import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface GlobalLoaderProps {
    /** Show / hide the overlay. */
    show: boolean;
    /** Headline displayed under the spinner. Ignored when `messages` is set. */
    message?: string;
    /** Rotating headlines — cycles every ~1.4s to keep the user engaged. */
    messages?: string[];
    /** Secondary line of supporting copy. */
    submessage?: string;
    /** Visual variant — `dark` reads on light brand bg, `light` on dark. */
    variant?: 'dark' | 'light';
}

/**
 * Global full-screen loader used across the app for any blocking transition
 * (sign-in, sign-out, route swap, plan refresh, etc.). Single source of truth
 * so the look stays consistent — edit here to restyle every loader.
 *
 * Kept lightweight: pure CSS/SVG animation, no heavy libs, GPU-friendly
 * transforms only. Rotating copy keeps the user feeling progress instead of
 * staring at a static spinner.
 */
const GlobalLoader: React.FC<GlobalLoaderProps> = ({
    show,
    message = 'Just a moment…',
    messages,
    submessage,
    variant = 'dark',
}) => {
    const isDark = variant === 'dark';
    const rotation = messages && messages.length > 0 ? messages : [message];
    const [idx, setIdx] = useState(0);

    useEffect(() => {
        if (!show) { setIdx(0); return; }
        if (rotation.length <= 1) return;
        const t = setInterval(() => setIdx(i => (i + 1) % rotation.length), 1400);
        return () => clearInterval(t);
    }, [show, rotation.length]);

    const current = rotation[Math.min(idx, rotation.length - 1)];

    return (
        <AnimatePresence>
            {show && (
                <motion.div
                    key="global-loader"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    role="status"
                    aria-live="polite"
                    aria-label={current}
                    className={`fixed inset-0 z-[1000] flex items-center justify-center px-6 ${
                        isDark ? 'bg-[#FAF9F6]' : 'bg-emerald-950'
                    }`}
                >
                    {/* Soft ambient glow — pure CSS, GPU accelerated. */}
                    <div
                        aria-hidden
                        className={`pointer-events-none absolute inset-0 opacity-60 ${
                            isDark
                                ? 'bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.10),transparent_60%)]'
                                : 'bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.08),transparent_60%)]'
                        }`}
                    />

                    <div className="relative flex flex-col items-center gap-7 text-center max-w-sm">
                        {/* Layered ring loader — dual counter-rotating arcs + pulse dot */}
                        <div className="relative w-24 h-24">
                            <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full -rotate-90">
                                <circle
                                    cx="50" cy="50" r="42"
                                    fill="none"
                                    strokeWidth="6"
                                    className={isDark ? 'stroke-emerald-900/10' : 'stroke-white/10'}
                                />
                                <motion.circle
                                    cx="50" cy="50" r="42"
                                    fill="none"
                                    strokeWidth="6"
                                    strokeLinecap="round"
                                    className={isDark ? 'stroke-emerald-800' : 'stroke-white'}
                                    strokeDasharray="80 184"
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
                                    style={{ transformOrigin: '50% 50%' }}
                                />
                                <motion.circle
                                    cx="50" cy="50" r="30"
                                    fill="none"
                                    strokeWidth="4"
                                    strokeLinecap="round"
                                    className={isDark ? 'stroke-emerald-500/70' : 'stroke-emerald-300/70'}
                                    strokeDasharray="40 148"
                                    animate={{ rotate: -360 }}
                                    transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                                    style={{ transformOrigin: '50% 50%' }}
                                />
                            </svg>
                            <motion.div
                                className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full ${
                                    isDark ? 'bg-emerald-800' : 'bg-white'
                                }`}
                                animate={{ scale: [1, 1.6, 1], opacity: [0.9, 0.4, 0.9] }}
                                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                            />
                        </div>

                        {/* Rotating headline */}
                        <div className="space-y-2 min-h-[3.5rem]">
                            <AnimatePresence mode="wait">
                                <motion.h2
                                    key={current}
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -6 }}
                                    transition={{ duration: 0.28, ease: 'easeOut' }}
                                    className={`font-black text-xl sm:text-2xl tracking-tight ${
                                        isDark ? 'text-emerald-900' : 'text-white'
                                    }`}
                                >
                                    {current}
                                </motion.h2>
                            </AnimatePresence>
                            {submessage && (
                                <p
                                    className={`text-sm font-medium ${
                                        isDark ? 'text-emerald-900/60' : 'text-white/60'
                                    }`}
                                >
                                    {submessage}
                                </p>
                            )}
                        </div>

                        {/* Slim indeterminate progress track */}
                        <div className={`relative w-48 h-1 rounded-full overflow-hidden ${
                            isDark ? 'bg-emerald-900/10' : 'bg-white/10'
                        }`}>
                            <motion.div
                                className={`absolute top-0 left-0 h-full w-1/3 rounded-full ${
                                    isDark ? 'bg-emerald-800' : 'bg-white'
                                }`}
                                animate={{ x: ['-100%', '250%'] }}
                                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                            />
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default GlobalLoader;
