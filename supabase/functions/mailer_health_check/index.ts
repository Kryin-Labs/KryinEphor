// supabase/functions/mailer_health_check/index.ts
//
// Server-side mailer health check. Verifies Brevo API connectivity directly
// WITHOUT exposing any secrets, request bodies, or sender configuration to
// the caller. Returns only a coarse status.
//
// Response shape (intentionally minimal):
//   { status: "ok" | "misconfigured" | "unreachable" | "unauthorized" | "error",
//     latency_ms: number }
//
// Notes:
// - Never logs secret values.
// - Never echoes provider error bodies to the client (they can leak account
//   details / sender identity). Detailed errors are only written to the
//   function logs for the project owner.
// - Safe to call from monitoring/uptime checks.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const BREVO_API_KEY = Deno.env.get("BREVO_DIRECT_API_KEY") || Deno.env.get("BREVO_API_KEY") || "";
  const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") || "";
  const BREVO_SENDER_NAME = Deno.env.get("BREVO_SENDER_NAME") || "";

  // Presence check only — never reveal which one is missing.
  if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL || !BREVO_SENDER_NAME) {
    console.error("[mailer_health_check] mailer not fully configured");
    return json(503, { status: "misconfigured", latency_ms: 0 });
  }

  const started = performance.now();
  try {
    // Does not send an email; just verifies the API key is accepted.
    const res = await fetch("https://api.brevo.com/v3/account", {
      method: "GET",
      headers: { "api-key": BREVO_API_KEY, accept: "application/json" },
    });

    const latency_ms = Math.round(performance.now() - started);

    if (res.status === 401 || res.status === 403) {
      console.error("[mailer_health_check] Brevo auth failed", res.status);
      return json(502, { status: "unauthorized", latency_ms });
    }

    if (!res.ok) {
      // Log the upstream body for operators, never return it to the client.
      const text = await res.text().catch(() => "");
      console.error(
        "[mailer_health_check] Brevo non-2xx",
        res.status,
        text.slice(0, 500),
      );
      return json(502, { status: "unreachable", latency_ms });
    }

    await res.body?.cancel().catch(() => {});

    return json(200, { status: "ok", latency_ms });
  } catch (err) {
    const latency_ms = Math.round(performance.now() - started);
    console.error("[mailer_health_check] exception", (err as Error).message);
    return json(500, { status: "error", latency_ms });
  }
});
