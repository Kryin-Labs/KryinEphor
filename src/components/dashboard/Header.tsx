import React, { useState, useRef, useEffect } from 'react';
import { Search, ShieldCheck, LayoutDashboard, Database, Users, Coins, CheckSquare, AlertTriangle, Settings, School as SchoolIcon, Menu, ArrowLeftRight, Lock, Bell } from 'lucide-react';
import NotificationsBell from './NotificationsBell';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { DASHBOARD_ROUTES } from '../../config/roles';
import { PersonaSwitcher } from './PersonaSwitcher';
import type { LucideIcon } from 'lucide-react';

interface HeaderProps {
    title?: string;
}

const iconMap: Record<string, LucideIcon> = {
    'LayoutDashboard': LayoutDashboard,
    'Database': Database,
    'Users': Users,
    'Coins': Coins,
    'CheckSquare': CheckSquare,
    'AlertTriangle': AlertTriangle,
    'Settings': Settings,
    'School': SchoolIcon,
    'Bell': Bell,
};

const Header: React.FC<HeaderProps> = ({ title = 'Dashboard Overview' }) => {
    const { role, roles, user, switchDashboardRole, lockStaffMode, linkedStudents, setActiveStudentId } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);

    const allowedRoutes = DASHBOARD_ROUTES.filter(route =>
        role ? route.roles.includes(role) : false
    );

    const filteredRoutes = searchQuery
        ? allowedRoutes.filter(route => {
            const query = searchQuery.toLowerCase();
            return (
                route.label.toLowerCase().includes(query) ||
                route.keywords?.some(k => k.toLowerCase().includes(query))
            );
        })
        : [];

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
                setIsSearchOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                document.getElementById('global-search')?.focus();
                setIsSearchOpen(true);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleSelectRoute = (path: string) => {
        navigate(path);
        setSearchQuery('');
        setIsSearchOpen(false);
    };

    return (
        <header className="sticky top-0 z-30 bg-[#FAF9F6]/80 backdrop-blur-lg border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-3">
            <div className="font-bold text-lg sm:text-xl text-foreground hidden sm:block truncate">{title}</div>


            <div className="flex-1 max-w-xl mx-4 sm:mx-8 relative" ref={searchRef}>
                <input
                    id="global-search"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setIsSearchOpen(true);
                    }}
                    onFocus={() => setIsSearchOpen(true)}
                    className="clay-input w-full py-2.5 pl-10 pr-12 text-sm focus:ring-2 focus:ring-primary/20 transition-all border border-gray-200 rounded-xl"
                    placeholder="Search modules, permissions, users..."
                />
                <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 bg-stone-100 px-1.5 py-0.5 rounded border border-stone-200 text-[10px] font-bold text-stone-500 shadow-sm hidden sm:block">
                    ⌘K
                </div>

                {isSearchOpen && searchQuery && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl border border-stone-200 shadow-xl overflow-hidden z-50 animate-fade-in origin-top">
                        {filteredRoutes.length > 0 ? (
                            <div className="py-2">
                                <div className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-stone-400">Modules</div>
                                {filteredRoutes.map((route, idx) => {
                                    const Icon = iconMap[route.icon || 'LayoutDashboard'] || LayoutDashboard;
                                    return (
                                        <button
                                            key={idx}
                                            onClick={() => handleSelectRoute(route.path)}
                                            className="w-full text-left px-4 py-3 hover:bg-stone-50 transition-colors flex items-center justify-between group"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center group-hover:bg-primary/10 group-hover:text-primary transition-colors text-stone-500">
                                                    <Icon className="w-4 h-4" />
                                                </div>
                                                <span className="text-sm font-bold text-stone-700 group-hover:text-stone-900">{route.label}</span>
                                            </div>
                                            <span className="text-xs font-bold text-stone-400 group-hover:text-primary transition-colors opacity-0 group-hover:opacity-100 hidden sm:block">Navigate →</span>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="p-8 text-center text-stone-500">
                                <Search className="w-8 h-8 mx-auto mb-3 opacity-20" />
                                <p className="text-sm font-medium">No modules found for "{searchQuery}"</p>
                                <p className="text-xs text-stone-400 mt-1">Try keywords like 'permissions', 'users', or 'finance'</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <button
                type="button"
                onClick={() => window.dispatchEvent(new Event('sidebar:open-mobile-menu'))}
                aria-label="Open sidebar menu"
                className="order-first sm:order-none lg:hidden flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-primary shadow-sm transition-colors hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
                <Menu className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3">
                {/* Phase 5: Lock Teacher View button */}
                {role === 'teacher' && (
                    <button
                        type="button"
                        onClick={async () => {
                            await lockStaffMode();
                            navigate('/dashboard');
                        }}
                        title="Lock Teacher View (return to family view)"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100 hover:border-amber-300 text-xs font-bold shadow-xs transition-all active:scale-95 cursor-pointer"
                    >
                        <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                        <span className="hidden sm:inline">Lock Teacher View</span>
                    </button>
                )}

                {/* Persona Switcher for multi-role/multi-child, or quick switch button for pure Student/Parent */}
                {(() => {
                    const activeLinkedStudents = linkedStudents?.filter(s => !s.studentStatus || s.studentStatus === 'active') || [];
                    const availablePersonasCount = (() => {
                        let count = 0;
                        if (roles.includes('parent')) count++;
                        if (roles.includes('teacher')) count++;
                        if (roles.includes('admin') || roles.includes('superadmin')) count++;
                        if (roles.includes('accountant')) count++;
                        if (roles.includes('receptionist')) count++;
                        count += activeLinkedStudents.length;
                        if (roles.includes('student') && activeLinkedStudents.length === 0 && (!user?.studentStatus || user.studentStatus === 'active')) {
                            count++;
                        }
                        return count;
                    })();

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

                    if (isPureStudentParent) {
                        return (
                            <button
                                type="button"
                                onClick={() => {
                                    const next = role === 'student' ? 'parent' : 'student';
                                    if (next === 'student' && activeLinkedStudents[0]) {
                                        setActiveStudentId(activeLinkedStudents[0].studentId);
                                    }
                                    switchDashboardRole(next);
                                    if (['/classes', '/users', '/attendance', '/marks', '/manage-tests', '/school-finance', '/finance', '/settings', '/global-setup', '/alerts', '/database'].includes(location.pathname)) {
                                        navigate('/dashboard');
                                    }
                                }}
                                title={`Switch to ${role === 'student' ? 'Parent' : 'Student'} View`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-teal-50 to-emerald-50 text-teal-800 border border-teal-200 hover:bg-teal-100 hover:border-teal-300 text-xs font-bold shadow-xs transition-all active:scale-95 cursor-pointer"
                            >
                                <ArrowLeftRight className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                                <span className="hidden sm:inline">Switch to {role === 'student' ? 'Parent' : 'Student'}</span>
                                <span className="sm:hidden">{role === 'student' ? 'Parent' : 'Student'}</span>
                            </button>
                        );
                    }
                    if (availablePersonasCount > 1) {
                        return <PersonaSwitcher variant="header" />;
                    }
                    return null;
                })()}
                {(() => {
                    const roleLabelMap: Record<string, string> = {
                        superadmin: 'Super Admin',
                        admin: 'Administrator',
                        teacher: 'Teacher',
                        student: 'Student',
                        parent: 'Parent',
                        accountant: 'Accountant',
                        receptionist: 'Receptionist',
                    };
                    const roleLabel = role ? (roleLabelMap[role] ?? role) : 'Member';
                    const displayName = user?.fullName?.trim() || user?.email?.split('@')[0] || 'Account';
                    const contextLabel = role === 'superadmin'
                        ? 'Platform Core'
                        : (user?.schoolName?.trim() || 'No school assigned');
                    return (
                        <div className="hidden md:flex items-center gap-2 bg-teal-50 text-primary px-3 py-1.5 rounded-full border border-teal-100 shadow-sm max-w-xs">
                            <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="text-xs font-bold truncate" title={`${displayName} — ${roleLabel} · ${contextLabel}`}>
                                {displayName} · {roleLabel} · {contextLabel}
                            </span>
                        </div>
                    );
                })()}
                <NotificationsBell />

            </div>
        </header>
    );
};

export default Header;
