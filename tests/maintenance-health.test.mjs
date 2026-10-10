import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { parsePlatformMetrics } from '../monitoring/platform-metrics.mjs';

async function moduleAt(path) {
    const { code } = await transform(await readFile(new URL(path, import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
    return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

test('maintenance blocks visitors and school pages before other gates, but preserves admin and recovery access', async () => {
    const { maintenanceView } = await moduleAt('../src/lib/maintenance.ts');
    assert.equal(maintenanceView({ enabled: true, superadmin: false, path: '/' }), 'blocked');
    assert.equal(maintenanceView({ enabled: true, superadmin: false, path: '/classes' }), 'blocked');
    assert.equal(maintenanceView({ enabled: true, superadmin: false, path: '/ai-connections' }), 'blocked');
    assert.equal(maintenanceView({ enabled: true, superadmin: true, path: '/settings' }), 'banner');
    assert.equal(maintenanceView({ enabled: true, superadmin: false, path: '/reset-password' }), 'banner');
    assert.equal(maintenanceView({ enabled: false, superadmin: false, path: '/classes' }), 'open');
});

test('request measurements batch real results without payloads, and keep each caller separate', async () => {
    const { requestMetricsFetch } = await moduleAt('../src/lib/requestMetrics.ts');
    const pending = [], reports = [];
    const project = 'https://project.supabase.co';
    const fetch = requestMetricsFetch(async (url, init) => {
        if (String(url).endsWith('fn_record_request_metrics')) { reports.push({ headers: init.headers, body: JSON.parse(init.body) }); return new Response('null'); }
        if (String(url).endsWith('offline')) throw new TypeError('offline');
        return new Response('{}', { status: String(url).includes('blocked') ? 403 : 200 });
    }, project, fn => { pending.push(fn); });
    const alice = { headers: { authorization: 'Bearer alice-session', apikey: 'anonymous-key' } };
    const bob = { headers: { authorization: 'Bearer bob-session', apikey: 'anonymous-key' } };
    await fetch(`${project}/rest/v1/classes`, alice);
    await fetch(`${project}/rest/v1/blocked`, { ...alice, method: 'POST', body: '{"password":"secret"}' });
    await assert.rejects(fetch(`${project}/rest/v1/offline`, alice), /offline/);
    await fetch(`${project}/storage/v1/object/private/file`, bob);
    await fetch(`${project}/auth/v1/token`, alice);
    await fetch(`${project}/rest/v1/rpc/fn_platform_status`, alice);
    await fetch(`${project}/rest/v1/classes`, { headers: { authorization: 'Bearer anonymous-key', apikey: 'anonymous-key' } });
    assert.equal(reports.length, 0);
    await pending[0]();
    assert.equal(reports.length, 2);
    assert.deepEqual(reports.map(r => [r.body.p_requests, r.body.p_failures]), [[3, 2], [1, 0]]);
    assert.ok(reports.every(r => r.body.p_duration_ms >= 0));
    assert.equal(reports[0].headers.get('authorization'), 'Bearer alice-session');
    assert.equal(reports[1].headers.get('authorization'), 'Bearer bob-session');
    assert.ok(!JSON.stringify(reports.map(r => r.body)).includes('secret'));
    assert.ok(!JSON.stringify(reports.map(r => r.body)).includes('session'));
});

test('host metrics use CPU counter deltas, available memory, and only real filesystem gauges', () => {
    const samples = `node_cpu_seconds_total{mode="idle"} 160\nnode_cpu_seconds_total{mode="system"} 40
node_memory_MemTotal_bytes 1000\nnode_memory_MemAvailable_bytes 300\nnode_filesystem_size_bytes{mountpoint="/data"} 5000
node_filesystem_avail_bytes{mountpoint="/data"} 4000\nnode_memory_MemTotal_bytes{service_type="other"} 999999`;
    const result = parsePlatformMetrics(samples, { total: 100, idle: 80 });
    assert.equal(result.snapshot.cpu_percent, 20);
    assert.equal(result.snapshot.memory_used_bytes, 700);
    assert.equal(result.snapshot.filesystems[0].available_bytes, 4000);
    assert.equal(parsePlatformMetrics(samples).snapshot.cpu_percent, null);
    assert.equal(parsePlatformMetrics('').snapshot.memory_used_bytes, null);
    assert.equal(parsePlatformMetrics(samples, { total: 900, idle: 800 }).snapshot.cpu_percent, null);
});

test('Edge mutations stop at the verified caller availability check and preserve admin access', async () => {
    const { maintenanceBlock } = await moduleAt('../supabase/functions/_shared/platformMaintenance.ts');
    const blocked = await maintenanceBlock({ rpc: async () => ({ error: { message: 'Platform maintenance is in progress' } }) }, { 'Access-Control-Allow-Origin': 'https://school.example' });
    assert.equal(blocked.status, 503);
    assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), 'https://school.example');
    assert.equal((await blocked.json()).code, 'PLATFORM_UNAVAILABLE');
    assert.equal(await maintenanceBlock({ rpc: async () => ({ error: null }) }, {}), null);
});
