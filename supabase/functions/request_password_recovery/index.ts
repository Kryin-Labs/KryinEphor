// supabase/functions/request_password_recovery/index.ts
//
// Phase 4A.2 — Enumeration-safe password recovery for institutional
// (possibly fake-inbox) accounts. Always returns the same response.
// Resolves login_id → profile → recovery_email; if verified, generates
// a Supabase recovery link bound to auth.users.email and delivers via
// Brevo from the server only. If delivery is unavailable,
// the attempt is logged without exposing the reset link to the browser.
//
// Rate limits (server-side, enforced by querying password_recovery_audit):
//   - 3 requests / 15 min per login_id
//   - 10 requests / hour per IP
//
// Recovery link TTL is 1 hour (set via redirectTo callback URL only;
// Supabase honours the project-wide link-expiry which defaults to 1h).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GENERIC_RESPONSE = {
  success: true,
  message:
    "If recovery information is configured for that account, recovery instructions have been sent.",
};

interface AuditRow {
  user_id?: string | null;
  login_id: string;
  ip_address?: string | null;
  user_agent?: string | null;
  status:
    | "sent"
    | "rate_limited"
    | "no_recovery_email"
    | "unverified"
    | "unknown_account"
    | "delivery_failed";
  recovery_link?: string | null;
}

function jsonOk() {
  return new Response(JSON.stringify(GENERIC_RESPONSE), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonBad(message: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonBad("Method not allowed", 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const BREVO_API_KEY = Deno.env.get("BREVO_DIRECT_API_KEY") || Deno.env.get("BREVO_API_KEY") || "";
  const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") || "";
  const BREVO_SENDER_NAME = Deno.env.get("BREVO_SENDER_NAME") || "EduNex";
  const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "";

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: { loginId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonBad("Invalid JSON");
  }

  const loginId = (body.loginId || "").trim().toLowerCase();
  if (!loginId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(loginId)) {
    // Don't even hint at validation specifics; respond generically.
    return jsonOk();
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") ||
    null;
  const userAgent = req.headers.get("user-agent") || null;

  const audit = async (row: Omit<AuditRow, "login_id"> & { login_id?: string }) => {
    await admin.from("password_recovery_audit").insert({
      login_id: loginId,
      ip_address: ip,
      user_agent: userAgent,
      ...row,
    });
  };

  // ── Rate limit checks (item 8) ──────────────────────────────────
  const since15 = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const since1h = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const [{ count: perIdCount }, { count: perIpCount }] = await Promise.all([
    admin
      .from("password_recovery_audit")
      .select("id", { head: true, count: "exact" })
      .eq("login_id", loginId)
      .gte("created_at", since15),
    ip
      ? admin
          .from("password_recovery_audit")
          .select("id", { head: true, count: "exact" })
          .eq("ip_address", ip)
          .gte("created_at", since1h)
      : Promise.resolve({ count: 0 } as { count: number }),
  ]);

  if ((perIdCount ?? 0) >= 3 || (perIpCount ?? 0) >= 10) {
    await audit({ status: "rate_limited" });
    return jsonOk(); // identical response — never leak rate-limit state
  }

  // ── Resolve account (item 7 — never differentiate failures) ─────
  const { data: profile } = await admin
    .from("profiles")
    .select("id, login_id, recovery_email, recovery_email_verified, is_active")
    .eq("login_id", loginId)
    .maybeSingle();

  if (!profile || !profile.is_active) {
    await audit({ status: "unknown_account" });
    return jsonOk();
  }

  if (!profile.recovery_email) {
    await audit({ user_id: profile.id, status: "no_recovery_email" });
    return jsonOk();
  }

  if (!profile.recovery_email_verified) {
    await audit({ user_id: profile.id, status: "unverified" });
    return jsonOk();
  }

  // ── Generate recovery link bound to auth.users.email = login_id ──
  const redirectTo = resolveRedirectTo(req, ALLOWED_ORIGIN);

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: loginId,
    options: redirectTo ? { redirectTo } : undefined,
  });

  if (linkErr || !linkData?.properties?.action_link) {
    await audit({ user_id: profile.id, status: "delivery_failed" });
    return jsonOk();
  }

  const actionLink = linkData.properties.action_link;

  // ── Deliver via Brevo; never expose links/codes client-side ─
  if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
    await audit({
      user_id: profile.id,
      status: "delivery_failed",
    });
    return jsonOk();
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
        to: [{ email: profile.recovery_email }],
        subject: "Reset your EduNex password",
        htmlContent: `
          <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
            <h2 style="margin:0 0 12px">Password reset request</h2>
            <p>A password reset was requested for your EduNex account
               <strong>${escapeHtml(loginId)}</strong>.</p>
            <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
            <p style="margin:24px 0">
              <a href="${actionLink}"
                 style="background:#064e3b;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">
                 Reset password
              </a>
            </p>
            <p style="font-size:12px;color:#64748b">Or paste this link into your browser:<br>${escapeHtml(actionLink)}</p>
          </div>`,
      }),
    });

    if (!r.ok) {
      await audit({
        user_id: profile.id,
        status: "delivery_failed",
      });
      return jsonOk();
    }
  } catch {
    await audit({
      user_id: profile.id,
      status: "delivery_failed",
    });
    return jsonOk();
  }

  await audit({ user_id: profile.id, status: "sent" });
  return jsonOk();
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveRedirectTo(req: Request, allowedOrigin: string): string | undefined {
  const configured = allowedOrigin.trim().replace(/\/$/, "");
  if (configured) return `${configured}/reset-password`;

  const origin = req.headers.get("origin") || "";
  try {
    const url = new URL(origin);
    const isAllowedHost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".lovable.app") ||
      url.hostname.endsWith(".lovableproject.com") ||
      url.hostname.endsWith(".sandbox.lovable.dev");
    if ((url.protocol === "https:" || url.protocol === "http:") && isAllowedHost) {
      return `${url.origin}/reset-password`;
    }
  } catch {
    // Fall through to project default auth redirect URL.
  }

  return undefined;
}
