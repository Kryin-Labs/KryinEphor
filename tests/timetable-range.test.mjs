import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const generated = resolve('tests', `.timetable-range-${randomUUID()}.mjs`);
const output = await build({
    entryPoints: [resolve('src/lib/timetable.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
});
await writeFile(generated, output.outputFiles[0].text, 'utf8');
const { addDays, shiftAnchor, timetableRange, weekday } = await import(pathToFileURL(generated).href);

after(async () => {
    await unlink(generated).catch(() => {});
});

test('timetable ranges stay on calendar dates across months and daylight saving', () => {
    assert.deepEqual(timetableRange('Week', '2026-09-29', ''), { from: '2026-09-28', to: '2026-10-04' });
    assert.deepEqual(timetableRange('Month', '2026-12-15', ''), { from: '2026-12-01', to: '2026-12-31' });
    assert.deepEqual(timetableRange('3 Months', '2026-11-15', ''), { from: '2026-11-01', to: '2027-01-31' });
    assert.equal(addDays('2026-03-08', 1), '2026-03-09');
    assert.equal(weekday('2026-09-29'), 2);
    assert.equal(shiftAnchor('2026-03-31', 'Month', -1), '2026-02-01');
});
