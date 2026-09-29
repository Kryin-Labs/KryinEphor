-- Announcements keep audiences in the database so a URL or client filter cannot expose a notice.
CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 180),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 30000),
  accent text NOT NULL DEFAULT '#0f766e' CHECK (accent ~ '^#[0-9A-Fa-f]{6}$'),
  audience text NOT NULL CHECK (audience IN ('everyone','roles','classes','users')),
  role_targets text[] NOT NULL DEFAULT '{}',
  class_targets uuid[] NOT NULL DEFAULT '{}',
  user_targets uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (status <> 'published' OR audience <> 'roles' OR cardinality(role_targets) > 0),
  CHECK (status <> 'published' OR audience <> 'classes' OR cardinality(class_targets) > 0),
  CHECK (status <> 'published' OR audience <> 'users' OR cardinality(user_targets) > 0),
  CHECK (status <> 'published' OR length(btrim(body)) > 0),
  CHECK (role_targets <@ ARRAY['superadmin','admin','teacher','student','parent','receptionist','accountant']::text[]),
  CHECK (expires_at IS NULL OR published_at IS NULL OR expires_at > published_at)
);
CREATE INDEX announcements_feed_idx ON public.announcements (school_id, published_at DESC) WHERE status = 'published' AND deleted_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON public.announcements TO authenticated;
GRANT ALL ON public.announcements TO service_role;
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- This function is also used by the notification fan-out. Its caller cannot choose a broader audience.
CREATE FUNCTION public.announcement_is_recipient(_id uuid, _user uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.announcements a
    JOIN public.profiles p ON p.id = _user AND p.is_active IS TRUE AND p.deleted_at IS NULL
    WHERE a.id = _id AND a.status = 'published' AND a.deleted_at IS NULL
      AND a.published_at <= now() AND (a.expires_at IS NULL OR a.expires_at > now())
      AND (a.school_id IS NULL OR a.school_id = p.school_id)
      AND CASE a.audience
        WHEN 'everyone' THEN true
        WHEN 'roles' THEN EXISTS (
          SELECT 1 FROM unnest(a.role_targets) AS target(role)
          WHERE public.has_role(p.id, target.role))
        WHEN 'classes' THEN EXISTS (
          SELECT 1 FROM public.class_enrollments ce WHERE ce.student_id = p.id
            AND ce.class_id = ANY(a.class_targets) AND ce.deleted_at IS NULL)
        WHEN 'users' THEN p.id = ANY(a.user_targets)
        ELSE false END
  );
$$;
REVOKE ALL ON FUNCTION public.announcement_is_recipient(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.announcement_is_recipient(uuid,uuid) TO authenticated, service_role;

CREATE FUNCTION public.announcement_validate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE actor_school uuid;
BEGIN
  -- A profile hard delete may null the author via its foreign key; preserve the notice.
  IF TG_OP = 'UPDATE' AND NEW.created_by IS NULL AND OLD.created_by IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.created_by) THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  SELECT school_id INTO actor_school FROM public.profiles
    WHERE id = auth.uid() AND is_active IS TRUE AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active account required'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.school_id IS DISTINCT FROM OLD.school_id) THEN
    RAISE EXCEPTION 'Author and school cannot be changed';
  END IF;
  IF NOT public.has_role(auth.uid(), 'superadmin') THEN
    IF NEW.school_id IS NULL OR NEW.school_id IS DISTINCT FROM actor_school THEN
      RAISE EXCEPTION 'Announcements must stay in your school';
    END IF;
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      IF NOT public.has_role(auth.uid(), 'teacher') OR NEW.created_by <> auth.uid()
        OR NEW.audience <> 'classes' THEN
        RAISE EXCEPTION 'Only school admins may publish to this audience';
      END IF;
      IF EXISTS (SELECT 1 FROM unnest(NEW.class_targets) AS target(class_id)
        WHERE NOT EXISTS (SELECT 1 FROM public.classes c WHERE c.id = target.class_id
          AND c.school_id = NEW.school_id AND c.teacher_id = auth.uid() AND c.deleted_at IS NULL)) THEN
        RAISE EXCEPTION 'Teachers may select only their assigned classes';
      END IF;
    END IF;
  END IF;
  IF NEW.school_id IS NULL AND NEW.audience IN ('classes','users') THEN
    RAISE EXCEPTION 'Global announcements can target everyone or roles';
  END IF;
  IF NEW.audience = 'classes' AND EXISTS (SELECT 1 FROM unnest(NEW.class_targets) AS target(class_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.classes c WHERE c.id = target.class_id AND c.school_id = NEW.school_id AND c.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'Class outside announcement school';
  END IF;
  IF NEW.audience = 'users' AND EXISTS (SELECT 1 FROM unnest(NEW.user_targets) AS target(user_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = target.user_id AND p.school_id = NEW.school_id AND p.is_active IS TRUE AND p.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'Recipient outside announcement school';
  END IF;
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.published_at := CASE WHEN NEW.status = 'published' THEN now() ELSE NULL END;
  ELSIF NEW.status = 'draft' THEN
    NEW.created_at := OLD.created_at;
    NEW.published_at := NULL;
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.published_at := CASE WHEN OLD.status = 'published' THEN OLD.published_at ELSE now() END;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER announcement_validate BEFORE INSERT OR UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.announcement_validate();

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY announcements_read ON public.announcements FOR SELECT TO authenticated USING (deleted_at IS NULL AND (
  public.has_role(auth.uid(),'superadmin') OR created_by = auth.uid()
  OR (school_id = public.get_auth_school_id() AND public.has_role(auth.uid(),'admin'))
  OR public.announcement_is_recipient(id, auth.uid())
));
CREATE POLICY announcements_insert ON public.announcements FOR INSERT TO authenticated WITH CHECK (
  created_by = auth.uid() AND (public.has_role(auth.uid(),'superadmin') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'teacher'))
);
CREATE POLICY announcements_update ON public.announcements FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'superadmin') OR (school_id = public.get_auth_school_id() AND public.has_role(auth.uid(),'admin')) OR created_by = auth.uid())
  WITH CHECK (public.has_role(auth.uid(),'superadmin') OR (school_id = public.get_auth_school_id() AND public.has_role(auth.uid(),'admin')) OR created_by = auth.uid());

ALTER TABLE public.notifications ADD COLUMN announcement_id uuid REFERENCES public.announcements(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD COLUMN push_sent_at timestamptz;
CREATE UNIQUE INDEX notifications_announcement_recipient_idx ON public.notifications(announcement_id,user_id) WHERE announcement_id IS NOT NULL;
CREATE POLICY notifications_announcement_live ON public.notifications AS RESTRICTIVE
  FOR SELECT TO authenticated USING (announcement_id IS NULL OR EXISTS (
    SELECT 1 FROM public.announcements a WHERE a.id = announcement_id
      AND a.status = 'published' AND a.deleted_at IS NULL
      AND a.published_at <= now() AND (a.expires_at IS NULL OR a.expires_at > now())
  ));

CREATE TABLE public.announcement_push_subscriptions (
  endpoint text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  p256dh text NOT NULL,
  auth_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX announcement_push_user_idx ON public.announcement_push_subscriptions(user_id);
ALTER TABLE public.announcement_push_subscriptions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.announcement_push_subscriptions TO service_role;
-- Subscriptions contain endpoint capabilities and are only accessed by the authenticated Edge Function.

CREATE FUNCTION public.announcement_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.status <> 'published' THEN
    UPDATE public.notifications SET deleted_at = now() WHERE announcement_id = NEW.id;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'published' AND OLD.title = NEW.title AND OLD.body = NEW.body
      AND OLD.audience = NEW.audience AND OLD.role_targets = NEW.role_targets
      AND OLD.class_targets = NEW.class_targets AND OLD.user_targets = NEW.user_targets
      AND OLD.expires_at IS NOT DISTINCT FROM NEW.expires_at THEN RETURN NEW; END IF;
  END IF;
  UPDATE public.notifications SET deleted_at = now() WHERE announcement_id = NEW.id;
  INSERT INTO public.notifications (school_id,user_id,title,message,type,channel,action_url,announcement_id,is_read)
    SELECT p.school_id, p.id, NEW.title, left(regexp_replace(NEW.body, '[#*`_>\[\]]', '', 'g'), 220),
      'info', 'in_app', '/announcements', NEW.id, false
    FROM public.profiles p WHERE public.announcement_is_recipient(NEW.id,p.id)
    ON CONFLICT (announcement_id,user_id) WHERE announcement_id IS NOT NULL DO UPDATE
      SET title = EXCLUDED.title, message = EXCLUDED.message, is_read = false, push_sent_at = NULL,
        deleted_at = NULL, created_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER announcement_notify AFTER INSERT OR UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.announcement_notify();

INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('announcement-images','announcement-images',false,5242880,ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO NOTHING;
-- ponytail: soft-deleted notices retain private files; add scheduled Storage API cleanup if image volume grows.
CREATE POLICY announcement_images_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'announcement-images' AND EXISTS (
    SELECT 1 FROM public.announcements a WHERE a.id::text = (storage.foldername(name))[1]
      AND a.deleted_at IS NULL AND (
        public.announcement_is_recipient(a.id,auth.uid()) OR a.created_by = auth.uid()
        OR public.has_role(auth.uid(),'superadmin')
        OR (a.school_id = public.get_auth_school_id() AND public.has_role(auth.uid(),'admin')))));
CREATE POLICY announcement_images_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'announcement-images' AND EXISTS
    (SELECT 1 FROM public.announcements a WHERE a.id::text = (storage.foldername(name))[1]
      AND a.deleted_at IS NULL AND (a.created_by = auth.uid()
        OR public.has_role(auth.uid(),'superadmin')
        OR (a.school_id = public.get_auth_school_id() AND public.has_role(auth.uid(),'admin')))));
