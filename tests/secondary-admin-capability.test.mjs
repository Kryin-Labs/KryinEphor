import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Capability derivation helper mirroring create_tenant_admin and update_admin logic:
 * Extracts roles from profiles.role and user_roles, then resolves permissions.
 */
function resolveCallerCapabilities(callerProfile, userRoles = []) {
  if (!callerProfile) {
    return { allowed: false, error: 'Forbidden: admin access required', status: 403 };
  }
  if (callerProfile.is_active === false || callerProfile.deleted_at) {
    return { allowed: false, error: 'Forbidden: caller account is inactive or deleted', status: 403 };
  }

  const callerRoleSet = new Set();
  if (callerProfile.role) callerRoleSet.add(callerProfile.role);
  (userRoles || []).forEach(r => {
    if (r && r.role) callerRoleSet.add(r.role);
    else if (typeof r === 'string') callerRoleSet.add(r);
  });

  const isSuperAdmin = callerRoleSet.has('superadmin');
  const isAdmin = callerRoleSet.has('admin');
  const isPrivileged = isSuperAdmin || isAdmin;
  const effectiveActorRole = isSuperAdmin ? 'superadmin' : (isAdmin ? 'admin' : (callerProfile.role || 'user'));

  return {
    allowed: isPrivileged,
    isSuperAdmin,
    isAdmin,
    isPrivileged,
    effectiveActorRole,
    schoolId: callerProfile.school_id,
  };
}

/**
 * Tenant action permission evaluator mirroring create_tenant_admin and update_admin tenant boundaries.
 */
function evaluateTenantActionPermission(callerCaps, targetInfo, actionType = 'create') {
  if (!callerCaps.allowed) {
    return { allowed: false, error: 'Forbidden: admin access required', status: 403 };
  }

  // Superadmins can manage users across schools, but school-owned targets require matching school context
  if (callerCaps.isSuperAdmin) {
    return { allowed: true, effectiveRole: 'superadmin' };
  }

  // School Admins
  if (callerCaps.isAdmin) {
    if (!callerCaps.schoolId) {
      return { allowed: false, error: 'Forbidden: Admin has no school context', status: 403 };
    }
    if (targetInfo.targetRole === 'superadmin' || targetInfo.existingRole === 'superadmin') {
      return { allowed: false, error: 'Forbidden: Admin cannot manage superadmin roles', status: 403 };
    }
    if (targetInfo.targetSchoolId && targetInfo.targetSchoolId !== callerCaps.schoolId) {
      return { allowed: false, error: 'Forbidden: Admin cannot create or update users in other schools', status: 403 };
    }
    return { allowed: true, effectiveRole: 'admin' };
  }

  return { allowed: false, error: 'Forbidden: admin access required', status: 403 };
}

// ────────────────────────────────────────────────────────────────────
// TEST SUITE: Secondary Admin Capability Authorization
// ────────────────────────────────────────────────────────────────────

test('Primary Teacher + additional Admin: same-school user creation is ALLOWED', () => {
  const teacherCaller = {
    id: 'user-teacher-1',
    role: 'teacher',
    school_id: 'school-alpha',
    is_active: true,
    deleted_at: null,
  };
  const userRoles = [{ role: 'admin' }];

  const caps = resolveCallerCapabilities(teacherCaller, userRoles);
  assert.equal(caps.allowed, true);
  assert.equal(caps.isAdmin, true);
  assert.equal(caps.isSuperAdmin, false);
  assert.equal(caps.effectiveActorRole, 'admin');

  const perm = evaluateTenantActionPermission(caps, {
    targetRole: 'student',
    targetSchoolId: 'school-alpha',
  }, 'create');

  assert.equal(perm.allowed, true);
  assert.equal(perm.effectiveRole, 'admin');
});

test('Primary Teacher + additional Admin: same-school user update is ALLOWED', () => {
  const teacherCaller = {
    id: 'user-teacher-1',
    role: 'teacher',
    school_id: 'school-alpha',
    is_active: true,
    deleted_at: null,
  };
  const userRoles = ['admin'];

  const caps = resolveCallerCapabilities(teacherCaller, userRoles);
  const perm = evaluateTenantActionPermission(caps, {
    targetRole: 'teacher',
    targetSchoolId: 'school-alpha',
    existingRole: 'teacher',
  }, 'update');

  assert.equal(perm.allowed, true);
});

test('Primary Teacher + additional Admin: cross-school user creation/update is DENIED', () => {
  const teacherCaller = {
    id: 'user-teacher-1',
    role: 'teacher',
    school_id: 'school-alpha',
    is_active: true,
    deleted_at: null,
  };
  const userRoles = ['admin'];

  const caps = resolveCallerCapabilities(teacherCaller, userRoles);
  const perm = evaluateTenantActionPermission(caps, {
    targetRole: 'student',
    targetSchoolId: 'school-beta',
  }, 'create');

  assert.equal(perm.allowed, false);
  assert.match(perm.error, /other schools/i);
});

test('Primary Teacher + additional Admin: creating superadmin is DENIED', () => {
  const teacherCaller = {
    id: 'user-teacher-1',
    role: 'teacher',
    school_id: 'school-alpha',
    is_active: true,
    deleted_at: null,
  };
  const userRoles = ['admin'];

  const caps = resolveCallerCapabilities(teacherCaller, userRoles);
  const perm = evaluateTenantActionPermission(caps, {
    targetRole: 'superadmin',
    targetSchoolId: 'school-alpha',
  }, 'create');

  assert.equal(perm.allowed, false);
  assert.match(perm.error, /superadmin/i);
});

test('Primary Parent + additional Superadmin: platform authorization is ALLOWED across schools', () => {
  const parentCaller = {
    id: 'user-parent-1',
    role: 'parent',
    school_id: null,
    is_active: true,
    deleted_at: null,
  };
  const userRoles = ['superadmin'];

  const caps = resolveCallerCapabilities(parentCaller, userRoles);
  assert.equal(caps.allowed, true);
  assert.equal(caps.isSuperAdmin, true);
  assert.equal(caps.effectiveActorRole, 'superadmin');

  const perm = evaluateTenantActionPermission(caps, {
    targetRole: 'admin',
    targetSchoolId: 'school-beta',
  }, 'create');

  assert.equal(perm.allowed, true);
  assert.equal(perm.effectiveRole, 'superadmin');
});

test('Primary Teacher WITHOUT Admin role: user management is DENIED', () => {
  const plainTeacher = {
    id: 'user-teacher-2',
    role: 'teacher',
    school_id: 'school-alpha',
    is_active: true,
    deleted_at: null,
  };
  const userRoles = [];

  const caps = resolveCallerCapabilities(plainTeacher, userRoles);
  assert.equal(caps.allowed, false);
  assert.equal(caps.isAdmin, false);
  assert.equal(caps.isSuperAdmin, false);
  assert.equal(caps.effectiveActorRole, 'teacher');

  const perm = evaluateTenantActionPermission(caps, {
    targetRole: 'student',
    targetSchoolId: 'school-alpha',
  }, 'create');

  assert.equal(perm.allowed, false);
  assert.match(perm.error, /admin access required/i);
});

test('Deactivated Teacher with Admin capability: immediately DENIED', () => {
  const deactivatedAdmin = {
    id: 'user-deactivated-1',
    role: 'teacher',
    school_id: 'school-alpha',
    is_active: false,
    deleted_at: null,
  };
  const userRoles = ['admin'];

  const caps = resolveCallerCapabilities(deactivatedAdmin, userRoles);
  assert.equal(caps.allowed, false);
  assert.match(caps.error, /inactive or deleted/i);
});
