import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendNotification } from 'npm:web-push-neo@0.1.2';
import { resolveCorsOrigin } from '../_shared/cors.js';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const subject = Deno.env.get('VAPID_SUBJECT') ?? '';

Deno.serve(async request => {
  const origin = resolveCorsOrigin(request.headers.get('origin'), (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()));
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  if (!url || !anon || !service || !publicKey || !privateKey || !subject) return reply(503, { error: 'Web Push is not configured' });
  const admin = createClient(url, service);
  const jwt = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return reply(401, { error: 'Authentication required' });
  const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser(jwt);
  if (authError || !user) return reply(401, { error: 'Invalid session' });
  const { data: actor } = await admin.from('profiles').select('id,role,school_id,is_active,deleted_at').eq('id', user.id).single();
  if (!actor?.is_active || actor.deleted_at) return reply(403, { error: 'Account inactive' });

  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return reply(400, { error: 'Invalid JSON' }); }

  if (input.action === 'subscribe') {
    const subscription = input.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
    if (!subscription?.endpoint?.startsWith('https://') || !subscription.keys?.p256dh || !subscription.keys.auth
      || subscription.endpoint.length > 2048 || subscription.keys.p256dh.length > 256 || subscription.keys.auth.length > 256) return reply(400, { error: 'Invalid push subscription' });
    let endpoint: URL;
    try { endpoint = new URL(subscription.endpoint); } catch { return reply(400, { error: 'Invalid push endpoint' }); }
    if (endpoint.username || endpoint.password || endpoint.port || /^[\d.]+$/.test(endpoint.hostname)
      || endpoint.hostname.includes(':') || /(^localhost$|\.(local|localhost|internal)$)/i.test(endpoint.hostname)) return reply(400, { error: 'Invalid push endpoint' });
    const { error } = await admin.from('announcement_push_subscriptions').upsert({ endpoint: subscription.endpoint, user_id: user.id, p256dh: subscription.keys.p256dh, auth_key: subscription.keys.auth });
    return error ? reply(500, { error: 'Could not save subscription' }) : reply(200, { ok: true });
  }
  if (input.action === 'unsubscribe') {
    if (typeof input.endpoint !== 'string') return reply(400, { error: 'Endpoint required' });
    await admin.from('announcement_push_subscriptions').delete().eq('endpoint', input.endpoint).eq('user_id', user.id);
    return reply(200, { ok: true });
  }
  if (input.action !== 'deliver' || typeof input.announcementId !== 'string') return reply(400, { error: 'Invalid action' });
  const { data: announcement } = await admin.from('announcements').select('id,school_id,created_by,status,deleted_at,published_at,expires_at').eq('id', input.announcementId).single();
  if (!announcement || announcement.deleted_at || announcement.status !== 'published' || !announcement.published_at
    || new Date(announcement.published_at) > new Date() || announcement.expires_at && new Date(announcement.expires_at) <= new Date()) return reply(404, { error: 'Announcement unavailable' });
  const { data: extraRoles } = await admin.from('user_roles').select('role').eq('user_id', user.id);
  const roles = new Set([actor.role, ...(extraRoles ?? []).map(row => row.role)]);
  if (announcement.created_by !== user.id && !roles.has('superadmin') && !(roles.has('admin') && actor.school_id === announcement.school_id)) return reply(403, { error: 'Not allowed to deliver this announcement' });

  let sent = 0;
  // ponytail: process 2,500 recipients per request; move to a queue worker if a global audience exceeds that ceiling.
  for (let page = 0; page < 10; page++) {
    const { data: notices, error } = await admin.from('notifications').select('id,user_id,title,message')
      .eq('announcement_id', announcement.id).is('push_sent_at', null).is('deleted_at', null).limit(250);
    if (error) return reply(500, { error: 'Could not read deliveries' });
    if (!notices?.length) return reply(200, { ok: true, sent, remaining: false });
    const userIds = [...new Set(notices.map(n => n.user_id).filter(Boolean))];
    const { data: subscriptions } = await admin.from('announcement_push_subscriptions').select('endpoint,user_id,p256dh,auth_key').in('user_id', userIds);
    const byUser = new Map<string, typeof subscriptions>();
    for (const sub of subscriptions ?? []) byUser.set(sub.user_id, [...(byUser.get(sub.user_id) ?? []), sub]);
    let failed = false;
    for (let offset = 0; offset < notices.length; offset += 10) await Promise.all(notices.slice(offset, offset + 10).map(async notice => {
      const targets = byUser.get(notice.user_id) ?? [];
      const results = await Promise.all(targets.map(async sub => {
        try {
          await sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
            JSON.stringify({ title: notice.title, body: notice.message, tag: `announcement-${announcement.id}` }),
            { vapidDetails: { subject, publicKey, privateKey }, TTL: 3600, signal: AbortSignal.timeout(10000) });
          return true;
        } catch (failure) {
          const status = (failure as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await admin.from('announcement_push_subscriptions').delete().eq('endpoint', sub.endpoint);
            return true;
          }
          console.error('Announcement push failed', status ?? 'unknown');
          return false;
        }
      }));
      if (results.every(Boolean)) {
        await admin.from('notifications').update({ push_sent_at: new Date().toISOString() }).eq('id', notice.id);
        sent += targets.length;
      } else failed = true;
    }));
    if (failed) return reply(502, { error: 'Some push services were temporarily unavailable', sent });
    if (notices.length < 250) return reply(200, { ok: true, sent, remaining: false });
  }
  return reply(200, { ok: true, sent, remaining: true });
});
