import { defineTool } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { canonicalJson, service, sha256 } from './auth-server.js';
import { failIfError, getSuperadmin, success, tool } from './support.js';

const uuid = z.string().uuid();
const query = z.string().trim().min(1).max(100);

export const superadminFindSchoolsTool = defineTool({
    name: 'superadmin_find_schools', title: 'Find schools',
    description: 'Find schools by name and see whether each school enabled AI access. Discovery only.',
    inputSchema: { query }, annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getSuperadmin(ctx);
        const { data, error } = await actor.client.from('schools').select('id,name,ai_connections_enabled')
            .ilike('name', `%${input.query}%`).is('deleted_at', null).limit(25);
        failIfError(error);
        return success({ schools: data ?? [] });
    }),
});

export const superadminFindUsersTool = defineTool({
    name: 'superadmin_find_users', title: 'Find users in one school',
    description: 'Find basic user records in one explicitly named AI-enabled school.',
    inputSchema: { school_id: uuid, query }, annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getSuperadmin(ctx, input.school_id);
        const { data, error } = await actor.client.from('profiles').select('id,full_name,email,role,is_active')
            .eq('school_id', input.school_id).ilike('full_name', `%${input.query}%`)
            .is('deleted_at', null).limit(25);
        failIfError(error);
        return success({ school_id: input.school_id, users: data ?? [] });
    }),
});

export const superadminTimetableTool = defineTool({
    name: 'superadmin_class_timetable', title: 'Published class timetable',
    description: 'Read a published class timetable from one explicitly named AI-enabled school.',
    inputSchema: { school_id: uuid, class_id: uuid,
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getSuperadmin(ctx, input.school_id);
        const { data: schoolClass, error: classError } = await actor.client.from('classes').select('id')
            .eq('id', input.class_id).eq('school_id', input.school_id).is('deleted_at', null).maybeSingle();
        failIfError(classError);
        if (!schoolClass) throw new Error('Class not found in the selected school.');
        const { data, error } = await actor.client.rpc('timetable_schedule', {
            p_class: input.class_id, p_from: input.from, p_to: input.to,
        });
        failIfError(error);
        return success({ school_id: input.school_id, timetable: data ?? [] });
    }),
});

export const superadminRequestUserStatusTool = defineTool({
    name: 'superadmin_request_user_status', title: 'Request user status change',
    description: 'Queue a user activation or deactivation for in-app approval. Name the school explicitly.',
    inputSchema: { school_id: uuid, user_id: uuid, active: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getSuperadmin(ctx, input.school_id);
        const { data: target, error: targetError } = await actor.client.from('profiles').select('id')
            .eq('id', input.user_id).eq('school_id', input.school_id).is('deleted_at', null).maybeSingle();
        failIfError(targetError);
        if (!target) throw new Error('User not found in the selected school.');
        const payload = { user_id: input.user_id, active: input.active };
        const { data, error } = await service().from('mcp_action_requests').insert({
            grant_id: actor.grantId, actor_id: actor.id, client_id: actor.clientId,
            grant_version: actor.grantVersion,
            school_id: input.school_id, action: 'admin_set_user_active', payload,
            payload_hash: sha256(canonicalJson(payload)),
        }).select('id,expires_at').single();
        failIfError(error);
        if (!data) throw new Error('Approval could not be queued.');
        const { error: noticeError } = await service().from('notifications').insert({
            school_id: input.school_id, user_id: actor.id, title: 'AI action needs approval',
            message: 'Review the selected school and user before approving.', type: 'info',
            action_url: '/ai-connections', metadata: { action_id: data.id },
        });
        failIfError(noticeError);
        return success({ approval_id: data.id, expires_at: data.expires_at,
            next_step: 'Review this action in KryinEphor AI Connections.' });
    }),
});
