import { createContext } from 'react';
import type { UserRole } from '../config/roles';

export interface AuthUser {
    id: string;
    email: string;
    fullName?: string;
    schoolId?: string | null;
    schoolName?: string | null;
    studentStatus?: string | null;
}

export interface TransitionState {
    show: boolean;
    message: string;
    messages?: string[];
    submessage?: string;
}

export interface StaffPinStatus {
    hasPin: boolean;
    mustChange: boolean;
    isLocked: boolean;
    lockedUntil: string | null;
    attemptsRemaining: number;
    isTemporary: boolean;
}

export interface LinkedStudentPersona {
    studentId: string;
    fullName: string;
    email: string;
    schoolId: string;
    relationship: string;
    isPrimary: boolean;
    avatarUrl?: string | null;
    className?: string | null;
    sectionName?: string | null;
    status?: string | null;
    studentStatus?: string | null;
}

export interface AuthContextType {
    user: AuthUser | null;
    role: UserRole | null;
    roles: UserRole[];
    loading: boolean;
    isTransitioning: boolean;
    transition: TransitionState;
    setTransitioning: (val: boolean) => void;
    setTransition: (val: TransitionState) => void;
    switchDashboardRole: (role: UserRole) => void;
    login: (email: string, password: string) => Promise<UserRole>;
    signOut: () => Promise<void>;
    toast: { show: boolean; message: string };
    hideToast: () => void;
    // Phase 5 Staff Unlock State & Methods
    isStaffUnlocked: boolean;
    staffSessionToken: string | null;
    staffPinStatus: StaffPinStatus | null;
    checkStaffPinStatus: () => Promise<StaffPinStatus | null>;
    unlockStaffMode: (pin: string) => Promise<{ success: boolean; error?: string; attemptsRemaining?: number; lockedUntil?: string; mustChange?: boolean }>;
    lockStaffMode: () => Promise<void>;
    setupStaffPin: (newPin: string, currentPin?: string) => Promise<{ success: boolean; error?: string }>;
    isStaffPinModalOpen: boolean;
    openStaffPinModal: () => void;
    closeStaffPinModal: () => void;
    // Phase 6 Persona & View Switcher State & Methods
    linkedStudents: LinkedStudentPersona[];
    activeStudentId: string | null;
    setActiveStudentId: (studentId: string | null) => void;
    refreshPersonaSummary: () => Promise<void>;
}

// Stable context identity across HMR — defined in a non-component module so
// React Fast Refresh never re-creates it. AuthProvider and useAuth both
// import this same object.
export const AuthContext = createContext<AuthContextType | undefined>(undefined);
