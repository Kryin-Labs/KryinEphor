
-- Indexes for hot paths
CREATE INDEX IF NOT EXISTS idx_class_enrollments_class_student ON public.class_enrollments (class_id, student_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_class_enrollments_student ON public.class_enrollments (student_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_class_date ON public.attendance (class_id, date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_subject_teachers_class ON public.subject_teachers (class_id);
CREATE INDEX IF NOT EXISTS idx_subject_teachers_teacher ON public.subject_teachers (teacher_id);
CREATE INDEX IF NOT EXISTS idx_student_fee_assignments_school_plan ON public.student_fee_assignments (school_id, plan_id);
CREATE INDEX IF NOT EXISTS idx_invoices_school_status_due ON public.invoices (school_id, status, due_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_classes_school_year ON public.classes (school_id, academic_year_id) WHERE deleted_at IS NULL;

-- Overview RPC: single-shot stats for a class
CREATE OR REPLACE FUNCTION public.fn_class_overview(p_class uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school uuid;
  v_students int;
  v_subjects int;
  v_present int;
  v_total_marked int;
  v_fees_assigned int;
BEGIN
  SELECT school_id INTO v_school FROM public.classes WHERE id = p_class AND deleted_at IS NULL;
  IF v_school IS NULL THEN RETURN NULL; END IF;
  IF v_school <> COALESCE(get_auth_school_id(), v_school) AND get_auth_role() <> 'superadmin' THEN
    RAISE EXCEPTION 'cross-tenant not allowed';
  END IF;

  SELECT COUNT(*) INTO v_students FROM public.class_enrollments
    WHERE class_id = p_class AND deleted_at IS NULL;
  SELECT COUNT(DISTINCT subject_id) INTO v_subjects FROM public.subject_teachers
    WHERE class_id = p_class;
  SELECT COUNT(*) FILTER (WHERE status IN ('present','late')), COUNT(*)
    INTO v_present, v_total_marked
    FROM public.attendance
   WHERE class_id = p_class AND date = CURRENT_DATE AND deleted_at IS NULL;
  SELECT COUNT(DISTINCT sfa.student_id) INTO v_fees_assigned
    FROM public.student_fee_assignments sfa
    JOIN public.class_enrollments ce ON ce.student_id = sfa.student_id AND ce.deleted_at IS NULL
   WHERE ce.class_id = p_class AND sfa.is_active = true;

  RETURN jsonb_build_object(
    'students', v_students,
    'subjects', v_subjects,
    'attendance_today_pct', CASE WHEN v_total_marked > 0 THEN ROUND(v_present::numeric * 100 / v_total_marked, 1) ELSE NULL END,
    'attendance_marked', v_total_marked,
    'fees_assigned', v_fees_assigned
  );
END $$;

-- Bulk enroll students into a class
CREATE OR REPLACE FUNCTION public.fn_bulk_enroll_students(p_class uuid, p_student_ids uuid[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_school uuid; v_year uuid; v_count int := 0;
BEGIN
  IF NOT (get_auth_role() = ANY(ARRAY['admin','superadmin'])) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT school_id, academic_year_id INTO v_school, v_year
    FROM public.classes WHERE id = p_class AND deleted_at IS NULL;
  IF v_school IS NULL THEN RAISE EXCEPTION 'class not found'; END IF;
  IF v_school <> get_auth_school_id() AND get_auth_role() <> 'superadmin' THEN
    RAISE EXCEPTION 'cross-tenant not allowed';
  END IF;

  INSERT INTO public.class_enrollments (school_id, class_id, student_id, academic_year_id)
  SELECT v_school, p_class, sid, v_year FROM unnest(p_student_ids) sid
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- Bulk assign a fee plan to every enrolled student in a class
CREATE OR REPLACE FUNCTION public.fn_bulk_assign_fee_plan(p_class uuid, p_plan uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_school uuid; v_count int := 0;
BEGIN
  IF NOT (get_auth_role() = ANY(ARRAY['admin','accountant','superadmin'])) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT school_id INTO v_school FROM public.classes WHERE id = p_class AND deleted_at IS NULL;
  IF v_school IS NULL THEN RAISE EXCEPTION 'class not found'; END IF;
  IF v_school <> get_auth_school_id() AND get_auth_role() <> 'superadmin' THEN
    RAISE EXCEPTION 'cross-tenant not allowed';
  END IF;

  INSERT INTO public.student_fee_assignments (school_id, student_id, plan_id, is_active)
  SELECT v_school, ce.student_id, p_plan, true
    FROM public.class_enrollments ce
   WHERE ce.class_id = p_class AND ce.deleted_at IS NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- Mark attendance for many students at once
-- p_marks = jsonb array [{"student_id": uuid, "status": "present"|"absent"|"late", "notes": "..."}]
CREATE OR REPLACE FUNCTION public.fn_mark_class_attendance(p_class uuid, p_date date, p_marks jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_school uuid; v_count int := 0; v_actor uuid := auth.uid();
BEGIN
  IF NOT (get_auth_role() = ANY(ARRAY['admin','teacher','superadmin'])) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT school_id INTO v_school FROM public.classes WHERE id = p_class AND deleted_at IS NULL;
  IF v_school IS NULL THEN RAISE EXCEPTION 'class not found'; END IF;
  IF v_school <> get_auth_school_id() AND get_auth_role() <> 'superadmin' THEN
    RAISE EXCEPTION 'cross-tenant not allowed';
  END IF;

  -- Remove any existing marks for this class/date so we can re-upsert
  UPDATE public.attendance SET deleted_at = now()
   WHERE class_id = p_class AND date = p_date AND deleted_at IS NULL;

  INSERT INTO public.attendance (school_id, class_id, student_id, date, status, notes, marked_by, created_by)
  SELECT v_school, p_class,
         (m->>'student_id')::uuid,
         p_date,
         COALESCE(m->>'status','present'),
         m->>'notes',
         v_actor, v_actor
    FROM jsonb_array_elements(p_marks) m;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.fn_class_overview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bulk_enroll_students(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bulk_assign_fee_plan(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mark_class_attendance(uuid, date, jsonb) TO authenticated;
