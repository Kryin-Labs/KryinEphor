import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('delete_school uses the shared CORS allowlist', async () => {
  const source = await readFile('supabase/functions/delete_school/index.ts', 'utf8');
  assert.match(source, /import\s*\{\s*resolveCorsOrigin\s*\}\s*from\s*["']\.\.\/_shared\/cors\.js["']/);
  assert.match(source, /const allowOrigin = resolveCorsOrigin\(origin, configured\)/);
});
