import { createClient } from '@supabase/supabase-js';
import type { ToolContext, ToolHandlerResult } from '@lovable.dev/mcp-js';
import type { Database } from '../../integrations/supabase/types.js';

type Access = 'admin' | 'teacher' | 'combined-student';

export const serverEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

export type McpActor = {
    id: string;
    name: string;
    email: string;
    role: string;
    roles: string[];
    schoolId: string;
    schoolName: string;
    combinedParentStudentEnabled: boolean;
    client: ReturnType<typeof createClient<Database>>;
};

const projectUrl = serverEnv.VITE_SUPABASE_URL;
const publishableKey = serverEnv.VITE_SUPABASE_PUBLISHABLE_KEY ?? serverEnv.VITE_SUPABASE_ANON_KEY;

export const mcpPublicUrl = (serverEnv.MCP_PUBLIC_URL ?? 'https://kryin-space.vercel.app').replace(/\/$/, '');

const textResult = (data: unknown): ToolHandlerResult => ({
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data && typeof data === 'object' ? data as Record<string, unknown> : undefined,
});

export const success = (data: unknown) => textResult(data);
export const failure = (message: string): ToolHandlerResult => ({
    content: [{ type: 'text', text: message }],
    isError: true,
});

export const failIfError = (error: { message: string } | null) => {
    if (error) throw new Error(error.message);
};

const allowedClientIds = () => new Set(
    (serverEnv.MCP_ALLOWED_CLIENT_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean),
);

export const getActor = async (ctx: ToolContext, access: Access): Promise<McpActor> => {
    const token = ctx.getToken();
    const userId = ctx.getUserId();
    const clientId = ctx.getClientId();
    const allowed = allowedClientIds();

    if (!token || !userId || !clientId) throw new Error('A verified OAuth MCP token is required.');
    if (!allowed.size) throw new Error('MCP is not configured. An administrator must add approved client IDs.');
    if (!allowed.has(clientId)) throw new Error('This AI client is not approved for Kryin Edu MCP.');
    if (!projectUrl || !publishableKey) throw new Error('MCP server configuration is incomplete.');

    const client = createClient<Database>(projectUrl, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: profile, error: profileError } = await client
        .from('profiles')
        .select('id, full_name, email, role, school_id, is_active')
        .eq('id', userId)
        .is('deleted_at', null)
        .single();
    failIfError(profileError);
    if (!profile?.is_active || !profile.school_id) throw new Error('Your school account is not active or has no school.');

    const { data: extraRoles, error: rolesError } = await client.from('user_roles').select('role').eq('user_id', userId);
    failIfError(rolesError);
    const roles = [...new Set([profile.role, ...(extraRoles ?? []).map(({ role }) => role)])];
    const schoolResponse = await fetch(`${projectUrl}/rest/v1/schools?id=eq.${encodeURIComponent(profile.school_id)}&deleted_at=is.null&select=id,name,combined_parent_student_account`, {
        headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
    });
    if (!schoolResponse.ok) throw new Error('Your school could not be verified.');
    const [school] = await schoolResponse.json() as Array<{ id: string; name: string; combined_parent_student_account: boolean }>;
    if (!school) throw new Error('Your school is unavailable.');

    if (access === 'admin' && !roles.includes('admin')) throw new Error('This tool is available only to school administrators.');
    if (access === 'teacher' && profile.role !== 'teacher') throw new Error('This tool is available only to teachers.');
    if (access === 'combined-student' && (!roles.includes('student') || !roles.includes('parent') || school.combined_parent_student_account === false)) {
        throw new Error('MCP is available only for a combined student/parent account. Ask your school for a new combined account.');
    }

    return {
        id: profile.id,
        name: profile.full_name ?? 'Unnamed user',
        email: profile.email,
        role: profile.role,
        roles,
        schoolId: profile.school_id,
        schoolName: school.name,
        combinedParentStudentEnabled: school.combined_parent_student_account !== false,
        client,
    };
};

export const tool = async (run: () => Promise<ToolHandlerResult>): Promise<ToolHandlerResult> => {
    try {
        return await run();
    } catch (error) {
        return failure(error instanceof Error ? error.message : 'The request could not be completed.');
    }
};
