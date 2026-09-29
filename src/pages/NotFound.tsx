import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Home, AlertTriangle } from 'lucide-react';

interface NotFoundProps {
    /** Optional context: "unauthorized" shows access-denied wording, otherwise generic. */
    variant?: 'missing' | 'unauthorized';
    /** Optional override label for the body copy. */
    message?: string;
}

const COPY = {
    missing: {
        code: '404',
        title: 'Page Not Found',
        body: "The page you're looking for doesn't exist or has been moved.",
    },
    unauthorized: {
        code: '404',
        title: 'Page Not Found',
        body: "The page you're looking for doesn't exist or has been moved.",
    },
} as const;

const NotFound: React.FC<NotFoundProps> = ({ variant = 'missing', message }) => {
    const copy = COPY[variant];

    return (
        <main
            role="main"
            className="relative min-h-screen w-full overflow-hidden bg-[#FAF9F6] flex items-center justify-center px-6"
        >
            {/* Animated gradient orbs */}
            <motion.div
                aria-hidden
                className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-gradient-to-br from-rose-300/40 to-amber-200/30 blur-3xl"
                animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
                transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
                aria-hidden
                className="pointer-events-none absolute -bottom-32 -right-32 h-[28rem] w-[28rem] rounded-full bg-gradient-to-tr from-sky-300/40 to-indigo-300/30 blur-3xl"
                animate={{ x: [0, -50, 0], y: [0, -20, 0] }}
                transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
            />

            <motion.section
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                className="relative z-10 max-w-xl w-full text-center"
            >
                <motion.div
                    initial={{ scale: 0.6, rotate: -8, opacity: 0 }}
                    animate={{ scale: 1, rotate: 0, opacity: 1 }}
                    transition={{ delay: 0.1, type: 'spring', stiffness: 140, damping: 12 }}
                    className="mx-auto mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white/70 backdrop-blur shadow-lg ring-1 ring-black/5"
                >
                    <AlertTriangle className="h-8 w-8 text-rose-500" />
                </motion.div>

                <motion.h1
                    className="text-[7rem] leading-none font-extrabold tracking-tight bg-gradient-to-br from-slate-900 via-slate-700 to-slate-500 bg-clip-text text-transparent sm:text-[9rem]"
                    initial={{ opacity: 0, letterSpacing: '0.4em' }}
                    animate={{ opacity: 1, letterSpacing: '-0.02em' }}
                    transition={{ duration: 0.9, ease: 'easeOut' }}
                >
                    {copy.code}
                </motion.h1>

                <motion.h2
                    className="mt-2 text-2xl font-semibold text-slate-800 sm:text-3xl"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25, duration: 0.5 }}
                >
                    {copy.title}
                </motion.h2>

                <motion.p
                    className="mt-3 text-base text-slate-600 sm:text-lg"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35, duration: 0.5 }}
                >
                    {message ?? copy.body}
                </motion.p>

                <motion.div
                    className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5, duration: 0.5 }}
                >
                    <Link
                        to="/"
                        className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-medium text-white shadow-lg shadow-slate-900/20 transition hover:scale-[1.03] hover:bg-slate-800 active:scale-95"
                    >
                        <Home className="h-4 w-4" />
                        Back to Home
                    </Link>
                    <button
                        type="button"
                        onClick={() => window.history.back()}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white/60 px-6 py-3 text-sm font-medium text-slate-700 backdrop-blur transition hover:bg-white"
                    >
                        Go Back
                    </button>
                </motion.div>
            </motion.section>
        </main>
    );
};

export default NotFound;
