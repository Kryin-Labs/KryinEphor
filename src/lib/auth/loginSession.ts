export function shouldHydrateAuthEvent(event: string, loginInProgress: boolean): boolean {
  return !(event === 'SIGNED_IN' && loginInProgress);
}

export async function signOutBeforeRedirect(
  signOut: () => Promise<{ error: Error | null }>,
  redirect: () => void,
): Promise<void> {
  const { error } = await signOut();
  if (error) throw error;
  redirect();
}
