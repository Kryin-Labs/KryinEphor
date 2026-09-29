import { useState, useEffect, useCallback, useRef } from 'react';
import type { UserRole } from '../config/roles';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { AuthContext, type AuthUser, type StaffPinStatus, type LinkedStudentPersona } from './authContextValue';
import { shouldHydrateAuthEvent, signOutBeforeRedirect } from '../lib/auth/loginSession';
import { StaffPinModal } from '../components/auth/StaffPinModal';
import { unsubscribeFromAnnouncementPush } from '../lib/announcementPush';

// Re-export useAuth from its dedicated module so existing imports keep working
// while React Fast Refresh treats this file as a pure component module.
// eslint-disable-next-line react-refresh/only-export-components
export { useAuth } from '../hooks/useAuth';

/**
 * Fetch the user's profile (role, full_name, school) from the profiles table.
 */
async function fetchProfile(userId: string): Promise<{
    role: UserRole;
    fullName: string;
    schoolId: string | null;
    schoolName: string | null;
    studentStatus?: string | null;
    isActive: boolean;
    deletedAt: string | null;
} | null> {
    const { data, error } = await supabase
        .from('profiles')
        .select('role, full_name, school_id, student_status, is_active, deleted_at, schools:school_id(name)')
        .eq('id', userId)
        .single();

    if (error || !data) {
        await logger.error('auth', 'Failed to fetch profile', {
            userId,
            details: { error: error?.message }
        });
        return null;
    }

    const row = data as unknown as {
        role: string;
        full_name: string | null;
        school_id: string | null;
        student_status?: string | null;
        is_active: boolean | null;
        deleted_at: string | null;
        schools: { name: string } | { name: string }[] | null;
    };
    const schoolJoin = Array.isArray(row.schools) ? row.schools[0] : row.schools;

    return {
        role: row.role as UserRole,
        fullName: row.full_name || '',
        schoolId: row.school_id ?? null,
        schoolName: schoolJoin?.name ?? null,
        studentStatus: row.student_status ?? null,
        isActive: row.is_active !== false,
        deletedAt: row.deleted_at ?? null,
    };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [role, setRole] = useState<UserRole | null>(null);
    const [roles, setRoles] = useState<UserRole[]>([]);
    const [loading, setLoading] = useState(true); // Start as true — checking session
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [transition, setTransition] = useState<{ show: boolean; message: string; messages?: string[]; submessage?: string }>({
        show: false,
        message: 'Just a moment…',
    });
    const [toast, setToast] = useState({ show: false, message: '' });
    const loginInProgressRef = useRef(false);

    // Phase 5 Staff PIN and unlock state
    const [isStaffUnlocked, setIsStaffUnlocked] = useState(false);
    const [staffSessionToken, setStaffSessionToken] = useState<string | null>(null);
    const [staffPinStatus, setStaffPinStatus] = useState<StaffPinStatus | null>(null);
    const [isStaffPinModalOpen, setIsStaffPinModalOpen] = useState(false);

    // Phase 6 & 7 Persona & Multiple Children state
    const [linkedStudents, setLinkedStudents] = useState<LinkedStudentPersona[]>([]);
    const [activeStudentId, setActiveStudentIdState] = useState<string | null>(() => {
        try {
            return sessionStorage.getItem('ky_active_student_id') || localStorage.getItem('ky_active_student_id') || null;
        } catch {
            return null;
        }
    });

    const setActiveStudentId = useCallback((id: string | null) => {
        if (id) {
            // Verify that the requested student exists in the authorized linked students
            const isAuthorized = linkedStudents.some(s => s.studentId === id);
            if (!isAuthorized && linkedStudents.length > 0) {
                // Reject unauthorized client selection
                return;
            }
        }
        setActiveStudentIdState(id);
        if (id) {
            try {
                sessionStorage.setItem('ky_active_student_id', id);
                localStorage.setItem('ky_active_student_id', id);
            } catch { /* ignore */ }
        } else {
            try {
                sessionStorage.removeItem('ky_active_student_id');
                localStorage.removeItem('ky_active_student_id');
            } catch { /* ignore */ }
        }
    }, [linkedStudents]);

    const refreshPersonaSummary = useCallback(async () => {
        try {
            const { data, error } = await supabase.rpc('fn_get_my_persona_summary');
            if (!error && data && (data as any).success) {
                const rawStudents = (data as any).linked_students || [];
                const parsed: LinkedStudentPersona[] = rawStudents.map((s: any) => ({
                    studentId: s.student_id,
                    fullName: s.full_name,
                    email: s.email,
                    schoolId: s.school_id,
                    relationship: s.relationship,
                    isPrimary: Boolean(s.is_primary),
                    avatarUrl: s.avatar_url ?? null,
                    className: s.class_name ?? null,
                    sectionName: s.section_name ?? null,
                    status: s.status ?? 'active',
                    studentStatus: s.student_status ?? 'active'
                }));
                setLinkedStudents(parsed);

                // Authoritative validation: verify stored active child still exists in authorized list
                const storedId = (() => {
                    try {
                        return sessionStorage.getItem('ky_active_student_id') || localStorage.getItem('ky_active_student_id') || null;
                    } catch {
                        return null;
                    }
                })();

                if (parsed.length > 0) {
                    const validMatch = storedId ? parsed.find(s => s.studentId === storedId) : null;
                    if (validMatch) {
                        setActiveStudentIdState(validMatch.studentId);
                    } else {
                        // Fall back to primary child, or first active child
                        const fallbackChild = parsed.find(s => s.isPrimary) || parsed[0];
                        setActiveStudentIdState(fallbackChild.studentId);
                        try {
                            sessionStorage.setItem('ky_active_student_id', fallbackChild.studentId);
                            localStorage.setItem('ky_active_student_id', fallbackChild.studentId);
                        } catch { /* ignore */ }
                    }
                } else {
                    // No authorized children linked
                    setActiveStudentIdState(null);
                    try {
                        sessionStorage.removeItem('ky_active_student_id');
                        localStorage.removeItem('ky_active_student_id');
                    } catch { /* ignore */ }
                }
            }
        } catch { /* ignore */ }
    }, []);

    /**
     * Handle a Supabase auth session — fetch profile and set state.
     */
    const handleSession = useCallback(async (session: Session | null, shouldLog: boolean) => {
        if (!session?.user) {
            setUser(null);
            setRole(null);
            setRoles([]);
            setIsStaffUnlocked(false);
            setStaffSessionToken(null);
            setLoading(false);
            return;
        }

        const supaUser: User = session.user;
        const profile = await fetchProfile(supaUser.id);

        if (profile) {
            // Authoritative account deactivation check: reject if inactive or deleted
            if (profile.isActive === false || profile.deletedAt !== null) {
                await logger.warn('auth', 'Session restored for deactivated/deleted account — signing out', {
                    userId: supaUser.id,
                    details: { isActive: profile.isActive, deletedAt: profile.deletedAt }
                });
                await supabase.auth.signOut();
                setUser(null);
                setRole(null);
                setRoles([]);
                setIsStaffUnlocked(false);
                setStaffSessionToken(null);
                setLinkedStudents([]);
                setActiveStudentIdState(null);
                setLoading(false);
                window.location.href = '/';
                return;
            }

            setUser({
                id: supaUser.id,
                email: supaUser.email || '',
                fullName: profile.fullName,
                schoolId: profile.schoolId,
                schoolName: profile.schoolName,
                studentStatus: profile.studentStatus ?? null,
            });
            // Fetch all assigned roles (primary + additional) via SECURITY DEFINER RPC.
            const { data: rolesData } = await supabase.rpc('fn_get_my_roles');
            const allRoles = Array.from(new Set([
                profile.role,
                ...(((rolesData ?? []) as string[]).map(r => r as UserRole)),
            ]));
            setRoles(allRoles);

            // Phase 5: Server-side validation of staff unlock session token
            let hasValidStaffUnlock = false;
            let validToken: string | null = null;
            if (allRoles.includes('teacher')) {
                try {
                    const storedToken = sessionStorage.getItem(`staff_session_token_${supaUser.id}`);
                    if (storedToken) {
                        const { data: valData } = await supabase.rpc('fn_validate_staff_session', {
                            _session_token: storedToken
                        });
                        if (valData && valData.is_valid) {
                            hasValidStaffUnlock = true;
                            validToken = storedToken;
                        } else {
                            sessionStorage.removeItem(`staff_session_token_${supaUser.id}`);
                        }
                    }
                } catch { /* ignore */ }
            }
            setIsStaffUnlocked(hasValidStaffUnlock);
            setStaffSessionToken(validToken);

            let effectiveActiveRole = profile.role;
            try {
                const storedRole = localStorage.getItem(`active_role_${supaUser.id}`) as UserRole | null;
                if (storedRole && allRoles.includes(storedRole)) {
                    effectiveActiveRole = storedRole;
                }
            } catch { /* ignore */ }

            // If stored role was 'teacher' but staff mode is not unlocked,
            // fall back to parent or student so privileged educator view is not open on shared devices.
            if (effectiveActiveRole === 'teacher' && !hasValidStaffUnlock && allRoles.some(r => r === 'student' || r === 'parent')) {
                effectiveActiveRole = allRoles.includes('parent') ? 'parent' : 'student';
            }

            setRole(effectiveActiveRole);
            void refreshPersonaSummary();
            if (shouldLog) {
                await logger.info('auth', 'Session restored', {
                    details: { email: supaUser.email, role: effectiveActiveRole, roles: allRoles },
                    userId: supaUser.id
                });
            }
        } else {
            setUser(null);
            setRole(null);
            setRoles([]);
            setIsStaffUnlocked(false);
            setStaffSessionToken(null);
            setLinkedStudents([]);
            setActiveStudentIdState(null);
            if (shouldLog) {
                await logger.warn('auth', 'User has no profile', {
                    details: { email: supaUser.email, userId: supaUser.id }
                });
            }
        }

        setLoading(false);
    }, []);

    /**
     * On mount: rely on onAuthStateChange (fires INITIAL_SESSION immediately).
     * We deliberately don't also call getSession() — that caused duplicate
     * "Session restored" logs (one per call site). Likewise, TOKEN_REFRESHED
     * and USER_UPDATED fire periodically (every ~hour and on metadata change)
     * and should never re-log a session-restore event.
     */
    useEffect(() => {
        // Pick up a one-shot toast queued before a hard navigation (e.g.
        // post sign-out redirect from a protected/locked screen back to "/").
        try {
            const queued = sessionStorage.getItem('post_signout_toast');
            if (queued) {
                sessionStorage.removeItem('post_signout_toast');
                // Defer so the landing page mounts first.
                setTimeout(() => setToast({ show: true, message: queued }), 350);
            }
        } catch { /* ignore */ }

        let loggedForUser: string | null = null;
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (!shouldHydrateAuthEvent(event, loginInProgressRef.current)) return;
            const uid = session?.user?.id ?? null;
            const isNewUser = uid !== null && uid !== loggedForUser;
            const shouldLog =
                isNewUser && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN');
            if (shouldLog) loggedForUser = uid;
            if (event === 'SIGNED_OUT') loggedForUser = null;
            handleSession(session, shouldLog);
        });

        return () => {
            subscription.unsubscribe();
        };
    }, [handleSession]);

    /**
     * Realtime: when the current user's profile row changes (role, school,
     * is_active), immediately re-sync. If role changes or account is
     * deactivated, force refresh/reload so ProtectedRoute re-evaluates and
     * the JWT picks up new app_metadata for RLS.
     */
    useEffect(() => {
        if (!user?.id) return;
        const currentRole = role;
        const channel = supabase
            .channel(`profile-watch-${user.id}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
                async (payload) => {
                    const newRow = payload.new as { role?: string; is_active?: boolean } | null;
                    if (!newRow || payload.eventType === 'DELETE' || newRow.is_active === false) {
                        await logger.warn('auth', 'Profile deleted/deactivated — signing out', { userId: user.id });
                        await supabase.auth.signOut();
                        window.location.href = '/';
                        return;
                    }
                    if (newRow.role && newRow.role !== currentRole) {
                        await logger.info('auth', 'Role changed — reloading session', {
                            userId: user.id,
                            details: { from: currentRole, to: newRow.role },
                        });
                        try { await supabase.auth.refreshSession(); } catch { /* ignore */ }
                        window.location.reload();
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user?.id, role]);

    /**
     * Login with email + password via Supabase Auth.
     */
    const login = async (email: string, password: string): Promise<UserRole> => {
        loginInProgressRef.current = true;
        setLoading(true);
        setTransition({
            show: true,
            message: 'Signing you in…',
            messages: [
                'Signing you in…',
                'Verifying credentials…',
                'Loading your workspace…',
                'Almost there…',
            ],
            submessage: 'Securely connecting to your dashboard.',
        });
        setIsTransitioning(true);

        const loginDetails = { email }; // SECURITY: Never log passwords

        try {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });

            if (error) {
                await logger.error('auth', `Login failed for ${email}`, {
                    action: 'login',
                    status: 'failed',
                    details: loginDetails
                });
                setLoading(false);
                setIsTransitioning(false);
                throw new Error(error.message);
            }

            // Fetch profile for the logged-in user
            const profile = await fetchProfile(data.user.id);

            if (!profile) {
                await supabase.auth.signOut();
                await logger.error('auth', 'Login succeeded but no profile found', {
                    action: 'login',
                    status: 'failed',
                    details: { email, userId: data.user.id },
                    userId: data.user.id
                });
                setLoading(false);
                setIsTransitioning(false);
                throw new Error('Account not configured. Contact your administrator.');
            }

            if (profile.isActive === false || profile.deletedAt !== null) {
                await supabase.auth.signOut();
                await logger.warn('auth', 'Login blocked for deactivated/deleted profile', {
                    action: 'login',
                    status: 'blocked',
                    details: { email, userId: data.user.id, isActive: profile.isActive, deletedAt: profile.deletedAt },
                    userId: data.user.id
                });
                setLoading(false);
                setIsTransitioning(false);
                throw new Error('This account has been deactivated. Please contact your school administrator.');
            }

            setUser({
                id: data.user.id,
                email: data.user.email || email,
                fullName: profile.fullName,
                schoolId: profile.schoolId,
                schoolName: profile.schoolName,
            });
            const { data: rolesData } = await supabase.rpc('fn_get_my_roles');
            setRole(profile.role);
            setRoles(Array.from(new Set([
                profile.role,
                ...(((rolesData ?? []) as string[]).map(r => r as UserRole)),
            ])));

            await logger.info('auth', 'Login successful', {
                action: 'login',
                status: 'success',
                details: { email, role: profile.role },
                userId: data.user.id
            });

            return profile.role;
        } catch (e: unknown) {
            // Error already logged if it was a Supabase error
            if (!(e instanceof Error && e.message === 'Login failed')) {
                // Fallback catch for unexpected errors
                console.error(e);
            }
            throw e;
        } finally {
            loginInProgressRef.current = false;
            setLoading(false);
            setIsTransitioning(false);
            setTransition({ show: false, message: '' });
        }
    };

    /**
     * Sign out via Supabase Auth.
     */
    const signOut = async () => {
        const currentEmail = user?.email;
        const currentUserId = user?.id;
        setTransition({
            show: true,
            message: 'Signing you out…',
            messages: [
                'Signing you out…',
                'Clearing your session…',
                'See you soon…',
            ],
            submessage: 'Securely ending your session.',
        });
        setIsTransitioning(true);

        // Fire-and-forget logs so we don't block the redirect on network I/O.
        void logger.info('auth', 'Logout initiated', {
            action: 'logout',
            status: 'pending',
            details: { email: currentEmail },
            userId: currentUserId,
        });

        // Local scope = clear tokens client-side without waiting for the
        // Supabase server round-trip (which was adding ~5–7s to sign-out).
        // Global session revocation happens lazily on next server contact.
        try {
            // Phase 17: Revoke server staff unlock session on logout
            try { await unsubscribeFromAnnouncementPush(); } catch { /* best effort */ }
            if (staffSessionToken) {
                try {
                    await supabase.rpc('fn_revoke_staff_session', {
                        _session_token: staffSessionToken,
                        _reason: 'LOGOUT'
                    });
                } catch { /* ignore */ }
            }
            if (currentUserId) {
                try {
                    sessionStorage.removeItem(`staff_session_token_${currentUserId}`);

                } catch { /* ignore */ }
            }
            setIsStaffUnlocked(false);
            setStaffSessionToken(null);

            await signOutBeforeRedirect(
                () => supabase.auth.signOut({ scope: 'global' }),
                () => {
                    void logger.info('auth', 'Logout successful', {
                        action: 'logout',
                        status: 'success',
                        details: { email: currentEmail },
                    });
                    setUser(null);
                    setRole(null);
                    setRoles([]);
                    setLinkedStudents([]);
                    setActiveStudentIdState(null);
                    try {
                        sessionStorage.removeItem('ky_active_student_id');
                        localStorage.removeItem('ky_active_student_id');
                    } catch { /* ignore */ }
                    try {
                        sessionStorage.setItem('post_signout_toast', 'Logged out successfully! Come back soon.');
                    } catch { /* ignore quota / privacy-mode errors */ }
                    window.location.replace('/');
                },
            );
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unable to sign out.';
            await logger.error('auth', 'Logout failed', {
                action: 'logout',
                status: 'error',
                details: { error: message },
                userId: currentUserId,
            });
            setToast({ show: true, message: `Sign-out failed: ${message}` });
            setIsTransitioning(false);
            setTransition({ show: false, message: '' });
        }
    };

    const checkStaffPinStatus = useCallback(async (): Promise<StaffPinStatus | null> => {
        if (!user?.schoolId) return null;
        try {
            const { data, error } = await supabase.rpc('fn_check_staff_pin_status', {
                _school_id: user.schoolId
            });
            if (error || !data) return null;
            const s: StaffPinStatus = {
                hasPin: Boolean(data.has_pin),
                mustChange: Boolean(data.must_change),
                isLocked: Boolean(data.is_locked),
                lockedUntil: data.locked_until ?? null,
                attemptsRemaining: data.attempts_remaining ?? 5,
                isTemporary: Boolean(data.is_temporary),
            };
            setStaffPinStatus(s);
            return s;
        } catch {
            return null;
        }
    }, [user?.schoolId]);

    const unlockStaffMode = useCallback(async (pin: string) => {
        if (!user?.schoolId || !user?.id) {
            return { success: false, error: 'No active school context' };
        }
        try {
            const { data, error } = await supabase.rpc('fn_verify_staff_pin', {
                _school_id: user.schoolId,
                _pin: pin,
                _device_info: navigator.userAgent
            });
            if (error) {
                return { success: false, error: error.message };
            }
            if (data && data.success && data.session_token) {
                setIsStaffUnlocked(true);
                setStaffSessionToken(data.session_token);
                try {
                    sessionStorage.setItem(`staff_session_token_${user.id}`, data.session_token);
                } catch { /* ignore */ }
                // Successfully unlocked! Now switch active role to 'teacher'
                setRole('teacher');
                try {
                    localStorage.setItem(`active_role_${user.id}`, 'teacher');
                } catch { /* ignore */ }
                return { success: true, mustChange: data.must_change };
            } else {
                return {
                    success: false,
                    error: data?.error,
                    message: data?.message,
                    attemptsRemaining: data?.attempts_remaining,
                    lockedUntil: data?.locked_until
                };
            }
        } catch (err: unknown) {
            return { success: false, error: err instanceof Error ? err.message : 'Unlock failed' };
        }
    }, [user?.schoolId, user?.id]);

    const lockStaffMode = useCallback(async () => {
        if (staffSessionToken) {
            try {
                await supabase.rpc('fn_revoke_staff_session', {
                    _session_token: staffSessionToken,
                    _reason: 'USER_LOCKED'
                });
            } catch { /* ignore */ }
        }
        setIsStaffUnlocked(false);

        setStaffSessionToken(null);
        if (user?.id) {
            try {
                sessionStorage.removeItem(`staff_session_token_${user.id}`);
            } catch { /* ignore */ }
        }
        // Fallback role: parent or student if available on account
        if (role === 'teacher') {
            const fallbackRole: UserRole = roles.includes('parent')
                ? 'parent'
                : (roles.includes('student') ? 'student' : roles[0]);
            setRole(fallbackRole);
            if (user?.id) {
                try {
                    localStorage.setItem(`active_role_${user.id}`, fallbackRole);
                } catch { /* ignore */ }
            }
        }
    }, [staffSessionToken, user?.id, role, roles]);

    const setupStaffPin = useCallback(async (newPin: string, currentPin?: string) => {
        if (!user?.schoolId || !user?.id) {
            return { success: false, error: 'No active school context' };
        }
        try {
            const { data, error } = await supabase.rpc('fn_setup_or_change_staff_pin', {
                _school_id: user.schoolId,
                _target_user_id: user.id,
                _new_pin: newPin,
                _current_pin: currentPin || null,
                _is_temporary: false
            });
            if (error) {
                return { success: false, error: error.message };
            }
            if (data && data.success) {
                await checkStaffPinStatus();
                return { success: true };
            } else {
                return { success: false, error: data?.error || 'Failed to update PIN' };
            }
        } catch (err: unknown) {
            return { success: false, error: err instanceof Error ? err.message : 'Setup failed' };
        }
    }, [user?.schoolId, user?.id, checkStaffPinStatus]);

    const openStaffPinModal = useCallback(() => setIsStaffPinModalOpen(true), []);
    const closeStaffPinModal = useCallback(() => setIsStaffPinModalOpen(false), []);

    const switchDashboardRole = useCallback((nextRole: UserRole) => {
        // Allow switching to 'student' if user either holds the student role or has authorized active linked children
        const hasAuthorizedStudentView = nextRole === 'student' && (
            roles.includes('student') || 
            linkedStudents.some(s => !s.studentStatus || s.studentStatus === 'active')
        );

        if (!roles.includes(nextRole) && !hasAuthorizedStudentView) return;

        // Phase 5: Gating teacher role switch behind verified staff PIN unlock
        if (nextRole === 'teacher' && !isStaffUnlocked) {
            setIsStaffPinModalOpen(true);
            return;
        }

        setRole(nextRole);
        try {
            if (user?.id) {
                localStorage.setItem(`active_role_${user.id}`, nextRole);
            }
        } catch { /* ignore */ }
    }, [roles, user?.id, isStaffUnlocked, linkedStudents]);

    const hideToast = () => setToast({ ...toast, show: false });

    return (
        <AuthContext.Provider value={{
            user,
            role,
            roles,
            loading,
            isTransitioning,
            transition,
            setTransitioning: setIsTransitioning,
            setTransition,
            switchDashboardRole,
            login,
            signOut,
            toast,
            hideToast,
            isStaffUnlocked,
            staffSessionToken,
            staffPinStatus,
            checkStaffPinStatus,
            unlockStaffMode,
            lockStaffMode,
            setupStaffPin,
            isStaffPinModalOpen,
            openStaffPinModal,
            closeStaffPinModal,
            linkedStudents,
            activeStudentId,
            setActiveStudentId,
            refreshPersonaSummary
        }}>
            {children}
            <StaffPinModal
                isOpen={isStaffPinModalOpen}
                onClose={() => setIsStaffPinModalOpen(false)}
            />
        </AuthContext.Provider>
    );
};
