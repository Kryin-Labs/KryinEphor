// ════════════════════════════════════════════════════════════════════
// create_school_with_admin — atomic school + admin provisioning
// ────────────────────────────────────────────────────────────────────
// Replaces the previous two-step client flow:
//     supabase.from('schools').insert(...)  →  create_tenant_admin
// which could leave an orphan school row if admin creation failed
// before the client-side compensating delete fired.
//
// Authorization: caller must be superadmin.
// On any failure after the school is inserted, the school row is hard-
// deleted to keep the workspace clean (no orphan tenants).
// ════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { resolveCorsOrigin } from "../_shared/cors.js";

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

const json = (req: Request, body: Record<string, unknown>, status = 200, correlationId?: string) => {
    const cid = correlationId ?? crypto.randomUUID();
    return new Response(JSON.stringify({ ...body, correlation_id: cid }), {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json', 'X-Correlation-Id': cid },
        status,
    });
};

const ALLOWED_TIERS = new Set(['starter', 'pro', 'enterprise']);
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const RESERVED_SUBDOMAINS = new Set([
    'www', 'api', 'admin', 'app', 'auth', 'mail', 'staging', 'dev', 'test',
    'supabase', 'lovable', 'kryinedu', 'root', 'system',
]);

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return json(req, { error: 'Missing authorization header' }, 401);

        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        if (!supabaseUrl || !anonKey || !serviceRoleKey) {
            return json(req, { error: 'Server misconfiguration: missing environment variables' }, 500);
        }

        // 1. Validate caller
        const callerClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
        });
        const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
        if (callerErr || !caller) return json(req, { error: 'Invalid or expired token' }, 401);

        const admin = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });

        const { data: callerProfile } = await admin
            .from('profiles').select('role').eq('id', caller.id).single();

        if (!callerProfile || callerProfile.role !== 'superadmin') {
            return json(req, { error: 'Forbidden: superadmin access required' }, 403);
        }

        // 2. Parse + validate body
        let payload: Record<string, unknown>;
        try { payload = await req.json(); } catch { return json(req, { error: 'Invalid JSON payload' }, 400); }

        const name = (payload.name as string | undefined)?.trim();
        const rawSubdomain = (payload.subdomain as string | undefined)?.trim().toLowerCase();
        const emailDomain = (payload.email_domain as string | undefined)?.trim().toLowerCase().replace(/^@/, '');
        const tier = String((payload.tier as string | undefined) ?? 'starter').toLowerCase();
        const adminEmail = (payload.adminEmail as string | undefined)?.trim().toLowerCase();
        const adminPassword = payload.adminPassword as string | undefined;
        const adminFullName = (payload.adminFullName as string | undefined)?.trim();
        const combinedParentStudentAccount = payload.combinedParentStudentAccount !== false;

        // Auto-generate subdomain slug from name if not provided (URL slug — kept for legacy).
        const subdomain = rawSubdomain || (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);

        if (!name) return json(req, { error: 'name is required' }, 400);
        if (!subdomain || !SUBDOMAIN_RE.test(subdomain)) {
            return json(req, { error: 'could not derive a valid subdomain slug from school name' }, 400);
        }
        if (RESERVED_SUBDOMAINS.has(subdomain)) {
            return json(req, { error: `subdomain "${subdomain}" is reserved` }, 400);
        }
        if (!emailDomain || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(emailDomain)) {
            return json(req, { error: 'email_domain is required and must be a valid domain (e.g. school.com)' }, 400);
        }
        if (!adminEmail || !adminPassword || !adminFullName) {
            return json(req, { error: 'adminEmail, adminPassword, and adminFullName are required' }, 400);
        }
        if (!adminEmail.endsWith('@' + emailDomain)) {
            return json(req, { error: `adminEmail must end with @${emailDomain}` }, 400);
        }
        if (adminPassword.length < 6) return json(req, { error: 'Password must be at least 6 characters' }, 400);
        if (!ALLOWED_TIERS.has(tier)) {
            return json(req, { error: `Invalid tier '${tier}'` }, 400);
        }

        const { data: existingSchool } = await admin
            .from('schools').select('id').eq('subdomain', subdomain).maybeSingle();
        if (existingSchool) return json(req, { error: `subdomain "${subdomain}" already in use` }, 409);

        // 3. Insert school
        const { data: school, error: schoolErr } = await admin
            .from('schools')
            .insert([{ name, subdomain, email_domain: emailDomain, subscription_tier: tier, status: 'active', combined_parent_student_account: combinedParentStudentAccount, created_by: caller.id }])
            .select()
            .single();
        if (schoolErr || !school) return json(req, { error: `School creation failed: ${schoolErr?.message}` }, 400);

        // 4. Create admin auth user
        const { data: userData, error: userErr } = await admin.auth.admin.createUser({
            email: adminEmail,
            password: adminPassword,
            email_confirm: true,
            app_metadata: { role: 'admin', school_id: school.id },
            // The auth trigger reads metadata during the INSERT. Keep the trusted
            // app_metadata and also mirror role/school_id into user_metadata so
            // older GoTrue trigger timing never sees a role-less NEW row.
            user_metadata: { full_name: adminFullName, role: 'admin', school_id: school.id },
        });
        if (userErr || !userData?.user) {
            await admin.from('schools').delete().eq('id', school.id);
            return json(req, { error: `Admin creation failed: ${userErr?.message}. School rolled back.` }, 400);
        }

        // 5. Upsert profile
        const { error: profileErr } = await admin.from('profiles').upsert({
            id: userData.user.id,
            email: adminEmail,
            login_id: adminEmail,
            full_name: adminFullName,
            role: 'admin',
            school_id: school.id,
            is_active: true,
        }, { onConflict: 'id' });
        if (profileErr) {
            await admin.auth.admin.deleteUser(userData.user.id);
            await admin.from('schools').delete().eq('id', school.id);
            return json(req, { error: `Profile creation failed: ${profileErr.message}. Rolled back.` }, 400);
        }

        // 6. Create membership (fatal — admin must have a membership row)
        const { data: systemRole } = await admin
            .from('roles').select('id').eq('name', 'admin').eq('is_system', true).single();

        const { error: membershipErr } = await admin.from('memberships').upsert({
            user_id: userData.user.id,
            school_id: school.id,
            role_id: systemRole?.id ?? null,
            status: 'active',
        }, { onConflict: 'user_id,school_id' });

        if (membershipErr) {
            await admin.auth.admin.deleteUser(userData.user.id);
            await admin.from('schools').delete().eq('id', school.id);
            return json(req, { error: `Membership creation failed: ${membershipErr.message}. Rolled back.` }, 400);
        }

        return json(req, {
            success: true,
            school: { id: school.id, name: school.name, subdomain: school.subdomain },
            admin: { id: userData.user.id, email: adminEmail },
        }, 200);
    } catch (e: unknown) {
        return json(req, { error: e instanceof Error ? e.message : 'Internal server error' }, 500);
    }
});
