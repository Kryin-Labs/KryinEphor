import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { failIfError, getActor, success, tool } from './support.js';

export const updateUserNameTool = defineTool({
    name: 'admin_update_user_name', title: 'Change a user name',
    description: 'Change a user’s display name in the administrator’s own school. Confirm the new name with the administrator before calling.',
    inputSchema: { user_id: z.string().uuid(), full_name: z.string().trim().min(1).max(120) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data: target, error: targetError } = await actor.client.from('profiles')
            .select('id').eq('id', input.user_id).eq('school_id', actor.schoolId).is('deleted_at', null).maybeSingle();
        failIfError(targetError);
        if (!target) throw new Error('User not found in your school.');
        const { data, error } = await actor.client.functions.invoke('update_admin', {
            body: { adminId: input.user_id, fullName: input.full_name },
        });
        if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'Name update failed.');
        return success({ user_id: input.user_id, full_name: input.full_name, updated: true });
    }),
});

export const setUserActiveTool = defineTool({
    name: 'admin_set_user_active', title: 'Deactivate or reactivate a user',
    description: 'Deactivate or reactivate a user account in the administrator’s own school. Confirm with the administrator before calling.',
    inputSchema: { user_id: z.string().uuid(), active: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { error } = await actor.client.rpc('fn_admin_set_account_active', {
            _school_id: actor.schoolId,
            _target_user_id: input.user_id,
            _is_active: input.active,
            _reason: input.active ? 'Reactivated by admin tool' : 'Deactivated by admin tool',
        });
        failIfError(error);
        return success({ user_id: input.user_id, active: input.active, updated: true });
    }),
});

export const resetUserPasswordTool = defineTool({
    name: 'admin_reset_user_password', title: 'Reset a user password',
    description: 'Set a new login password for a user in the administrator’s own school. Confirm the user and new password with the administrator before calling.',
    inputSchema: { user_id: z.string().uuid(), new_password: z.string().min(6).max(128) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data, error } = await actor.client.functions.invoke('update_admin', {
            body: { adminId: input.user_id, password: input.new_password },
        });
        if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'Password reset failed.');
        return success({ user_id: input.user_id, password_reset: true });
    }),
});

export const enrollStudentsTool = defineTool({
    name: 'admin_enroll_students', title: 'Enroll students in a class',
    description: 'Enroll one or more existing students into a class in the administrator’s school. Confirm the class and students before calling.',
    inputSchema: { class_id: z.string().uuid(), student_ids: z.array(z.string().uuid()).min(1).max(100) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data, error } = await actor.client.rpc('fn_bulk_enroll_students', { p_class: input.class_id, p_student_ids: input.student_ids });
        failIfError(error);
        return success({ class_id: input.class_id, enrolled: data ?? 0 });
    }),
});

export const recordFeePaymentTool = defineTool({
    name: 'admin_record_fee_payment', title: 'Record a fee payment',
    description: 'Record a payment against an invoice in the administrator’s school. Confirm the invoice, amount, and payment method with the administrator before calling.',
    inputSchema: {
        invoice_id: z.string().uuid(), amount: z.number().positive(),
        method: z.enum(['cash', 'card', 'bank_transfer', 'upi', 'cheque', 'online']),
        reference: z.string().trim().max(80).optional(), notes: z.string().trim().max(300).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data, error } = await actor.client.rpc('fn_record_fee_payment', {
            p_invoice: input.invoice_id, p_amount: input.amount, p_method: input.method,
            // fn_record_fee_payment COALESCEs null p_reference into a generated receipt number;
            // the generated types wrongly require string, so keep runtime null via cast.
            p_reference: (input.reference ?? null) as unknown as string, p_notes: (input.notes ?? null) as unknown as string,
        });
        failIfError(error);
        return success({ invoice_id: input.invoice_id, amount: input.amount, transaction_id: data });
    }),
});

export const createAnnouncementTool = defineTool({
    name: 'admin_create_announcement', title: 'Publish school announcement',
    description: 'Publish to the announcement board and notify the selected school recipients. Confirm the message and audience with the administrator before calling.',
    inputSchema: {
        title: z.string().trim().min(1).max(180), message: z.string().trim().min(1).max(30000),
        audience: z.enum(['everyone', 'roles', 'classes', 'users']).default('everyone'),
        role_targets: z.array(z.enum(['admin', 'teacher', 'student', 'parent', 'accountant', 'receptionist'])).default([]),
        class_targets: z.array(z.string().uuid()).default([]), user_targets: z.array(z.string().uuid()).default([]),
        expires_at: z.string().datetime({ offset: true }).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data, error } = await actor.client.from('announcements').insert({
            school_id: actor.schoolId, created_by: actor.id, title: input.title, body: input.message,
            audience: input.audience, role_targets: input.audience === 'roles' ? input.role_targets : [],
            class_targets: input.audience === 'classes' ? input.class_targets : [],
            user_targets: input.audience === 'users' ? input.user_targets : [],
            expires_at: input.expires_at ?? null, status: 'published',
        }).select('id').single();
        failIfError(error);
        let backgroundPush = false;
        if (data?.id) {
            try {
                for (let attempt = 0; attempt < 10; attempt++) {
                    const delivery = await actor.client.functions.invoke('announcement_push', {
                        body: { action: 'deliver', announcementId: data.id },
                    });
                    if (delivery.error || delivery.data?.error) break;
                    if (!delivery.data?.remaining) { backgroundPush = true; break; }
                }
            } catch { /* The announcement and in-app notifications were saved. */ }
        }
        return success({ published: true, announcement_id: data?.id, title: input.title, audience: input.audience, background_push: backgroundPush });
    }),
});

const schoolRole = z.enum(['admin', 'teacher', 'student', 'parent', 'accountant', 'receptionist']);

export const createUserTool = defineTool({
    name: 'admin_create_user', title: 'Create a school user',
    description: 'Create a new user in the administrator’s school. Before calling, ask the administrator for every detail the school user form collects: (1) full name, (2) the email username — the login email is username + the school’s locked @domain, call admin_whoami first and show the domain to the administrator, (3) a password of at least 6 characters, (4) the role, (5) for students: optionally which class to enroll in (admin_list_classes), (6) optionally any additional roles the account should also hold, and (7) optionally a recovery email (must differ from the login email; a 6-digit verification code is emailed to it — verify with admin_verify_recovery_email). Creating a student automatically creates a combined student/parent account when the school has that enabled. Confirm all details with the administrator before calling.',
    inputSchema: {
        full_name: z.string().trim().min(1).max(120), email: z.string().email().max(254), password: z.string().min(6).max(128),
        role: schoolRole,
        class_id: z.string().uuid().optional().describe('Optional class to enroll a student in. Only valid when role is student.'),
        additional_roles: z.array(schoolRole).max(5).optional().describe('Optional extra roles the account also holds, besides the primary role.'),
        recovery_email: z.string().email().max(254).optional().describe('Optional recovery email. A 6-digit verification code is sent to it; verify afterwards with admin_verify_recovery_email.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        if (input.class_id && input.role !== 'student') throw new Error('Only student accounts can be assigned to a class.');
        if (input.recovery_email && input.recovery_email.toLowerCase() === input.email.toLowerCase()) throw new Error('The recovery email must differ from the login email.');
        if (input.class_id) {
            const { data: schoolClass, error: classError } = await actor.client.from('classes')
                .select('id').eq('id', input.class_id).eq('school_id', actor.schoolId).is('deleted_at', null).maybeSingle();
            failIfError(classError);
            if (!schoolClass) throw new Error('Class not found in your school.');
        }
        const { data, error } = await actor.client.functions.invoke('create_tenant_admin', {
            body: { email: input.email.toLowerCase(), password: input.password, fullName: input.full_name, role: input.role, schoolId: actor.schoolId, classId: input.class_id },
        });
        if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'User account creation failed.');
        const userId: string | undefined = data?.user?.id ?? data?.userId ?? data?.id;

        let additionalRolesApplied = false;
        if (input.additional_roles?.length && userId) {
            const { data: rolesData, error: rolesError } = await actor.client.functions.invoke('update_admin', {
                body: { adminId: userId, role: input.role, additionalRoles: input.additional_roles },
            });
            additionalRolesApplied = !rolesError && !rolesData?.error;
        }
        let recoveryOtpSent = false;
        if (input.recovery_email && userId) {
            const { data: recData, error: recError } = await actor.client.functions.invoke('admin_set_recovery_email', {
                body: { targetUserId: userId, recoveryEmail: input.recovery_email.toLowerCase() },
            });
            recoveryOtpSent = !recError && !recData?.error;
        }
        return success({
            created: true, user_id: userId ?? null, user: data?.user ?? data, role: input.role, class_id: input.class_id ?? null,
            combined_account: input.role === 'student' && actor.combinedParentStudentEnabled,
            additional_roles_applied: input.additional_roles?.length ? additionalRolesApplied : undefined,
            recovery_email_code_sent: input.recovery_email ? recoveryOtpSent : undefined,
            next_step: input.recovery_email && recoveryOtpSent ? 'A 6-digit code was emailed to the recovery address. Ask the administrator for it and call admin_verify_recovery_email.' : undefined,
        });
    }),
});

export const verifyRecoveryEmailTool = defineTool({
    name: 'admin_verify_recovery_email', title: 'Verify a recovery email code',
    description: 'Confirm a user’s recovery email with the 6-digit code that was emailed to it. Ask the administrator for the code first. Codes expire after 10 minutes.',
    inputSchema: { user_id: z.string().uuid(), code: z.string().regex(/^\d{6}$/) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data, error } = await actor.client.functions.invoke('admin_set_recovery_email', {
            body: { targetUserId: input.user_id, code: input.code },
        });
        if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'Verification failed.');
        return success({ user_id: input.user_id, recovery_email_verified: true });
    }),
});

export const setUserRolesTool = defineTool({
    name: 'admin_set_user_roles', title: 'Change a user’s roles',
    description: 'Change an existing user’s primary role and/or the additional roles the account also holds, within the administrator’s own school. Pass the complete desired set of additional roles — roles not listed are removed. Confirm with the administrator before calling.',
    inputSchema: {
        user_id: z.string().uuid(),
        role: schoolRole.describe('The primary role for the account.'),
        additional_roles: z.array(schoolRole).max(5).default([]).describe('Complete set of extra roles; an empty list removes all additional roles.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data, error } = await actor.client.functions.invoke('update_admin', {
            body: { adminId: input.user_id, role: input.role, additionalRoles: input.additional_roles },
        });
        if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'Role update failed.');
        return success({ user_id: input.user_id, role: input.role, additional_roles: input.additional_roles, updated: true });
    }),
});
