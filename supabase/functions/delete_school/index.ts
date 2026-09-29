// ════════════════════════════════════════════════════════════════════
// delete_school — privileged soft-delete of a school tenant
// ────────────────────────────────────────────────────────────────────
// Authorization: caller must be superadmin.
// Behavior: soft-delete (deleted_at = now(), status='archived').
// Hard delete gated behind `hard=true`.
// ════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { resolveCorsOrigin } from "../_shared/cors.js";
import { SCHOOL_DELETION_STATUS } from "../_shared/schoolDeletion.js";

const getCorsHeaders = (req: Request) => {
    const origin = req.headers.get('Origin') ?? '';
    const configured = (Deno.env.get('ALLOWED_ORIGINS') ?? Deno.env.get('ALLOWED_ORIGIN') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const allowOrigin = resolveCorsOrigin(origin, configured);
    return {
        ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
};

Deno.serve(async (req: Request) => {
    const corsHeaders = getCorsHeaders(req);
    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status,
        });

    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        if (!supabaseUrl || !anonKey || !serviceRoleKey) {
            return json({ error: 'Server misconfiguration' }, 500);
        }

        const callerClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
        });
        const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
        if (callerErr || !caller) return json({ error: 'Invalid or expired token' }, 401);

        const admin = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });

        const { data: callerProfile } = await admin
            .from('profiles').select('role, is_active, deleted_at').eq('id', caller.id).single();
        if (!callerProfile || callerProfile.role !== 'superadmin') {
            return json({ error: 'Forbidden: superadmin access required' }, 403);
        }
        if (callerProfile.is_active === false || callerProfile.deleted_at) {
            return json({ error: 'Forbidden: caller account is inactive or deleted' }, 403);
        }

        let payload: Record<string, unknown>;
        try { payload = await req.json(); } catch { return json({ error: 'Invalid JSON payload' }, 400); }

        const schoolId = payload.schoolId as string | undefined;
        const hard = payload.hard === true;
        if (!schoolId) return json({ error: 'schoolId is required' }, 400);

        const { data: school } = await admin
            .from('schools').select('id, deleted_at').eq('id', schoolId).single();
        if (!school) return json({ error: 'School not found' }, 404);

        if (hard) {
            const { data: schoolUsers, error: usersErr } = await admin
                .from('profiles')
                .select('id')
                .eq('school_id', schoolId);
            if (usersErr) return json({ error: `Could not load school users: ${usersErr.message}` }, 400);

            for (const schoolUser of schoolUsers ?? []) {
                const { error: userDeleteErr } = await admin.auth.admin.deleteUser(schoolUser.id);
                if (userDeleteErr) {
                    return json({ error: `Hard delete stopped while deleting a school user: ${userDeleteErr.message}` }, 400);
                }
            }
            const { error: delErr } = await admin.from('schools').delete().eq('id', schoolId);
            if (delErr) return json({ error: `Hard delete failed: ${delErr.message}` }, 400);
            return json({ success: true, mode: 'hard', schoolId, deletedUsers: schoolUsers?.length ?? 0 }, 200);
        }

        const { error: updErr } = await admin
            .from('schools')
            .update({ deleted_at: new Date().toISOString(), status: SCHOOL_DELETION_STATUS, updated_by: caller.id })
            .eq('id', schoolId);
        if (updErr) return json({ error: `Soft delete failed: ${updErr.message}` }, 400);

        return json({ success: true, mode: 'soft', schoolId }, 200);
    } catch (e: unknown) {
        return json({ error: e instanceof Error ? e.message : 'Internal server error' }, 500);
    }
});
