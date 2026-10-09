import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generated = resolve(root, 'tests', `.mcp-protocol-${randomUUID()}.mjs`);
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.MCP_PUBLIC_URL = 'https://school.example';
process.env.MCP_SIGNING_PRIVATE_KEY = key;
process.env.SUPABASE_JWT_SECRET = 'a-test-secret-not-used-by-clients';
process.env.VITE_SUPABASE_URL = 'https://project.supabase.co';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-public-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const output = await build({
    entryPoints: [resolve(root, 'api/oauth.ts')], bundle: true, platform: 'node', format: 'esm',
    packages: 'external', write: false, logLevel: 'silent',
});
await writeFile(generated, output.outputFiles[0].text);
after(async () => { await unlink(generated); });
const { handle, safeRedirect } = await import(pathToFileURL(generated).href);

test('OAuth metadata advertises the dedicated MCP audience and PKCE', async () => {
    const response = await handle(new Request('https://school.example/api/oauth?op=metadata'));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.issuer, 'https://school.example');
    assert.equal(body.token_endpoint, 'https://school.example/api/oauth/token');
    assert.deepEqual(body.code_challenge_methods_supported, ['S256']);
    assert.deepEqual(body.token_endpoint_auth_methods_supported, ['none']);
});

test('registration redirect validation rejects dangerous schemes and credentials', () => {
    assert.equal(safeRedirect('https://client.example/callback'), true);
    assert.equal(safeRedirect('http://localhost:3412/callback'), true);
    assert.equal(safeRedirect('http://client.example/callback'), false);
    assert.equal(safeRedirect('javascript:alert(1)'), false);
    assert.equal(safeRedirect('https://user:pass@client.example/callback'), false);
    assert.equal(safeRedirect('https://client.example/callback#fragment'), false);
});

test('dedicated access token has the MCP audience, signature and expiry', async () => {
    const jwks = await handle(new Request('https://school.example/api/oauth?op=jwks'));
    const keySet = await jwks.json();
    assert.equal(keySet.keys[0].alg, 'RS256');
    assert.equal(keySet.keys[0].d, undefined);
    // The OAuth module bundles the same signing code used by /api/mcp.
    const authOutput = await build({
        entryPoints: [resolve(root, 'src/lib/mcp/auth-server.ts')], bundle: true,
        platform: 'node', format: 'esm', packages: 'external', write: false, logLevel: 'silent',
    });
    const authGenerated = resolve(root, 'tests', `.mcp-auth-${randomUUID()}.mjs`);
    await writeFile(authGenerated, authOutput.outputFiles[0].text);
    try {
        const { issueMcpToken, verifyMcpToken } = await import(pathToFileURL(authGenerated).href);
        const token = issueMcpToken('user-1', 'client-1', 'grant-1', 'version-1');
        const claims = verifyMcpToken(token);
        assert.equal(claims.aud, 'https://school.example/api/mcp');
        assert.equal(claims.client_id, 'client-1');
        assert.throws(() => verifyMcpToken(`${token.slice(0, -2)}aa`));
        const now = Date.now;
        try {
            Date.now = () => now() + 11 * 60_000;
            assert.throws(() => verifyMcpToken(token), /Expired/);
        } finally { Date.now = now; }
    } finally { await unlink(authGenerated); }
});

test('OAuth enforces exact redirects, PKCE, single-use codes and refresh rotation', async () => {
    const ids = { user: randomUUID(), client: randomUUID(), grant: randomUUID(), school: randomUUID(), version: randomUUID() };
    const digest = value => createHash('sha256').update(value).digest('base64url');
    const verifier = 'a'.repeat(43);
    const redirectUri = 'https://client.example/callback';
    const tables = {
        mcp_clients: [{ id: ids.client, redirect_uris: [redirectUri] }],
        mcp_auth_requests: [{ id: randomUUID(), client_id: ids.client, user_id: ids.user, redirect_uri: redirectUri,
            status: 'approved', code_hash: digest('test-code'), code_challenge: digest(verifier), grant_version: ids.version,
            expires_at: new Date(Date.now() + 600000).toISOString() }],
        mcp_grants: [{ id: ids.grant, user_id: ids.user, client_id: ids.client, school_id: ids.school,
            token_version: ids.version, revoked_at: null }],
        profiles: [{ id: ids.user, school_id: ids.school, role: 'admin', is_active: true, deleted_at: null }],
        schools: [{ id: ids.school, ai_connections_enabled: true, deleted_at: null }],
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        const rows = tables[url.pathname.split('/').at(-1)];
        assert.ok(rows, `Unexpected request ${url.pathname}`);
        const selected = rows.filter(row => [...url.searchParams].every(([key, filter]) => {
            if (key === 'select') return true;
            const dot = filter.indexOf('.');
            const op = filter.slice(0, dot), value = filter.slice(dot + 1);
            if (op === 'eq') return String(row[key]) === value;
            if (op === 'is') return value === 'null' && row[key] == null;
            if (op === 'gt') return row[key] > value;
            throw new Error(`Unsupported mock filter ${filter}`);
        }));
        if (request.method === 'PATCH') {
            const changes = await request.json();
            selected.forEach(row => Object.assign(row, changes));
        } else assert.equal(request.method, 'GET');
        return Response.json(request.headers.get('accept')?.includes('vnd.pgrst.object') ? selected[0] ?? null : selected);
    };
    const exchange = values => handle(new Request('https://school.example/api/oauth?op=token', {
        method: 'POST', body: new URLSearchParams({ client_id: ids.client, ...values }),
    }));
    const code = { grant_type: 'authorization_code', code: 'test-code', code_verifier: verifier, redirect_uri: redirectUri };
    try {
        const authorize = new URL('https://school.example/api/oauth?op=authorize');
        for (const [name, value] of Object.entries({ client_id: ids.client, redirect_uri: `${redirectUri}/changed`,
            response_type: 'code', code_challenge_method: 'S256', code_challenge: digest(verifier) })) authorize.searchParams.set(name, value);
        assert.equal((await handle(new Request(authorize))).status, 400);
        assert.equal((await exchange({ ...code, redirect_uri: `${redirectUri}/changed` })).status, 400);
        assert.equal((await exchange({ ...code, code_verifier: 'b'.repeat(43) })).status, 400);
        assert.equal((await exchange({ ...code, resource: 'https://other.example/api/mcp' })).status, 400);
        const accepted = await exchange(code);
        assert.equal(accepted.status, 200);
        const first = await accepted.json();
        assert.equal(first.expires_in, 600);
        assert.equal(JSON.parse(Buffer.from(first.access_token.split('.')[1], 'base64url')).aud, 'https://school.example/api/mcp');
        assert.equal((await exchange(code)).status, 400, 'authorization code cannot be replayed');
        const refreshed = await exchange({ grant_type: 'refresh_token', refresh_token: first.refresh_token });
        assert.equal(refreshed.status, 200);
        const second = await refreshed.json();
        assert.notEqual(second.refresh_token, first.refresh_token);
        assert.equal((await exchange({ grant_type: 'refresh_token', refresh_token: first.refresh_token })).status, 400);
        tables.mcp_grants[0].revoked_at = new Date().toISOString();
        assert.equal((await exchange({ grant_type: 'refresh_token', refresh_token: second.refresh_token })).status, 400);
    } finally { globalThis.fetch = originalFetch; }
});

test('MCP protocol lists only current capabilities and blocks revoked or moved connections', async () => {
    const compiled = await build({
        stdin: { contents: "export { handle } from '../api/mcp.ts'; export { issueMcpToken, mcpJwks } from '../src/lib/mcp/auth-server.ts';",
            resolveDir: resolve(root, 'tests'), loader: 'ts' },
        bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false, logLevel: 'silent',
    });
    const path = resolve(root, 'tests', `.mcp-transport-${randomUUID()}.mjs`);
    await writeFile(path, compiled.outputFiles[0].text);
    const { handle: mcp, issueMcpToken, mcpJwks } = await import(pathToFileURL(path).href);
    const ids = { user: randomUUID(), client: randomUUID(), grant: randomUUID(), school: randomUUID(), session: randomUUID(), version: randomUUID() };
    let grantVersion = ids.version;
    let roles = ['admin'];
    let schoolEnabled = true;
    let revoked = false;
    let teacherUnlocked = false;
    let profileSchool = ids.school;
    let platform = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        if (url.pathname === '/api/oauth/jwks') return Response.json(mcpJwks());
        const table = url.pathname.split('/').at(-1);
        const rows = {
            mcp_grants: revoked ? [] : [{ id: ids.grant, user_id: ids.user, client_id: ids.client, token_version: grantVersion,
                school_id: platform ? null : ids.school, teacher_session_id: teacherUnlocked ? ids.session : null,
                teacher_read_until: teacherUnlocked ? new Date(Date.now() + 3600000).toISOString() : null }],
            profiles: [{ id: ids.user, school_id: profileSchool, role: roles[0], is_active: true, deleted_at: null }],
            user_roles: roles.slice(1).map(role => ({ role })),
            schools: [{ id: ids.school, ai_connections_enabled: schoolEnabled, combined_parent_student_account: true, deleted_at: null }],
            employees: teacherUnlocked ? [{ id: randomUUID() }] : [],
            staff_unlock_sessions: teacherUnlocked ? [{ id: ids.session }] : [],
            mcp_call_logs: [],
        }[table];
        if (!rows) throw new Error(`Unexpected network request: ${url.pathname}`);
        return Response.json(request.headers.get('accept')?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows);
    };
    const token = issueMcpToken(ids.user, ids.client, ids.grant, ids.version);
    const call = (method, withToken = true) => mcp(new Request('https://school.example/api/mcp', {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
            ...(withToken ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: method === 'initialize'
            ? { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } : {} }),
    }));
    const payload = async response => {
        assert.equal(response.status, 200, await response.clone().text());
        const body = await response.text();
        return JSON.parse(body.startsWith('event:') ? body.split('\n').find(line => line.startsWith('data:')).slice(5) : body);
    };
    try {
        const unauthenticated = await call('tools/list', false);
        assert.equal(unauthenticated.status, 401);
        assert.match(unauthenticated.headers.get('www-authenticate'), /oauth-protected-resource/);
        assert.equal((await payload(await call('initialize'))).result.serverInfo.name, 'kryin-edu');
        let listed = (await payload(await call('tools/list'))).result.tools;
        assert.ok(listed.some(tool => tool.name === 'admin_request_create_user'));
        assert.ok(listed.every(tool => tool.name.startsWith('admin_')));
        assert.ok(listed.every(tool => !('password' in (tool.inputSchema.properties ?? {}))));
        roles = ['student', 'admin'];
        listed = (await payload(await call('tools/list'))).result.tools;
        assert.ok(listed.some(tool => tool.name === 'admin_list_classes'), 'additional admin role works');
        roles = ['student', 'parent'];
        listed = (await payload(await call('tools/list'))).result.tools;
        assert.ok(listed.length > 0 && listed.every(tool => tool.annotations.readOnlyHint));
        roles = ['teacher'];
        assert.equal((await payload(await call('tools/list'))).result?.tools?.length ?? 0, 0);
        teacherUnlocked = true;
        listed = (await payload(await call('tools/list'))).result.tools;
        assert.ok(listed.some(tool => tool.name === 'teacher_my_classes'));
        assert.ok(listed.every(tool => tool.name.startsWith('teacher_')));
        revoked = true;
        const denied = await call('tools/list');
        assert.equal(denied.status, 401, 'revocation applies to the next call');
        assert.match(denied.headers.get('www-authenticate'), /invalid_token/);
        revoked = false; grantVersion = randomUUID();
        assert.equal((await call('tools/list')).status, 401, 'reconsent must not revive an old access token');
        grantVersion = ids.version;
        revoked = false; schoolEnabled = false;
        assert.equal((await call('tools/list')).status, 401, 'disabled school blocks existing token');
        schoolEnabled = true; profileSchool = randomUUID();
        assert.equal((await call('tools/list')).status, 401, 'school move invalidates old grant');
        profileSchool = null; platform = true; roles = ['superadmin'];
        listed = (await payload(await call('tools/list'))).result.tools;
        assert.ok(listed.every(tool => tool.name.startsWith('superadmin_')));
        assert.ok(listed.filter(tool => tool.name !== 'superadmin_find_schools')
            .every(tool => tool.inputSchema.required.includes('school_id')));
    } finally {
        globalThis.fetch = originalFetch;
        await unlink(path);
    }
});
