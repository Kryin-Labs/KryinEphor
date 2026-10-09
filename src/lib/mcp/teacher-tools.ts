import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { failIfError, getActor, success, tool } from './support.js';
import { addDays, schoolDate } from '../timetable.js';
export const teacherClassesTool = defineTool({
    name: 'teacher_my_classes', title: 'My classes',
    description: 'List the classes assigned to the connected teacher, with student counts. Read-only.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (_, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'teacher');
        const [home, subjects] = await Promise.all([
            actor.client.from('classes').select('id, name, section, academic_year_id').eq('teacher_id', actor.id).eq('school_id', actor.schoolId).is('deleted_at', null).order('name'),
            actor.client.from('subject_teachers').select('class_id, academic_year_id').eq('teacher_id', actor.id).eq('school_id', actor.schoolId),
        ]);
        failIfError(home.error); failIfError(subjects.error);
        const assignedIds = [...new Set((subjects.data ?? []).map(item => item.class_id))];
        const additional = assignedIds.length ? await actor.client.from('classes').select('id, name, section, academic_year_id')
            .in('id', assignedIds).eq('school_id', actor.schoolId).is('deleted_at', null) : { data: [], error: null };
        failIfError(additional.error);
        const assigned = (additional.data ?? []).filter(item => subjects.data?.some(assignment =>
            assignment.class_id === item.id && (!assignment.academic_year_id || assignment.academic_year_id === item.academic_year_id)));
        const classes = [...new Map([...(home.data ?? []), ...assigned].map(item => [item.id, item])).values()];
        const withCounts = await Promise.all(classes.map(async (schoolClass) => {
            const { data, error } = await actor.client.rpc('fn_class_attendance_roster', { p_class: schoolClass.id });
            failIfError(error);
            return { ...schoolClass, student_count: (data as { students: unknown[] }).students.length };
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
        const { data, error } = await actor.client.rpc('fn_class_attendance_roster', { p_class: input.class_id });
        failIfError(error);
        return success({ class_id: input.class_id, students: (data as { students: unknown[] }).students });
    }),
});

export const teacherScheduleTool = defineTool({
    name: 'teacher_my_schedule', title: 'My teaching schedule',
    description: 'Show the connected teacher’s published lessons for the next seven calendar dates, including date exceptions. Read-only.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (_, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'teacher');
        const school = await actor.client.from('schools').select('time_zone').eq('id', actor.schoolId).single();
        failIfError(school.error);
        const from = schoolDate(school.data!.time_zone);
        const { data, error } = await actor.client.rpc('timetable_schedule', { p_from: from, p_to: addDays(from, 6) });
        failIfError(error);
        return success({ teacher: actor.name, time_zone: school.data!.time_zone,
            timetable: (data ?? []).filter(row => row.teacher_id === actor.id) });
    }),
});
