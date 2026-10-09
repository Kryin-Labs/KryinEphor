-- Preview uses the real publication path inside a rolled-back subtransaction.
-- This keeps validation and conflict rules identical without changing published data.
CREATE OR REPLACE FUNCTION public.timetable_preview_draft(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  d public.timetable_drafts%ROWTYPE;
  c public.classes%ROWTYPE;
  y public.academic_years%ROWTYPE;
  school_today date;
  from_date date;
  to_date date;
  before_rows jsonb := '[]'::jsonb;
  after_rows jsonb := '[]'::jsonb;
  preview_error text;
  affected_count int := 0;
BEGIN
  SELECT * INTO d FROM public.timetable_drafts WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found'; END IF;
  SELECT * INTO c FROM public.classes WHERE id=d.class_id AND school_id=d.school_id AND deleted_at IS NULL;
  IF NOT FOUND OR c.school_id IS DISTINCT FROM public.get_auth_school_id() OR
    NOT (public.has_role(auth.uid(),'admin') OR
      (d.author_id=auth.uid() AND public.has_role(auth.uid(),'teacher')
       AND public.fn_has_valid_staff_unlock(c.school_id))) THEN
    RAISE EXCEPTION 'Draft not available to this account';
  END IF;
  SELECT (now() AT TIME ZONE s.time_zone)::date INTO school_today
    FROM public.schools s WHERE s.id=d.school_id;
  IF c.academic_year_id IS NOT NULL THEN
    SELECT * INTO y FROM public.academic_years WHERE id=c.academic_year_id AND school_id=c.school_id;
  END IF;
  from_date := COALESCE(d.start_date,y.start_date,school_today);
  to_date := COALESCE(d.end_date,y.end_date,from_date+365);
  IF d.target_id IS NOT NULL AND d.kind='weekly' THEN
    SELECT least(from_date,COALESCE(t.effective_start,y.start_date,school_today)),
           greatest(to_date,COALESCE(t.effective_end,y.end_date,school_today+365))
      INTO from_date,to_date FROM public.timetable t WHERE t.id=d.target_id;
  END IF;
  IF to_date < from_date OR to_date>from_date+365 THEN
    RETURN jsonb_build_object('before','[]'::jsonb,'after','[]'::jsonb,
      'error','Select an affected range of at most 366 days','affected_user_count',0,
      'from_date',from_date,'to_date',to_date);
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.lesson_date,s.start_time,s.id),'[]'::jsonb)
    INTO before_rows FROM public.timetable_schedule(from_date,to_date,d.class_id) s;
  BEGIN
    PERFORM public.timetable_publish_draft(p_id);
    SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.lesson_date,s.start_time,s.id),'[]'::jsonb)
      INTO after_rows FROM public.timetable_schedule(from_date,to_date,d.class_id) s;
    RAISE EXCEPTION 'rollback preview' USING ERRCODE='PT001';
  EXCEPTION
    WHEN SQLSTATE 'PT001' THEN NULL;
    WHEN OTHERS THEN preview_error := SQLERRM;
  END;
  IF preview_error IS NULL AND EXISTS (
    SELECT 1 FROM (
      (SELECT b.item-'id'-'base_id'-'source' AS item FROM jsonb_array_elements(before_rows) AS b(item)
       EXCEPT SELECT a.item-'id'-'base_id'-'source' FROM jsonb_array_elements(after_rows) AS a(item))
      UNION
      (SELECT a.item-'id'-'base_id'-'source' FROM jsonb_array_elements(after_rows) AS a(item)
       EXCEPT SELECT b.item-'id'-'base_id'-'source' FROM jsonb_array_elements(before_rows) AS b(item))
    ) changed WHERE (changed.item->>'lesson_date')::date BETWEEN school_today AND school_today+6
  ) THEN
    SELECT count(DISTINCT id) INTO affected_count FROM (
      SELECT ce.student_id AS id FROM public.class_enrollments ce
        WHERE ce.class_id=d.class_id AND ce.deleted_at IS NULL
          AND ce.school_id=d.school_id AND ce.academic_year_id IS NOT DISTINCT FROM c.academic_year_id
          AND public.has_role(ce.student_id,'student')
      UNION SELECT ps.parent_id FROM public.parent_student ps
        JOIN public.class_enrollments ce ON ce.student_id=ps.student_id
        WHERE ce.class_id=d.class_id AND ce.deleted_at IS NULL
          AND ps.status='active' AND ps.school_id=d.school_id
          AND ce.school_id=d.school_id AND ce.academic_year_id IS NOT DISTINCT FROM c.academic_year_id
          AND public.has_role(ce.student_id,'student')
      UNION SELECT (changed.item->>'teacher_id')::uuid FROM (
        (SELECT item-'id'-'base_id'-'source' AS item FROM jsonb_array_elements(before_rows) item
          EXCEPT SELECT item-'id'-'base_id'-'source' FROM jsonb_array_elements(after_rows) item)
        UNION
        (SELECT item-'id'-'base_id'-'source' FROM jsonb_array_elements(after_rows) item
          EXCEPT SELECT item-'id'-'base_id'-'source' FROM jsonb_array_elements(before_rows) item)
      ) changed WHERE changed.item->>'teacher_id' IS NOT NULL
        AND (changed.item->>'lesson_date')::date BETWEEN school_today AND school_today+6
    ) people JOIN public.profiles p ON p.id=people.id AND p.school_id=d.school_id
      AND p.is_active AND p.deleted_at IS NULL;
  END IF;
  RETURN jsonb_build_object('before',before_rows,'after',after_rows,
    'error',preview_error,'affected_user_count',affected_count,
    'from_date',from_date,'to_date',to_date);
END;
$$;
REVOKE ALL ON FUNCTION public.timetable_preview_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timetable_preview_draft(uuid) TO authenticated;

-- An AI approval names the exact draft the person reviewed. Lock and compare
-- it in the publication transaction so an intervening edit cannot change consent.
CREATE OR REPLACE FUNCTION public.timetable_publish_approved(p_id uuid,p_expected jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.timetable_drafts%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.timetable_drafts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR p_expected IS NULL OR to_jsonb(d) IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'Draft changed after the request; create a new approval';
  END IF;
  RETURN public.timetable_publish_draft(p_id);
END;
$$;
REVOKE ALL ON FUNCTION public.timetable_publish_approved(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.timetable_publish_approved(uuid,jsonb) TO authenticated;

-- Existing teacher-removal functions clear weekly rows and then deactivate the
-- employee. Also clear standalone exceptions that have no weekly row to update.
CREATE OR REPLACE FUNCTION public.timetable_clear_departed_teacher()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE school_today date;
BEGIN
  IF NEW.status='active' AND NEW.deleted_at IS NULL THEN RETURN NEW; END IF;
  SELECT (now() AT TIME ZONE s.time_zone)::date INTO school_today FROM public.schools s WHERE s.id=OLD.school_id;
  WITH affected_classes AS (
    SELECT DISTINCT e.class_id FROM public.timetable_exceptions e
      JOIN public.classes c ON c.id=e.class_id AND c.deleted_at IS NULL
      LEFT JOIN public.academic_years y ON y.id=c.academic_year_id
      WHERE e.teacher_id=OLD.profile_id AND e.school_id=OLD.school_id AND NOT e.cancelled
        AND (e.academic_year_id IS NULL OR e.academic_year_id=c.academic_year_id)
        AND EXISTS (SELECT 1 FROM generate_series(school_today,school_today+6,interval '1 day') d
          WHERE d::date BETWEEN e.start_date AND e.end_date
            AND extract(dow FROM d)::integer=e.day_of_week
            AND (y.id IS NULL OR d::date BETWEEN y.start_date AND y.end_date))
  ), students AS (
    SELECT ce.student_id FROM public.class_enrollments ce
      JOIN affected_classes c ON c.class_id=ce.class_id
      JOIN public.profiles p ON p.id=ce.student_id AND p.is_active AND p.deleted_at IS NULL
      WHERE ce.deleted_at IS NULL AND ce.school_id=OLD.school_id
  ), recipients AS (
    SELECT student_id AS id FROM students
    UNION SELECT ps.parent_id FROM public.parent_student ps JOIN students s ON s.student_id=ps.student_id
      WHERE ps.school_id=OLD.school_id AND ps.status='active'
    UNION SELECT OLD.profile_id WHERE EXISTS (SELECT 1 FROM affected_classes)
  )
  INSERT INTO public.notifications(school_id,user_id,title,message,type,action_url,channel)
    SELECT OLD.school_id,p.id,'Timetable changed','A teacher assignment in the next 7 days has changed.',
      'info','/timetable','in_app' FROM recipients r JOIN public.profiles p ON p.id=r.id
      AND p.school_id=OLD.school_id AND p.is_active AND p.deleted_at IS NULL;
  INSERT INTO public.audit_logs(school_id,user_id,table_name,record_id,action,old_data,new_data,changed_fields)
    SELECT OLD.school_id,auth.uid(),'timetable_exceptions',e.id,'update',
      jsonb_build_object('teacher_id',e.teacher_id),jsonb_build_object('teacher_id',NULL),ARRAY['teacher_id']
    FROM public.timetable_exceptions e WHERE e.school_id=OLD.school_id AND e.teacher_id=OLD.profile_id;
  UPDATE public.timetable_exceptions SET teacher_id=NULL
    WHERE school_id=OLD.school_id AND teacher_id=OLD.profile_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER timetable_employee_departed AFTER UPDATE OF status,deleted_at ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.timetable_clear_departed_teacher();
