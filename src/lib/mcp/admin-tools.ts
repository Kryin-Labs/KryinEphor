import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { failIfError, getActor, success, tool } from './support.js';
import { addDays } from '../timetable.js';

const limit = z.number().int().min(1).max(50).default(20);

export const adminWhoamiTool = defineTool({
    name: 'admin_whoami', title: 'My admin account',
    description: 'Show the connected administrator’s own name, email, roles, school, and the school’s locked email domain for new accounts.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (_, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data: school, error } = await actor.client.from('schools').select('email_domain').eq('id', actor.schoolId).maybeSingle();
        failIfError(error);
        return success({
            name: actor.name, email: actor.email, role: actor.role, roles: actor.roles,
            school: actor.schoolName, school_email_domain: school?.email_domain ?? null,
            combined_parent_student_accounts_enabled: actor.combinedParentStudentEnabled,
        });
    }),
});

export const adminOverviewTool = defineTool({
    name: 'admin_school_overview', title: 'School overview',
    description: 'Get the administrator’s school totals and the latest school activity.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (_, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const [users, classes, activity] = await Promise.all([
            actor.client.from('profiles').select('id', { count: 'exact', head: true }).eq('school_id', actor.schoolId).is('deleted_at', null),
            actor.client.from('classes').select('id', { count: 'exact', head: true }).eq('school_id', actor.schoolId).is('deleted_at', null),
            actor.client.from('activity_logs').select('action, resource_type, resource_id, created_at').eq('school_id', actor.schoolId).order('created_at', { ascending: false }).limit(10),
        ]);
        failIfError(users.error); failIfError(classes.error); failIfError(activity.error);
        return success({ school: actor.schoolName, total_users: users.count ?? 0, total_classes: classes.count ?? 0, recent_activity: activity.data ?? [] });
    }),
});

export const findUsersTool = defineTool({
    name: 'admin_find_users', title: 'Find school users',
    description: 'Search users in the administrator’s school by name, email, or role. Returns only basic account details.',
    inputSchema: { query: z.string().trim().max(100).optional(), role: z.string().trim().max(40).optional(), limit },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        let request = actor.client.from('profiles').select('id, full_name, email, role, is_active').eq('school_id', actor.schoolId).is('deleted_at', null).order('full_name').limit(input.limit);
        if (input.role) request = request.eq('role', input.role);
        if (input.query) request = request.or(`full_name.ilike.%${input.query}%,email.ilike.%${input.query}%`);
        const { data, error } = await request;
        failIfError(error);
        return success({ users: data ?? [] });
    }),
});

export const listClassesTool = defineTool({
    name: 'admin_list_classes', title: 'List classes', description: 'List all active classes in the administrator’s school.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (_, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data, error } = await actor.client.from('classes').select('id, name, section, teacher_id').eq('school_id', actor.schoolId).is('deleted_at', null).order('name');
        failIfError(error);
        return success({ classes: data ?? [] });
    }),
});

export const classStudentsTool = defineTool({
    name: 'admin_class_students', title: 'Class students', description: 'List active students enrolled in one class in the administrator’s school.',
    inputSchema: { class_id: z.string().uuid() }, annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data, error } = await actor.client.rpc('fn_class_attendance_roster', { p_class: input.class_id });
        failIfError(error);
        return success({ class_id: input.class_id, students: (data as { students: unknown[] }).students });
    }),
});

export const classAttendanceTool = defineTool({
    name: 'admin_class_attendance', title: 'Class attendance', description: 'Get the enrolled students and their attendance for one class and date.',
    inputSchema: { class_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }, annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data, error } = await actor.client.rpc('fn_class_attendance_roster', { p_class: input.class_id, p_date: input.date });
        failIfError(error);
        return success({ class_id: input.class_id, date: input.date, ...(data as { students: unknown[]; existing: unknown[] }) });
    }),
});

export const markAttendanceTool = defineTool({
    name: 'admin_mark_class_attendance', title: 'Mark class attendance', description: 'Save daily attendance for the complete active class roster. Read the roster first and confirm the school-local date and all marks.',
    inputSchema: { class_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), marks: z.array(z.object({ student_id: z.string().uuid(), status: z.enum(['present', 'absent', 'late', 'excused', 'half_day']), notes: z.string().max(500).nullable().optional() })).min(1).max(500) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data: schoolClass, error: classError } = await actor.client.from('classes').select('id').eq('id', input.class_id).eq('school_id', actor.schoolId).is('deleted_at', null).maybeSingle();
        failIfError(classError);
        if (!schoolClass) throw new Error('Class not found in your school.');
        const { data, error } = await actor.client.rpc('fn_mark_class_attendance', { p_class: input.class_id, p_date: input.date, p_marks: input.marks });
        failIfError(error);
        return success({ saved: data, class_id: input.class_id, date: input.date });
    }),
});

export const attendanceReportTool = defineTool({
    name: 'admin_attendance_report', title: 'Attendance report',
    description: 'Attendance summary for one class over up to 366 dates, including all five attendance statuses.',
    inputSchema: { class_id: z.string().uuid(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        if (input.to < input.from || input.to > addDays(input.from, 365)) throw new Error('Choose a range of up to 366 dates.');
        const byStudent: Record<string, { name: string; present: number; absent: number; late: number; excused: number; half_day: number }> = {};
        for (let page = 0; ; page++) {
            const { data, error } = await actor.client.from('attendance')
                .select('student_id, status, profiles:student_id(full_name)')
                .eq('class_id', input.class_id).eq('school_id', actor.schoolId)
                .gte('date', input.from).lte('date', input.to).is('deleted_at', null)
                .order('id').range(page * 1000, page * 1000 + 999);
            failIfError(error);
            for (const row of data ?? []) {
                const entry = byStudent[row.student_id] ??= { name: (row.profiles as unknown as { full_name?: string } | null)?.full_name ?? 'Unknown', present: 0, absent: 0, late: 0, excused: 0, half_day: 0 };
                if (row.status === 'present' || row.status === 'absent' || row.status === 'late' || row.status === 'excused' || row.status === 'half_day') entry[row.status] += 1;
            }
            if (!data || data.length < 1000) break;
        }
        return success({ class_id: input.class_id, from: input.from, to: input.to, students: Object.entries(byStudent).map(([student_id, stats]) => ({ student_id, ...stats })) });
    }),
});

export const feeSummaryTool = defineTool({
    name: 'admin_fee_summary', title: 'Fee summary', description: 'Show recent school invoices, optionally limited to one student.',
    inputSchema: { student_id: z.string().uuid().optional(), limit }, annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        let request = actor.client.from('invoices').select('id, invoice_number, student_id, amount, paid_amount, due_date, status, period_label').eq('school_id', actor.schoolId).is('deleted_at', null).order('due_date', { ascending: false }).limit(input.limit);
        if (input.student_id) request = request.eq('student_id', input.student_id);
        const { data, error } = await request;
        failIfError(error);
        return success({ invoices: data ?? [] });
    }),
});
