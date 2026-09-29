// supabase/functions/admin_set_recovery_email/index.ts
//
// Admin-side recovery-email + OTP for users created from the UserManagement panel.
// Caller must be authenticated as superadmin, admin (principal), or receptionist.
//
// Modes (POST JSON):
//   { targetUserId, recoveryEmail }  → save + send 6-digit OTP to that address
//   { targetUserId, code }           → verify OTP, mark profiles.recovery_email_verified = true

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const OTP_TTL_MIN = 10;
const ALLOWED_ROLES = new Set(["superadmin", "admin", "receptionist"]);
const REQUIRED_ROLE_MESSAGE = "Requires superadmin, admin (principal), or receptionist role.";

type ProfileForRecovery = {
  role: string | null;
  school_id: string | null;
  is_active: boolean | null;
  email?: string | null;
  full_name?: string | null;
};

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

  const { data: ud, error: uerr } = await userClient.auth.getUser(jwt);
  if (uerr || !ud?.user) return json({ error: "Unauthenticated" }, 401);
  const callerId = ud.user.id;

  let body: { targetUserId?: string; recoveryEmail?: string; code?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const targetUserId = (body.targetUserId || "").trim();
  if (!targetUserId) return json({ error: "Missing targetUserId" }, 400);
  const mode = body.recoveryEmail !== undefined ? "send_otp" : body.code !== undefined ? "confirm_otp" : "unknown";
  const ipAddress = getClientIp(req);
  const userAgent = req.headers.get("user-agent") || null;

  const { data: callerProfile, error: callerProfileErr } = await admin
    .from("profiles")
    .select("role, school_id, is_active")
    .eq("id", callerId)
    .maybeSingle();
  if (callerProfileErr || !callerProfile) {
    await writeAudit(admin, { actorId: callerId, actorRole: null, targetUserId, action: "recovery_email_permission_denied", status: "failed", ipAddress, detail: { mode, reason: "caller_profile_missing", userAgent } });
    return json({ error: `You don't have permission to set recovery emails. ${REQUIRED_ROLE_MESSAGE}` }, 403);
  }

  const { data: targetProfile, error: targetProfileErr } = await admin
    .from("profiles")
    .select("role, school_id, is_active, email, full_name")
    .eq("id", targetUserId)
    .maybeSingle();
  if (targetProfileErr || !targetProfile) {
    await writeAudit(admin, { actorId: callerId, actorRole: callerProfile.role, targetUserId, action: "recovery_email_target_missing", status: "failed", ipAddress, detail: { mode, userAgent } });
    return json({ error: "Target user profile not found." }, 404);
  }

  const { data: sqlAllowed, error: sqlPermissionErr } = await admin.rpc("can_manage_recovery_email", {
    _actor_id: callerId,
    _target_user_id: targetUserId,
  });
  const localAllowed = canManageRecovery(callerProfile, targetProfile);
  const allowed = localAllowed && (sqlPermissionErr ? true : sqlAllowed === true);
  if (!allowed) {
    await writeAudit(admin, {
      actorId: callerId,
      actorRole: callerProfile.role,
      targetUserId,
      action: "recovery_email_permission_denied",
      status: "failed",
      ipAddress,
      detail: {
        mode,
        reason: sqlPermissionErr ? "role_or_school_denied" : "sql_permission_denied",
        callerRole: callerProfile.role,
        targetRole: targetProfile.role,
        sqlPermissionError: sqlPermissionErr?.message,
        userAgent,
      },
    });
    return json({ error: `You don't have permission to set recovery emails. ${REQUIRED_ROLE_MESSAGE}` }, 403);
  }

  // ── Mode 1: set + send OTP ──
  if (body.recoveryEmail !== undefined) {
    const recoveryEmail = String(body.recoveryEmail).trim().toLowerCase();
    if (!EMAIL_RE.test(recoveryEmail)) {
      await writeAudit(admin, { actorId: callerId, actorRole: callerProfile.role, targetUserId, action: "recovery_email_otp_send_failed", status: "failed", ipAddress, detail: { reason: "invalid_email", userAgent } });
      return json({ error: "Invalid email address" }, 400);
    }

    const { error: upErr } = await admin
      .from("profiles")
      .update({ recovery_email: recoveryEmail, recovery_email_verified: false, updated_at: new Date().toISOString() })
      .eq("id", targetUserId);
    if (upErr) {
      await writeAudit(admin, { actorId: callerId, actorRole: callerProfile.role, targetUserId, action: "recovery_email_otp_send_failed", status: "failed", ipAddress, detail: { reason: "profile_update_failed", error: upErr.message, email: maskEmail(recoveryEmail), userAgent } });
      return json({ error: `Could not save: ${upErr.message}` }, 400);
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000).toISOString();

    const { error: otpErr } = await admin.from("recovery_email_otp").upsert(
      { user_id: targetUserId, email: recoveryEmail, code_hash: await sha256(code), expires_at: expiresAt, consumed_at: null, created_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    if (otpErr) {
      await writeAudit(admin, { actorId: callerId, actorRole: callerProfile.role, targetUserId, action: "recovery_email_otp_send_failed", status: "failed", ipAddress, detail: { reason: "otp_store_failed", error: otpErr.message, email: maskEmail(recoveryEmail), userAgent } });
      return json({ error: `OTP error: ${otpErr.message}` }, 500);
    }

    if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
      await writeAudit(admin, { actorId: callerId, actorRole: callerProfile.role, targetUserId, action: "recovery_email_otp_send_failed", status: "failed", ipAddress, detail: { reason: !BREVO_SENDER_EMAIL ? "missing_sender" : "missing_brevo_secret", email: maskEmail(recoveryEmail), expiresAt, userAgent } });
      return json({ error: "Mailer is not configured. Verification code was not sent." }, 503);
    }

    try {
      const r = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": BREVO_API_KEY,
          accept: "application/json",
        },
        body: JSON.stringify({
          sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
          to: [{ email: recoveryEmail }],
          subject: "Verify your EduNex recovery email",
          htmlContent: brandedHtml(recoveryEmail, code),
        }),
      });
      if (!r.ok) {
        let detail = "";
        try { const j = await r.json(); detail = j?.message || j?.code || JSON.stringify(j); }
        catch { detail = await r.text().catch(() => `HTTP ${r.status}`); }
        await writeAudit(admin, { actorId: callerId, actorRole: callerProfile.role, targetUserId, action: "recovery_email_otp_send_failed", status: "failed", ipAddress, detail: { reason: "brevo_rejected", brevoStatus: r.status, brevoMessage: detail, email: maskEmail(recoveryEmail), userAgent } });
        return json({ error: `Brevo ${r.status}: ${detail}` }, 502);
      }
    } catch (e) {
      const mailerError = e instanceof Error ? e.message : String(e);
      await writeAudit(admin, { actorId: callerId, actorRole: callerProfile.role, targetUserId, action: "recovery_email_otp_send_failed", status: "failed", ipAddress, detail: { reason: "mailer_network_error", error: mailerError, email: maskEmail(recoveryEmail), userAgent } });
      return json({ error: `Mailer network error: ${mailerError}` }, 502);
    }
    await writeAudit(admin, { actorId: callerId, actorRole: callerProfile.role, targetUserId, action: "recovery_email_otp_sent", status: "success", ipAddress, detail: { email: maskEmail(recoveryEmail), expiresAt, sender: BREVO_SENDER_EMAIL, userAgent } });
    return json({ success: true, message: `Code sent — expires in ${OTP_TTL_MIN} minutes.` });
  }

  // ── Mode 2: verify ──
  if (body.code !== undefined) {
    const code = String(body.code).trim();
    if (!/^\d{6}$/.test(code)) {
      await writeAudit(admin, { actorId: callerId, actorRole: callerProfile.role, targetUserId, action: "recovery_email_otp_confirm_failed", status: "failed", ipAddress, detail: { reason: "invalid_code_format", userAgent } });
      return json({ error: "Invalid code format" }, 400);
    }

    const { data: row } = await admin
      .from("recovery_email_otp")
      .select("email, code_hash, expires_at, consumed_at")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!row || row.consumed_at) {
      await writeAudit(admin, { actorId: callerId, actorRole: callerProfile.role, targetUserId, action: "recovery_email_otp_confirm_failed", status: "failed", ipAddress, detail: { reason: "no_active_code", userAgent } });
      return json({ error: "No active code. Resend it." }, 400);
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await writeAudit(admin, { actorId: callerId, actorRole: callerProfile.role, targetUserId, action: "recovery_email_otp_confirm_failed", status: "failed", ipAddress, detail: { reason: "expired", expiresAt: row.expires_at, userAgent } });
      return json({ error: "Code expired. Request a new one." }, 400);
    }
    if (row.code_hash !== (await sha256(code))) {
      await writeAudit(admin, { actorId: callerId, actorRole: callerProfile.role, targetUserId, action: "recovery_email_otp_confirm_failed", status: "failed", ipAddress, detail: { reason: "incorrect_code", userAgent } });
      return json({ error: "Incorrect code." }, 400);
    }

    const { error: flagErr } = await admin
      .from("profiles")
      .update({ recovery_email_verified: true, recovery_email: row.email, updated_at: new Date().toISOString() })
      .eq("id", targetUserId);
    if (flagErr) {
      await writeAudit(admin, { actorId: callerId, actorRole: callerProfile.role, targetUserId, action: "recovery_email_otp_confirm_failed", status: "failed", ipAddress, detail: { reason: "profile_verify_failed", error: flagErr.message, email: maskEmail(row.email), userAgent } });
      return json({ error: `Could not mark verified: ${flagErr.message}` }, 400);
    }

    await admin.from("recovery_email_otp").update({ consumed_at: new Date().toISOString() }).eq("user_id", targetUserId);
    await writeAudit(admin, { actorId: callerId, actorRole: callerProfile.role, targetUserId, action: "recovery_email_otp_confirmed", status: "success", ipAddress, detail: { email: maskEmail(row.email), userAgent } });
    return json({ success: true, message: "Recovery email verified." });
  }

  return json({ error: "Provide recoveryEmail or code" }, 400);
});

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function canManageRecovery(caller: ProfileForRecovery, target: ProfileForRecovery): boolean {
  if (!caller.is_active || !target.is_active || !caller.role || !ALLOWED_ROLES.has(caller.role)) return false;
  if (caller.role === "superadmin") return true;
  return Boolean(caller.school_id && target.school_id && caller.school_id === target.school_id && target.role !== "superadmin");
}

function getClientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("cf-connecting-ip")
    || req.headers.get("x-real-ip")
    || null;
}

function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [name, domain] = email.split("@");
  if (!domain) return "***";
  return `${name.slice(0, 2)}***@${domain}`;
}

async function writeAudit(admin: ReturnType<typeof createClient>, entry: {
  actorId: string;
  actorRole: string | null;
  targetUserId: string;
  action: string;
  status: "success" | "failed";
  ipAddress: string | null;
  detail?: Record<string, unknown>;
}) {
  try {
    await admin.from("admin_action_audit").insert({
      actor_id: entry.actorId,
      actor_role: entry.actorRole,
      target_user_id: entry.targetUserId,
      action: entry.action,
      detail: { status: entry.status, ...(entry.detail || {}) },
      ip_address: entry.ipAddress,
    });
  } catch {
    // Audit must never leak details or block the user-facing recovery flow.
  }
}

function brandedHtml(email: string, code: string) {
  return `<div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;background:#FAF9F6;padding:24px;border-radius:20px;color:#0F172A">
    <div style="background:linear-gradient(135deg,#1A3C34,#4B9C88);padding:24px;border-radius:14px;color:#EDFCE2;font-weight:700;letter-spacing:2px;text-transform:uppercase;font-size:12px">◆ EduNex • Recovery</div>
    <h2 style="margin:20px 0 8px">Verify your recovery email</h2>
    <p style="color:#475569;font-size:14px">Use this code to confirm <strong>${email.replace(/[<>&]/g,'')}</strong> as your recovery address.</p>
    <div style="font-size:32px;font-weight:800;letter-spacing:10px;background:#EDFCE2;border:1px solid #B8F28B;color:#1A3C34;padding:18px;border-radius:14px;text-align:center;margin:18px 0">${code}</div>
    <p style="font-size:12px;color:#94A3B8">Expires in ${OTP_TTL_MIN} minutes.</p>
  </div>`;
}
