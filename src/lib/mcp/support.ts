import { createClient } from '@supabase/supabase-js';
import type { ToolContext, ToolHandlerResult } from '@lovable.dev/mcp-js';
import type { Database } from '../../integrations/supabase/types.js';
import { service, userClient, verifyGrant, verifyMcpToken } from './auth-server.js';
export { mcpPublicUrl, serverEnv } from './config.js';

type Access = 'admin' | 'teacher' | 'combined-student';
export type McpActor = {
    id: string; name: string; email: string; role: string; roles: string[];
    schoolId: string; schoolName: string; combinedParentStudentEnabled: boolean;
    client: ReturnType<typeof createClient<Database>>;
};
const result = (data: unknown): ToolHandlerResult => ({
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data && typeof data === 'object' ? data as Record<string, unknown> : undefined,
});
export const success = result;
export const failure = (message: string): ToolHandlerResult => ({ content: [{ type: 'text', text: message }], isError: true });
export const failIfError = (error: { message: string } | null) => { if (error) throw new Error(error.message); };

export const getActor = async (ctx: ToolContext, access: Access): Promise<McpActor> => {
    const token = ctx.getToken();
    if (!token) throw new Error('A verified MCP token is required.');
    const claims = verifyMcpToken(token);
    if (ctx.getUserId() !== claims.sub || ctx.getClientId() !== claims.client_id) throw new Error('MCP identity mismatch.');
    const { grant, profile, db } = await verifyGrant(claims);
    const { data: extraRoles, error: roleError } = await db.from('user_roles').select('role').eq('user_id', profile.id);
    failIfError(roleError);
    const roles = [...new Set([profile.role, ...(extraRoles ?? []).map(item => item.role)])];
    if (!profile.school_id) throw new Error('A school account is required for this tool.');
    const { data: school, error: schoolError } = await db.from('schools')
        .select('id,name,combined_parent_student_account,ai_connections_enabled,deleted_at')
        .eq('id', profile.school_id).maybeSingle();
    failIfError(schoolError);
    if (!school?.ai_connections_enabled || school.deleted_at) throw new Error('School AI connections are disabled.');
    if (access === 'admin' && !roles.includes('admin')) throw new Error('School administrator access is required.');
    if (access === 'teacher') {
        const { data: staff } = await db.from('employees').select('id').eq('profile_id', profile.id)
            .eq('school_id', school.id).eq('status', 'active').is('deleted_at', null).maybeSingle();
        if (!roles.includes('teacher') || !staff) throw new Error('Active teacher access is required.');
        if (!grant.teacher_session_id || !grant.teacher_read_until
            || new Date(grant.teacher_read_until).getTime() <= Date.now()) {
            throw new Error('Enable teacher AI access from an unlocked KryinEphor session.');
        }
        const { data: unlock } = await db.from('staff_unlock_sessions').select('id')
            .eq('user_id', profile.id).eq('school_id', school.id)
            .eq('auth_session_id', grant.teacher_session_id).eq('is_revoked', false)
            .gt('expires_at', new Date().toISOString()).maybeSingle();
        if (!unlock) throw new Error('The staff unlock was revoked or expired.');
    }
    if (access === 'combined-student' &&
        (!roles.includes('student') || !roles.includes('parent') || !school.combined_parent_student_account)) {
        throw new Error('This tool requires a combined student and parent account.');
    }
    const { data: details } = await db.from('profiles').select('full_name,email').eq('id', profile.id).single();
    return {
        id: profile.id, name: details?.full_name ?? 'Unnamed user', email: details?.email ?? '',
        role: profile.role, roles, schoolId: school.id, schoolName: school.name,
        combinedParentStudentEnabled: !!school.combined_parent_student_account,
        client: userClient(profile.id, access === 'teacher' ? grant.teacher_session_id : null) as ReturnType<typeof createClient<Database>>,
    };
};

export const tool = async (run: () => Promise<ToolHandlerResult>): Promise<ToolHandlerResult> => {
    try { return await run(); }
    catch (error) { return failure(error instanceof Error ? error.message : 'The request could not be completed.'); }
};

export const getSuperadmin = async (ctx: ToolContext, schoolId?: string) => {
    const token = ctx.getToken();
    if (!token) throw new Error('A verified MCP token is required.');
    const claims = verifyMcpToken(token);
    if (ctx.getUserId() !== claims.sub || ctx.getClientId() !== claims.client_id) throw new Error('MCP identity mismatch.');
    const { grant, profile, db } = await verifyGrant(claims);
    if (grant.school_id) throw new Error('A platform AI connection is required.');
    const { data: role, error: roleError } = await db.from('user_roles').select('role')
        .eq('user_id', profile.id).eq('role', 'superadmin').maybeSingle();
    failIfError(roleError);
    if (profile.role !== 'superadmin' && !role) throw new Error('Superadmin access is required.');
    if (schoolId) {
        const { data: school, error: schoolError } = await db.from('schools')
            .select('id,name,ai_connections_enabled,deleted_at').eq('id', schoolId).maybeSingle();
        failIfError(schoolError);
        if (!school?.ai_connections_enabled || school.deleted_at) throw new Error('AI is disabled for this school.');
    }
    return { id: profile.id, grantId: grant.id, grantVersion: grant.token_version, clientId: claims.client_id,
        client: userClient(profile.id) as ReturnType<typeof createClient<Database>>, db };
};

export const resolveStudent = async (actor: McpActor, requested?: string) => {
    const id = requested ?? actor.id;
    if (id !== actor.id) {
        const { data: link, error: linkError } = await service().from('parent_student').select('id')
            .eq('parent_id', actor.id).eq('student_id', id).eq('school_id', actor.schoolId)
            .eq('status', 'active').maybeSingle();
        failIfError(linkError);
        if (!link) throw new Error('This child is not linked to your account.');
    }
    const { data: student, error } = await service().from('profiles')
        .select('id,full_name,role,is_active,deleted_at').eq('id', id).eq('school_id', actor.schoolId).maybeSingle();
    failIfError(error);
    if (!student?.is_active || student.deleted_at) throw new Error('Student is unavailable.');
    if (student.role !== 'student') {
        const { data: extra, error: roleError } = await service().from('user_roles')
            .select('role').eq('user_id', id).eq('role', 'student').maybeSingle();
        failIfError(roleError);
        if (!extra) throw new Error('Selected account is not a student.');
    }
    return { id, name: student.full_name ?? 'Student' };
};
