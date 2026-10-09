import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { sendWebResponse, toWebRequest } from '../src/lib/mcp/http.js';
import { canonicalJson, service, sha256 } from '../src/lib/mcp/auth-server.js';
import { serverEnv } from '../src/lib/mcp/config.js';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

async function handle(request: Request) {
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!bearer) return reply({ error: 'Sign in to approve actions.' }, 401);
    const { data: identity, error: identityError } = await service().auth.getUser(bearer);
    if (identityError || !identity.user) return reply({ error: 'Session expired.' }, 401);
    const body = await request.json() as { id?: string; approve?: boolean; password?: string };
    if (typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)
        || typeof body.approve !== 'boolean') return reply({ error: 'Action and decision required.' }, 400);
    if (body.approve) {
        const { data: pending } = await service().from('mcp_action_requests').select('action')
            .eq('id', body.id).eq('actor_id', identity.user.id).eq('status', 'pending').maybeSingle();
        if (pending && ['admin_create_user', 'admin_reset_password'].includes(pending.action)
            && (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128)) {
            return reply({ error: 'Enter a password of 8 to 128 characters in KryinEphor.' }, 400);
        }
    }
    const key = serverEnv.VITE_SUPABASE_PUBLISHABLE_KEY ?? serverEnv.VITE_SUPABASE_ANON_KEY;
    if (!serverEnv.VITE_SUPABASE_URL || !key) throw new Error('Supabase credentials are missing.');
    const client = createClient(serverEnv.VITE_SUPABASE_URL, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data: claimed, error: claimError } = await client.rpc('mcp_claim_action', {
        p_action: body.id, p_approve: body.approve,
    });
    if (claimError || !claimed) {
        const db = service();
        const { data: denied } = await db.from('mcp_action_requests').select('school_id,action')
            .eq('id', body.id).eq('actor_id', identity.user.id).maybeSingle();
        if (denied) {
            const errorText = claimError?.message ?? 'Action unavailable.';
            const [audit, notice] = await Promise.all([
                db.from('activity_logs').insert({ school_id: denied.school_id, user_id: identity.user.id,
                    action: 'mcp_approval_denied', resource_type: 'mcp_action', resource_id: body.id,
                    metadata: { action: denied.action, error: errorText } }),
                db.from('notifications').insert({ school_id: denied.school_id, user_id: identity.user.id,
                    title: 'AI approval blocked', message: errorText, type: 'warning', action_url: '/ai-connections' }),
            ]);
            if (audit.error || notice.error) throw audit.error ?? notice.error;
        }
        return reply({ error: claimError?.message ?? 'Action unavailable.' }, 403);
    }
    const action = claimed as { id: string; action: string; payload: Record<string, unknown>;
        payload_hash: string; school_id: string };
    let status = body.approve ? 'completed' : 'denied';
    let result: unknown = { denied: true };
    let errorText: string | null = null;
    if (body.approve) {
        try {
            if (sha256(canonicalJson(action.payload)) !== action.payload_hash) throw new Error('Action payload changed.');
            const p = action.payload;
            let operation: { data: unknown; error: { message: string } | null };
            switch (action.action) {
                case 'admin_create_user':
                case 'admin_reset_password': {
                    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) {
                        throw new Error('Enter a password of 8 to 128 characters in KryinEphor.');
                    }
                    operation = await client.functions.invoke(action.action === 'admin_create_user' ? 'create_tenant_admin' : 'update_admin', {
                        body: action.action === 'admin_create_user'
                            ? { fullName: p.full_name, email: p.email, role: p.role, classId: p.class_id,
                                schoolId: action.school_id, password: body.password }
                            : { adminId: p.user_id, password: body.password },
                    });
                    break;
                }
                case 'admin_set_user_roles':
                    operation = await client.functions.invoke('update_admin', {
                        body: { adminId: p.user_id, role: p.role, additionalRoles: p.additional_roles },
                    });
                    break;
                case 'admin_set_user_active':
                    operation = await client.rpc('fn_admin_set_account_active', {
                        _school_id: action.school_id, _target_user_id: p.user_id,
                        _is_active: p.active, _reason: 'Approved AI connection action',
                    });
                    break;
                case 'admin_enroll_students':
                    operation = await client.rpc('fn_bulk_enroll_students', {
                        p_class: p.class_id, p_student_ids: p.student_ids,
                    });
                    break;
                case 'admin_record_fee_payment':
                    operation = await client.rpc('fn_record_fee_payment', {
                        p_invoice: p.invoice_id, p_amount: p.amount, p_method: p.method,
                        p_reference: p.reference ?? null, p_notes: p.notes ?? null,
                    });
                    break;
                case 'admin_publish_timetable':
                case 'teacher_publish_timetable':
                    operation = await client.rpc('timetable_publish_approved', { p_id: p.draft_id, p_expected: p.draft });
                    break;
                case 'teacher_save_timetable_draft':
                    operation = await client.rpc('timetable_save_draft', { p_data: p.draft });
                    break;
                case 'teacher_mark_attendance':
                    operation = await client.rpc('fn_mark_class_attendance', {
                        p_class: p.class_id, p_date: p.date, p_marks: p.marks,
                    });
                    break;
                case 'admin_publish_announcement':
                    operation = await client.from('announcements').insert({
                        school_id: action.school_id, created_by: identity.user.id,
                        title: p.title, body: p.message, audience: p.audience,
                        role_targets: p.audience === 'roles' ? p.role_targets : [],
                        class_targets: p.audience === 'classes' ? p.class_targets : [],
                        user_targets: p.audience === 'users' ? p.user_targets : [],
                        status: 'published',
                    }).select('id').single();
                    break;
                default: throw new Error('This action is no longer supported.');
            }
            if (operation.error) throw new Error(operation.error.message);
            if (operation.data && typeof operation.data === 'object' && 'error' in operation.data) {
                throw new Error(String(operation.data.error));
            }
            // Account endpoints may return auth records; never persist credentials or tokens in AI history.
            result = ['admin_create_user', 'admin_reset_password', 'admin_set_user_roles'].includes(action.action)
                ? { completed: true } : operation.data;
        } catch (error) {
            status = 'failed';
            errorText = error instanceof Error ? error.message : 'Action failed.';
            result = null;
        }
    }
    const db = service();
    const { error: updateError } = await db.from('mcp_action_requests').update({
        status, result, error_text: errorText, executed_at: new Date().toISOString(),
    }).eq('id', action.id).eq('status', body.approve ? 'running' : 'denied');
    if (updateError) throw updateError;
    const [activity, notice] = await Promise.all([
        db.from('activity_logs').insert({ school_id: action.school_id, user_id: identity.user.id,
            action: `mcp_action_${status}`, resource_type: 'mcp_action', resource_id: action.id,
            metadata: { action: action.action, error: errorText } }),
        db.from('notifications').insert({ school_id: action.school_id, user_id: identity.user.id,
            title: `AI action ${status}`, message: errorText ?? `${action.action} ${status}.`,
            type: status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'warning',
            action_url: '/ai-connections', metadata: { action_id: action.id } }),
    ]);
    if (activity.error || notice.error) throw activity.error ?? notice.error;
    return reply({ id: action.id, status, result, error: errorText }, status === 'failed' ? 422 : 200);
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
    try { await sendWebResponse(await handle(await toWebRequest(request)), response); }
    catch { await sendWebResponse(reply({ error: 'Action could not be processed.' }, 500), response); }
}
