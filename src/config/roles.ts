export type UserRole = 'superadmin' | 'admin' | 'teacher' | 'student' | 'parent' | 'receptionist' | 'accountant';

export interface RouteConfig {
    path: string;
    label: string;
    icon?: string;
    roles: UserRole[];
    keywords?: string[];
}

export const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string; order: number }> = {
    superadmin: { label: 'Super Admin', color: 'text-indigo-700', bg: 'bg-indigo-100', order: 0 },
    admin: { label: 'Admin', color: 'text-amber-700', bg: 'bg-amber-100', order: 1 },
    teacher: { label: 'Teacher', color: 'text-sky-700', bg: 'bg-sky-100', order: 2 },
    student: { label: 'Student', color: 'text-emerald-700', bg: 'bg-emerald-100', order: 3 },
    parent: { label: 'Parent', color: 'text-purple-700', bg: 'bg-purple-100', order: 4 },
    accountant: { label: 'Accountant', color: 'text-rose-700', bg: 'bg-rose-100', order: 5 },
    receptionist: { label: 'Receptionist', color: 'text-teal-700', bg: 'bg-teal-100', order: 6 },
};

export const getRoleStyle = (role: string) => ROLE_CONFIG[role] || { label: role, color: 'text-gray-700', bg: 'bg-gray-100', order: 99 };


// ─────────────────────────────────────────────────────────────
// 📝 Author: Narco / Arth
// 🔗 GitHub: https://github.com/ArthOfficial
// 🌐 Website: https://arth-hub.vercel.app
// © 2026 Arth — All rights reserved.
// ─────────────────────────────────────────────────────────────

export const DASHBOARD_ROUTES: RouteConfig[] = [
    { path: '/super-admin', label: 'Dashboard', icon: 'LayoutDashboard', roles: ['superadmin'], keywords: ['overview', 'home', 'main', 'status'] },
    { path: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard', roles: ['admin', 'teacher', 'student', 'parent', 'receptionist', 'accountant'], keywords: ['overview', 'home', 'main'] },
    { path: '/announcements', label: 'Announcements', icon: 'Bell', roles: ['superadmin', 'admin', 'teacher', 'student', 'parent', 'receptionist', 'accountant'], keywords: ['notices', 'school', 'messages', 'updates'] },
    { path: '/database', label: 'Database', icon: 'Database', roles: ['superadmin'], keywords: ['tenant', 'schema', 'tables', 'school', 'data', 'infrastructure'] },
    { path: '/users', label: 'Users', icon: 'Users', roles: ['superadmin', 'admin', 'receptionist'], keywords: ['admin', 'users', 'staff', 'management', 'accounts', 'recovery', 'otp'] },
    { path: '/finance', label: 'Finance', icon: 'Coins', roles: ['superadmin'], keywords: ['billing', 'payments', 'fees', 'money', 'invoice', 'revenue'] },
    { path: '/school-finance', label: 'School Finance', icon: 'Wallet', roles: ['admin', 'accountant'], keywords: ['fees', 'salary', 'invoice', 'receipt', 'payroll', 'dues', 'collection'] },
    { path: '/classes', label: 'Classes', icon: 'GraduationCap', roles: ['superadmin', 'admin', 'teacher', 'receptionist', 'accountant'], keywords: ['class', 'section', 'roster', 'students', 'subjects', 'grade', 'principal'] },
    { path: '/attendance', label: 'Attendance', icon: 'CheckSquare', roles: ['admin', 'teacher'], keywords: ['presence', 'absence', 'roll', 'students', 'records'] },
    { path: '/alerts', label: 'System Alerts', icon: 'AlertTriangle', roles: ['superadmin', 'admin'], keywords: ['logs', 'errors', 'notifications', 'status', 'health', 'system'] },
    { path: '/settings', label: 'Global Setup', icon: 'Settings', roles: ['superadmin', 'admin'], keywords: ['permissions', 'roles', 'config', 'setup', 'school', 'module', 'system'] },
];
