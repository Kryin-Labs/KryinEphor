// supabase/functions/set_recovery_email/index.ts
//
// Phase 4A.2 — User sets / verifies their recovery email.
// Flow:
//   1) User POSTs { recoveryEmail } with their session JWT.
//      → server lowercases + validates, writes to profiles.recovery_email
//        (the DB trigger resets recovery_email_verified to false),
//        then issues a 6-digit OTP and emails it via Brevo through the
//        Brevo from the server only.
//   2) User POSTs { code } with their session JWT.
//      → server verifies the OTP and sets recovery_email_verified = true.
//
// OTP storage uses public.recovery_email_otp (created on demand).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const OTP_TTL_MIN = 15;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const BREVO_API_KEY = Deno.env.get("BREVO_DIRECT_API_KEY") || Deno.env.get("BREVO_API_KEY") || "";
  const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") || "";
  const BREVO_SENDER_NAME = Deno.env.get("BREVO_SENDER_NAME") || "EduNex";

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Missing auth" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: "Unauthenticated" }, 401);
  const userId = userData.user.id;

  let body: { recoveryEmail?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // ── Mode 1: set recovery email + send OTP ──────────────────────
  if (body.recoveryEmail !== undefined) {
    const recoveryEmail = body.recoveryEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(recoveryEmail)) {
      return json({ error: "Invalid email address" }, 400);
    }

    const { error: upErr } = await admin
      .from("profiles")
      .update({ recovery_email: recoveryEmail, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (upErr) return json({ error: `Could not save: ${upErr.message}` }, 400);

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000).toISOString();

    const { error: otpErr } = await admin.from("recovery_email_otp").upsert(
      {
        user_id: userId,
        email: recoveryEmail,
        code_hash: await sha256(code),
        expires_at: expiresAt,
        consumed_at: null,
      },
      { onConflict: "user_id" }
    );
    if (otpErr) return json({ error: `OTP error: ${otpErr.message}` }, 500);

    if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
      return json({ error: "Mailer is not configured. Verification code was not sent." }, 503);
    }

    try {
      const r = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": BREVO_API_KEY,
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
          to: [{ email: recoveryEmail }],
          subject: "Verify your EduNex recovery email",
          htmlContent: `
            <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
              <h2>Confirm recovery email</h2>
              <p>Enter this code in EduNex to verify <strong>${escapeHtml(recoveryEmail)}</strong> as your recovery address.</p>
              <p style="font-size:32px;font-weight:700;letter-spacing:6px;background:#f1f5f9;padding:16px 24px;border-radius:10px;text-align:center">${code}</p>
              <p style="font-size:12px;color:#64748b">This code expires in ${OTP_TTL_MIN} minutes.</p>
            </div>`,
        }),
      });
      if (!r.ok) {
        return json({ success: true, message: "Saved, but verification email could not be sent. Try again later." });
      }
    } catch {
      return json({ success: true, message: "Saved, but verification email could not be sent. Try again later." });
    }

    return json({ success: true, message: "Verification code sent to your recovery email." });
  }

  // ── Mode 2: verify OTP ─────────────────────────────────────────
  if (body.code !== undefined) {
    const code = String(body.code).trim();
    if (!/^\d{6}$/.test(code)) return json({ error: "Invalid code format" }, 400);

    const { data: row } = await admin
      .from("recovery_email_otp")
      .select("email, code_hash, expires_at, consumed_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (!row || row.consumed_at) return json({ error: "No active code. Request a new one." }, 400);
    if (new Date(row.expires_at).getTime() < Date.now())
      return json({ error: "Code expired. Request a new one." }, 400);
    if (row.code_hash !== (await sha256(code)))
      return json({ error: "Incorrect code." }, 400);

    const { error: flagErr } = await admin
      .from("profiles")
      .update({
        recovery_email_verified: true,
        recovery_email: row.email,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (flagErr) return json({ error: `Could not mark verified: ${flagErr.message}` }, 400);

    await admin
      .from("recovery_email_otp")
      .update({ consumed_at: new Date().toISOString() })
      .eq("user_id", userId);

    return json({ success: true, message: "Recovery email verified." });
  }

  return json({ error: "Provide recoveryEmail or code" }, 400);
});

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
