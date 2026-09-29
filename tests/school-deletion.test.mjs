import assert from 'node:assert/strict';
import test from 'node:test';

import { SCHOOL_DELETION_STATUS } from '../supabase/functions/_shared/schoolDeletion.js';

test('soft-deleted schools move to the recoverable archived state', () => {
  assert.equal(SCHOOL_DELETION_STATUS, 'archived');
});
