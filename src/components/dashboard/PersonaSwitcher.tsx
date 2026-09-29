import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    Shield,
    Lock,
    ChevronDown,
    Check,
    ArrowLeftRight
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { UserRole } from '../../config/roles';

interface PersonaSwitcherProps {
    variant?: 'sidebar' | 'header';
    collapsed?: boolean;
}

export const PersonaSwitcher: React.FC<PersonaSwitcherProps> = ({
    variant = 'sidebar',
    collapsed = false
}) => {
    const {
        user,
        role,
        roles,
        linkedStudents,
        activeStudentId,
        setActiveStudentId,
        switchDashboardRole,
        isStaffUnlocked,
        lockStaffMode,
        openStaffPinModal
    } = useAuth();

    const navigate = useNavigate();
    const location = useLocation();
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Format child's class and section (e.g. "Class 5A")
    const formatChildClass = (className?: string | null, sectionName?: string | null) => {
        if (!className && !sectionName) return '';
        let c = (className || '').trim();
        const s = (sectionName || '').trim();
        if (c && !c.toLowerCase().startsWith('class') && !c.toLowerCase().startsWith('grade')) {
            c = `Class ${c}`;
        }
        if (s && !c.toLowerCase().includes(s.toLowerCase())) {
            return `${c} ${s}`.trim();
        }
        return c || s;
    };

    // Filter children who have active student status for the active Student persona view
    const activeLinkedStudents = linkedStudents.filter(s => !s.studentStatus || s.studentStatus === 'active');
    const hasActiveStudentPersona = (roles.includes('student') && (!user?.studentStatus || user.studentStatus === 'active')) || activeLinkedStudents.length > 0;

    // Check which workspaces are available
    const hasFamilyWorkspaces = hasActiveStudentPersona || roles.includes('parent') || linkedStudents.length > 0;
    const hasWorkWorkspaces = roles.some(r => ['teacher', 'admin', 'superadmin', 'accountant', 'receptionist'].includes(r));

    // Handle switching to a specific role/workspace
    const handleSelectRole = (nextRole: UserRole, studentId?: string) => {
        if (studentId) {
            setActiveStudentId(studentId);
        }

        if (nextRole === 'teacher' && !isStaffUnlocked) {
            setDropdownOpen(false);
            openStaffPinModal();
            return;
        }

        switchDashboardRole(nextRole);
        setDropdownOpen(false);

        // Auto-redirect to dashboard if current route is not accessible in next role
        if (['/classes', '/users', '/attendance', '/marks', '/manage-tests', '/school-finance', '/finance', '/settings', '/global-setup', '/alerts', '/database'].includes(location.pathname) && (nextRole === 'student' || nextRole === 'parent')) {
            navigate('/dashboard');
        }
    };

    // Label for current workspace
    const getCurrentWorkspaceLabel = () => {
        if (role === 'student') {
            const activeChild = activeLinkedStudents.find(s => s.studentId === activeStudentId) || activeLinkedStudents[0];
            if (activeChild) {
                const classInfo = formatChildClass(activeChild.className, activeChild.sectionName);
                return classInfo ? `${activeChild.fullName} (${classInfo})` : activeChild.fullName;
            }
            return 'Student View';
        }
        if (role === 'parent') return 'Parent Dashboard';
        if (role === 'teacher') return 'Teacher Dashboard';
        if (role === 'admin') return 'School Admin';
        if (role === 'superadmin') return 'Super Admin';
        if (role === 'accountant') return 'Accountant';
        if (role === 'receptionist') return 'Receptionist';
        return 'Workspace';
    };

    // Calculate actual usable available personas (Items 25, 26, 28)
    const availablePersonasCount = (() => {
        let count = 0;
        if (roles.includes('parent')) count++;
        if (roles.includes('teacher')) count++;
        if (roles.includes('admin') || roles.includes('superadmin')) count++;
        if (roles.includes('accountant')) count++;
        if (roles.includes('receptionist')) count++;
        // Add active linked student personas
        count += activeLinkedStudents.length;
        // Legacy/self student capability if not already represented in activeLinkedStudents
        if (roles.includes('student') && activeLinkedStudents.length === 0 && (!user?.studentStatus || user.studentStatus === 'active')) {
            count++;
        }
        return count;
    })();

    // Quick toggle for 2-persona single-child Parent <-> Student accounts
    const isPureStudentParent = (
        roles.includes('parent') &&
        activeLinkedStudents.length === 1 &&
        roles.length === 1
    ) || (
        roles.includes('student') &&
        roles.includes('parent') &&
        roles.length === 2 &&
        activeLinkedStudents.length <= 1
    );

    if (availablePersonasCount <= 1) {
        return null;
    }

    /* ─── VARIANT: SIDEBAR ─────────────────────────────────── */
    if (variant === 'sidebar') {
        if (isPureStudentParent) {
            return (
                <div className="mb-3">
                    <button
                        type="button"
                        onClick={() => {
                            const next = role === 'student' ? 'parent' : 'student';
                            handleSelectRole(next);
                        }}
                        title={role === 'student' ? 'Switch to Parent View' : 'Switch to Student View'}
                        className={`w-full flex items-center ${collapsed ? 'justify-center p-2' : 'justify-between px-3 py-2'} rounded-2xl bg-gradient-to-r from-teal-500/10 via-emerald-500/10 to-teal-500/15 border border-teal-500/25 text-teal-900 hover:from-teal-500/20 hover:to-teal-500/25 hover:border-teal-500/50 hover:shadow-sm transition-all active:scale-[0.98] group`}
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-lg bg-teal-600/15 flex items-center justify-center text-teal-700 shrink-0 group-hover:rotate-180 transition-transform duration-300">
                                <ArrowLeftRight className="w-3.5 h-3.5" />
                            </div>
                            {!collapsed && (
                                <span className="text-xs font-bold truncate">
                                    {role === 'student' ? 'Switch to Parent' : 'Switch to Student'}
                                </span>
                            )}
                        </div>
                        {!collapsed && (
                            <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-md bg-white text-teal-800 border border-teal-200 shrink-0 shadow-2xs">
                                {role === 'student' ? 'Parent' : 'Student'}
                            </span>
                        )}
                    </button>
                </div>
            );
        }

        return (
            <div className="mb-3 space-y-2">
                {!collapsed && (
                    <div className="flex items-center justify-between px-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Workspace Mode</span>
                        <span className="text-[9px] font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-100">
                            {roles.length} Views
                        </span>
                    </div>
                )}

                {/* FAMILY SECTION */}
                {hasFamilyWorkspaces && (
                    <div className="space-y-1">
                        {!collapsed && (
                            <div className="text-[9px] font-bold uppercase tracking-wider text-stone-400 px-1 pt-1 flex items-center justify-between">
                                <span>Family</span>
                            </div>
                        )}
                        <div className="space-y-1">
                            {/* Parent Dashboard (First in Family) */}
                            {roles.includes('parent') && (
                                <button
                                    type="button"
                                    onClick={() => handleSelectRole('parent')}
                                    className={`w-full flex items-center ${collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'} rounded-xl text-xs font-medium transition-all ${
                                        role === 'parent'
                                            ? 'bg-teal-700 text-white font-bold shadow-xs'
                                            : 'bg-white/80 hover:bg-white text-stone-700 border border-stone-200/70 hover:border-teal-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-1.5 truncate">
                                        <span className="text-xs shrink-0">👨‍👩‍👧</span>
                                        {!collapsed && <span className="truncate">Parent Dashboard</span>}
                                    </div>
                                    {!collapsed && role === 'parent' && (
                                        <Check className="w-3 h-3 text-white shrink-0" />
                                    )}
                                </button>
                            )}

                            {/* Student Persona(s) / Linked Children (active only) */}
                            {hasActiveStudentPersona && (
                                activeLinkedStudents.length > 0 ? (
                                    activeLinkedStudents.map((child) => {
                                        const isCurrent = role === 'student' && (activeStudentId === child.studentId || (!activeStudentId && child.isPrimary));
                                        const classInfo = formatChildClass(child.className, child.sectionName);
                                        return (
                                            <button
                                                key={child.studentId}
                                                type="button"
                                                onClick={() => handleSelectRole('student', child.studentId)}
                                                className={`w-full flex items-center ${collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'} rounded-xl text-xs font-medium transition-all ${
                                                    isCurrent
                                                        ? 'bg-emerald-600 text-white font-bold shadow-xs'
                                                        : 'bg-white/80 hover:bg-white text-stone-700 border border-stone-200/70 hover:border-emerald-300'
                                                }`}
                                            >
                                                <div className="flex items-center gap-1.5 truncate">
                                                    <span className="text-xs shrink-0">🎓</span>
                                                    {!collapsed && (
                                                        <span className="truncate">
                                                            {child.fullName} {classInfo ? `— ${classInfo}` : ''}
                                                        </span>
                                                    )}
                                                </div>
                                                {!collapsed && isCurrent && (
                                                    <Check className="w-3 h-3 text-white shrink-0" />
                                                )}
                                            </button>
                                        );
                                    })
                                ) : (roles.includes('student') && (!user?.studentStatus || user.studentStatus === 'active')) ? (
                                    <button
                                        type="button"
                                        onClick={() => handleSelectRole('student')}
                                        className={`w-full flex items-center ${collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'} rounded-xl text-xs font-medium transition-all ${
                                            role === 'student'
                                                ? 'bg-emerald-600 text-white font-bold shadow-xs'
                                                : 'bg-white/80 hover:bg-white text-stone-700 border border-stone-200/70 hover:border-emerald-300'
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5 truncate">
                                            <span className="text-xs shrink-0">🎓</span>
                                            {!collapsed && (
                                                <span className="truncate">
                                                    {user?.fullName ? `${user.fullName} — Student` : 'Student View'}
                                                </span>
                                            )}
                                        </div>
                                        {!collapsed && role === 'student' && (
                                            <Check className="w-3 h-3 text-white shrink-0" />
                                        )}
                                    </button>
                                ) : null
                            )}
                        </div>
                    </div>
                )}

                {/* WORK / STAFF SECTION */}
                {hasWorkWorkspaces && (
                    <div className="space-y-1 pt-1">
                        {!collapsed && (
                            <div className="text-[9px] font-bold uppercase tracking-wider text-stone-400 px-1 pt-1 flex items-center justify-between">
                                <span>Work</span>
                            </div>
                        )}
                        <div className="space-y-1">
                            {/* Teacher Workspace */}
                            {roles.includes('teacher') && (
                                <button
                                    type="button"
                                    onClick={() => handleSelectRole('teacher')}
                                    className={`w-full flex items-center ${collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'} rounded-xl text-xs font-medium transition-all ${
                                        role === 'teacher'
                                            ? 'bg-amber-600 text-white font-bold shadow-xs'
                                            : 'bg-white/80 hover:bg-white text-stone-700 border border-stone-200/70 hover:border-amber-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-1.5 truncate">
                                        <span className="text-xs shrink-0">👩‍🏫</span>
                                        {!collapsed && <span className="truncate">Teacher Dashboard</span>}
                                    </div>
                                    {!collapsed && (
                                        role === 'teacher' ? (
                                            <div className="flex items-center gap-1">
                                                <span className="text-[9px] bg-amber-700 px-1 rounded text-white">Active</span>
                                                <Check className="w-3 h-3 text-white shrink-0" />
                                            </div>
                                        ) : isStaffUnlocked ? (
                                            <span className="text-xs text-emerald-600 font-bold">✓</span>
                                        ) : (
                                            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                                <Lock className="w-2.5 h-2.5" /> 🔒
                                            </span>
                                        )
                                    )}
                                </button>
                            )}

                            {/* Admin Workspace */}
                            {(roles.includes('admin') || roles.includes('superadmin')) && (
                                <button
                                    type="button"
                                    onClick={() => handleSelectRole(roles.includes('superadmin') ? 'superadmin' : 'admin')}
                                    className={`w-full flex items-center ${collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'} rounded-xl text-xs font-medium transition-all ${
                                        role === 'admin' || role === 'superadmin'
                                            ? 'bg-indigo-700 text-white font-bold shadow-xs'
                                            : 'bg-white/80 hover:bg-white text-stone-700 border border-stone-200/70 hover:border-indigo-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-1.5 truncate">
                                        <Shield className={`w-3.5 h-3.5 shrink-0 ${role === 'admin' || role === 'superadmin' ? 'text-white' : 'text-indigo-700'}`} />
                                        {!collapsed && (
                                            <span className="truncate">
                                                {roles.includes('superadmin') ? 'Super Admin' : 'School Admin'}
                                            </span>
                                        )}
                                    </div>
                                    {!collapsed && (role === 'admin' || role === 'superadmin') && (
                                        <Check className="w-3 h-3 text-white shrink-0" />
                                    )}
                                </button>
                            )}

                            {/* Accountant Workspace */}
                            {roles.includes('accountant') && (
                                <button
                                    type="button"
                                    onClick={() => handleSelectRole('accountant')}
                                    className={`w-full flex items-center ${collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'} rounded-xl text-xs font-medium transition-all ${
                                        role === 'accountant'
                                            ? 'bg-rose-700 text-white font-bold shadow-xs'
                                            : 'bg-white/80 hover:bg-white text-stone-700 border border-stone-200/70 hover:border-rose-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-1.5 truncate">
                                        <span className="text-xs shrink-0">💼</span>
                                        {!collapsed && <span className="truncate">Accountant</span>}
                                    </div>
                                    {!collapsed && role === 'accountant' && (
                                        <Check className="w-3 h-3 text-white shrink-0" />
                                    )}
                                </button>
                            )}

                            {/* Receptionist Workspace */}
                            {roles.includes('receptionist') && (
                                <button
                                    type="button"
                                    onClick={() => handleSelectRole('receptionist')}
                                    className={`w-full flex items-center ${collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'} rounded-xl text-xs font-medium transition-all ${
                                        role === 'receptionist'
                                            ? 'bg-teal-700 text-white font-bold shadow-xs'
                                            : 'bg-white/80 hover:bg-white text-stone-700 border border-stone-200/70 hover:border-teal-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-1.5 truncate">
                                        <span className="text-xs shrink-0">📋</span>
                                        {!collapsed && <span className="truncate">Receptionist</span>}
                                    </div>
                                    {!collapsed && role === 'receptionist' && (
                                        <Check className="w-3 h-3 text-white shrink-0" />
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    /* ─── VARIANT: HEADER DROPDOWN ─────────────────────────── */
    return (
        <div className="relative" ref={dropdownRef}>
            <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white text-stone-800 border border-stone-200 hover:border-teal-400 hover:shadow-xs transition-all text-xs font-bold"
            >
                <div className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
                <span className="truncate max-w-[140px]">{getCurrentWorkspaceLabel()}</span>
                <ChevronDown className={`w-3 h-3 text-stone-400 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {dropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-xl border border-stone-200/90 py-2.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150 overflow-hidden">
                    {/* Top Identity Header */}
                    <div className="px-3.5 pb-2.5 border-b border-stone-100">
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <h4 className="text-xs font-black text-stone-900 truncate">
                                    {user?.fullName || user?.email || 'User Account'}
                                </h4>
                                {user?.email && (
                                    <p className="text-[10px] text-stone-500 truncate font-medium">
                                        {user.email}
                                    </p>
                                )}
                            </div>
                            {role === 'teacher' && isStaffUnlocked && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        lockStaffMode();
                                        setDropdownOpen(false);
                                        navigate('/dashboard');
                                    }}
                                    className="shrink-0 text-[10px] font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-lg flex items-center gap-1 transition-colors"
                                    title="Lock Teacher Workspace"
                                >
                                    <Lock className="w-2.5 h-2.5" /> Lock Staff
                                </button>
                            )}
                        </div>
                    </div>

                    {/* FAMILY WORKSPACES */}
                    {hasFamilyWorkspaces && (
                        <div className="px-2 pt-2 pb-1">
                            <div className="text-[10px] font-extrabold uppercase tracking-wider text-stone-400 px-2 pb-1.5 flex items-center justify-between">
                                <span>Family</span>
                            </div>

                            <div className="space-y-0.5">
                                {/* Parent Dashboard First */}
                                {roles.includes('parent') && (
                                    <button
                                        type="button"
                                        onClick={() => handleSelectRole('parent')}
                                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                                            role === 'parent'
                                                ? 'bg-teal-50/90 text-teal-900 shadow-2xs border border-teal-200/60 font-bold'
                                                : 'hover:bg-stone-50 text-stone-700 hover:text-stone-900'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2.5 truncate">
                                            <span className="text-sm shrink-0">👨‍👩‍👧</span>
                                            <span className="truncate">Parent Dashboard</span>
                                        </div>
                                        {role === 'parent' && <Check className="w-3.5 h-3.5 text-teal-700 shrink-0 stroke-[2.5]" />}
                                    </button>
                                )}

                                {/* Linked Children / Student Persona(s) (active only) */}
                                {hasActiveStudentPersona && (
                                    activeLinkedStudents.length > 0 ? (
                                        activeLinkedStudents.map((child) => {
                                            const isCurrent = role === 'student' && (activeStudentId === child.studentId || (!activeStudentId && child.isPrimary));
                                            const classInfo = formatChildClass(child.className, child.sectionName);
                                            return (
                                                <button
                                                    key={child.studentId}
                                                    type="button"
                                                    onClick={() => handleSelectRole('student', child.studentId)}
                                                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                                                        isCurrent
                                                            ? 'bg-emerald-50/90 text-emerald-900 shadow-2xs border border-emerald-200/60 font-bold'
                                                            : 'hover:bg-stone-50 text-stone-700 hover:text-stone-900'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2.5 truncate">
                                                        <span className="text-sm shrink-0">🎓</span>
                                                        <span className="truncate">
                                                            {child.fullName} {classInfo ? `— ${classInfo}` : ''}
                                                        </span>
                                                    </div>
                                                    {isCurrent && (
                                                        <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0 stroke-[2.5]" />
                                                    )}
                                                </button>
                                            );
                                        })
                                    ) : (roles.includes('student') && (!user?.studentStatus || user.studentStatus === 'active')) ? (
                                        <button
                                            type="button"
                                            onClick={() => handleSelectRole('student')}
                                            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                                                role === 'student'
                                                    ? 'bg-emerald-50/90 text-emerald-900 shadow-2xs border border-emerald-200/60 font-bold'
                                                    : 'hover:bg-stone-50 text-stone-700 hover:text-stone-900'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2.5 truncate">
                                                <span className="text-sm shrink-0">🎓</span>
                                                <span className="truncate">
                                                    {user?.fullName ? `${user.fullName} — Student` : 'Student Dashboard'}
                                                </span>
                                            </div>
                                            {role === 'student' && <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0 stroke-[2.5]" />}
                                        </button>
                                    ) : null
                                )}
                            </div>
                        </div>
                    )}

                    {/* WORK WORKSPACES */}
                    {hasWorkWorkspaces && (
                        <div className={`px-2 pb-1.5 ${hasFamilyWorkspaces ? 'border-t border-stone-100 pt-2 mt-1' : 'pt-2'}`}>
                            <div className="text-[10px] font-extrabold uppercase tracking-wider text-stone-400 px-2 pb-1.5 flex items-center justify-between">
                                <span>Work</span>
                            </div>

                            <div className="space-y-0.5">
                                {/* Teacher Dashboard */}
                                {roles.includes('teacher') && (
                                    <button
                                        type="button"
                                        onClick={() => handleSelectRole('teacher')}
                                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                                            role === 'teacher'
                                                ? 'bg-amber-50/90 text-amber-950 shadow-2xs border border-amber-200/60 font-bold'
                                                : 'hover:bg-stone-50 text-stone-700 hover:text-stone-900'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2.5 truncate">
                                            <span className="text-sm shrink-0">👩‍🏫</span>
                                            <span className="truncate">Teacher Dashboard</span>
                                        </div>
                                        {role === 'teacher' ? (
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-200/70 text-amber-900">
                                                    Active
                                                </span>
                                                <Check className="w-3.5 h-3.5 text-amber-700 shrink-0 stroke-[2.5]" />
                                            </div>
                                        ) : isStaffUnlocked ? (
                                            <span className="text-xs text-emerald-600 font-bold" title="Staff session unlocked">
                                                ✓
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100/70 text-amber-900 border border-amber-200/70" title="PIN Required">
                                                <Lock className="w-2.5 h-2.5 text-amber-700" />
                                                <span>🔒</span>
                                            </span>
                                        )}
                                    </button>
                                )}

                                {/* School Admin / Super Admin */}
                                {(roles.includes('admin') || roles.includes('superadmin')) && (
                                    <button
                                        type="button"
                                        onClick={() => handleSelectRole(roles.includes('superadmin') ? 'superadmin' : 'admin')}
                                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                                            role === 'admin' || role === 'superadmin'
                                                ? 'bg-indigo-50/90 text-indigo-950 shadow-2xs border border-indigo-200/60 font-bold'
                                                : 'hover:bg-stone-50 text-stone-700 hover:text-stone-900'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2.5 truncate">
                                            <Shield className="w-4 h-4 text-indigo-700 shrink-0" />
                                            <span className="truncate">
                                                {roles.includes('superadmin') ? 'Super Admin' : 'School Admin'}
                                            </span>
                                        </div>
                                        {(role === 'admin' || role === 'superadmin') && (
                                            <Check className="w-3.5 h-3.5 text-indigo-700 shrink-0 stroke-[2.5]" />
                                        )}
                                    </button>
                                )}

                                {/* Accountant */}
                                {roles.includes('accountant') && (
                                    <button
                                        type="button"
                                        onClick={() => handleSelectRole('accountant')}
                                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                                            role === 'accountant'
                                                ? 'bg-rose-50/90 text-rose-950 shadow-2xs border border-rose-200/60 font-bold'
                                                : 'hover:bg-stone-50 text-stone-700 hover:text-stone-900'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2.5 truncate">
                                            <span className="text-sm shrink-0">💼</span>
                                            <span className="truncate">Accountant</span>
                                        </div>
                                        {role === 'accountant' && (
                                            <Check className="w-3.5 h-3.5 text-rose-700 shrink-0 stroke-[2.5]" />
                                        )}
                                    </button>
                                )}

                                {/* Receptionist */}
                                {roles.includes('receptionist') && (
                                    <button
                                        type="button"
                                        onClick={() => handleSelectRole('receptionist')}
                                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                                            role === 'receptionist'
                                                ? 'bg-teal-50/90 text-teal-950 shadow-2xs border border-teal-200/60 font-bold'
                                                : 'hover:bg-stone-50 text-stone-700 hover:text-stone-900'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2.5 truncate">
                                            <span className="text-sm shrink-0">📋</span>
                                            <span className="truncate">Receptionist</span>
                                        </div>
                                        {role === 'receptionist' && (
                                            <Check className="w-3.5 h-3.5 text-teal-700 shrink-0 stroke-[2.5]" />
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

