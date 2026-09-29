// ════════════════════════════════════════════════════════════════════
// update_school — privileged mutation of a school tenant row
// ────────────────────────────────────────────────────────────────────
// Replaces direct client `supabase.from('schools').update()` calls.
// Authorization: caller must be superadmin.
// Field allowlist: name, subdomain, subscription_tier, status,
//                  max_students, address, phone.
// Side-effects: writes an audit row to migration_audit (action =
// 'update_school') capturing the diff between old and new values.
// ════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const getCorsHeaders = (req: Request) => {
    const origin = req.headers.get('Origin') ?? '';
    const configured = (Deno.env.get('ALLOWED_ORIGINS') ?? Deno.env.get('ALLOWED_ORIGIN') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const allowedOrigins = new Set(['https://kryinedu.lovable.app', ...configured]);
    const allowOrigin = allowedOrigins.has(origin) || /^https:\/\/[a-z0-9-]+\.(lovable\.app|lovableproject\.com|sandbox\.lovable\.dev)$/i.test(origin)
        ? origin
        : 'https://kryinedu.lovable.app';
    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
};

const ALLOWED_TIERS = new Set(['starter', 'pro', 'enterprise']);
const ALLOWED_STATUS = new Set(['active', 'inactive', 'suspended', 'trial']);
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const RESERVED_SUBDOMAINS = new Set([
    'www', 'api', 'admin', 'app', 'auth', 'mail', 'staging', 'dev', 'test',
    'supabase', 'lovable', 'kryinedu', 'root', 'system',
]);

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
            .from('profiles').select('role').eq('id', caller.id).single();
        if (!callerProfile || callerProfile.role !== 'superadmin') {
            return json({ error: 'Forbidden: superadmin access required' }, 403);
        }

        let payload: Record<string, unknown>;
        try { payload = await req.json(); } catch { return json({ error: 'Invalid JSON payload' }, 400); }

        const schoolId = payload.schoolId as string | undefined;
        if (!schoolId || typeof schoolId !== 'string') {
            return json({ error: 'schoolId is required' }, 400);
        }

        // ── Field allowlist + per-field validation ──────────────────
        const updates: Record<string, unknown> = {};

        if (payload.name !== undefined) {
            const v = String(payload.name).trim();
            if (v.length < 2 || v.length > 200) {
                return json({ error: 'name must be 2-200 characters' }, 400);
            }
            updates.name = v;
        }

        if (payload.subdomain !== undefined) {
            const v = String(payload.subdomain).trim().toLowerCase();
            if (!SUBDOMAIN_RE.test(v)) {
                return json({ error: 'subdomain must be lowercase alphanumeric/hyphen, 1-32 chars' }, 400);
            }
            if (RESERVED_SUBDOMAINS.has(v)) {
                return json({ error: `subdomain "${v}" is reserved` }, 400);
            }
            // collision check (exclude self)
            const { data: collision } = await admin
                .from('schools').select('id').eq('subdomain', v).neq('id', schoolId).maybeSingle();
            if (collision) return json({ error: `subdomain "${v}" already in use` }, 409);
            updates.subdomain = v;
        }

        if (payload.subscription_tier !== undefined) {
            const v = String(payload.subscription_tier).toLowerCase();
            if (!ALLOWED_TIERS.has(v)) {
                return json({ error: `subscription_tier must be one of: ${[...ALLOWED_TIERS].join(', ')}` }, 400);
            }
            updates.subscription_tier = v;
        }

        if (payload.status !== undefined) {
            const v = String(payload.status).toLowerCase();
            if (!ALLOWED_STATUS.has(v)) {
                return json({ error: `status must be one of: ${[...ALLOWED_STATUS].join(', ')}` }, 400);
            }
            updates.status = v;
        }

        if (payload.max_students !== undefined) {
            const n = Number(payload.max_students);
            if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
                return json({ error: 'max_students must be an integer between 1 and 1,000,000' }, 400);
            }
            updates.max_students = n;
        }

        if (payload.address !== undefined) {
            const v = payload.address === null ? null : String(payload.address).trim().slice(0, 500);
            updates.address = v;
        }

        if (payload.phone !== undefined) {
            const v = payload.phone === null ? null : String(payload.phone).trim().slice(0, 50);
            updates.phone = v;
        }

        if (payload.email_domain !== undefined && payload.email_domain !== null && payload.email_domain !== '') {
            const v = String(payload.email_domain).trim().toLowerCase().replace(/^@/, '');
            if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v)) {
                return json({ error: 'email_domain must be a valid domain (e.g. school.com)' }, 400);
            }
            updates.email_domain = v;
        }

        if (Object.keys(updates).length === 0) {
            return json({ error: 'No allowed fields supplied for update' }, 400);
        }

        // ── Fetch pre-image for audit ───────────────────────────────
        const { data: before, error: beforeErr } = await admin
            .from('schools')
            .select('id, name, subdomain, subscription_tier, status, max_students, address, phone')
            .eq('id', schoolId)
            .single();
        if (beforeErr || !before) return json({ error: 'School not found' }, 404);

        updates.updated_by = caller.id;
        updates.updated_at = new Date().toISOString();

        const { data: after, error: updErr } = await admin
            .from('schools')
            .update(updates)
            .eq('id', schoolId)
            .select('id, name, subdomain, subscription_tier, status, max_students, address, phone')
            .single();
        if (updErr) return json({ error: `Update failed: ${updErr.message}` }, 400);

        // ── Audit (best-effort; do not fail the request on audit error) ──
        try {
            await admin.from('migration_audit').insert({
                migration_name: 'edge:update_school',
                action: 'update_school',
                target_table: 'schools',
                target_id: schoolId,
                payload: { caller: caller.id, before, after, changed: Object.keys(updates) },
            });
        } catch { /* audit table may not exist yet pre-Phase4A */ }

        return json({ success: true, school: after }, 200);
    } catch (e: unknown) {
        return json({ error: e instanceof Error ? e.message : 'Internal server error' }, 500);
    }
});

