// Daily cron: generates upcoming invoices for every active student fee
// assignment based on plan frequency, and applies late fees for overdue ones.
// Idempotent — safe to run repeatedly.
//
// AUTH: caller must be authenticated AND either
//   (a) present a valid CRON_SECRET header (for scheduled runs), or
//   (b) be a superadmin (processes all schools), or
//   (c) be an admin/accountant (processes only their own school).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

interface Assignment {
  id: string;
  school_id: string;
  student_id: string;
  start_date: string;
  end_date: string | null;
  plan_id: string;
  fee_plans: {
    id: string;
    frequency: 'monthly' | 'quarterly' | 'annual' | 'one_time';
    is_active: boolean;
  } | null;
}

function periodsForToday(freq: string, start: string): { s: string; e: string; label: string } | null {
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

  if (freq === 'monthly') {
    const s = new Date(Date.UTC(y, m, 1));
    const e = new Date(Date.UTC(y, m + 1, 0));
    return { s: iso(s), e: iso(e), label: `${s.toLocaleString('en-US', { month: 'short' })} ${y}` };
  }
  if (freq === 'quarterly') {
    const q = Math.floor(m / 3);
    const s = new Date(Date.UTC(y, q * 3, 1));
    const e = new Date(Date.UTC(y, q * 3 + 3, 0));
    return { s: iso(s), e: iso(e), label: `Q${q + 1} ${y}` };
  }
  if (freq === 'annual') {
    const s = new Date(Date.UTC(y, 0, 1));
    const e = new Date(Date.UTC(y, 11, 31));
    return { s: iso(s), e: iso(e), label: `${y}` };
  }
  if (freq === 'one_time') {
    return { s: start, e: start, label: `One-time ${start}` };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  const cronSecret = Deno.env.get('CRON_SECRET');
  const providedSecret = req.headers.get('x-cron-secret');
  const isCronCall = !!(cronSecret && providedSecret && providedSecret === cronSecret);

  let callerRole: string | null = null;
  let callerSchoolId: string | null = null;

  if (!isCronCall) {
    // Authenticate the caller via JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401);
    }
    const authed = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsErr } = await authed.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return json({ error: 'Unauthorized' }, 401);
    }
    const userId = claimsData.claims.sub as string;

    const { data: profile, error: profileErr } = await authed
      .from('profiles')
      .select('role, school_id, is_active')
      .eq('id', userId)
      .maybeSingle();
    if (profileErr || !profile || profile.is_active === false) {
      return json({ error: 'Forbidden' }, 403);
    }
    const allowed = ['admin', 'accountant', 'superadmin'];
    if (!allowed.includes(profile.role)) {
      return json({ error: 'Forbidden: insufficient role' }, 403);
    }
    callerRole = profile.role as string;
    callerSchoolId = (profile.school_id as string | null) ?? null;
    if (callerRole !== 'superadmin' && !callerSchoolId) {
      return json({ error: 'Forbidden: no school context' }, 403);
    }
  }

  // From here on we use service-role for DB writes because the RPCs need to
  // set billing state uniformly.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let assignmentsQuery = supabase
    .from('student_fee_assignments')
    .select('id, school_id, student_id, start_date, end_date, plan_id, fee_plans(id, frequency, is_active)')
    .eq('is_active', true);

  // Scope to caller's school unless cron or superadmin
  if (!isCronCall && callerRole !== 'superadmin' && callerSchoolId) {
    assignmentsQuery = assignmentsQuery.eq('school_id', callerSchoolId);
  }

  const { data: assignments, error } = await assignmentsQuery.returns<Assignment[]>();

  if (error) {
    return json({ error: error.message }, 500);
  }

  let generated = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const a of assignments ?? []) {
    if (!a.fee_plans?.is_active) continue;
    if (a.end_date && a.end_date < today) continue;
    const period = periodsForToday(a.fee_plans.frequency, a.start_date);
    if (!period) continue;

    const { data: invId, error: fnErr } = await supabase.rpc('fn_generate_school_invoice', {
      p_assignment: a.id,
      p_period_start: period.s,
      p_period_end: period.e,
      p_period_label: period.label,
    });
    if (!fnErr && invId) generated++;
  }

  // Late-fee sweep — only during cron or superadmin runs (platform-wide op).
  let lateFeesApplied: number | null = null;
  if (isCronCall || callerRole === 'superadmin') {
    const { data: lateCount } = await supabase.rpc('fn_apply_late_fees');
    lateFeesApplied = (lateCount as number | null) ?? 0;
  }

  return json({
    generated,
    late_fees_applied: lateFeesApplied,
    scoped_to_school: !isCronCall && callerRole !== 'superadmin' ? callerSchoolId : null,
    ran_at: new Date().toISOString(),
  });
});
