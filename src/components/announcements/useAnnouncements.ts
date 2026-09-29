import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export interface Announcement {
  id: string;
  school_id: string | null;
  created_by: string | null;
  title: string;
  body: string;
  accent: string;
  audience: 'everyone' | 'roles' | 'classes' | 'users';
  role_targets: string[];
  class_targets: string[];
  user_targets: string[];
  status: 'draft' | 'published';
  published_at: string | null;
  expires_at: string | null;
  updated_at: string;
}

export function useAnnouncements(userId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['announcements', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from('announcements').select('*')
        .is('deleted_at', null).order('updated_at', { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as Announcement[];
    },
  });
  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel(`announcements:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' },
        () => qc.invalidateQueries({ queryKey: ['announcements', userId] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, userId]);
  return query;
}

export function announcementDate(value: string | null) {
  if (!value) return 'Not published';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
