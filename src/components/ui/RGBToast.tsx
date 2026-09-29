import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, X } from 'lucide-react';

interface RGBToastProps {
    message: string;
    show: boolean;
    onClose: () => void;
}

const RGBToast: React.FC<RGBToastProps> = ({ message, show, onClose }) => {
    useEffect(() => {
        if (show) {
            const timer = setTimeout(() => {
                onClose();
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [show, onClose]);

    return (
        <AnimatePresence>
            {show && (
                <motion.div
                    initial={{ scale: 0.8, opacity: 0, y: 50 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.8, opacity: 0, y: 20 }}
                    className="fixed bottom-8 right-8 z-[200]"
                >
                    <div className="relative p-[3px] rounded-2xl overflow-hidden shadow-2xl">
                        {/* Animated RGB Border Gradient */}
                        <div className="absolute inset-0 bg-gradient-to-r from-emerald-400 via-lime-400 to-blue-400 animate-spin-slow opacity-80"
                            style={{ animationDuration: '3s' }}></div>

                        {/* Inner Content */}
                        <div className="relative bg-[#FAF9F6] px-6 py-4 rounded-[13px] flex items-center gap-4 border border-white/40 backdrop-blur-xl">
                            <div className="w-10 h-10 rounded-full bg-emerald-900 flex items-center justify-center shadow-lg">
                                <LogOut className="text-lime-400 w-5 h-5" />
                            </div>
                            <div>
                                <h4 className="text-emerald-900 font-black text-sm uppercase tracking-wider">Session Ended</h4>
                                <p className="text-emerald-900/60 font-bold text-xs">{message}</p>
                            </div>
                            <button
                                onClick={onClose}
                                className="ml-4 p-1 hover:bg-emerald-900/5 rounded-full transition-colors text-emerald-900/20 hover:text-emerald-900"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default RGBToast;
