-- Published weekly rows remain in timetable so teacher removal functions keep working.
ALTER TABLE public.schools ADD COLUMN time_zone text NOT NULL DEFAULT 'UTC';
CREATE FUNCTION public.timetable_validate_zone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=NEW.time_zone) THEN
    RAISE EXCEPTION 'Unknown school time zone';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER timetable_school_zone BEFORE INSERT OR UPDATE OF time_zone ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.timetable_validate_zone();
ALTER TABLE public.timetable ADD COLUMN academic_year_id uuid REFERENCES public.academic_years(id);
UPDATE public.timetable t SET academic_year_id = c.academic_year_id
FROM public.classes c WHERE c.id = t.class_id AND t.academic_year_id IS NULL;
ALTER TABLE public.timetable ADD COLUMN effective_start date;
ALTER TABLE public.timetable ADD COLUMN effective_end date;
ALTER TABLE public.timetable ADD CONSTRAINT timetable_valid_dates CHECK (effective_end IS NULL OR effective_start IS NULL OR effective_start <= effective_end);
ALTER TABLE public.timetable DROP CONSTRAINT IF EXISTS uq_timetable_slot;
CREATE INDEX timetable_class_day_idx ON public.timetable(class_id, day_of_week) WHERE deleted_at IS NULL;

CREATE TABLE public.timetable_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id),
  class_id uuid NOT NULL REFERENCES public.classes(id),
  base_id uuid REFERENCES public.timetable(id),
  academic_year_id uuid REFERENCES public.academic_years(id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  subject_id uuid NOT NULL REFERENCES public.subjects(id),
  teacher_id uuid REFERENCES public.profiles(id),
  room text,
  cancelled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date AND start_time < end_time)
);
CREATE INDEX timetable_exceptions_range_idx ON public.timetable_exceptions(class_id, start_date, end_date);

CREATE TABLE public.timetable_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id),
  class_id uuid NOT NULL REFERENCES public.classes(id),
  author_id uuid NOT NULL REFERENCES public.profiles(id),
  kind text NOT NULL CHECK (kind IN ('weekly','exception')),
  target_id uuid,
  base_id uuid REFERENCES public.timetable(id),
  academic_year_id uuid REFERENCES public.academic_years(id),
  start_date date,
  end_date date,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  subject_id uuid NOT NULL REFERENCES public.subjects(id),
  teacher_id uuid REFERENCES public.profiles(id),
  room text,
  cancelled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_time < end_time),
  CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date),
  CHECK (kind <> 'exception' OR (start_date IS NOT NULL AND end_date IS NOT NULL)),
  CHECK (NOT cancelled OR (kind = 'exception' AND (base_id IS NOT NULL OR target_id IS NOT NULL))
    OR (kind = 'weekly' AND target_id IS NOT NULL))
);
CREATE UNIQUE INDEX timetable_one_draft_per_target ON public.timetable_drafts(kind, target_id) WHERE target_id IS NOT NULL;

-- Readers see only their own classes. Staff can see schedules needed for their work.
CREATE FUNCTION public.timetable_can_view(_class uuid, _teacher uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(),'superadmin') OR EXISTS (
    SELECT 1 FROM public.classes c WHERE c.id = _class AND c.deleted_at IS NULL
      AND c.school_id = public.get_auth_school_id() AND (
        public.has_role(auth.uid(),'admin') OR
        (_teacher = auth.uid() AND public.has_role(auth.uid(),'teacher')
          AND public.fn_has_valid_staff_unlock(c.school_id)) OR
        EXISTS (SELECT 1 FROM public.class_enrollments ce WHERE ce.class_id = c.id
          AND ce.school_id=c.school_id AND ce.academic_year_id IS NOT DISTINCT FROM c.academic_year_id
          AND ce.deleted_at IS NULL AND public.fn_can_access_student(ce.student_id))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.timetable_can_view(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timetable_can_view(uuid,uuid) TO authenticated, service_role;

ALTER TABLE public.timetable_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON public.timetable;
DROP POLICY IF EXISTS tenant_insert ON public.timetable;
DROP POLICY IF EXISTS tenant_update ON public.timetable;
DROP POLICY IF EXISTS tenant_delete ON public.timetable;
CREATE POLICY timetable_read ON public.timetable FOR SELECT TO authenticated
USING (deleted_at IS NULL AND (school_id=public.get_auth_school_id() OR public.has_role(auth.uid(),'superadmin'))
  AND public.timetable_can_view(class_id, teacher_id));
CREATE POLICY timetable_exceptions_read ON public.timetable_exceptions FOR SELECT TO authenticated
USING ((school_id=public.get_auth_school_id() OR public.has_role(auth.uid(),'superadmin')) AND
  public.timetable_can_view(class_id, teacher_id));
CREATE POLICY timetable_drafts_read ON public.timetable_drafts FOR SELECT TO authenticated
USING (school_id = public.get_auth_school_id() AND
  (public.has_role(auth.uid(),'admin') OR (author_id = auth.uid()
    AND public.fn_has_valid_staff_unlock(school_id))));
REVOKE INSERT, UPDATE, DELETE ON public.timetable FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.timetable_exceptions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.timetable_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.timetable_exceptions, public.timetable_drafts TO authenticated;
GRANT ALL ON public.timetable_exceptions, public.timetable_drafts TO service_role;

CREATE FUNCTION public.timetable_clear_exception_teacher() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE school_today date;
BEGIN
  IF OLD.teacher_id IS NOT NULL AND NEW.teacher_id IS NULL THEN
    UPDATE public.timetable_exceptions SET teacher_id=NULL WHERE base_id=NEW.id AND teacher_id=OLD.teacher_id;
    IF current_setting('app.timetable_publishing',true) IS DISTINCT FROM 'on' THEN
      SELECT (now() AT TIME ZONE s.time_zone)::date INTO school_today FROM public.schools s WHERE s.id=NEW.school_id;
      IF EXISTS (SELECT 1 FROM generate_series(school_today,school_today+6,interval '1 day') day
        WHERE extract(dow FROM day)::integer=NEW.day_of_week
          AND (((NEW.effective_start IS NULL OR day::date>=NEW.effective_start)
            AND (NEW.effective_end IS NULL OR day::date<=NEW.effective_end))
            OR EXISTS (SELECT 1 FROM public.timetable_exceptions e WHERE e.base_id=NEW.id
              AND day::date BETWEEN e.start_date AND e.end_date))) THEN
        INSERT INTO public.notifications(school_id,user_id,title,message,type,action_url,channel)
        SELECT NEW.school_id,recipient.id,'Timetable changed',
          'A teacher assignment in your schedule for the next 7 days has changed.',
          'info','/timetable','in_app'
        FROM (
          SELECT ce.student_id AS id FROM public.class_enrollments ce
            WHERE ce.class_id=NEW.class_id AND ce.deleted_at IS NULL
          UNION SELECT ps.parent_id FROM public.parent_student ps
            JOIN public.class_enrollments ce ON ce.student_id=ps.student_id
            WHERE ce.class_id=NEW.class_id AND ce.deleted_at IS NULL AND ps.status='active'
              AND ps.school_id=NEW.school_id
          UNION SELECT OLD.teacher_id
        ) recipient JOIN public.profiles p ON p.id=recipient.id AND p.school_id=NEW.school_id
          AND p.is_active IS TRUE AND p.deleted_at IS NULL;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER timetable_teacher_removed AFTER UPDATE OF teacher_id ON public.timetable
  FOR EACH ROW EXECUTE FUNCTION public.timetable_clear_exception_teacher();

CREATE FUNCTION public.timetable_save_draft(p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.timetable_drafts%ROWTYPE; c public.classes%ROWTYPE; old_teacher uuid; result_id uuid;
BEGIN
  SELECT * INTO c FROM public.classes WHERE id = (p_data->>'class_id')::uuid AND deleted_at IS NULL;
  IF NOT FOUND OR c.school_id IS DISTINCT FROM public.get_auth_school_id() OR
    NOT (public.has_role(auth.uid(),'admin') OR
      (public.has_role(auth.uid(),'teacher') AND public.fn_has_valid_staff_unlock(c.school_id))) THEN
    RAISE EXCEPTION 'Class or permission not found';
  END IF;
  d.id := COALESCE((p_data->>'id')::uuid, gen_random_uuid());
  d.school_id := c.school_id; d.class_id := c.id; d.author_id := auth.uid();
  d.kind := p_data->>'kind'; d.target_id := (p_data->>'target_id')::uuid;
  d.base_id := (p_data->>'base_id')::uuid; d.academic_year_id := c.academic_year_id;
  d.start_date := (p_data->>'start_date')::date; d.end_date := (p_data->>'end_date')::date;
  d.day_of_week := (p_data->>'day_of_week')::integer;
  d.start_time := (p_data->>'start_time')::time; d.end_time := (p_data->>'end_time')::time;
  d.subject_id := (p_data->>'subject_id')::uuid; d.teacher_id := (p_data->>'teacher_id')::uuid;
  d.room := nullif(btrim(p_data->>'room'),''); d.cancelled := COALESCE((p_data->>'cancelled')::boolean,false);
  IF d.kind IS NULL OR d.kind NOT IN ('weekly','exception') OR
    d.day_of_week IS NULL OR d.day_of_week NOT BETWEEN 0 AND 6 OR
    d.start_time IS NULL OR d.end_time IS NULL OR d.start_time >= d.end_time OR
    (d.kind = 'exception' AND (d.start_date IS NULL OR d.end_date IS NULL)) OR
    (d.start_date IS NOT NULL AND d.end_date IS NOT NULL AND d.start_date > d.end_date) OR
    (d.start_date IS NOT NULL AND d.end_date IS NOT NULL AND d.end_date > d.start_date + 365) OR
    (d.cancelled AND NOT ((d.kind='exception' AND (d.base_id IS NOT NULL OR d.target_id IS NOT NULL)) OR
      (d.kind='weekly' AND d.target_id IS NOT NULL))) THEN
    RAISE EXCEPTION 'Invalid timetable dates or times';
  END IF;
  IF d.start_date IS NOT NULL AND d.end_date IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM generate_series(d.start_date,d.end_date,interval '1 day') day
      WHERE extract(dow FROM day)::integer=d.day_of_week) THEN
    RAISE EXCEPTION 'Selected dates do not include the chosen weekday';
  END IF;
  IF d.academic_year_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.academic_years y
    WHERE y.id = d.academic_year_id AND (d.start_date < y.start_date OR d.end_date > y.end_date)) THEN
    RAISE EXCEPTION 'Dates must be inside the academic year';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subjects s WHERE s.id = d.subject_id AND s.school_id = c.school_id AND s.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Subject is not in this school';
  END IF;
  IF NOT d.cancelled AND d.teacher_id IS NOT NULL AND (NOT public.has_role(d.teacher_id,'teacher') OR NOT EXISTS (SELECT 1 FROM public.subject_teachers st
    WHERE st.school_id = c.school_id AND st.class_id = c.id AND st.subject_id = d.subject_id
      AND st.teacher_id = d.teacher_id AND (st.academic_year_id IS NULL OR st.academic_year_id=c.academic_year_id))) THEN
    RAISE EXCEPTION 'Teacher must be assigned to this class and subject';
  END IF;
  IF d.target_id IS NOT NULL THEN
    IF d.kind = 'weekly' THEN
      SELECT teacher_id INTO old_teacher FROM public.timetable
        WHERE id = d.target_id AND class_id = c.id AND school_id = c.school_id AND deleted_at IS NULL;
    ELSE
      SELECT teacher_id INTO old_teacher FROM public.timetable_exceptions
        WHERE id = d.target_id AND class_id = c.id AND school_id = c.school_id;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'Published lesson not found'; END IF;
  END IF;
  IF d.base_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.timetable t
    WHERE t.id = d.base_id AND t.class_id = c.id AND t.school_id = c.school_id
      AND t.deleted_at IS NULL AND t.day_of_week = d.day_of_week) THEN
    RAISE EXCEPTION 'Base lesson not found';
  END IF;
  IF public.has_role(auth.uid(),'teacher') AND NOT public.has_role(auth.uid(),'admin') THEN
    IF d.teacher_id IS DISTINCT FROM auth.uid() OR
      (d.target_id IS NOT NULL AND old_teacher IS DISTINCT FROM auth.uid()) OR
      (d.base_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.timetable t
        WHERE t.id = d.base_id AND t.teacher_id = auth.uid())) THEN
      RAISE EXCEPTION 'Teachers may edit only their assigned lessons';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.timetable_drafts x WHERE x.id = d.id AND
      (x.class_id <> c.id OR (x.author_id <> auth.uid() AND NOT public.has_role(auth.uid(),'admin')))) THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;
  INSERT INTO public.timetable_drafts(id,school_id,class_id,author_id,kind,target_id,base_id,academic_year_id,
    start_date,end_date,day_of_week,start_time,end_time,subject_id,teacher_id,room,cancelled)
  VALUES (d.id,d.school_id,d.class_id,d.author_id,d.kind,d.target_id,d.base_id,d.academic_year_id,
    d.start_date,d.end_date,d.day_of_week,d.start_time,d.end_time,d.subject_id,d.teacher_id,d.room,d.cancelled)
  ON CONFLICT (id) DO UPDATE SET kind=EXCLUDED.kind,target_id=EXCLUDED.target_id,base_id=EXCLUDED.base_id,
    start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date,day_of_week=EXCLUDED.day_of_week,
    start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,subject_id=EXCLUDED.subject_id,
    teacher_id=EXCLUDED.teacher_id,room=EXCLUDED.room,cancelled=EXCLUDED.cancelled
  RETURNING id INTO result_id;
  RETURN result_id;
END;
$$;

-- Published occurrences, with an exception replacing its base on matching dates.
CREATE FUNCTION public.timetable_schedule(p_from date, p_to date, p_class uuid DEFAULT NULL)
RETURNS TABLE(id uuid, base_id uuid, class_id uuid, lesson_date date, day_of_week integer,
  start_time time, end_time time, subject_id uuid, teacher_id uuid, room text,
  subject_name text, teacher_name text, class_name text, source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH days AS (SELECT d::date AS lesson_date FROM generate_series(p_from,least(p_to,p_from+365),interval '1 day') d
    WHERE p_to >= p_from AND p_to <= p_from + 365),
  weekly AS (
    SELECT t.id, t.id AS base_id, t.class_id, d.lesson_date, t.day_of_week,
      t.start_time,t.end_time,t.subject_id,t.teacher_id,t.room,'weekly'::text AS source
    FROM days d JOIN public.timetable t ON t.day_of_week = extract(dow FROM d.lesson_date)::integer
      AND t.deleted_at IS NULL AND (t.effective_start IS NULL OR t.effective_start <= d.lesson_date)
      AND (t.effective_end IS NULL OR t.effective_end >= d.lesson_date)
    JOIN public.classes c ON c.id=t.class_id AND c.school_id=t.school_id AND c.deleted_at IS NULL
    LEFT JOIN public.academic_years y ON y.id = c.academic_year_id
    LEFT JOIN public.academic_years ty ON ty.id = t.academic_year_id
    WHERE (y.id IS NULL OR d.lesson_date BETWEEN y.start_date AND y.end_date)
      AND (ty.id IS NULL OR d.lesson_date BETWEEN ty.start_date AND ty.end_date)
      AND (t.academic_year_id IS NULL OR t.academic_year_id=c.academic_year_id)
      AND (p_class IS NULL OR t.class_id=p_class)
      AND NOT EXISTS (SELECT 1 FROM public.timetable_exceptions e WHERE e.base_id=t.id
        AND e.day_of_week=t.day_of_week AND d.lesson_date BETWEEN e.start_date AND e.end_date)
  ), exceptions AS (
    SELECT e.id,e.base_id,e.class_id,d.lesson_date,e.day_of_week,e.start_time,e.end_time,
      e.subject_id,e.teacher_id,e.room,'exception'::text AS source
    FROM days d JOIN public.timetable_exceptions e
      ON e.day_of_week=extract(dow FROM d.lesson_date)::integer
      AND d.lesson_date BETWEEN e.start_date AND e.end_date AND NOT e.cancelled
    JOIN public.classes c ON c.id=e.class_id AND c.school_id=e.school_id AND c.deleted_at IS NULL
    LEFT JOIN public.academic_years y ON y.id=c.academic_year_id
    LEFT JOIN public.academic_years ey ON ey.id=e.academic_year_id
    WHERE (y.id IS NULL OR d.lesson_date BETWEEN y.start_date AND y.end_date)
      AND (ey.id IS NULL OR d.lesson_date BETWEEN ey.start_date AND ey.end_date)
      AND (e.academic_year_id IS NULL OR e.academic_year_id=c.academic_year_id)
      AND (p_class IS NULL OR e.class_id=p_class)
  ), combined AS (SELECT * FROM weekly UNION ALL SELECT * FROM exceptions)
  SELECT x.id,x.base_id,x.class_id,x.lesson_date,x.day_of_week,x.start_time,x.end_time,
    x.subject_id,x.teacher_id,x.room::text,s.name::text,p.full_name::text,c.name::text,x.source
  FROM combined x JOIN public.classes c ON c.id=x.class_id
  JOIN public.subjects s ON s.id=x.subject_id AND s.school_id=c.school_id
  LEFT JOIN public.profiles p ON p.id=x.teacher_id AND p.school_id=c.school_id
  WHERE public.timetable_can_view(x.class_id,x.teacher_id)
  ORDER BY x.lesson_date,x.start_time,x.class_id,x.id;
$$;

CREATE FUNCTION public.timetable_publish_draft(p_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.timetable_drafts%ROWTYPE; c public.classes%ROWTYPE; y public.academic_years%ROWTYPE;
  old_teacher uuid; old_base_id uuid; old_start date; old_end date; old_day integer;
  from_date date; to_date date; check_from date; check_to date;
  school_today date; affected boolean; published_id uuid;
  before_week jsonb; after_week jsonb;
  conflict_message text;
BEGIN
  SELECT * INTO d FROM public.timetable_drafts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found'; END IF;
  SELECT * INTO c FROM public.classes WHERE id=d.class_id AND school_id=d.school_id AND deleted_at IS NULL;
  IF NOT FOUND OR c.school_id IS DISTINCT FROM public.get_auth_school_id() OR
    NOT (public.has_role(auth.uid(),'admin') OR (public.has_role(auth.uid(),'teacher')
      AND d.author_id=auth.uid() AND public.fn_has_valid_staff_unlock(c.school_id))) THEN
    RAISE EXCEPTION 'Not allowed to publish this draft';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(d.school_id::text));
  IF d.academic_year_id IS DISTINCT FROM c.academic_year_id OR NOT EXISTS
    (SELECT 1 FROM public.subjects s WHERE s.id=d.subject_id AND s.school_id=d.school_id AND s.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Class year or subject changed; save this draft again';
  END IF;
  IF d.base_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.timetable t WHERE t.id=d.base_id
    AND t.class_id=d.class_id AND t.school_id=d.school_id AND t.day_of_week=d.day_of_week AND t.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Base lesson changed; save this draft again';
  END IF;
  SELECT (now() AT TIME ZONE s.time_zone)::date INTO school_today FROM public.schools s WHERE s.id=d.school_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(s)-'id'-'base_id'-'source'
    ORDER BY s.lesson_date,s.start_time,s.subject_id,s.teacher_id,s.room),'[]'::jsonb)
    INTO before_week FROM public.timetable_schedule(school_today,school_today+6,d.class_id) s;
  IF c.academic_year_id IS NOT NULL THEN
    SELECT * INTO y FROM public.academic_years WHERE id=c.academic_year_id AND school_id=c.school_id;
  END IF;
  IF d.kind='weekly' AND y.id IS NULL THEN
    from_date := COALESCE(d.start_date,school_today);
    to_date := COALESCE(d.end_date,from_date+365);
  ELSE
    from_date := COALESCE(d.start_date,y.start_date);
    to_date := COALESCE(d.end_date,y.end_date);
  END IF;
  IF y.id IS NOT NULL AND (from_date < y.start_date OR to_date > y.end_date) THEN
    RAISE EXCEPTION 'Dates must be inside the academic year';
  END IF;
  IF to_date < from_date OR to_date > from_date + 365 THEN RAISE EXCEPTION 'Select a range of at most 366 days'; END IF;
  IF NOT EXISTS (SELECT 1 FROM generate_series(from_date,to_date,interval '1 day') day
    WHERE extract(dow FROM day)::integer=d.day_of_week) THEN
    RAISE EXCEPTION 'Selected dates do not include the chosen weekday';
  END IF;
  IF public.has_role(auth.uid(),'teacher') AND NOT public.has_role(auth.uid(),'admin') AND
    (d.teacher_id IS DISTINCT FROM auth.uid() OR
      (d.target_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.timetable t
        WHERE d.kind='weekly' AND t.id=d.target_id AND t.teacher_id=auth.uid()) AND NOT EXISTS
        (SELECT 1 FROM public.timetable_exceptions e WHERE d.kind='exception' AND e.id=d.target_id AND e.teacher_id=auth.uid())) OR
      (d.base_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.timetable t WHERE t.id=d.base_id AND t.teacher_id=auth.uid()))) THEN
    RAISE EXCEPTION 'Teacher assignment changed';
  END IF;
  IF NOT d.cancelled AND d.teacher_id IS NOT NULL AND (NOT public.has_role(d.teacher_id,'teacher') OR NOT EXISTS (SELECT 1 FROM public.subject_teachers st
    WHERE st.school_id=d.school_id AND st.class_id=d.class_id AND st.subject_id=d.subject_id
      AND st.teacher_id=d.teacher_id AND (st.academic_year_id IS NULL OR st.academic_year_id=c.academic_year_id))) THEN
    RAISE EXCEPTION 'Teacher assignment changed';
  END IF;
  IF d.kind='exception' AND d.base_id IS NOT NULL AND EXISTS
    (SELECT 1 FROM public.timetable_exceptions e WHERE e.base_id=d.base_id AND e.id IS DISTINCT FROM d.target_id
      AND daterange(e.start_date,e.end_date,'[]') && daterange(d.start_date,d.end_date,'[]')) THEN
    RAISE EXCEPTION 'An exception already covers this lesson and range';
  END IF;
  IF d.target_id IS NOT NULL THEN
    IF d.kind='weekly' THEN
      SELECT teacher_id,effective_start,effective_end,day_of_week
        INTO old_teacher,old_start,old_end,old_day FROM public.timetable
        WHERE id=d.target_id AND class_id=d.class_id AND school_id=d.school_id AND deleted_at IS NULL;
    ELSE
      SELECT teacher_id,start_date,end_date,day_of_week,base_id
        INTO old_teacher,old_start,old_end,old_day,old_base_id FROM public.timetable_exceptions
        WHERE id=d.target_id AND class_id=d.class_id AND school_id=d.school_id;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'Published lesson changed; save this draft again'; END IF;
  ELSIF d.base_id IS NOT NULL THEN
    SELECT teacher_id INTO old_teacher FROM public.timetable WHERE id=d.base_id;
  END IF;
  IF d.kind='exception' THEN old_base_id := COALESCE(old_base_id,d.base_id); END IF;
  check_from := least(from_date,COALESCE(old_start,from_date));
  check_to := greatest(to_date,COALESCE(old_end,to_date));
  IF d.kind='weekly' THEN
    PERFORM set_config('app.timetable_publishing','on',true);
    IF d.cancelled THEN
      UPDATE public.timetable SET deleted_at=now() WHERE id=d.target_id AND class_id=d.class_id
        AND school_id=d.school_id AND deleted_at IS NULL RETURNING id INTO published_id;
      DELETE FROM public.timetable_exceptions WHERE base_id=d.target_id;
    ELSIF d.target_id IS NULL THEN
      INSERT INTO public.timetable(school_id,class_id,academic_year_id,day_of_week,start_time,end_time,subject_id,teacher_id,room,effective_start,effective_end)
      VALUES(d.school_id,d.class_id,d.academic_year_id,d.day_of_week,d.start_time,d.end_time,d.subject_id,d.teacher_id,d.room,from_date,to_date)
      RETURNING id INTO published_id;
    ELSE
      IF EXISTS (SELECT 1 FROM public.timetable t WHERE t.id=d.target_id
          AND t.day_of_week<>d.day_of_week) AND EXISTS
          (SELECT 1 FROM public.timetable_exceptions e WHERE e.base_id=d.target_id) THEN
        RAISE EXCEPTION 'Restore or remove date exceptions before moving this weekly lesson';
      END IF;
      UPDATE public.timetable SET day_of_week=d.day_of_week,start_time=d.start_time,end_time=d.end_time,
        subject_id=d.subject_id,teacher_id=d.teacher_id,room=d.room,effective_start=from_date,effective_end=to_date,
        academic_year_id=d.academic_year_id WHERE id=d.target_id AND class_id=d.class_id AND school_id=d.school_id AND deleted_at IS NULL
      RETURNING id INTO published_id;
    END IF;
  ELSE
    IF d.cancelled AND d.base_id IS NULL AND d.target_id IS NOT NULL THEN
      DELETE FROM public.timetable_exceptions WHERE id=d.target_id AND class_id=d.class_id
        AND school_id=d.school_id RETURNING id INTO published_id;
    ELSIF d.target_id IS NULL THEN
      INSERT INTO public.timetable_exceptions(school_id,class_id,base_id,academic_year_id,start_date,end_date,
        day_of_week,start_time,end_time,subject_id,teacher_id,room,cancelled)
      VALUES(d.school_id,d.class_id,d.base_id,d.academic_year_id,d.start_date,d.end_date,
        d.day_of_week,d.start_time,d.end_time,d.subject_id,d.teacher_id,d.room,d.cancelled)
      RETURNING id INTO published_id;
    ELSE
      UPDATE public.timetable_exceptions SET base_id=d.base_id,start_date=d.start_date,end_date=d.end_date,
        day_of_week=d.day_of_week,start_time=d.start_time,end_time=d.end_time,subject_id=d.subject_id,
        teacher_id=d.teacher_id,room=d.room,cancelled=d.cancelled WHERE id=d.target_id AND class_id=d.class_id AND school_id=d.school_id
      RETURNING id INTO published_id;
    END IF;
  END IF;
  IF published_id IS NULL THEN RAISE EXCEPTION 'Published lesson no longer exists'; END IF;
  -- ponytail: scan the school's affected dates; add an occupancy index if publish latency becomes a problem.
  -- Check the resulting schedule, including weekly slots uncovered by moving or removing an exception.
  WITH days AS (SELECT day::date AS lesson_date FROM generate_series(check_from,check_to,interval '1 day') day
      WHERE extract(dow FROM day)::integer IN (d.day_of_week,old_day)),
    slots AS (
      SELECT day.lesson_date,t.id,t.class_id,t.teacher_id,t.room,t.start_time,t.end_time
      FROM days day JOIN public.timetable t ON t.school_id=d.school_id AND t.deleted_at IS NULL
        AND t.day_of_week=extract(dow FROM day.lesson_date)::integer
        AND (t.effective_start IS NULL OR t.effective_start<=day.lesson_date)
        AND (t.effective_end IS NULL OR t.effective_end>=day.lesson_date)
      JOIN public.classes cl ON cl.id=t.class_id AND cl.school_id=t.school_id AND cl.deleted_at IS NULL
      LEFT JOIN public.academic_years ay ON ay.id=cl.academic_year_id
      LEFT JOIN public.academic_years ty ON ty.id=t.academic_year_id
      WHERE (ay.id IS NULL OR day.lesson_date BETWEEN ay.start_date AND ay.end_date)
        AND (ty.id IS NULL OR day.lesson_date BETWEEN ty.start_date AND ty.end_date)
        AND (t.academic_year_id IS NULL OR t.academic_year_id=cl.academic_year_id)
        AND NOT EXISTS (SELECT 1 FROM public.timetable_exceptions e WHERE e.base_id=t.id
          AND e.day_of_week=t.day_of_week AND day.lesson_date BETWEEN e.start_date AND e.end_date)
      UNION ALL
      SELECT day.lesson_date,e.id,e.class_id,e.teacher_id,e.room,e.start_time,e.end_time
      FROM days day JOIN public.timetable_exceptions e ON e.school_id=d.school_id AND NOT e.cancelled
        AND e.day_of_week=extract(dow FROM day.lesson_date)::integer
        AND day.lesson_date BETWEEN e.start_date AND e.end_date
      JOIN public.classes cl ON cl.id=e.class_id AND cl.school_id=e.school_id AND cl.deleted_at IS NULL
      LEFT JOIN public.academic_years ay ON ay.id=cl.academic_year_id
      LEFT JOIN public.academic_years ey ON ey.id=e.academic_year_id
      WHERE (ay.id IS NULL OR day.lesson_date BETWEEN ay.start_date AND ay.end_date)
        AND (ey.id IS NULL OR day.lesson_date BETWEEN ey.start_date AND ey.end_date)
        AND (e.academic_year_id IS NULL OR e.academic_year_id=cl.academic_year_id)
    )
    SELECT format('%s conflict on %s, %s–%s',
      concat_ws(' / ',CASE WHEN a.class_id=b.class_id THEN 'Class' END,
        CASE WHEN a.teacher_id IS NOT NULL AND a.teacher_id=b.teacher_id THEN 'Teacher' END,
        CASE WHEN a.room IS NOT NULL AND lower(btrim(a.room))=lower(btrim(b.room)) THEN 'Room' END),
      a.lesson_date,a.start_time,a.end_time) INTO conflict_message
    FROM slots a JOIN slots b ON b.lesson_date=a.lesson_date AND b.id<>a.id
      AND a.start_time<b.end_time AND b.start_time<a.end_time
    WHERE a.id IN (published_id,old_base_id) AND
      (a.class_id=b.class_id OR (a.teacher_id IS NOT NULL AND a.teacher_id=b.teacher_id)
        OR (a.room IS NOT NULL AND lower(btrim(a.room))=lower(btrim(b.room))))
    LIMIT 1;
  IF conflict_message IS NOT NULL THEN RAISE EXCEPTION '%',conflict_message; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(s)-'id'-'base_id'-'source'
    ORDER BY s.lesson_date,s.start_time,s.subject_id,s.teacher_id,s.room),'[]'::jsonb)
    INTO after_week FROM public.timetable_schedule(school_today,school_today+6,d.class_id) s;
  affected := before_week IS DISTINCT FROM after_week;
  IF affected THEN
    INSERT INTO public.notifications(school_id,user_id,title,message,type,action_url,channel)
    SELECT d.school_id,recipient.id,'Timetable changed','A lesson in your schedule for the next 7 days has changed.',
      'info','/timetable','in_app'
    FROM (
      SELECT ce.student_id AS id FROM public.class_enrollments ce WHERE ce.class_id=d.class_id AND ce.deleted_at IS NULL
        AND ce.school_id=d.school_id AND ce.academic_year_id IS NOT DISTINCT FROM c.academic_year_id
        AND public.has_role(ce.student_id,'student')
      UNION
      SELECT ps.parent_id FROM public.parent_student ps JOIN public.class_enrollments ce ON ce.student_id=ps.student_id
        WHERE ce.class_id=d.class_id AND ce.deleted_at IS NULL AND ps.status='active' AND ps.school_id=d.school_id
          AND ce.school_id=d.school_id AND ce.academic_year_id IS NOT DISTINCT FROM c.academic_year_id
          AND public.has_role(ce.student_id,'student')
      UNION SELECT (changed.item->>'teacher_id')::uuid FROM (
        (SELECT item FROM jsonb_array_elements(before_week) item EXCEPT SELECT item FROM jsonb_array_elements(after_week) item)
        UNION
        (SELECT item FROM jsonb_array_elements(after_week) item EXCEPT SELECT item FROM jsonb_array_elements(before_week) item)
      ) changed WHERE changed.item->>'teacher_id' IS NOT NULL
    ) recipient JOIN public.profiles p ON p.id=recipient.id AND p.school_id=d.school_id
      AND p.is_active IS TRUE AND p.deleted_at IS NULL;
  END IF;
  DELETE FROM public.timetable_drafts WHERE id=p_id;
  RETURN published_id;
END;
$$;

CREATE FUNCTION public.timetable_discard_draft(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.timetable_drafts d WHERE d.id=p_id AND d.school_id=public.get_auth_school_id()
    AND (public.has_role(auth.uid(),'admin') OR (d.author_id=auth.uid()
      AND public.fn_has_valid_staff_unlock(d.school_id)));
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found'; END IF;
END;
$$;

CREATE FUNCTION public.timetable_set_zone(p_zone text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') OR public.get_auth_school_id() IS NULL THEN
    RAISE EXCEPTION 'Only a school admin can set the time zone';
  END IF;
  UPDATE public.schools SET time_zone=p_zone WHERE id=public.get_auth_school_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'School not found'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.timetable_save_draft(jsonb), public.timetable_schedule(date,date,uuid),
  public.timetable_publish_draft(uuid), public.timetable_discard_draft(uuid),
  public.timetable_set_zone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timetable_save_draft(jsonb), public.timetable_schedule(date,date,uuid),
  public.timetable_publish_draft(uuid), public.timetable_discard_draft(uuid),
  public.timetable_set_zone(text) TO authenticated, service_role;
