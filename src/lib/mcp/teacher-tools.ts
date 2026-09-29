import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { failIfError, getActor, success, tool } from './support.js';

export const teacherClassesTool = defineTool({
    name: 'teacher_my_classes', title: 'My classes',
    description: 'List the classes assigned to the connected teacher, with student counts. Read-only.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (_, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'teacher');
        const { data: classes, error } = await actor.client.from('classes').select('id, name, section').eq('teacher_id', actor.id).eq('school_id', actor.schoolId).is('deleted_at', null).order('name');
        failIfError(error);
        const withCounts = await Promise.all((classes ?? []).map(async (schoolClass) => {
            const { count } = await actor.client.from('class_enrollments').select('id', { count: 'exact', head: true }).eq('class_id', schoolClass.id).is('deleted_at', null);
            return { ...schoolClass, student_count: count ?? 0 };
        }));
        return success({ teacher: actor.name, classes: withCounts });
    }),
});

export const teacherClassStudentsTool = defineTool({
    name: 'teacher_class_students', title: 'My class roster',
    description: 'List students enrolled in one of the connected teacher’s own classes. Read-only.',
    inputSchema: { class_id: z.string().uuid() },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'teacher');
        const { data: owned, error: ownedError } = await actor.client.from('classes').select('id').eq('id', input.class_id).eq('teacher_id', actor.id).eq('school_id', actor.schoolId).is('deleted_at', null).maybeSingle();
        failIfError(ownedError);
        if (!owned) throw new Error('This class is not assigned to you.');
        const { data, error } = await actor.client.from('class_enrollments').select('student_id, profiles:student_id(full_name)').eq('class_id', input.class_id).is('deleted_at', null);
        failIfError(error);
        return success({ class_id: input.class_id, students: data ?? [] });
    }),
});

export const teacherScheduleTool = defineTool({
    name: 'teacher_my_schedule', title: 'My teaching schedule',
    description: 'Show the connected teacher’s own weekly timetable. Read-only.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (_, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'teacher');
        const { data, error } = await actor.client.from('timetable')
            .select('class_id, day_of_week, start_time, end_time, room, subjects(name), classes(name, section)')
            .eq('teacher_id', actor.id).eq('school_id', actor.schoolId).is('deleted_at', null).order('day_of_week').order('start_time');
        failIfError(error);
        return success({ teacher: actor.name, timetable: data ?? [] });
    }),
});

export const teacherMarkAttendanceTool = defineTool({
    name: 'teacher_mark_attendance', title: 'Mark attendance for my class',
    description: 'Save present, absent, or late attendance for one of the connected teacher’s own classes. Confirm the date and marks with the teacher before calling.',
    inputSchema: { class_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), marks: z.array(z.object({ student_id: z.string().uuid(), status: z.enum(['present', 'absent', 'late']) })).min(1).max(200) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'teacher');
        const { data: owned, error: ownedError } = await actor.client.from('classes').select('id').eq('id', input.class_id).eq('teacher_id', actor.id).eq('school_id', actor.schoolId).is('deleted_at', null).maybeSingle();
        failIfError(ownedError);
        if (!owned) throw new Error('This class is not assigned to you.');
        const { data, error } = await actor.client.rpc('fn_mark_class_attendance', { p_class: input.class_id, p_date: input.date, p_marks: input.marks });
        failIfError(error);
        return success({ saved: data, class_id: input.class_id, date: input.date });
    }),
});
