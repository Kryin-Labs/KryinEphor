import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { failIfError, getActor, success, tool } from './support.js';

type ResultRow = { marks_obtained: number | null; grade: string | null; exam_subjects: { max_marks: number; subjects: { name: string } | null } | null };

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional();

const subjectSnapshot = (rows: ResultRow[]) => Object.entries(rows.reduce<Record<string, { total: number; count: number }>>((all, row) => {
    const subject = row.exam_subjects?.subjects?.name;
    const max = row.exam_subjects?.max_marks;
    if (subject && max && row.marks_obtained !== null) {
        all[subject] ??= { total: 0, count: 0 };
        all[subject].total += (row.marks_obtained / max) * 100;
        all[subject].count += 1;
    }
    return all;
}, {})).map(([subject, value]) => ({ subject, percentage: Math.round(value.total / value.count) })).sort((a, b) => b.percentage - a.percentage);

export const studentFeesTool = defineTool({
    name: 'student_my_fees', title: 'My fees and payments',
    description: 'Show the connected student’s own invoices, dues, and payment history. Read-only.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (_, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'combined-student');
        const [invoices, payments] = await Promise.all([
            actor.client.from('invoices').select('id, invoice_number, amount, paid_amount, late_fee, due_date, status, period_label').eq('student_id', actor.id).eq('school_id', actor.schoolId).is('deleted_at', null).order('due_date', { ascending: false }).limit(24),
            actor.client.from('transactions').select('amount, payment_method, reference_number, status, created_at, invoice_id').eq('student_id', actor.id).eq('school_id', actor.schoolId).order('created_at', { ascending: false }).limit(24),
        ]);
        failIfError(invoices.error); failIfError(payments.error);
        const due = (invoices.data ?? []).filter(({ status }) => status !== 'paid')
            .reduce((sum, invoice) => sum + (Number(invoice.amount) + Number(invoice.late_fee ?? 0) - Number(invoice.paid_amount ?? 0)), 0);
        return success({ student: actor.name, total_due: due, invoices: invoices.data ?? [], payments: payments.data ?? [] });
    }),
});

export const studentScheduleTool = defineTool({
    name: 'student_my_schedule', title: 'My class schedule',
    description: 'Show the connected student’s own weekly timetable with subjects, teachers, times, and rooms. Shows only the student’s own schedule, never other students’ information. Read-only.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (_, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'combined-student');
        const { data: enrollment, error: enrollmentError } = await actor.client.from('class_enrollments').select('class_id, classes(name, section)').eq('student_id', actor.id).eq('school_id', actor.schoolId).is('deleted_at', null);
        failIfError(enrollmentError);
        const classIds = (enrollment ?? []).map(({ class_id }) => class_id);
        if (!classIds.length) return success({ student: actor.name, classes: [], timetable: [] });
        const { data: timetable, error } = await actor.client.from('timetable')
            .select('class_id, day_of_week, start_time, end_time, room, subjects(name), profiles:teacher_id(full_name)')
            .in('class_id', classIds).eq('school_id', actor.schoolId).is('deleted_at', null).order('day_of_week').order('start_time');
        failIfError(error);
        return success({ student: actor.name, classes: enrollment ?? [], timetable: timetable ?? [] });
    }),
});

export const studentHomeworkTool = defineTool({
    name: 'student_my_homework', title: 'My homework',
    description: 'Show homework assigned to the connected student’s own classes, with due dates. Read-only.',
    inputSchema: { include_past: z.boolean().default(false) },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'combined-student');
        const { data: enrollment, error: enrollmentError } = await actor.client.from('class_enrollments').select('class_id').eq('student_id', actor.id).eq('school_id', actor.schoolId).is('deleted_at', null);
        failIfError(enrollmentError);
        const classIds = (enrollment ?? []).map(({ class_id }) => class_id);
        if (!classIds.length) return success({ homework: [] });
        let request = actor.client.from('homework')
            .select('id, title, description, due_date, max_marks, status, subjects(name), classes(name, section)')
            .in('class_id', classIds).eq('school_id', actor.schoolId).is('deleted_at', null).order('due_date', { ascending: false }).limit(30);
        if (!input.include_past) request = request.gte('due_date', new Date().toISOString().slice(0, 10));
        const { data, error } = await request;
        failIfError(error);
        return success({ homework: data ?? [] });
    }),
});

export const studentAnnouncementsTool = defineTool({
    name: 'student_school_announcements', title: 'School announcements',
    description: 'Show current announcement board messages selected for the connected student, plus upcoming calendar events. Read-only.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (_, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'combined-student');
        const now = new Date().toISOString();
        const { data: announcements, error: announcementError } = await actor.client.from('announcements')
            .select('id,title,body,published_at,expires_at,audience')
            .eq('status', 'published').is('deleted_at', null)
            .lte('published_at', now).or(`expires_at.is.null,expires_at.gt.${now}`)
            .order('published_at', { ascending: false }).limit(20);
        // Keep the existing events tool usable until the announcement migration reaches production.
        if (announcementError?.code !== 'PGRST205') failIfError(announcementError);
        const { data: events, error } = await actor.client.from('events')
            .select('title, description, event_date, end_date, category, location, is_all_day')
            .eq('school_id', actor.schoolId).is('deleted_at', null)
            .gte('event_date', new Date().toISOString().slice(0, 10)).order('event_date').limit(20);
        failIfError(error);
        return success({ school: actor.schoolName, announcements: announcements ?? [], events: events ?? [] });
    }),
});

export const studentProfileTool = defineTool({
    name: 'student_my_profile', title: 'My profile',
    description: 'Show the connected student’s own account details: name, email, roles, school, and enrolled classes. Read-only.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (_, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'combined-student');
        const { data: enrollment, error } = await actor.client.from('class_enrollments').select('classes(name, section)').eq('student_id', actor.id).eq('school_id', actor.schoolId).is('deleted_at', null);
        failIfError(error);
        return success({ name: actor.name, email: actor.email, roles: actor.roles, school: actor.schoolName, classes: enrollment ?? [] });
    }),
});

export const studentDashboardTool = defineTool({
    name: 'student_dashboard', title: 'Student dashboard',
    description: 'Get the combined student/parent account dashboard: school activity feed, attendance, subject performance, current standing, and today’s timetable. Read-only.',
    inputSchema: { month: monthSchema, day_of_week: z.number().int().min(0).max(6).optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'combined-student');
        const today = new Date();
        const month = input.month ?? today.toISOString().slice(0, 7);
        const start = `${month}-01`;
        const end = new Date(`${start}T00:00:00Z`);
        end.setUTCMonth(end.getUTCMonth() + 1);
        const monthEnd = end.toISOString().slice(0, 10);
        const dayOfWeek = input.day_of_week ?? today.getDay();
        const [enrollment, attendance, results, feed] = await Promise.all([
            actor.client.from('class_enrollments').select('class_id, classes(id, name, section)').eq('student_id', actor.id).eq('school_id', actor.schoolId).is('deleted_at', null),
            actor.client.from('attendance').select('date, status').eq('student_id', actor.id).eq('school_id', actor.schoolId).gte('date', start).lt('date', monthEnd).is('deleted_at', null).order('date'),
            actor.client.from('exam_results').select('marks_obtained, grade, exam_subjects(max_marks, subjects(name))').eq('student_id', actor.id).eq('school_id', actor.schoolId).not('marks_obtained', 'is', null).is('deleted_at', null),
            actor.client.from('activity_logs').select('action, resource_type, created_at, metadata').eq('school_id', actor.schoolId).order('created_at', { ascending: false }).limit(10),
        ]);
        failIfError(enrollment.error); failIfError(attendance.error); failIfError(results.error); failIfError(feed.error);
        const classIds = (enrollment.data ?? []).map(({ class_id }) => class_id);
        const timetable = classIds.length
            ? await actor.client.from('timetable').select('class_id, start_time, end_time, room, subjects(name), profiles:teacher_id(full_name)').in('class_id', classIds).eq('school_id', actor.schoolId).eq('day_of_week', dayOfWeek).is('deleted_at', null).order('start_time')
            : { data: [], error: null };
        failIfError(timetable.error);
        const rows = results.data as ResultRow[] ?? [];
        const subjects = subjectSnapshot(rows);
        const average = subjects.length ? Math.round(subjects.reduce((sum, item) => sum + item.percentage, 0) / subjects.length) : null;
        const marks = attendance.data ?? [];
        const present = marks.filter(({ status }) => status === 'present').length;
        const late = marks.filter(({ status }) => status === 'late').length;
        const absent = marks.filter(({ status }) => status === 'absent').length;
        const total = present + late + absent;
        return success({
            student: { name: actor.name, school: actor.schoolName }, month, school_feed: feed.data ?? [], classes: enrollment.data ?? [],
            attendance_history: marks, attendance_stats: { present, absent, late, rate: total ? Math.round(((present + late) / total) * 100) : null },
            subject_snapshot: subjects, academic_progress: { average_percentage: average, results: rows }, current_standing: { average_percentage: average, class_rank: null },
            timetable_for_day: dayOfWeek, timetable: timetable.data ?? [],
        });
    }),
});
