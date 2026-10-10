import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
const source = await readFile(new URL('../src/lib/activityTransport.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { activityFetch } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('command audit omits secrets and payloads, preserves the original result, and avoids recursive audit calls', async () => {
    const calls = [];
    const fetch = activityFetch(async (input, init) => { calls.push({input,init}); return new Response('{}', {status:200}); }, 'https://project.supabase.co');
    const response = await fetch('https://project.supabase.co/functions/v1/update_admin', {
        method:'POST',headers:{Authorization:'Bearer caller-token'},body:JSON.stringify({password:'secret',fullName:'Alice'}),
    });
    assert.equal(response.status,200);
    assert.equal(calls.length,2);
    const audit = JSON.parse(calls[1].init.body);
    assert.equal(audit.p_action,'command.update_admin');
    assert.ok(!JSON.stringify(audit).includes('secret'));
    assert.ok(!JSON.stringify(audit).includes('caller-token'));
    assert.equal(calls[1].init.headers.get('Authorization'),'Bearer caller-token');
    await fetch('https://project.supabase.co/rest/v1/rpc/fn_record_client_event',{method:'POST'});
    assert.equal(calls.length,3);
    await fetch('https://project.supabase.co/rest/v1/rpc/fn_get_system_activity',{method:'POST'});
    assert.equal(calls.length,4);
});

test('failed browser writes are reported once per minute and reads are quiet', async () => {
    const calls=[];
    const fetch=activityFetch(async(input,init)=>{calls.push({input,init});return new Response('{}',{status:403});},'https://project.supabase.co');
    await fetch('https://project.supabase.co/rest/v1/classes',{method:'PATCH'});
    assert.equal(JSON.parse(calls[1].init.body).p_status,'failed');
    await fetch('https://project.supabase.co/rest/v1/classes',{method:'PATCH'});
    assert.equal(calls.length,3);
    await fetch('https://project.supabase.co/rest/v1/classes',{method:'GET'});
    assert.equal(calls.length,4);
});
