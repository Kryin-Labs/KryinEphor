// Unit tests for delete_user permission rules.
//
// Run with:
//   deno test supabase/functions/delete_user/permissions.test.ts
//
// These tests cover the security invariants the user requires:
//   - Only superadmins, or admins for their own school, may delete.
//   - Root/protected accounts are never deletable.
//   - Self-deletion is always blocked.
//   - Admins cannot delete superadmins, cross-school users, or unscoped users.

import {
    assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
    evaluateDeletePermission,
    expectedConfirmText,
    PROTECTED_EMAILS,
    type ProfileLike,
} from "./permissions.ts";

const superadmin = (over: Partial<ProfileLike> = {}): ProfileLike => ({
    id: "u-super", role: "superadmin", school_id: null, email: "sa@x.com", ...over,
});
const admin = (over: Partial<ProfileLike> = {}): ProfileLike => ({
    id: "u-admin", role: "admin", school_id: "school-A", email: "a@x.com", ...over,
});
const teacher = (over: Partial<ProfileLike> = {}): ProfileLike => ({
    id: "u-teacher", role: "teacher", school_id: "school-A", email: "t@x.com", ...over,
});
const student = (over: Partial<ProfileLike> = {}): ProfileLike => ({
    id: "u-student", role: "student", school_id: "school-A", email: "s@x.com", ...over,
});

Deno.test("self-deletion is always blocked (even for superadmin)", () => {
    const me = superadmin({ id: "u-1" });
    const d = evaluateDeletePermission(me, { ...me });
    assertEquals(d.allowed, false);
    if (!d.allowed) assertEquals(d.status, 400);
});

Deno.test("protected root accounts cannot be deleted by superadmin", () => {
    for (const protectedEmail of PROTECTED_EMAILS) {
        const d = evaluateDeletePermission(
            superadmin({ id: "u-1" }),
            { id: "u-2", role: "superadmin", school_id: null, email: protectedEmail },
        );
        assertEquals(d.allowed, false, `should block ${protectedEmail}`);
        if (!d.allowed) assertEquals(d.status, 403);
    }
});

Deno.test("superadmin can delete any non-protected, non-self user", () => {
    assertEquals(evaluateDeletePermission(superadmin(), teacher()).allowed, true);
    assertEquals(evaluateDeletePermission(superadmin(), student()).allowed, true);
    assertEquals(
        evaluateDeletePermission(superadmin({ id: "u-1" }), superadmin({ id: "u-2", email: "other-sa@x.com" })).allowed,
        true,
    );
});

Deno.test("admin can delete users only in their own school", () => {
    // Same school: allowed
    assertEquals(evaluateDeletePermission(admin(), teacher({ school_id: "school-A" })).allowed, true);

    // Cross-school: blocked
    const cross = evaluateDeletePermission(admin(), teacher({ school_id: "school-B" }));
    assertEquals(cross.allowed, false);
    if (!cross.allowed) assertEquals(cross.status, 403);

    // Target without school: blocked
    const unscoped = evaluateDeletePermission(admin(), teacher({ school_id: null }));
    assertEquals(unscoped.allowed, false);
});

Deno.test("admin without school assignment cannot delete anyone", () => {
    const d = evaluateDeletePermission(admin({ school_id: null }), teacher());
    assertEquals(d.allowed, false);
    if (!d.allowed) assertEquals(d.status, 403);
});

Deno.test("admin cannot delete a superadmin", () => {
    const d = evaluateDeletePermission(admin(), superadmin({ school_id: "school-A", id: "u-other-sa" }));
    assertEquals(d.allowed, false);
    if (!d.allowed) assertEquals(d.status, 403);
});

Deno.test("non-admin roles cannot delete anyone", () => {
    for (const role of ["teacher", "student", "parent", "receptionist", "accountant", null]) {
        const caller: ProfileLike = { id: "u-caller", role: role as string | null, school_id: "school-A", email: "c@x.com" };
        const d = evaluateDeletePermission(caller, student({ id: "u-target" }));
        assertEquals(d.allowed, false, `role=${role} should be denied`);
    }
});

Deno.test("expectedConfirmText shape: <schoolSlug>/<fullName lowercased>", () => {
    assertEquals(expectedConfirmText("NDMF Public School", "John Doe"), "ndmfpublicschool/john doe");
    assertEquals(expectedConfirmText(null, "Jane"), "platform/jane");
    assertEquals(expectedConfirmText("", "Jane"), "platform/jane");
    assertEquals(expectedConfirmText("St. Mary's", "  Anna  "), "stmarys/anna");
});

Deno.test("caller with additional admin role in user_roles can delete users in their school", () => {
    const caller: ProfileLike = { id: "u-teacher-admin", role: "teacher", school_id: "school-A", email: "ta@x.com" };
    const d = evaluateDeletePermission(caller, student({ school_id: "school-A" }), ["teacher", "admin"]);
    assertEquals(d.allowed, true);
});

Deno.test("caller with additional superadmin role in user_roles can delete cross-school user", () => {
    const caller: ProfileLike = { id: "u-teacher-sa", role: "teacher", school_id: "school-A", email: "tsa@x.com" };
    const d = evaluateDeletePermission(caller, student({ school_id: "school-B" }), ["teacher", "superadmin"]);
    assertEquals(d.allowed, true);
});

Deno.test("evaluateAccountDisposability: blocks hard delete if target has other roles", () => {
    const d1 = evaluateAccountDisposability(["student", "teacher"], false, false);
    assertEquals(d1.disposable, false);

    const d2 = evaluateAccountDisposability(["student", "parent"], false, false);
    assertEquals(d2.disposable, false);
});

Deno.test("evaluateAccountDisposability: blocks hard delete if target has employees record", () => {
    const d = evaluateAccountDisposability(["student"], true, false);
    assertEquals(d.disposable, false);
});

Deno.test("evaluateAccountDisposability: blocks hard delete if target has family relationships", () => {
    const d = evaluateAccountDisposability(["student"], false, true);
    assertEquals(d.disposable, false);
});

Deno.test("evaluateAccountDisposability: allows hard delete for clean isolated student duplicate", () => {
    const d = evaluateAccountDisposability(["student"], false, false);
    assertEquals(d.disposable, true);
});
