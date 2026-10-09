import { defineTool, type ToolContext } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { canonicalJson, service, sha256 } from './auth-server.js';
import { failIfError, getActor, success, tool } from './support.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const draft = z.object({
    id: uuid.optional(), class_id: uuid, kind: z.enum(['weekly', 'exception']),
    target_id: uuid.optional(), base_id: uuid.optional(), start_date: date.optional(), end_date: date.optional(),
    day_of_week: z.number().int().min(0).max(6), start_time: z.string(), end_time: z.string(),
    subject_id: uuid, teacher_id: uuid.nullable(), room: z.string().max(120).optional(),
    cancelled: z.boolean().optional(),
});

export const queueMcpAction = async (ctx: ToolContext, access: 'admin' | 'teacher', action: string, payload: object) => {
    const actor = await getActor(ctx, access);
    const claimsClient = ctx.getClientId();
    if (!claimsClient) throw new Error('AI client identity is missing.');
    const { data: grant, error: grantError } = await service().from('mcp_grants').select('id,token_version')
        .eq('user_id', actor.id).eq('client_id', claimsClient).eq('school_id', actor.schoolId)
        .is('revoked_at', null).single();
    failIfError(grantError);
    if (!grant) throw new Error('AI connection was revoked.');
    const { data, error } = await service().from('mcp_action_requests').insert({
        actor_id: actor.id, client_id: claimsClient, grant_id: grant.id, school_id: actor.schoolId,
        grant_version: grant.token_version,
        action, payload, payload_hash: sha256(canonicalJson(payload)),
    }).select('id,expires_at').single();
    failIfError(error);
    if (!data) throw new Error('Approval could not be queued.');
    const notice = await service().from('notifications').insert({
        school_id: actor.schoolId, user_id: actor.id, title: 'AI action needs approval',
        message: `${action} is waiting for your review.`, type: 'info',
        action_url: '/ai-connections', metadata: { action_id: data.id },
    });
    failIfError(notice.error);
    return { approval_id: data.id, expires_at: data.expires_at,
        next_step: 'Open AI Connections in KryinEphor to review and approve this exact action.' };
};

export const adminTimetableTool = defineTool({
    name: 'admin_class_timetable', title: 'Class timetable',
    description: 'Read a published class timetable for a date range.',
    inputSchema: { class_id: uuid, from: date, to: date },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data: schoolClass, error: classError } = await actor.client.from('classes').select('id')
            .eq('id', input.class_id).eq('school_id', actor.schoolId).is('deleted_at', null).maybeSingle();
        failIfError(classError);
        if (!schoolClass) throw new Error('Class not in your school.');
        const { data, error } = await actor.client.rpc('timetable_schedule', {
            p_class: input.class_id, p_from: input.from, p_to: input.to,
        });
        failIfError(error);
        return success({ timetable: data ?? [] });
    }),
});

export const adminSaveTimetableDraftTool = defineTool({
    name: 'admin_save_timetable_draft', title: 'Save timetable draft',
    description: 'Save a draft for a class in your school. Publication requires in-app approval.',
    inputSchema: { draft },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data: schoolClass, error: classError } = await actor.client.from('classes').select('id')
            .eq('id', input.draft.class_id).eq('school_id', actor.schoolId).is('deleted_at', null).maybeSingle();
        failIfError(classError);
        if (!schoolClass) throw new Error('Class not in your school.');
        const { data, error } = await actor.client.rpc('timetable_save_draft', { p_data: input.draft });
        failIfError(error);
        return success({ draft_id: data });
    }),
});

export const previewTimetableTool = defineTool({
    name: 'admin_preview_timetable_draft', title: 'Preview timetable draft',
    description: 'Preview resulting lessons, conflicts, and affected users before publication.',
    inputSchema: { draft_id: uuid },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data, error } = await actor.client.rpc('timetable_preview_draft', { p_id: input.draft_id });
        failIfError(error);
        return success({ school_id: actor.schoolId, preview: data });
    }),
});

export const teacherPreviewTimetableTool = defineTool({
    name: 'teacher_preview_timetable_draft', title: 'Preview my timetable draft',
    description: 'Preview the resulting published dates and conflicts for your assigned draft.',
    inputSchema: { draft_id: uuid },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'teacher');
        const { data, error } = await actor.client.rpc('timetable_preview_draft', { p_id: input.draft_id });
        failIfError(error);
        return success({ school_id: actor.schoolId, preview: data });
    }),
});

export const requestPublishTimetableTool = defineTool({
    name: 'admin_request_timetable_publication', title: 'Request timetable publication',
    description: 'Queue a draft publication for exact in-app approval. Preview the draft first.',
    inputSchema: { draft_id: uuid },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'admin');
        const { data, error } = await actor.client.rpc('timetable_preview_draft', { p_id: input.draft_id });
        failIfError(error);
        if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
        const snapshot = await actor.client.from('timetable_drafts').select('*').eq('id', input.draft_id).single();
        failIfError(snapshot.error);
        return success(await queueMcpAction(ctx, 'admin', 'admin_publish_timetable', {
            ...input, draft: snapshot.data,
        }));
    }),
});

export const teacherRequestPublishTimetableTool = defineTool({
    name: 'teacher_request_timetable_publication', title: 'Request my timetable publication',
    description: 'Queue publication of your assigned draft for approval in an unlocked staff session.',
    inputSchema: { draft_id: uuid },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        const actor = await getActor(ctx, 'teacher');
        const { data, error } = await actor.client.rpc('timetable_preview_draft', { p_id: input.draft_id });
        failIfError(error);
        if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
        const snapshot = await actor.client.from('timetable_drafts').select('*').eq('id', input.draft_id).single();
        failIfError(snapshot.error);
        return success(await queueMcpAction(ctx, 'teacher', 'teacher_publish_timetable', {
            ...input, draft: snapshot.data,
        }));
    }),
});

export const teacherRequestDraftTool = defineTool({
    name: 'teacher_request_timetable_draft', title: 'Request my timetable draft',
    description: 'Queue a draft edit for approval in an unlocked staff session. The database checks your lesson assignment.',
    inputSchema: { draft },
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: (input, ctx) => tool(async () => {
        await getActor(ctx, 'teacher');
        return success(await queueMcpAction(ctx, 'teacher', 'teacher_save_timetable_draft', input));
    }),
});
