-- One daily mark per student, written only through a validated class operation.
-- Keep the old row when a mark is corrected; audit_logs stores its prior value.

CREATE OR REPLACE FUNCTION public.fn_is_assigned_teacher_for_class(_class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.classes c
    WHERE c.id=_class_id AND c.school_id=public.get_auth_school_id() AND c.deleted_at IS NULL
      AND (c.teacher_id=auth.uid() OR EXISTS (SELECT 1 FROM public.subject_teachers st
        WHERE st.class_id=c.id AND st.school_id=c.school_id AND st.teacher_id=auth.uid()
          AND (st.academic_year_id IS NULL OR st.academic_year_id=c.academic_year_id))));
$$;

CREATE OR REPLACE FUNCTION public.fn_mark_class_attendance(p_class uuid, p_date date, p_marks jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_class public.classes%ROWTYPE;
  v_zone text;
  v_today date;
  v_year public.academic_years%ROWTYPE;
  v_roster int;
  v_count int;
  v_mark record;
  v_old public.attendance%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_class FROM public.classes WHERE id=p_class AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class not found'; END IF;
  IF NOT (public.has_role(auth.uid(),'superadmin') OR
    (v_class.school_id IS NOT DISTINCT FROM public.get_auth_school_id() AND
      (public.has_role(auth.uid(),'admin') OR
       (public.has_role(auth.uid(),'teacher') AND v_class.teacher_id IS NOT DISTINCT FROM auth.uid()
        AND public.fn_has_valid_staff_unlock(v_class.school_id))))) THEN
    RAISE EXCEPTION 'Only a school admin or the unlocked homeroom teacher can mark attendance';
  END IF;
  SELECT time_zone INTO v_zone FROM public.schools WHERE id=v_class.school_id AND deleted_at IS NULL;
  IF v_zone IS NULL THEN RAISE EXCEPTION 'School is unavailable'; END IF;
  v_today := (now() AT TIME ZONE v_zone)::date;
  IF p_date IS NULL OR p_date>v_today THEN RAISE EXCEPTION 'Attendance date cannot be in the future'; END IF;
  IF v_class.academic_year_id IS NOT NULL THEN
    SELECT * INTO v_year FROM public.academic_years WHERE id=v_class.academic_year_id
      AND school_id=v_class.school_id AND deleted_at IS NULL;
    IF NOT FOUND OR p_date NOT BETWEEN v_year.start_date AND v_year.end_date THEN
      RAISE EXCEPTION 'Attendance date must be inside the class academic year';
    END IF;
  END IF;
  IF p_marks IS NULL OR jsonb_typeof(p_marks)<>'array' OR jsonb_array_length(p_marks)>500 THEN
    RAISE EXCEPTION 'Marks must be an array of at most 500 students';
  END IF;
  SELECT count(*) INTO v_roster FROM public.class_enrollments ce
    JOIN public.profiles p ON p.id=ce.student_id AND p.school_id=v_class.school_id
      AND p.is_active AND p.deleted_at IS NULL AND public.has_role(p.id,'student')
    WHERE ce.class_id=p_class AND ce.school_id=v_class.school_id AND ce.deleted_at IS NULL
      AND ce.academic_year_id IS NOT DISTINCT FROM v_class.academic_year_id;
  SELECT count(*) INTO v_count FROM jsonb_array_elements(p_marks);
  IF v_count<>v_roster THEN RAISE EXCEPTION 'Marks must include the complete current class roster'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_marks) m
    WHERE jsonb_typeof(m)<>'object' OR NOT (m ? 'student_id') OR NOT (m ? 'status')
      OR m->>'status' IS NULL OR m->>'status' NOT IN ('present','absent','late','excused','half_day')
      OR length(COALESCE(m->>'notes',''))>500) THEN
    RAISE EXCEPTION 'Invalid attendance mark';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_marks) m
    GROUP BY m->>'student_id' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate student in attendance marks';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_marks) m
    WHERE NOT EXISTS (SELECT 1 FROM public.class_enrollments ce
      JOIN public.profiles p ON p.id=ce.student_id AND p.school_id=v_class.school_id
        AND p.is_active AND p.deleted_at IS NULL AND public.has_role(p.id,'student')
      WHERE ce.student_id=(m->>'student_id')::uuid AND ce.class_id=p_class
        AND ce.school_id=v_class.school_id AND ce.deleted_at IS NULL
        AND ce.academic_year_id IS NOT DISTINCT FROM v_class.academic_year_id)) THEN
    RAISE EXCEPTION 'A student is not active in this class roster';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_class::text || p_date::text));
  FOR v_mark IN SELECT (m->>'student_id')::uuid AS student_id,m->>'status' AS status,
    m->>'notes' AS notes,m ? 'notes' AS notes_provided FROM jsonb_array_elements(p_marks) m LOOP
    SELECT * INTO v_old FROM public.attendance WHERE student_id=v_mark.student_id AND date=p_date FOR UPDATE;
    IF FOUND THEN
      IF NOT v_mark.notes_provided THEN v_mark.notes := v_old.notes; END IF;
      IF v_old.school_id IS DISTINCT FROM v_class.school_id OR v_old.class_id IS DISTINCT FROM p_class THEN
        RAISE EXCEPTION 'Student already has attendance in another class or school for this date';
      END IF;
      UPDATE public.attendance SET class_id=p_class,school_id=v_class.school_id,status=v_mark.status,
        notes=v_mark.notes,marked_by=auth.uid(),updated_by=auth.uid(),deleted_at=NULL
      WHERE id=v_old.id;
      IF v_old.class_id IS DISTINCT FROM p_class OR v_old.status IS DISTINCT FROM v_mark.status
        OR v_old.notes IS DISTINCT FROM v_mark.notes OR v_old.deleted_at IS NOT NULL THEN
        INSERT INTO public.audit_logs(school_id,user_id,table_name,record_id,action,old_data,new_data,changed_fields)
        VALUES(v_class.school_id,auth.uid(),'attendance',v_old.id,'update',
          jsonb_build_object('class_id',v_old.class_id,'status',v_old.status,'notes',v_old.notes,'deleted_at',v_old.deleted_at),
          jsonb_build_object('class_id',p_class,'status',v_mark.status,'notes',v_mark.notes,'deleted_at',NULL),
          ARRAY['class_id','status','notes','deleted_at']);
      END IF;
    ELSE
      INSERT INTO public.attendance(school_id,class_id,student_id,date,status,notes,marked_by,created_by)
      VALUES(v_class.school_id,p_class,v_mark.student_id,p_date,v_mark.status,v_mark.notes,auth.uid(),auth.uid())
      RETURNING id INTO v_id;
      INSERT INTO public.audit_logs(school_id,user_id,table_name,record_id,action,new_data)
      VALUES(v_class.school_id,auth.uid(),'attendance',v_id,'insert',
        jsonb_build_object('student_id',v_mark.student_id,'class_id',p_class,'date',p_date,'status',v_mark.status));
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bulk_enroll_students(p_class uuid, p_student_ids uuid[])
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_class public.classes%ROWTYPE; v_count int;
BEGIN
  SELECT * INTO v_class FROM public.classes WHERE id=p_class AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class not found'; END IF;
  IF NOT (public.has_role(auth.uid(),'superadmin') OR
    (public.has_role(auth.uid(),'admin') AND v_class.school_id IS NOT DISTINCT FROM public.get_auth_school_id())) THEN
    RAISE EXCEPTION 'Not allowed to enroll students in this class';
  END IF;
  IF p_student_ids IS NULL OR cardinality(p_student_ids)=0 OR cardinality(p_student_ids)>100
    OR EXISTS (SELECT 1 FROM unnest(p_student_ids) AS u(student_id) WHERE u.student_id IS NULL)
    OR (SELECT count(DISTINCT u.student_id) FROM unnest(p_student_ids) AS u(student_id))<>cardinality(p_student_ids) THEN
    RAISE EXCEPTION 'Provide 1 to 100 distinct student IDs';
  END IF;
  -- ponytail: serialize school enrollment batches; use ordered per-student locks if throughput requires it.
  PERFORM pg_advisory_xact_lock(hashtext('enrollment:'||v_class.school_id::text));
  IF EXISTS (SELECT 1 FROM unnest(p_student_ids) AS u(student_id) LEFT JOIN public.profiles p ON p.id=u.student_id
    WHERE p.id IS NULL OR p.school_id IS DISTINCT FROM v_class.school_id OR NOT p.is_active
      OR p.deleted_at IS NOT NULL OR NOT public.has_role(p.id,'student')) THEN
    RAISE EXCEPTION 'Every student must be active in the class school';
  END IF;
  IF EXISTS (SELECT 1 FROM public.class_enrollments ce
    WHERE ce.student_id=ANY(p_student_ids) AND ce.class_id<>p_class AND ce.deleted_at IS NULL
      AND ce.academic_year_id IS NOT DISTINCT FROM v_class.academic_year_id) THEN
    RAISE EXCEPTION 'A student is already enrolled in another class for this academic year';
  END IF;
  INSERT INTO public.class_enrollments(school_id,class_id,student_id,academic_year_id)
  SELECT v_class.school_id,p_class,u.student_id,v_class.academic_year_id FROM unnest(p_student_ids) AS u(student_id)
  ON CONFLICT (student_id,class_id) DO UPDATE SET deleted_at=NULL,
    academic_year_id=EXCLUDED.academic_year_id,enrolled_at=now()
    WHERE public.class_enrollments.deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_class_overview(p_class uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_class public.classes%ROWTYPE; v_today date; v_students int; v_subjects int;
  v_present int; v_marked int; v_fees int;
BEGIN
  SELECT * INTO v_class FROM public.classes WHERE id=p_class AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT (public.has_role(auth.uid(),'superadmin') OR
    (v_class.school_id IS NOT DISTINCT FROM public.get_auth_school_id() AND
      (public.has_role(auth.uid(),'admin') OR
       (public.has_role(auth.uid(),'teacher') AND public.fn_has_valid_staff_unlock(v_class.school_id)
        AND public.fn_is_assigned_teacher_for_class(p_class))))) THEN
    RAISE EXCEPTION 'Class overview is unavailable';
  END IF;
  SELECT (now() AT TIME ZONE s.time_zone)::date INTO v_today FROM public.schools s WHERE s.id=v_class.school_id;
  SELECT count(*),count(a.id) FILTER (WHERE a.status IN ('present','late')),count(a.id)
    INTO v_students,v_present,v_marked FROM public.class_enrollments ce
    JOIN public.profiles p ON p.id=ce.student_id AND p.school_id=v_class.school_id
      AND p.is_active AND p.deleted_at IS NULL AND public.has_role(p.id,'student')
    LEFT JOIN public.attendance a ON a.class_id=p_class AND a.student_id=ce.student_id
      AND a.school_id=v_class.school_id AND a.date=v_today AND a.deleted_at IS NULL
    WHERE ce.class_id=p_class AND ce.school_id=v_class.school_id AND ce.deleted_at IS NULL
      AND ce.academic_year_id IS NOT DISTINCT FROM v_class.academic_year_id;
  SELECT count(DISTINCT subject_id) INTO v_subjects FROM public.subject_teachers WHERE class_id=p_class;
  SELECT count(DISTINCT sfa.student_id) INTO v_fees FROM public.student_fee_assignments sfa
    JOIN public.class_enrollments ce ON ce.student_id=sfa.student_id AND ce.deleted_at IS NULL
    JOIN public.profiles p ON p.id=ce.student_id AND p.school_id=v_class.school_id
      AND p.is_active AND p.deleted_at IS NULL AND public.has_role(p.id,'student')
    WHERE ce.class_id=p_class AND ce.school_id=v_class.school_id
      AND ce.academic_year_id IS NOT DISTINCT FROM v_class.academic_year_id AND sfa.is_active;
  RETURN jsonb_build_object('students',v_students,'subjects',v_subjects,
    'attendance_today_pct',CASE WHEN v_marked>0 THEN round(v_present::numeric*100/v_marked,1) ELSE NULL END,
    'attendance_marked',v_marked,'fees_assigned',v_fees);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_attendance_summary(p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_school uuid:=public.get_auth_school_id(); v_zone text; v_result jsonb;
BEGIN
  IF v_school IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'teacher')) THEN
    RAISE EXCEPTION 'Attendance summary unavailable';
  END IF;
  IF public.has_role(auth.uid(),'teacher') AND NOT public.has_role(auth.uid(),'admin')
    AND NOT public.fn_has_valid_staff_unlock(v_school) THEN
    RAISE EXCEPTION 'Unlock staff mode to view attendance';
  END IF;
  SELECT time_zone INTO v_zone FROM public.schools WHERE id=v_school AND deleted_at IS NULL;
  IF v_zone IS NULL THEN RAISE EXCEPTION 'School unavailable'; END IF;
  IF p_date IS NULL THEN p_date := (now() AT TIME ZONE v_zone)::date; END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.name),'[]'::jsonb) INTO v_result FROM (
    SELECT c.id,c.name,c.teacher_id,count(roster.student_id) AS total,
      count(a.id) AS marked,
      count(a.id) FILTER (WHERE a.status='present') AS present,
      count(a.id) FILTER (WHERE a.status='absent') AS absent,
      count(a.id) FILTER (WHERE a.status='late') AS late,
      count(a.id) FILTER (WHERE a.status='excused') AS excused,
      count(a.id) FILTER (WHERE a.status='half_day') AS half_day
    FROM public.classes c
    LEFT JOIN (
      SELECT ce.class_id,ce.student_id,ce.academic_year_id FROM public.class_enrollments ce
      JOIN public.profiles p ON p.id=ce.student_id AND p.school_id=ce.school_id
        AND p.is_active AND p.deleted_at IS NULL AND public.has_role(p.id,'student')
      WHERE ce.school_id=v_school AND ce.deleted_at IS NULL
    ) roster ON roster.class_id=c.id AND roster.academic_year_id IS NOT DISTINCT FROM c.academic_year_id
    LEFT JOIN public.attendance a ON a.class_id=c.id AND a.student_id=roster.student_id
      AND a.school_id=v_school AND a.date=p_date AND a.deleted_at IS NULL
    WHERE c.school_id=v_school AND c.deleted_at IS NULL
      AND (public.has_role(auth.uid(),'admin') OR public.fn_is_assigned_teacher_for_class(c.id))
    GROUP BY c.id,c.name,c.teacher_id
  ) x;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_class_attendance_roster(p_class uuid, p_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.classes%ROWTYPE; v_students jsonb; v_marks jsonb;
BEGIN
  SELECT * INTO c FROM public.classes WHERE id=p_class AND deleted_at IS NULL;
  IF NOT FOUND OR c.school_id IS DISTINCT FROM public.get_auth_school_id() OR
    NOT (public.has_role(auth.uid(),'admin') OR
      (public.has_role(auth.uid(),'teacher') AND public.fn_has_valid_staff_unlock(c.school_id)
        AND public.fn_is_assigned_teacher_for_class(p_class))) THEN
    RAISE EXCEPTION 'Class attendance roster is unavailable';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('student_id',ce.student_id,
    'full_name',p.full_name,'email',p.email) ORDER BY p.full_name),'[]'::jsonb)
    INTO v_students FROM public.class_enrollments ce JOIN public.profiles p ON p.id=ce.student_id
      AND p.school_id=c.school_id AND p.is_active AND p.deleted_at IS NULL
      AND public.has_role(p.id,'student')
    WHERE ce.class_id=p_class AND ce.school_id=c.school_id AND ce.deleted_at IS NULL
      AND ce.academic_year_id IS NOT DISTINCT FROM c.academic_year_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('student_id',a.student_id,
    'status',a.status,'notes',a.notes)),'[]'::jsonb) INTO v_marks
    FROM public.attendance a WHERE a.class_id=p_class AND a.school_id=c.school_id
      AND a.date=p_date AND a.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_students) s WHERE (s->>'student_id')::uuid=a.student_id);
  RETURN jsonb_build_object('students',v_students,'existing',v_marks);
END;
$$;

-- Browser and OAuth clients cannot bypass the class RPC with direct row writes.
REVOKE INSERT, UPDATE, DELETE ON public.attendance FROM authenticated, anon;
DROP POLICY IF EXISTS classes_admin_only_update ON public.classes;
CREATE POLICY classes_admin_only_update ON public.classes AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'superadmin') OR
    (school_id=public.get_auth_school_id() AND public.has_role(auth.uid(),'admin')))
  WITH CHECK (public.has_role(auth.uid(),'superadmin') OR
    (school_id=public.get_auth_school_id() AND public.has_role(auth.uid(),'admin')));

CREATE OR REPLACE FUNCTION public.fn_validate_class_teacher() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.teacher_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.employees e ON e.profile_id=p.id
      AND e.school_id=NEW.school_id AND e.status='active' AND e.deleted_at IS NULL
    WHERE p.id=NEW.teacher_id AND p.school_id=NEW.school_id AND p.is_active
      AND p.deleted_at IS NULL AND public.has_role(p.id,'teacher')) THEN
    RAISE EXCEPTION 'Class teacher must have active teaching staff access';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_validate_subject_teacher() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.teacher_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.employees e ON e.profile_id=p.id
      AND e.school_id=NEW.school_id AND e.status='active' AND e.deleted_at IS NULL
    WHERE p.id=NEW.teacher_id AND p.school_id=NEW.school_id AND p.is_active
      AND p.deleted_at IS NULL AND public.has_role(p.id,'teacher')) THEN
    RAISE EXCEPTION 'Subject teacher must have active teaching staff access';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_attendance_summary(date),
  public.fn_class_attendance_roster(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_attendance_summary(date),
  public.fn_class_attendance_roster(uuid,date) TO authenticated;

-- Payment recording uses the same active primary/additional role model as other
-- guarded school writes, and locks the invoice to prevent concurrent overpayment.
CREATE OR REPLACE FUNCTION public.fn_record_fee_payment(
  p_invoice uuid, p_amount numeric, p_method text, p_reference text, p_notes text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_transaction uuid;
  v_paid numeric;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id=p_invoice AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF v_invoice.school_id IS DISTINCT FROM public.get_auth_school_id() OR
    NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'accountant')) THEN
    RAISE EXCEPTION 'Payment recording is unavailable';
  END IF;
  IF p_amount IS NULL OR p_amount<=0 OR
    p_amount>v_invoice.amount+COALESCE(v_invoice.late_fee,0)-COALESCE(v_invoice.paid_amount,0) THEN
    RAISE EXCEPTION 'Payment must be positive and no greater than the amount due';
  END IF;
  v_paid := COALESCE(v_invoice.paid_amount,0)+p_amount;
  INSERT INTO public.transactions(school_id,invoice_id,student_id,amount,type,payment_method,
    reference_number,status,notes,processed_by,created_at)
  VALUES(v_invoice.school_id,p_invoice,v_invoice.student_id,p_amount,'payment',p_method,
    COALESCE(NULLIF(btrim(p_reference),''),
      'RCP-'||to_char(now(),'YYYYMM')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,6)),
    'completed',p_notes,auth.uid(),now()) RETURNING id INTO v_transaction;
  UPDATE public.invoices SET paid_amount=v_paid,
    status=CASE WHEN v_paid>=amount+COALESCE(late_fee,0) THEN 'paid' ELSE 'partial' END,
    paid_at=CASE WHEN v_paid>=amount+COALESCE(late_fee,0) THEN now() ELSE paid_at END,
    receipt_count=COALESCE(receipt_count,0)+1 WHERE id=p_invoice;
  RETURN v_transaction;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_record_fee_payment(uuid,numeric,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_record_fee_payment(uuid,numeric,text,text,text) TO authenticated,service_role;

-- Share live primary/additional capability and active target checks across all
-- student RLS paths, including parent reads of a selected child's timetable.
CREATE OR REPLACE FUNCTION public.fn_can_access_student(target_student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles actor JOIN public.profiles student ON student.id=target_student_id
    WHERE actor.id=auth.uid() AND actor.is_active AND actor.deleted_at IS NULL
      AND student.is_active AND student.deleted_at IS NULL AND public.has_role(student.id,'student')
      AND (public.has_role(actor.id,'superadmin') OR
        (actor.school_id=student.school_id AND EXISTS
          (SELECT 1 FROM public.schools s WHERE s.id=actor.school_id AND s.deleted_at IS NULL)
          AND ((actor.id=student.id AND public.has_role(actor.id,'student')) OR
            (public.has_role(actor.id,'parent') AND EXISTS
              (SELECT 1 FROM public.parent_student ps WHERE ps.parent_id=actor.id
                AND ps.student_id=student.id AND ps.school_id=actor.school_id AND ps.status='active')))))
  );
$$;
