// Pure helpers for delete_user. Kept dependency-free so unit tests can
// import without a Supabase client or Deno network access.

export const PROTECTED_EMAILS = new Set([
    "admin@admin.com",
    "superadmin@edunex.com",
]);

export type ProfileLike = {
    id: string;
    role: string | null;
    school_id: string | null;
    email?: string | null;
    full_name?: string | null;
};

export type DeleteDecision =
    | { allowed: true }
    | { allowed: false; reason: string; status: 400 | 403 };

export function slugify(s: string): string {
    return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalize(s: string): string {
    return (s || "").trim().toLowerCase();
}

export function expectedConfirmText(
    schoolName: string | null,
    fullName: string | null,
): string {
    const schoolSlug = schoolName ? slugify(schoolName) : "platform";
    return `${schoolSlug}/${normalize(fullName || "")}`;
}

/**
 * Decide whether `caller` may permanently delete `target`.
 *
 * Rules:
 *  - Self-deletion is always blocked.
 *  - Protected root accounts (PROTECTED_EMAILS) are never deletable.
 *  - Superadmins may delete any non-protected, non-self user.
 *  - Admins may delete users only in their own school and never a superadmin.
 *  - Evaluates caller authority from primary role + user_roles.
 *  - Any other role is denied.
 */
export function evaluateDeletePermission(
    caller: ProfileLike,
    target: ProfileLike,
    callerRoles: string[] = caller.role ? [caller.role] : [],
): DeleteDecision {
    if (!caller?.id || !target?.id) {
        return { allowed: false, reason: "Missing caller or target.", status: 400 };
    }
    if (caller.id === target.id) {
        return { allowed: false, reason: "You cannot delete your own account.", status: 400 };
    }
    if (PROTECTED_EMAILS.has((target.email || "").toLowerCase())) {
        return { allowed: false, reason: "This account is protected and cannot be deleted.", status: 403 };
    }
    const isSuperadmin = callerRoles.includes("superadmin");
    const isAdmin = callerRoles.includes("admin");

    if (isSuperadmin) {
        return { allowed: true };
    }
    if (isAdmin) {
        if (!caller.school_id || caller.school_id !== target.school_id) {
            return {
                allowed: false,
                reason: "Forbidden: admins may only delete users in their own school.",
                status: 403,
            };
        }
        if (target.role === "superadmin") {
            return { allowed: false, reason: "Forbidden: cannot delete a superadmin.", status: 403 };
        }
        return { allowed: true };
    }
    return { allowed: false, reason: "Forbidden: admin access required.", status: 403 };
}

export type DisposabilityDecision =
    | { disposable: true }
    | { disposable: false; reason: string };

/**
 * Prove that an account is genuinely disposable before hard delete.
 * Reject hard delete if the account has any other persona/capability or identity that must survive.
 */
export function evaluateAccountDisposability(
    targetRoles: string[],
    hasEmployeesRecord: boolean,
    hasFamilyRelationships: boolean,
): DisposabilityDecision {
    const otherRoles = targetRoles.filter(r => r !== 'student');
    if (otherRoles.length > 0) {
        return {
            disposable: false,
            reason: `Account has other active roles (${otherRoles.join(', ')}). Hard deletion denied to protect multi-persona account. Recommend archive, unlinking, or manual duplicate remediation.`,
        };
    }
    if (hasEmployeesRecord) {
        return {
            disposable: false,
            reason: "Account has an associated staff/employee identity. Hard deletion denied to protect staff records. Recommend archive, unlinking, or manual duplicate remediation.",
        };
    }
    if (hasFamilyRelationships) {
        return {
            disposable: false,
            reason: "Account has family/guardian relationships (active or historical). Hard deletion denied to protect family history. Recommend archive, unlinking, or manual duplicate remediation.",
        };
    }
    return { disposable: true };
}
