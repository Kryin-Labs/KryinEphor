import type { IncomingMessage, ServerResponse } from 'node:http';
import { createMcpProtocolHandler } from '@lovable.dev/mcp-js/protocols/mcp';
import { adminTools, makeMcp, studentTools, superadminTools, teacherTools } from '../src/lib/mcp/index.js';
import { service, verifyGrant, verifyMcpToken, type McpClaims } from '../src/lib/mcp/auth-server.js';
import { mcpPublicUrl } from '../src/lib/mcp/config.js';
import { sendWebResponse, toWebRequest } from '../src/lib/mcp/http.js';

export async function handle(webRequest: Request): Promise<Response> {
    let claims: McpClaims | undefined;
    try {
        const bearer = webRequest.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
        if (!bearer) {
            return createMcpProtocolHandler(makeMcp([]))(webRequest);
        }
        claims = verifyMcpToken(bearer);
        const { profile, grant, db } = await verifyGrant(claims);
        const { data: extra, error: roleError } = await db.from('user_roles').select('role').eq('user_id', profile.id);
        if (roleError) throw roleError;
        const roles = new Set([profile.role, ...(extra ?? []).map(item => item.role)]);
        const tools: Parameters<typeof makeMcp>[0][number][] = [];
        if (roles.has('superadmin') && !grant.school_id) tools.push(...superadminTools);
        if (roles.has('admin') && grant.school_id) tools.push(...adminTools);
        if (roles.has('teacher') && grant.school_id && grant.teacher_session_id && grant.teacher_read_until
            && new Date(grant.teacher_read_until).getTime() > Date.now()) {
            const [staff, unlock] = await Promise.all([
                db.from('employees').select('id').eq('profile_id', profile.id).eq('school_id', grant.school_id)
                    .eq('status', 'active').is('deleted_at', null).maybeSingle(),
                db.from('staff_unlock_sessions').select('id').eq('user_id', profile.id)
                    .eq('school_id', grant.school_id).eq('auth_session_id', grant.teacher_session_id)
                    .eq('is_revoked', false).gt('expires_at', new Date().toISOString()).maybeSingle(),
            ]);
            if (staff.data && unlock.data) tools.push(...teacherTools);
        }
        if (roles.has('student') && roles.has('parent') && grant.school_id) {
            const { data: school } = await db.from('schools').select('combined_parent_student_account')
                .eq('id', grant.school_id).maybeSingle();
            if (school?.combined_parent_student_account) tools.push(...studentTools);
        }
        return createMcpProtocolHandler(makeMcp(tools))(webRequest);
    } catch {
        if (claims) {
            const db = service();
            const { data: grant } = await db.from('mcp_grants').select('school_id')
                .eq('id', claims.grant_id).eq('user_id', claims.sub).eq('client_id', claims.client_id).maybeSingle();
            const { error } = await db.from('mcp_call_logs').insert({
                actor_id: claims.sub, client_id: claims.client_id, grant_id: claims.grant_id,
                school_id: grant?.school_id ?? null, tool_name: 'connection', outcome: 'denied',
                error_text: 'Connection permission check failed.',
            });
            if (error) return Response.json({ error: 'AI audit history is unavailable.' }, { status: 503 });
        }
        return Response.json({ error: 'MCP connection is invalid or unavailable.' }, { status: 401,
            headers: { 'cache-control': 'no-store',
                'www-authenticate': `Bearer error="invalid_token", resource_metadata="${mcpPublicUrl}/.well-known/oauth-protected-resource/api/mcp"` } });
    }
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
    await sendWebResponse(await handle(await toWebRequest(request)), response);
}
