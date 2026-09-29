import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, KeyRound, ArrowLeft, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import NotFound from '../../pages/NotFound';

interface ProtectedRouteProps {
    children: React.ReactNode;
    allowedRoles?: string[];
    requireStaffUnlock?: boolean;
}

/**
 * StaffLockGate component.
 * Rendered when an authorized teacher attempts to access a protected educator route
 * while their server-validated staff session is locked or expired.
 */
const StaffLockGate: React.FC<{ onUnlock: () => void; onBack: () => void }> = ({ onUnlock, onBack }) => {
    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-[#FAF9F6]">
            <div className="clay-card max-w-md w-full p-7 text-center space-y-5 border border-amber-200/80 bg-white/90 shadow-xl rounded-3xl">
                <div className="w-16 h-16 rounded-2xl bg-amber-100/80 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto shadow-xs">
                    <Lock className="w-8 h-8 text-amber-700" />
                </div>

                <div className="space-y-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200/70">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                        Staff Verification Required
                    </span>
                    <h2 className="text-xl font-bold text-foreground">
                        Staff Mode Locked
                    </h2>
                    <p className="text-xs text-muted leading-relaxed max-w-xs mx-auto">
                        Privileged educator access requires an active, verified staff session to protect student marks, attendance, and records.
                    </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200/80 text-[11px] text-stone-600 leading-relaxed text-left">
                    <p className="font-semibold text-stone-800 mb-0.5">Shared Device Protection</p>
                    Unlocked staff sessions expire automatically. Enter your 6-digit Staff PIN to access teacher features on this device.
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                    <button
                        type="button"
                        onClick={onBack}
                        className="flex-1 py-2.5 px-4 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-muted hover:bg-gray-50 transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        Return to Dashboard
                    </button>
                    <button
                        type="button"
                        onClick={onUnlock}
                        className="flex-1 py-2.5 px-4 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 transition-colors shadow-xs inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                        <KeyRound className="w-3.5 h-3.5" />
                        Unlock Staff Mode
                    </button>
                </div>
            </div>
        </div>
    );
};

/**
 * Route-level auth guard.
 * AuthProvider resolves the Supabase session, profile, and roles once before
 * any protected route renders. Row Level Security remains the data boundary.
 *
 * Phase 15: For privileged teacher routes, roles.includes("teacher") is NEVER
 * assumed to be sufficient on its own. Teacher route access strictly requires
 * the secure staff state:
 * - hasTeacherCapability (roles.includes("teacher"))
 * - hasActiveStaffMembership (Boolean(user.schoolId))
 * - staffSessionIsUnlocked (isStaffUnlocked === true, server-validated token)
 * - school matches (Boolean(user.schoolId))
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles, requireStaffUnlock }) => {
    const { user, roles, isStaffUnlocked, openStaffPinModal, loading } = useAuth();
    const navigate = useNavigate();

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#FAF9F6]" role="status" aria-label="Loading workspace">
                <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
        );
    }

    if (!user) return <NotFound variant="unauthorized" />;

    // Check basic role membership against authoritative server-fetched roles
    if (allowedRoles && !roles.some(r => allowedRoles.includes(r))) {
        return <NotFound variant="unauthorized" />;
    }

    // Phase 15: Secure Staff State Verification for Teacher Routes
    const isElevatedAdmin = roles.includes('superadmin') || roles.includes('admin');
    const qualifiesAsTeacher = allowedRoles ? allowedRoles.includes('teacher') && roles.includes('teacher') : false;
    const mustVerifyStaffState = Boolean(requireStaffUnlock || (qualifiesAsTeacher && !isElevatedAdmin));

    if (mustVerifyStaffState) {
        const hasTeacherCapability = roles.includes('teacher');
        const hasActiveStaffMembership = Boolean(user.schoolId);
        const schoolMatches = Boolean(user.schoolId);

        // If user lacks basic teacher capability or school context, refuse access
        if (!hasTeacherCapability || !hasActiveStaffMembership || !schoolMatches) {
            return <NotFound variant="unauthorized" />;
        }

        // If staff session is not unlocked, render the Staff Mode Locked Gate
        if (!isStaffUnlocked) {
            return (
                <StaffLockGate
                    onUnlock={() => openStaffPinModal()}
                    onBack={() => navigate('/dashboard')}
                />
            );
        }
    }

    return <>{children}</>;
};

export default ProtectedRoute;
