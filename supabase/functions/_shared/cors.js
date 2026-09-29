const LOVABLE_ORIGIN = 'https://kryinedu.lovable.app';
const LOVABLE_PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.(lovable\.app|lovableproject\.com|sandbox\.lovable\.dev)$/i;
const LOCAL_DEVELOPMENT_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(?::\d{1,5})?$/i;

/**
 * Returns the request origin only when it is permitted to call an Edge Function.
 * Returning null deliberately omits the CORS header for untrusted browser origins.
 */
export function resolveCorsOrigin(origin, configuredOrigins = []) {
  if (!origin) return null;

  const configured = new Set(configuredOrigins.filter(Boolean));
  if (
    origin === LOVABLE_ORIGIN ||
    LOVABLE_PREVIEW_ORIGIN.test(origin) ||
    LOCAL_DEVELOPMENT_ORIGIN.test(origin) ||
    configured.has(origin)
  ) {
    return origin;
  }

  return null;
}
