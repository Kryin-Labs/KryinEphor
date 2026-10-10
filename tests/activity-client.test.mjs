import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/lib/activityClient.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { describeClient } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

test('readable browser names respect tokens before generic Chrome and Safari compatibility tokens', () => {
    assert.deepEqual(describeClient(chrome), { browser: 'Chrome', version: '154.0.0.0', os: 'Windows', device: 'Computer' });
    assert.equal(describeClient(`${chrome} OPR/124.0.0.0`).browser, 'Opera');
    assert.equal(describeClient(`${chrome} OPR/124.0.0.0`).version, '124.0.0.0');
    assert.equal(describeClient(`${chrome} Edg/154.0.0.0`).browser, 'Microsoft Edge');
    assert.equal(describeClient(`${chrome} SamsungBrowser/28.0`).browser, 'Samsung Internet');
    assert.equal(describeClient(`${chrome} Vivaldi/7.0`).browser, 'Vivaldi');
    assert.equal(describeClient('Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0').browser, 'Firefox');
});

test('iOS browser variants, Safari and device types remain distinct', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
    assert.equal(describeClient(`${iphone} CriOS/154.0.0.0 Mobile/15E148 Safari/604.1`).browser, 'Chrome');
    assert.equal(describeClient(`${iphone} FxiOS/144.0 Mobile/15E148 Safari/604.1`).browser, 'Firefox');
    assert.equal(describeClient(`${iphone} OPT/3.2 Mobile/15E148 Safari/604.1`).browser, 'Opera');
    assert.deepEqual(describeClient(`${iphone} Version/18.0 Mobile/15E148 Safari/604.1`), { browser: 'Safari', version: '18.0', os: 'iOS', device: 'Phone' });
    assert.equal(describeClient('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Version/18.0 Safari/604.1').device, 'Tablet');
    assert.equal(describeClient('Mozilla/5.0 (Linux; Android 14) Chrome/154.0 Mobile Safari/537.36').device, 'Phone');
    assert.equal(describeClient('Mozilla/5.0 (Linux; Android 14) Chrome/154.0 Safari/537.36').device, 'Unknown');
});

test('missing, ambiguous and server agents never become a fabricated browser or device', () => {
    assert.equal(describeClient(null).browser, 'Not captured');
    assert.equal(describeClient('Mozilla/5.0').browser, 'Unknown');
    assert.equal(describeClient('Deno/2.1').browser, 'API client (Deno)');
    assert.equal(describeClient('Deno/2.1').device, 'Server / API client');
    assert.equal(describeClient(`${chrome} Googlebot/2.1`).device, 'Bot / automation');
});

test('verified Edge actor context forwards only browser and matching session identifiers, never credentials or claimed proxy IPs', async () => {
    const serverSource = await readFile(new URL('../supabase/functions/_shared/actorContext.ts', import.meta.url), 'utf8');
    const transformed = await transform(serverSource, { loader: 'ts', format: 'esm' });
    const { verifiedActorHeaders } = await import(`data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`);
    const user = '20000000-0000-0000-0000-000000000003', session = '30000000-0000-0000-0000-000000000001';
    const request = claims => new Request('https://school.example/functions/update_admin', { headers: { authorization: `Bearer a.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.b`, 'user-agent':chrome, 'x-kryin-actor-id':'spoofed', 'x-forwarded-for':'fake IP' } });
    assert.deepEqual(verifiedActorHeaders(request({ sub:user, session_id:session }), user), { 'x-kryin-actor-id':user, 'x-kryin-session-id':session, 'x-kryin-user-agent':chrome });
    assert.equal(verifiedActorHeaders(request({ sub:'another actor', session_id:session }), user)['x-kryin-session-id'],undefined);
    assert.equal(verifiedActorHeaders(request({ sub:user, session_id:'not a UUID' }), user)['x-kryin-session-id'],undefined);
});
