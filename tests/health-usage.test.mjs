import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/lib/healthUsage.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { capacityUsage, filesystemUsed, canClearQuery, clearDownloadedCaches } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('usage percentages use real capacity, preserve zero and display over-capacity honestly', () => {
    assert.deepEqual(capacityUsage(25, 100), { percent: 25, barPercent: 25, remainingPercent: 75, exceeded: false });
    assert.equal(capacityUsage(0, 100).percent, 0);
    assert.equal(capacityUsage(150, 100).percent, 150);
    assert.equal(capacityUsage(150, 100).barPercent, 100);
    assert.equal(capacityUsage(150, 100).remainingPercent, 0);
    assert.equal(capacityUsage(150, 100).exceeded, true);
});

test('cache cleanup keeps active, fetching and critical session/settings queries', () => {
    const query = (key, active = false, fetchStatus = 'idle') => ({ queryKey: [key], isActive: () => active, state: { fetchStatus, data: [] } });
    assert.equal(canClearQuery(query('announcements')), true);
    assert.equal(canClearQuery(query('announcements', true)), false);
    assert.equal(canClearQuery(query('announcements', false, 'fetching')), false);
    assert.equal(canClearQuery(query('announcements', false, 'paused')), false);
    assert.equal(canClearQuery({ ...query('unloaded-page'), state: { fetchStatus: 'idle' } }), false);
    for (const key of ['auth', 'session', 'profile', 'user', 'platform-status', 'platform-settings', 'platform-health-console']) assert.equal(canClearQuery(query(key)), false);
});

test('unknown quotas, empty request samples and invalid readings never become a fake zero percent', () => {
    for (const [used, total] of [[0, null], [null, 100], [0, 0], [-1, 100], [100, -1], [NaN, 100], [100, Infinity]]) {
        assert.equal(capacityUsage(used, total), null);
    }
    assert.equal(filesystemUsed(1000, 250), 750);
    assert.equal(filesystemUsed(1000, null), null);
    assert.equal(filesystemUsed(1000, 2000), null);
});

test('download cleanup removes only Cache API containers and reports successfully removed entries', async () => {
    const deleted = [];
    const downloaded = {
        keys: async () => ['assets', 'already-removed'],
        open: async name => ({ keys: async () => name === 'assets' ? ['image', 'font'] : ['old-image'] }),
        delete: async name => { deleted.push(name); return name === 'assets'; },
    };
    assert.equal(await clearDownloadedCaches(downloaded), 2);
    assert.deepEqual(deleted, ['assets', 'already-removed']);
    assert.equal(await clearDownloadedCaches({ keys: async () => [], open: () => assert.fail(), delete: () => assert.fail() }), 0);
    await assert.rejects(clearDownloadedCaches({ ...downloaded, keys: async () => { throw new Error('Browser policy denied'); } }), /policy denied/);
});
