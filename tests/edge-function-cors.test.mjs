import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCorsOrigin } from '../supabase/functions/_shared/cors.js';

test('allows Vite localhost origins for Edge Function development', () => {
  assert.equal(resolveCorsOrigin('http://localhost:5173'), 'http://localhost:5173');
  assert.equal(resolveCorsOrigin('http://127.0.0.1:5173'), 'http://127.0.0.1:5173');
});

test('keeps untrusted origins out of the Edge Function CORS allowlist', () => {
  assert.equal(resolveCorsOrigin('https://untrusted.example'), null);
});
