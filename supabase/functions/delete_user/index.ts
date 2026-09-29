// ════════════════════════════════════════════════════════════════════
// delete_user — privileged HARD delete of a user account
// ────────────────────────────────────────────────────────────────────
// Authorization:
//   - Caller must be authenticated.
//   - Caller must be superadmin OR an admin of the SAME school as the
//     target user (admins cannot delete users outside their school).
//   - Protected root accounts cannot be deleted.
//   - Caller cannot delete themselves.
//
// Server-side confirmation:
//   The client must submit a `confirmText` value matching
//     `<schoolSlug>/<fullName>` (case-insensitive, trimmed).
//   Where schoolSlug = lowercased school name stripped to [a-z0-9],
//   or "platform" if the user has no school assignment.
//   This stops accidental deletions even if the UI is bypassed.
//
// Effect: deletes from auth.users (profile row + related rows cascade
// through existing FKs); the action is irreversible.
// ════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import {
    evaluateDeletePermission,
    evaluateAccountDisposability,
    expectedConfirmText,
    normalize,
} from "./permissions.ts";

const getCorsHeaders = (req: Request) => {
    const origin = req.headers.get("Origin") ?? "";
    const configured = (Deno.env.get("ALLOWED_ORIGINS") ?? Deno.env.get("ALLOWED_ORIGIN") ?? "")
        .split(",").map(v => v.trim()).filter(Boolean);
    const allowedOrigins = new Set(["https://kryinedu.lovable.app", ...configured]);
    const allowOrigin = allowedOrigins.has(origin) || /^https:\/\/[a-z0-9-]+\.(lovable\.app|lovableproject\.com|sandbox\.lovable\.dev)$/i.test(origin)
        ? origin
        : "https://kryinedu.lovable.app";
    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
};

Deno.serve(async (req: Request) => {
    const corsHeaders = getCorsHeaders(req);
    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status,
        });

    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) return json({ error: "Missing authorization header" }, 401);

        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        if (!supabaseUrl || !anonKey || !serviceRoleKey)
            return json({ error: "Server misconfiguration" }, 500);

        const callerClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
        });
        const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
        if (callerErr || !caller) return json({ error: "Invalid or expired token" }, 401);

        const admin = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });

        // Authoritative caller role derivation (primary profile role + user_roles)
        const { data: callerProfile } = await admin
            .from("profiles").select("role, school_id, is_active, deleted_at").eq("id", caller.id).single();
        if (!callerProfile) return json({ error: "Caller profile not found" }, 403);
        if (callerProfile.is_active === false || callerProfile.deleted_at) {
            return json({ error: "Forbidden: caller account is inactive or deleted" }, 403);
        }

        const { data: callerUserRoles } = await admin
            .from("user_roles").select("role").eq("user_id", caller.id);
        const callerRoles = Array.from(new Set([
            callerProfile.role,
            ...(callerUserRoles ?? []).map((r: { role: string }) => r.role),
        ])).filter(Boolean);

        let payload: { targetUserId?: string; confirmText?: string };
        try { payload = await req.json(); } catch { return json({ error: "Invalid JSON payload" }, 400); }

        const targetUserId = (payload.targetUserId || "").trim();
        const confirmText = normalize(payload.confirmText || "");
        if (!targetUserId) return json({ error: "targetUserId is required" }, 400);
        if (!confirmText) return json({ error: "confirmText is required" }, 400);

        // Load target and authoritative roles
        const { data: target, error: tgtErr } = await admin
            .from("profiles")
            .select("id, full_name, email, role, school_id")
            .eq("id", targetUserId).single();
        if (tgtErr || !target) return json({ error: "Target user not found" }, 404);

        const { data: targetUserRoles } = await admin
            .from("user_roles").select("role").eq("user_id", targetUserId);
        const targetRoles = Array.from(new Set([
            target.role,
            ...(targetUserRoles ?? []).map((r: { role: string }) => r.role),
        ])).filter(Boolean);

        // Centralised permission decision with full caller roles
        const decision = evaluateDeletePermission(
            { id: caller.id, role: callerProfile.role, school_id: callerProfile.school_id },
            { id: target.id, role: target.role, school_id: target.school_id, email: target.email },
            callerRoles,
        );
        if (!decision.allowed) return json({ error: decision.reason }, decision.status);

        // Resolve expected confirmText: <schoolSlug>/<fullName>
        let schoolName: string | null = null;
        if (target.school_id) {
            const { data: school } = await admin
                .from("schools").select("name").eq("id", target.school_id).single();
            schoolName = school?.name ?? null;
        }
        const expected = expectedConfirmText(schoolName, target.full_name);
        if (confirmText !== expected)
            return json({ error: "Confirmation text does not match." }, 400);

        const targetIsStudent = targetRoles.includes("student");
        let eligibilityResult: Record<string, unknown> | null = null;

        // If target has student capability, enforce disposability and dependency protections
        if (targetIsStudent) {
            // Check employees identity
            const { data: empRecord } = await admin
                .from("employees")
                .select("id")
                .eq("profile_id", targetUserId)
                .is("deleted_at", null)
                .limit(1);
            const hasEmployeesRecord = (empRecord && empRecord.length > 0) || false;

            // Check family relationships (as student or guardian, active or historical)
            const { data: psRecords } = await admin
                .from("parent_student")
                .select("id")
                .or(`student_id.eq.${targetUserId},parent_id.eq.${targetUserId}`)
                .limit(1);
            const hasFamilyRelationships = (psRecords && psRecords.length > 0) || false;

            // 1. Multi-persona and identity disposability check
            const disposability = evaluateAccountDisposability(
                targetRoles,
                hasEmployeesRecord,
                hasFamilyRelationships,
            );
            if (!disposability.disposable) {
                return json({ error: disposability.reason }, 400);
            }

            // 2. Authoritative dependency check via locked service-only RPC
            const { data: eligibility, error: eligErr } = await admin.rpc(
                "fn_check_student_delete_eligibility_internal",
                {
                    _school_id: target.school_id,
                    _student_id: targetUserId,
                    _actor_id: caller.id,
                },
            );
            if (eligErr) {
                return json({ error: `Failed to verify student deletion eligibility: ${eligErr.message}` }, 500);
            }
            eligibilityResult = eligibility;

            if (eligibility && !eligibility.can_delete) {
                const reasonsList = (eligibility.reasons as string[] || []).join(", ");
                
                // Canonical audit log: student deletion attempted (blocked)
                await admin.from("admin_action_audit").insert({
                    actor_id: caller.id,
                    actor_role: callerRoles.includes("superadmin") ? "superadmin" : "admin",
                    school_id: target.school_id,
                    target_user_id: targetUserId,
                    action: "student deletion attempted",
                    detail: {
                        blocked: true,
                        reasons: eligibility.reasons,
                        total_records: eligibility.total_records,
                        target_student_identity: targetUserId,
                        target_name: target.full_name,
                        target_email: target.email,
                        school_id: target.school_id,
                    },
                    created_at: new Date().toISOString(),
                });

                return json({
                    error: `Permanent deletion blocked: student has active or historical records (${reasonsList}). To protect student and family history, hard deletion is refused. Please mark the student as Withdrawn, Transferred, or Inactive instead.`,
                    eligibility,
                }, 400);
            }
        }

        // Durable Two-Phase Hard-Delete Auditing:
        // Phase 1: Insert pending audit row with complete target identity snapshot BEFORE delete
        const actorRoleForAudit = callerRoles.includes("superadmin") ? "superadmin" : "admin";
        const auditDetail: Record<string, unknown> = {
            operation_state: "pending",
            completed: false,
            target_id: targetUserId,
            target_name: target.full_name,
            target_email: target.email,
            target_role: target.role,
            target_roles: targetRoles,
            school_id: target.school_id,
            target_student_identity: targetIsStudent ? targetUserId : undefined,
            exceptionally_allowed: targetIsStudent ? true : undefined,
            eligibility_summary: targetIsStudent ? eligibilityResult?.summary : undefined,
            actor_id: caller.id,
            actor_roles: callerRoles,
            initiated_at: new Date().toISOString(),
        };

        const { data: auditRow } = await admin
            .from("admin_action_audit")
            .insert({
                actor_id: caller.id,
                actor_role: actorRoleForAudit,
                school_id: target.school_id,
                target_user_id: targetUserId,
                action: targetIsStudent ? "student_hard_delete_pending" : "user_hard_delete_pending",
                detail: auditDetail,
                created_at: new Date().toISOString(),
            })
            .select("id")
            .single();

        const auditId = auditRow?.id;

        // Phase 2: Perform hard delete from auth (profile + related rows cascade via FKs)
        const { error: delErr } = await admin.auth.admin.deleteUser(targetUserId);
        if (delErr) {
            if (auditId) {
                await admin.from("admin_action_audit").update({
                    action: targetIsStudent ? "student_hard_delete_failed" : "user_hard_delete_failed",
                    detail: {
                        ...auditDetail,
                        operation_state: "failed",
                        completed: false,
                        error: delErr.message,
                        failed_at: new Date().toISOString(),
                    },
                }).eq("id", auditId);
            }
            return json({ error: `Delete failed: ${delErr.message}` }, 400);
        }

        // Best-effort: also delete profile row if it lingered without cascade
        await admin.from("profiles").delete().eq("id", targetUserId);

        // Phase 3: Update audit row to completed
        if (auditId) {
            await admin.from("admin_action_audit").update({
                action: targetIsStudent ? "student deleted if exceptionally allowed" : "user_hard_deleted",
                detail: {
                    ...auditDetail,
                    operation_state: "completed",
                    completed: true,
                    completed_at: new Date().toISOString(),
                },
            }).eq("id", auditId);
        }

        return json({ success: true, deletedUserId: targetUserId }, 200);
    } catch (e: unknown) {
        return json({ error: e instanceof Error ? e.message : "Internal server error" }, 500);
    }
});
