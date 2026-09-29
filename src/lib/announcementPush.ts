import { supabase } from './supabase';

const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export async function subscribeToAnnouncementPush() {
  if (!vapidKey || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const registration = await navigator.serviceWorker.register('/announcement-sw.js');
  const raw = atob(vapidKey.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  const { error } = await supabase.functions.invoke('announcement_push', { body: { action: 'subscribe', subscription: subscription.toJSON() } });
  if (error) throw error;
  return true;
}

export async function unsubscribeFromAnnouncementPush() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/announcement-sw.js');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await supabase.functions.invoke('announcement_push', { body: { action: 'unsubscribe', endpoint: subscription.endpoint } });
  await subscription.unsubscribe();
}
