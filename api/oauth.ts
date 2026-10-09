import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { sendWebResponse, toWebRequest } from '../src/lib/mcp/http.js';
import { mcpPublicUrl } from '../src/lib/mcp/config.js';
import { issueMcpToken, mcpJwks, randomToken, resource, service, sha256, verifyGrant, verifyMcpToken } from '../src/lib/mcp/auth-server.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store',
        'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type' },
});
const oauthError = (error: string, status = 400) => json({ error }, status);
const addQuery = (uri: string, values: Record<string, string>) => {
    const url = new URL(uri);
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
    return url.toString();
};
const redirect = (uri: string) => new Response(null, { status: 302, headers: { location: uri, 'cache-control': 'no-store' } });
export const safeRedirect = (value: string) => {
    try {
        const url = new URL(value);
        if (url.username || url.password || url.hash) return false;
        if (url.protocol === 'https:') return true;
        return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    } catch { return false; }
};
const authUser = async (request: Request) => {
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) throw new Error('Sign in to KryinEphor first.');
    const { data, error } = await service().auth.getUser(token);
    if (error || !data.user) throw new Error('Your KryinEphor session expired.');
    return data.user.id;
};
const eligibility = async (userId: string) => {
    const db = service();
    const { data: profile } = await db.from('profiles').select('id,role,school_id,is_active,deleted_at,full_name,email')
        .eq('id', userId).maybeSingle();
    if (!profile?.is_active || profile.deleted_at) throw new Error('Account is inactive.');
    const { data: extra } = await db.from('user_roles').select('role').eq('user_id', userId);
    const roles = new Set([profile.role, ...(extra ?? []).map(item => item.role)]);
    if (roles.has('superadmin')) return { profile, roles, schoolId: null };
    if (!profile.school_id) throw new Error('Account has no school.');
    const { data: school } = await db.from('schools').select('ai_connections_enabled,combined_parent_student_account,deleted_at')
        .eq('id', profile.school_id).maybeSingle();
    if (!school?.ai_connections_enabled || school.deleted_at) throw new Error('Your school has not enabled AI connections.');
    if (roles.has('admin')) return { profile, roles, schoolId: profile.school_id };
    if (roles.has('teacher')) {
        const { data: staff } = await db.from('employees').select('id').eq('profile_id', userId)
            .eq('school_id', profile.school_id).eq('status', 'active').is('deleted_at', null).maybeSingle();
        if (staff) return { profile, roles, schoolId: profile.school_id };
    }
    if (roles.has('student') && roles.has('parent') && school.combined_parent_student_account) {
        return { profile, roles, schoolId: profile.school_id };
    }
    throw new Error('This account does not have an eligible AI role.');
};
const details = async (request: Request) => {
    const userId = await authUser(request);
    const account = await eligibility(userId);
    const id = new URL(request.url).searchParams.get('request_id');
    const { data: authRequest } = await service().from('mcp_auth_requests').select('*')
        .eq('id', id).eq('status', 'pending').gt('expires_at', new Date().toISOString()).maybeSingle();
    if (!authRequest) return oauthError('Authorization request expired.', 404);
    const { data: client } = await service().from('mcp_clients').select('id,name').eq('id', authRequest.client_id).single();
    return json({ request_id: id, client: client?.name, scope: authRequest.scope,
        email: account.profile.email, school_id: account.schoolId, redirect_uri: authRequest.redirect_uri });
};
const consent = async (request: Request) => {
    const userId = await authUser(request);
    const account = await eligibility(userId);
    const body = await request.json() as { request_id?: string; approve?: boolean };
    if (typeof body.approve !== 'boolean' || typeof body.request_id !== 'string') return oauthError('invalid_request');
    const db = service();
    const { data: item } = await db.from('mcp_auth_requests').select('*')
        .eq('id', body.request_id).eq('status', 'pending').gt('expires_at', new Date().toISOString()).maybeSingle();
    if (!item) return oauthError('Authorization request expired.', 404);
    if (!body.approve) {
        await db.from('mcp_auth_requests').update({ status: 'denied', user_id: userId }).eq('id', item.id).eq('status', 'pending');
        return json({ redirect_url: addQuery(item.redirect_uri, { error: 'access_denied', state: item.state ?? '' }) });
    }
    const code = randomToken();
    const { data: updated } = await db.from('mcp_auth_requests').update({
        status: 'approved', user_id: userId, code_hash: sha256(code),
    }).eq('id', item.id).eq('status', 'pending').select('id').maybeSingle();
    if (!updated) return oauthError('Authorization request was already used.');
    const grantVersion = randomUUID();
    const { data: grant, error: grantError } = await db.from('mcp_grants').upsert({
        user_id: userId, client_id: item.client_id, school_id: account.schoolId,
        revoked_at: null, refresh_hash: null, token_version: grantVersion,
        refresh_expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
        teacher_session_id: null, teacher_read_until: null,
    }, { onConflict: 'user_id,client_id' }).select('id').single();
    if (grantError || !grant) throw grantError ?? new Error('Could not save AI connection.');
    const { error: requestError } = await db.from('mcp_auth_requests').update({ grant_version: grantVersion })
        .eq('id', item.id).eq('user_id', userId).eq('status', 'approved');
    if (requestError) throw requestError;
    const { error: auditError } = await db.from('activity_logs').insert({ school_id: account.schoolId, user_id: userId,
        action: 'mcp_connection_approved', resource_type: 'mcp_client', resource_id: item.client_id,
        metadata: { grant_id: grant.id } });
    if (auditError) throw auditError;
    return json({ redirect_url: addQuery(item.redirect_uri, { code, state: item.state ?? '' }) });
};
const form = async (request: Request) => new URLSearchParams(await request.text());
const token = async (request: Request) => {
    const input = await form(request);
    if (input.get('resource') && input.get('resource') !== resource) return oauthError('invalid_target');
    const db = service();
    const clientId = input.get('client_id');
    if (!clientId) return oauthError('invalid_client');
    if (input.get('grant_type') === 'authorization_code') {
        const code = input.get('code');
        const verifier = input.get('code_verifier');
        const uri = input.get('redirect_uri');
        if (!code || !verifier || !uri || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return oauthError('invalid_grant');
        const { data: item } = await db.from('mcp_auth_requests').select('*')
            .eq('code_hash', sha256(code)).eq('client_id', clientId).eq('redirect_uri', uri)
            .eq('status', 'approved').gt('expires_at', new Date().toISOString()).maybeSingle();
        if (!item || sha256(verifier) !== item.code_challenge) return oauthError('invalid_grant');
        const { data: used } = await db.from('mcp_auth_requests').update({ status: 'used', code_hash: null })
            .eq('id', item.id).eq('status', 'approved').select('id').maybeSingle();
        if (!used) return oauthError('invalid_grant');
        const { data: grant } = await db.from('mcp_grants').select('*').eq('user_id', item.user_id)
            .eq('client_id', clientId).is('revoked_at', null).maybeSingle();
        if (!grant || grant.token_version !== item.grant_version) return oauthError('invalid_grant');
        await verifyGrant({ sub: item.user_id, client_id: clientId, grant_id: grant.id,
            grant_version: grant.token_version, iss: mcpPublicUrl, aud: resource, exp: Math.floor(Date.now() / 1000) + 1 });
        const refresh = randomToken();
        const { data: refreshed } = await db.from('mcp_grants').update({ refresh_hash: sha256(refresh),
            refresh_expires_at: new Date(Date.now() + 30 * 86400_000).toISOString() })
            .eq('id', grant.id).eq('token_version', item.grant_version).is('revoked_at', null).select('id').maybeSingle();
        if (!refreshed) return oauthError('invalid_grant');
        return json({ access_token: issueMcpToken(item.user_id, clientId, grant.id, grant.token_version), token_type: 'Bearer',
            expires_in: 600, refresh_token: refresh, scope: 'mcp' });
    }
    if (input.get('grant_type') === 'refresh_token') {
        const old = input.get('refresh_token');
        if (!old) return oauthError('invalid_grant');
        const { data: grant } = await db.from('mcp_grants').select('*').eq('refresh_hash', sha256(old))
            .eq('client_id', clientId).is('revoked_at', null).gt('refresh_expires_at', new Date().toISOString()).maybeSingle();
        if (!grant) return oauthError('invalid_grant');
        await verifyGrant({ sub: grant.user_id, client_id: clientId, grant_id: grant.id,
            grant_version: grant.token_version, iss: mcpPublicUrl, aud: resource, exp: Math.floor(Date.now() / 1000) + 1 });
        const refresh = randomToken();
        const { data: rotated } = await db.from('mcp_grants').update({ refresh_hash: sha256(refresh) })
            .eq('id', grant.id).eq('token_version', grant.token_version).is('revoked_at', null)
            .eq('refresh_hash', sha256(old)).select('id').maybeSingle();
        if (!rotated) return oauthError('invalid_grant');
        return json({ access_token: issueMcpToken(grant.user_id, clientId, grant.id, grant.token_version), token_type: 'Bearer',
            expires_in: 600, refresh_token: refresh, scope: 'mcp' });
    }
    return oauthError('unsupported_grant_type');
};
const register = async (request: Request) => {
    const input = await request.json() as { client_name?: string; redirect_uris?: string[]; token_endpoint_auth_method?: string };
    if (!input.client_name?.trim() || input.client_name.length > 120 || !Array.isArray(input.redirect_uris)
        || input.redirect_uris.length < 1 || input.redirect_uris.length > 5
        || !input.redirect_uris.every(uri => typeof uri === 'string' && safeRedirect(uri))
        || (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== 'none')) {
        return oauthError('invalid_client_metadata');
    }
    const { data, error } = await service().from('mcp_clients').insert({
        name: input.client_name.trim(), redirect_uris: input.redirect_uris,
    }).select('id').single();
    if (error || !data) throw error ?? new Error('Registration failed.');
    return json({ client_id: data.id, client_name: input.client_name.trim(),
        redirect_uris: input.redirect_uris, token_endpoint_auth_method: 'none' }, 201);
};
const authorize = async (request: Request) => {
    const params = new URL(request.url).searchParams;
    const clientId = params.get('client_id');
    const uri = params.get('redirect_uri');
    const challenge = params.get('code_challenge');
    const state = params.get('state');
    if (!clientId || !uri || !challenge || params.get('response_type') !== 'code'
        || params.get('code_challenge_method') !== 'S256'
        || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || (state && state.length > 1024)) {
        return oauthError('invalid_request');
    }
    if (params.get('resource') && params.get('resource') !== resource) return oauthError('invalid_target');
    if (params.get('scope') && params.get('scope') !== 'mcp') return oauthError('invalid_scope');
    const { data: client } = await service().from('mcp_clients').select('id,redirect_uris').eq('id', clientId).maybeSingle();
    if (!client || !Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(uri)) return oauthError('invalid_client');
    const { data, error } = await service().from('mcp_auth_requests').insert({
        client_id: clientId, redirect_uri: uri, state, code_challenge: challenge, scope: params.get('scope') ?? 'mcp',
    }).select('id').single();
    if (error || !data) throw error ?? new Error('Authorization could not start.');
    return redirect(`${mcpPublicUrl}/oauth/consent?request_id=${encodeURIComponent(data.id)}`);
};
const revoke = async (request: Request) => {
    const input = await form(request);
    const value = input.get('token');
    if (!value) return json({});
    const db = service();
    let query = db.from('mcp_grants').update({ revoked_at: new Date().toISOString(), refresh_hash: null,
        teacher_session_id: null, teacher_read_until: null });
    try { query = query.eq('id', verifyMcpToken(value).grant_id); }
    catch { query = query.eq('refresh_hash', sha256(value)); }
    const { error } = await query.eq('client_id', input.get('client_id') ?? '').is('revoked_at', null);
    if (error) throw error;
    return json({});
};
export const handle = async (request: Request) => {
    if (request.method === 'OPTIONS') return json({});
    const op = new URL(request.url).searchParams.get('op');
    if (op === 'metadata') return json({ issuer: mcpPublicUrl,
        authorization_endpoint: `${mcpPublicUrl}/api/oauth/authorize`,
        token_endpoint: `${mcpPublicUrl}/api/oauth/token`,
        registration_endpoint: `${mcpPublicUrl}/api/oauth/register`,
        revocation_endpoint: `${mcpPublicUrl}/api/oauth/revoke`,
        jwks_uri: `${mcpPublicUrl}/api/oauth/jwks`,
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['mcp'] });
    if (op === 'jwks') return json(mcpJwks());
    if (op === 'register' && request.method === 'POST') return register(request);
    if (op === 'authorize' && request.method === 'GET') return authorize(request);
    if (op === 'token' && request.method === 'POST') return token(request);
    if (op === 'revoke' && request.method === 'POST') return revoke(request);
    if (op === 'details' && request.method === 'GET') return details(request);
    if (op === 'consent' && request.method === 'POST') return consent(request);
    return oauthError('not_found', 404);
};
export default async function handler(request: IncomingMessage, response: ServerResponse) {
    try { await sendWebResponse(await handle(await toWebRequest(request)), response); }
    catch (error) { await sendWebResponse(oauthError(error instanceof Error ? error.message : 'Authorization failed.', 400), response); }
}
