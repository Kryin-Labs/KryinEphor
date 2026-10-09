import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
    AlertTriangle,
    School,
    User,
    Mail,
    RefreshCw,
    LogOut,
    GraduationCap,
    ArrowRightLeft,
    ShieldAlert,
    Clock
} from 'lucide-react';

export const NoClassAssignedModal: React.FC = () => {
    const {
        user,
        role,
        roles,
        loading,
        linkedStudents,
        activeStudentId,
        setActiveStudentId,
        switchDashboardRole,
        refreshPersonaSummary,
        signOut
    } = useAuth();

    const [isRefreshing, setIsRefreshing] = useState(false);

    // Trap Escape key so modal cannot be closed
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, []);

    // Only active for Student and Parent workspaces
    if (loading || !user || (role !== 'student' && role !== 'parent')) {
        return null;
    }

    // Resolve the active student persona
    const currentStudent = role === 'student'
        ? (linkedStudents.find(s => s.studentId === user.id || s.relationship === 'self_student') ?? linkedStudents[0])
        : (linkedStudents.find(s => s.studentId === activeStudentId)
            ?? linkedStudents.find(s => s.isPrimary)
            ?? linkedStudents[0]);

    // Check if class is assigned
    const hasClassAssigned = Boolean(currentStudent?.className);

    // If a class is assigned, do not show modal
    if (hasClassAssigned) {
        return null;
    }

    // Find other linked children who DO have an assigned class (for parents)
    const otherEnrolledChildren = role === 'parent'
        ? linkedStudents.filter(s => s.studentId !== currentStudent?.studentId && Boolean(s.className))
        : [];

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            await refreshPersonaSummary();
        } finally {
            setTimeout(() => setIsRefreshing(false), 600);
        }
    };

    const studentDisplayName = currentStudent?.fullName || user.fullName || 'Student';
    const schoolDisplayName = user.schoolName || 'Your School';
    const roleDisplayName = role === 'student' ? 'Student Workspace' : 'Parent Workspace';

    return (
        <div
            className="fixed inset-0 z-[9999] bg-stone-950/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="no-class-title"
            aria-describedby="no-class-desc"
            onClick={(e) => e.stopPropagation()}
        >
            <div
                className="clay-card relative w-full max-w-lg overflow-hidden rounded-3xl bg-white p-6 sm:p-8 shadow-2xl border-2 border-amber-300 animate-scale-up"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header with warning accent */}
                <div className="flex flex-col items-center text-center">
                    <div className="w-16 h-16 rounded-2xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700 shadow-sm mb-4">
                        <AlertTriangle className="w-8 h-8 text-amber-600 animate-pulse" />
                    </div>

                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold uppercase tracking-wider mb-2">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-600" /> Enrollment Pending
                    </span>

                    <h2 id="no-class-title" className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
                        No Class Assigned
                    </h2>
                    <p id="no-class-desc" className="text-sm font-medium text-amber-900/80 mt-1">
                        Please contact your School Administrator to complete class setup.
                    </p>
                </div>

                {/* Explanation text */}
                <p className="mt-4 text-xs text-stone-600 text-center leading-relaxed bg-amber-50/50 p-3 rounded-2xl border border-amber-200/60">
                    Your account is active, but this student profile has not yet been assigned to a class or section.
                    Academic statistics, attendance, timetables, and module scores cannot be generated until class enrollment is completed.
                </p>

                {/* Account Info Card */}
                <div className="mt-5 rounded-2xl bg-stone-50 border border-stone-200/90 p-4 space-y-2.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-2 border-b border-stone-200 pb-1.5 flex items-center justify-between">
                        <span>Account Information</span>
                        <span className="text-[10px] font-semibold text-amber-700 bg-amber-100/70 px-2 py-0.5 rounded-full">
                            Pending Assignment
                        </span>
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                        <div className="flex items-start gap-2">
                            <GraduationCap className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                                <span className="text-[10px] text-stone-400 block font-medium">Student Name</span>
                                <span className="font-bold text-stone-800 truncate block">{studentDisplayName}</span>
                            </div>
                        </div>

                        <div className="flex items-start gap-2">
                            <Mail className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                                <span className="text-[10px] text-stone-400 block font-medium">Account Email</span>
                                <span className="font-bold text-stone-800 truncate block font-mono text-[11px]">
                                    {user.email}
                                </span>
                            </div>
                        </div>

                        <div className="flex items-start gap-2">
                            <User className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                                <span className="text-[10px] text-stone-400 block font-medium">Current Role / View</span>
                                <span className="font-bold text-stone-800 truncate block capitalize">
                                    {roleDisplayName}
                                </span>
                            </div>
                        </div>

                        <div className="flex items-start gap-2">
                            <School className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                                <span className="text-[10px] text-stone-400 block font-medium">School</span>
                                <span className="font-bold text-stone-800 truncate block">
                                    {schoolDisplayName}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="pt-2 border-t border-stone-200/80 flex items-center justify-between text-[11px] text-stone-500">
                        <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-stone-400" /> Academic Session: 2025–26
                        </span>
                        <span className="font-medium text-stone-600">
                            Class Status: <strong className="text-amber-700 font-bold">Unassigned</strong>
                        </span>
                    </div>
                </div>

                {/* Switch to enrolled child option (for parent profile with multiple children) */}
                {otherEnrolledChildren.length > 0 && (
                    <div className="mt-4 p-3 bg-purple-50 rounded-2xl border border-purple-200 space-y-2">
                        <p className="text-xs font-bold text-purple-900">
                            Other linked children have assigned classes:
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {otherEnrolledChildren.map(child => (
                                <button
                                    key={child.studentId}
                                    type="button"
                                    onClick={() => setActiveStudentId(child.studentId)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 text-white text-xs font-bold hover:bg-purple-700 transition shadow-sm"
                                >
                                    <ArrowRightLeft className="w-3 h-3" />
                                    Switch to {child.fullName} ({child.className})
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="mt-6 flex flex-col sm:flex-row items-center gap-2.5">
                    <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-primary text-white font-bold text-xs hover:bg-primary/90 transition shadow-md shadow-teal-900/10 disabled:opacity-75"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                        {isRefreshing ? 'Checking Enrollment…' : 'Check Status Again'}
                    </button>

                    {roles.length > 1 && (
                        <button
                            type="button"
                            onClick={() => {
                                const nextRole = roles.find(r => r !== role);
                                if (nextRole) switchDashboardRole(nextRole);
                            }}
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-2xl bg-stone-100 text-stone-700 font-semibold text-xs hover:bg-stone-200 transition"
                        >
                            <ArrowRightLeft className="w-3.5 h-3.5 text-stone-500" />
                            Switch Profile
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={() => signOut()}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-2xl border border-stone-200 bg-white text-rose-700 font-semibold text-xs hover:bg-rose-50 transition"
                    >
                        <LogOut className="w-3.5 h-3.5 text-rose-600" />
                        Sign Out
                    </button>
                </div>
            </div>
        </div>
    );
};
export default NoClassAssignedModal;
