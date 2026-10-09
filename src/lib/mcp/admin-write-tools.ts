import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { failIfError, getActor, success, tool } from './support.js';

export const updateUserNameTool = defineTool({
    name: 'admin_update_user_name', title: 'Change a user name',
    description: 'Change a user’s display name in the administrator’s own school.',
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

export const updateClassTool = defineTool({
    name: 'admin_update_class', title: 'Edit class details',
    description: 'Update the name, section, room, or capacity of a class in your school. Enrollment and teacher assignments use their separate guarded workflows.',
    inputSchema: { class_id: z.string().uuid(), name: z.string().trim().min(1).max(120).optional(),
        section: z.string().trim().max(40).nullable().optional(),
        room_number: z.string().trim().max(120).nullable().optional(),
        capacity: z.number().int().min(1).max(500).optional() },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { class_id, ...changes } = input;
        if (!Object.keys(changes).length) throw new Error('Provide at least one class field to change.');
        const { data, error } = await actor.client.from('classes').update(changes)
            .eq('id', class_id).eq('school_id', actor.schoolId).is('deleted_at', null)
            .select('id,name,section,room_number,capacity').single();
        failIfError(error);
        return success({ class: data });
    }),
});
