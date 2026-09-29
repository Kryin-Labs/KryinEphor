import { expect, test } from 'bun:test';
import { shouldHydrateAuthEvent, signOutBeforeRedirect } from '../src/lib/auth/loginSession';

test('does not hydrate a sign-in event while the login action owns it', () => {
  expect(shouldHydrateAuthEvent('SIGNED_IN', true)).toBe(false);
});

test('hydrates initial and unrelated auth events', () => {
  expect(shouldHydrateAuthEvent('INITIAL_SESSION', true)).toBe(true);
  expect(shouldHydrateAuthEvent('SIGNED_IN', false)).toBe(true);
});

test('redirects only after sign-out succeeds', async () => {
  const events: string[] = [];
  let finishSignOut!: (result: { error: Error | null }) => void;

  const pending = signOutBeforeRedirect(
    () => {
      events.push('sign-out');
      return new Promise((resolve) => { finishSignOut = resolve; });
    },
    () => events.push('redirect'),
  );

  expect(events).toEqual(['sign-out']);
  finishSignOut({ error: null });
  await pending;
  expect(events).toEqual(['sign-out', 'redirect']);
});
