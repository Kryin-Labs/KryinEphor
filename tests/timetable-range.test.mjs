import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, shiftAnchor, timetableRange, weekday } from '../src/lib/timetable.ts';

test('timetable ranges stay on calendar dates across months and daylight saving', () => {
    assert.deepEqual(timetableRange('Week', '2026-09-29', ''), { from: '2026-09-28', to: '2026-10-04' });
    assert.deepEqual(timetableRange('Month', '2026-12-15', ''), { from: '2026-12-01', to: '2026-12-31' });
    assert.deepEqual(timetableRange('3 Months', '2026-11-15', ''), { from: '2026-11-01', to: '2027-01-31' });
    assert.equal(addDays('2026-03-08', 1), '2026-03-09');
    assert.equal(weekday('2026-09-29'), 2);
    assert.equal(shiftAnchor('2026-03-31', 'Month', -1), '2026-02-01');
});
