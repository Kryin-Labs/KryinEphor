import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { failIfError, getActor, success, tool } from './support.js';
import { queueMcpAction } from './timetable-tools.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schoolRole = z.enum(['admin', 'teacher', 'student', 'parent', 'accountant', 'receptionist']);

export const requestCreateUserTool = defineTool({
    name: 'admin_request_create_user', title: 'Request a school account',
    description: 'Propose a school account. Use the school email domain from admin_whoami. The administrator enters the password only in the KryinEphor approval form; never ask for it in chat.',
    inputSchema: { full_name: z.string().trim().min(1).max(120), email: z.string().email().max(254),
        role: schoolRole, class_id: uuid.optional() },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        if (input.class_id && input.role !== 'student') throw new Error('Only students can be enrolled in a class.');
        return success(await queueMcpAction(ctx, 'admin', 'admin_create_user', input));
    }),
});

export const requestPasswordResetTool = defineTool({
    name: 'admin_request_password_reset', title: 'Request a password reset',
    description: 'Propose a reset for a school account. The new password is entered only in KryinEphor. Never request a password or recovery code in chat.',
    inputSchema: { user_id: uuid },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const target = await actor.client.from('profiles').select('id').eq('id', input.user_id)
            .eq('school_id', actor.schoolId).is('deleted_at', null).single();
        failIfError(target.error);
        return success(await queueMcpAction(ctx, 'admin', 'admin_reset_password', input));
    }),
});

export const requestUserRolesTool = defineTool({
    name: 'admin_request_user_roles', title: 'Request school role changes',
    description: 'Propose the complete primary and additional school roles for an existing account. Requires exact in-app approval.',
    inputSchema: { user_id: uuid, role: schoolRole, additional_roles: z.array(schoolRole).max(6) },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const target = await actor.client.from('profiles').select('id').eq('id', input.user_id)
            .eq('school_id', actor.schoolId).is('deleted_at', null).single();
        failIfError(target.error);
        return success(await queueMcpAction(ctx, 'admin', 'admin_set_user_roles', input));
    }),
});

export const requestUserActiveTool = defineTool({
    name: 'admin_request_user_status', title: 'Request account status change',
    description: 'Queue an account activation or deactivation for review in KryinEphor.',
    inputSchema: { user_id: uuid, active: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data, error } = await actor.client.from('profiles').select('id').eq('id', input.user_id)
            .eq('school_id', actor.schoolId).is('deleted_at', null).maybeSingle();
        failIfError(error);
        if (!data) throw new Error('User not found in your school.');
        return success(await queueMcpAction(ctx, 'admin', 'admin_set_user_active', input));
    }),
});

export const requestEnrollmentTool = defineTool({
    name: 'admin_request_enrollment', title: 'Request class enrollment',
    description: 'Queue enrollment of existing school students for in-app approval.',
    inputSchema: { class_id: uuid, student_ids: z.array(uuid).min(1).max(100) },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data, error } = await actor.client.from('classes').select('id').eq('id', input.class_id)
            .eq('school_id', actor.schoolId).is('deleted_at', null).maybeSingle();
        failIfError(error);
        if (!data) throw new Error('Class not found in your school.');
        if (new Set(input.student_ids).size !== input.student_ids.length) throw new Error('Duplicate student IDs.');
        return success(await queueMcpAction(ctx, 'admin', 'admin_enroll_students', input));
    }),
});

export const requestFeePaymentTool = defineTool({
    name: 'admin_request_fee_payment', title: 'Request fee payment record',
    description: 'Queue a fee payment for exact in-app approval.',
    inputSchema: { invoice_id: uuid, amount: z.number().positive(),
        method: z.enum(['cash', 'card', 'bank_transfer', 'upi', 'cheque', 'online']),
        reference: z.string().max(80).optional(), notes: z.string().max(300).optional() },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data, error } = await actor.client.from('invoices').select('id').eq('id', input.invoice_id)
            .eq('school_id', actor.schoolId).is('deleted_at', null).maybeSingle();
        failIfError(error);
        if (!data) throw new Error('Invoice not found in your school.');
        return success(await queueMcpAction(ctx, 'admin', 'admin_record_fee_payment', input));
    }),
});

export const requestAnnouncementTool = defineTool({
    name: 'admin_request_announcement', title: 'Request announcement publication',
    description: 'Queue an announcement for exact in-app approval.',
    inputSchema: { title: z.string().trim().min(1).max(180), message: z.string().trim().min(1).max(30000),
        audience: z.enum(['everyone', 'roles', 'classes', 'users']),
        role_targets: z.array(z.enum(['admin', 'teacher', 'student', 'parent', 'accountant', 'receptionist'])).default([]),
        class_targets: z.array(uuid).max(100).default([]), user_targets: z.array(uuid).max(200).default([]) },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        await getActor(ctx, 'admin');
        return success(await queueMcpAction(ctx, 'admin', 'admin_publish_announcement', input));
    }),
});

export const teacherRequestAttendanceTool = defineTool({
    name: 'teacher_request_attendance', title: 'Request class attendance save',
    description: 'Queue full daily attendance marks for your homeroom class. Approval requires unlocked staff mode.',
    inputSchema: { class_id: uuid, date,
        marks: z.array(z.object({ student_id: uuid, status: z.enum(['present', 'absent', 'late', 'excused', 'half_day']),
            notes: z.string().max(500).optional() })).max(500) },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'teacher');
        const { data, error } = await actor.client.from('classes').select('id').eq('id', input.class_id)
            .eq('school_id', actor.schoolId).eq('teacher_id', actor.id).is('deleted_at', null).maybeSingle();
        failIfError(error);
        if (!data) throw new Error('Only your homeroom class can be marked.');
        if (new Set(input.marks.map(mark => mark.student_id)).size !== input.marks.length) throw new Error('Duplicate student IDs.');
        return success(await queueMcpAction(ctx, 'teacher', 'teacher_mark_attendance', input));
    }),
});
