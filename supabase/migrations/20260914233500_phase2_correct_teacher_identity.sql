-- ════════════════════════════════════════════════════════════════════
-- PHASE 2 MIGRATION — Correct Teacher Identity & Validation
-- Date: 2026-09-14
-- Enforces that teacher assignments require valid staff identity/teaching capability
-- and updates administrative teacher counts.
-- ════════════════════════════════════════════════════════════════════

-- 1. TRIGGER TO VALIDATE CLASS TEACHER ASSIGNMENT
CREATE OR REPLACE FUNCTION public.fn_validate_class_teacher()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_teacher_school UUID;
  v_teacher_deleted TIMESTAMPTZ;
  v_is_active BOOLEAN;
  v_is_valid_staff BOOLEAN;
BEGIN
  IF NEW.teacher_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT school_id, deleted_at, is_active
    INTO v_teacher_school, v_teacher_deleted, v_is_active
    FROM public.profiles
   WHERE id = NEW.teacher_id;

  IF v_teacher_school IS NULL THEN
    RAISE EXCEPTION 'Assigned teacher does not exist or has no school assigned';
  END IF;

  IF v_teacher_school <> NEW.school_id THEN
    RAISE EXCEPTION 'Cross-tenant assignment forbidden: teacher school (%) does not match class school (%)', v_teacher_school, NEW.school_id;
  END IF;

  IF v_teacher_deleted IS NOT NULL OR v_is_active = false THEN
    RAISE EXCEPTION 'Cannot assign deleted or inactive teacher to class';
  END IF;

  -- Validate active staff membership or teacher role
  SELECT (
    EXISTS (
      SELECT 1 FROM public.employees e
       WHERE e.profile_id = NEW.teacher_id
         AND e.school_id = NEW.school_id
         AND e.status = 'active'
         AND e.deleted_at IS NULL
    ) OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = NEW.teacher_id
         AND p.role = 'teacher'
    ) OR EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = NEW.teacher_id
         AND ur.role = 'teacher'
    )
  ) AND NOT (
    -- Exclude pure students without active staff membership
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = NEW.teacher_id
         AND p.role = 'student'
         AND NOT EXISTS (
           SELECT 1 FROM public.employees e
            WHERE e.profile_id = NEW.teacher_id
              AND e.status = 'active'
              AND e.deleted_at IS NULL
         )
    )
  ) INTO v_is_valid_staff;

  IF NOT v_is_valid_staff THEN
    RAISE EXCEPTION 'Assigned user does not hold a valid active staff or teacher identity';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_class_teacher ON public.classes;
CREATE TRIGGER trg_validate_class_teacher
  BEFORE INSERT OR UPDATE OF teacher_id ON public.classes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_class_teacher();

-- 2. TRIGGER TO VALIDATE SUBJECT TEACHER ASSIGNMENT
CREATE OR REPLACE FUNCTION public.fn_validate_subject_teacher()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_teacher_school UUID;
  v_teacher_deleted TIMESTAMPTZ;
  v_is_active BOOLEAN;
  v_is_valid_staff BOOLEAN;
BEGIN
  IF NEW.teacher_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT school_id, deleted_at, is_active
    INTO v_teacher_school, v_teacher_deleted, v_is_active
    FROM public.profiles
   WHERE id = NEW.teacher_id;

  IF v_teacher_school IS NULL THEN
    RAISE EXCEPTION 'Assigned teacher does not exist or has no school assigned';
  END IF;

  IF v_teacher_school <> NEW.school_id THEN
    RAISE EXCEPTION 'Cross-tenant assignment forbidden: teacher school (%) does not match subject teacher school (%)', v_teacher_school, NEW.school_id;
  END IF;

  IF v_teacher_deleted IS NOT NULL OR v_is_active = false THEN
    RAISE EXCEPTION 'Cannot assign deleted or inactive teacher to subject';
  END IF;

  SELECT (
    EXISTS (
      SELECT 1 FROM public.employees e
       WHERE e.profile_id = NEW.teacher_id
         AND e.school_id = NEW.school_id
         AND e.status = 'active'
         AND e.deleted_at IS NULL
    ) OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = NEW.teacher_id
         AND p.role = 'teacher'
    ) OR EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = NEW.teacher_id
         AND ur.role = 'teacher'
    )
  ) AND NOT (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = NEW.teacher_id
         AND p.role = 'student'
         AND NOT EXISTS (
           SELECT 1 FROM public.employees e
            WHERE e.profile_id = NEW.teacher_id
              AND e.status = 'active'
              AND e.deleted_at IS NULL
         )
    )
  ) INTO v_is_valid_staff;

  IF NOT v_is_valid_staff THEN
    RAISE EXCEPTION 'Assigned user does not hold a valid active staff or teacher identity';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_subject_teacher ON public.subject_teachers;
CREATE TRIGGER trg_validate_subject_teacher
  BEFORE INSERT OR UPDATE OF teacher_id ON public.subject_teachers
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_subject_teacher();

-- 3. ACCURATE TEACHER COUNT IN ADMIN STATS
CREATE OR REPLACE FUNCTION public.fn_admin_dashboard_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_school UUID := get_auth_school_id();
  v_role TEXT := get_auth_role();
  v_students INT := 0; v_teachers INT := 0; v_classes INT := 0;
  v_month_revenue NUMERIC := 0; v_pending NUMERIC := 0; v_overdue NUMERIC := 0;
  v_paid_count INT := 0; v_pending_count INT := 0;
  v_collection_pct NUMERIC := 0;
  v_top_payers JSONB;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin','accountant','superadmin') THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;
  IF v_school IS NULL AND v_role <> 'superadmin' THEN
    RETURN jsonb_build_object('error','no school context');
  END IF;

  SELECT COUNT(*) INTO v_students FROM public.profiles
   WHERE school_id = v_school AND role = 'student' AND is_active = true AND deleted_at IS NULL;

  -- Count genuine educators with active staff membership or teacher role, excluding unprivileged students
  SELECT COUNT(DISTINCT p.id) INTO v_teachers
    FROM public.profiles p
   WHERE p.school_id = v_school
     AND p.is_active = true
     AND p.deleted_at IS NULL
     AND (
       p.role = 'teacher'
       OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'teacher')
       OR EXISTS (SELECT 1 FROM public.employees e WHERE e.profile_id = p.id AND e.school_id = v_school AND e.status = 'active' AND e.deleted_at IS NULL)
     )
     AND NOT (
       p.role = 'student'
       AND NOT EXISTS (SELECT 1 FROM public.employees e2 WHERE e2.profile_id = p.id AND e2.status = 'active' AND e2.deleted_at IS NULL)
     );

  SELECT COUNT(*) INTO v_classes FROM public.classes
   WHERE school_id = v_school AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount),0) INTO v_month_revenue
    FROM public.transactions
   WHERE school_id = v_school AND type='payment' AND status='completed'
     AND created_at >= date_trunc('month', now());

  SELECT COALESCE(SUM(amount - COALESCE(paid_amount,0)),0),
         COUNT(*) FILTER (WHERE status='paid'),
         COUNT(*) FILTER (WHERE status IN ('pending','partial','overdue'))
    INTO v_pending, v_paid_count, v_pending_count
    FROM public.invoices
   WHERE school_id = v_school AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount - COALESCE(paid_amount,0)),0) INTO v_overdue
    FROM public.invoices
   WHERE school_id = v_school AND status='overdue' AND deleted_at IS NULL;

  IF (v_paid_count + v_pending_count) > 0 THEN
    v_collection_pct := ROUND(v_paid_count::numeric * 100 / (v_paid_count + v_pending_count), 1);
  END IF;

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_top_payers FROM (
    SELECT p.full_name AS name, p.id AS student_id,
           SUM(tx.amount) AS total_paid
      FROM public.transactions tx
      JOIN public.profiles p ON p.id = tx.student_id
     WHERE tx.school_id = v_school AND tx.type='payment' AND tx.status='completed'
       AND tx.created_at >= date_trunc('month', now())
     GROUP BY p.id, p.full_name
     ORDER BY total_paid DESC
     LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'students', v_students,
    'teachers', v_teachers,
    'classes', v_classes,
    'month_revenue', v_month_revenue,
    'pending_amount', v_pending,
    'overdue_amount', v_overdue,
    'paid_invoices', v_paid_count,
    'pending_invoices', v_pending_count,
    'collection_pct', v_collection_pct,
    'top_payers', v_top_payers
  );
END $function$;
