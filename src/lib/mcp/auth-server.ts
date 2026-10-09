import { createClient } from '@supabase/supabase-js';
import { createHash, createHmac, createPublicKey, createSign, createVerify, randomBytes } from 'node:crypto';
import { mcpPublicUrl, serverEnv } from './config.js';

const projectUrl = serverEnv.VITE_SUPABASE_URL;
const serviceKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;
const privatePem = serverEnv.MCP_SIGNING_PRIVATE_KEY?.replace(/\\n/g, '\n');
const supabaseJwtSecret = serverEnv.SUPABASE_JWT_SECRET;
const issuer = mcpPublicUrl;
export const resource = `${mcpPublicUrl}/api/mcp`;
export const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');
export const canonicalJson = (value: unknown) => JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
        : item) ?? 'null';
export const randomToken = () => randomBytes(32).toString('base64url');

export const service = () => {
    if (!projectUrl || !serviceKey) throw new Error('Supabase server credentials are missing.');
    return createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
};

const signingKey = () => {
    if (!privatePem) throw new Error('MCP_SIGNING_PRIVATE_KEY is missing.');
    return privatePem;
};
const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const parse = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;

export const mcpJwks = () => {
    const key = createPublicKey(signingKey()).export({ format: 'jwk' }) as JsonWebKey;
    return { keys: [{ ...key, kid: sha256(JSON.stringify(key)).slice(0, 16), use: 'sig', alg: 'RS256' }] };
};

export const issueMcpToken = (userId: string, clientId: string, grantId: string, grantVersion: string) => {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'at+jwt', kid: mcpJwks().keys[0].kid };
    const claims = { iss: issuer, aud: resource, sub: userId, client_id: clientId,
        grant_id: grantId, grant_version: grantVersion, scope: 'mcp', iat: now, exp: now + 600 };
    const body = `${encoded(header)}.${encoded(claims)}`;
    const signer = createSign('RSA-SHA256');
    signer.update(body);
    return `${body}.${signer.sign(signingKey(), 'base64url')}`;
};

export type McpClaims = { sub: string; client_id: string; grant_id: string; grant_version: string; iss: string; aud: string; exp: number };
export const verifyMcpToken = (token: string): McpClaims => {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid MCP token.');
    const header = parse(parts[0]);
    const claims = parse(parts[1]);
    if (header.alg !== 'RS256' || header.kid !== mcpJwks().keys[0].kid) throw new Error('Invalid MCP signing key.');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    if (!verifier.verify(createPublicKey(signingKey()), Buffer.from(parts[2], 'base64url'))) throw new Error('Invalid MCP signature.');
    if (claims.iss !== issuer || claims.aud !== resource || typeof claims.exp !== 'number'
        || claims.exp <= Date.now() / 1000 || typeof claims.sub !== 'string'
        || typeof claims.client_id !== 'string' || typeof claims.grant_id !== 'string'
        || typeof claims.grant_version !== 'string') {
        throw new Error('Expired or invalid MCP token.');
    }
    return claims as McpClaims;
};

export const issueInternalUserToken = (userId: string, sessionId?: string | null) => {
    if (!supabaseJwtSecret) throw new Error('SUPABASE_JWT_SECRET is missing.');
    const now = Math.floor(Date.now() / 1000);
    const claims = { aud: 'authenticated', role: 'authenticated', sub: userId,
        iss: `${projectUrl}/auth/v1`, iat: now, exp: now + 300,
        ...(sessionId ? { session_id: sessionId } : {}) };
    const body = `${encoded({ alg: 'HS256', typ: 'JWT' })}.${encoded(claims)}`;
    return `${body}.${createHmac('sha256', supabaseJwtSecret).update(body).digest('base64url')}`;
};

export const userClient = (userId: string, sessionId?: string | null) => {
    const key = serverEnv.VITE_SUPABASE_PUBLISHABLE_KEY ?? serverEnv.VITE_SUPABASE_ANON_KEY;
    if (!projectUrl || !key) throw new Error('Supabase public credentials are missing.');
    return createClient(projectUrl, key, { auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${issueInternalUserToken(userId, sessionId)}` } } });
};

export const verifyGrant = async (claims: McpClaims) => {
    const db = service();
    const { data: grant, error } = await db.from('mcp_grants').select('*')
        .eq('id', claims.grant_id).eq('user_id', claims.sub).eq('client_id', claims.client_id)
        .is('revoked_at', null).maybeSingle();
    if (error || !grant || grant.token_version !== claims.grant_version) throw new Error('AI connection has been revoked.');
    const { data: profile } = await db.from('profiles').select('id,school_id,role,is_active,deleted_at')
        .eq('id', claims.sub).maybeSingle();
    if (!profile?.is_active || profile.deleted_at) throw new Error('Account is inactive.');
    if (grant.school_id && profile.school_id !== grant.school_id) throw new Error('School membership changed.');
    if (grant.school_id) {
        const { data: school } = await db.from('schools').select('ai_connections_enabled,deleted_at')
            .eq('id', grant.school_id).maybeSingle();
        if (!school?.ai_connections_enabled || school.deleted_at) throw new Error('School AI connections are disabled.');
    }
    return { grant, profile, db };
};
