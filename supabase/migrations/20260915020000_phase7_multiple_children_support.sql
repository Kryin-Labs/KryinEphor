-- Migration: 20260915020000_phase7_multiple_children_support.sql
-- Description: Phase 7 - Authoritative multiple children support, hardened fn_can_access_student, multi-child performance RPC, and guardian RLS extensions

-- 1. HARDEN fn_can_access_student
CREATE OR REPLACE FUNCTION public.fn_can_access_student(target_student_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_actor_school UUID;
    v_is_superadmin BOOLEAN;
BEGIN
    IF v_actor_id IS NULL OR target_student_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Check actor profile and school
    SELECT school_id, (role = 'superadmin')
    INTO v_actor_school, v_is_superadmin
    FROM public.profiles
    WHERE id = v_actor_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Superadmin has system-wide access
    IF v_is_superadmin IS TRUE THEN
        RETURN TRUE;
    END IF;

    -- Case 1: Caller is the student directly (legacy combined/single student account)
    IF target_student_id = v_actor_id THEN
        RETURN EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = v_actor_id
              AND p.role = 'student'
              AND p.deleted_at IS NULL
        );
    END IF;

    -- Case 2: Parent/Guardian relationship in public.parent_student
    RETURN EXISTS (
        SELECT 1
        FROM public.parent_student ps
        JOIN public.profiles s ON s.id = ps.student_id AND s.deleted_at IS NULL
        WHERE ps.parent_id = v_actor_id
          AND ps.student_id = target_student_id
          AND ps.status = 'active'
          AND (v_actor_school IS NULL OR ps.school_id = v_actor_school)
          AND (v_actor_school IS NULL OR s.school_id = v_actor_school)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_can_access_student(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_can_access_student(UUID) TO authenticated;


-- 2. ENHANCE fn_get_my_linked_students WITH ACTIVE CLASS & SECTION
DROP FUNCTION IF EXISTS public.fn_get_my_linked_students();
CREATE OR REPLACE FUNCTION public.fn_get_my_linked_students()
RETURNS TABLE (
  student_id UUID,
  full_name TEXT,
  email TEXT,
  school_id UUID,
  relationship TEXT,
  is_primary BOOLEAN,
  status TEXT,
  avatar_url TEXT,
  class_name TEXT,
  section_name TEXT
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH authorized_students AS (
    -- Direct parent_student links
    SELECT
      p.id AS student_id,
      p.full_name,
      p.email,
      ps.school_id,
      ps.relationship,
      ps.is_primary,
      ps.status,
      p.avatar_url
    FROM public.parent_student ps
    JOIN public.profiles p ON p.id = ps.student_id
    WHERE ps.parent_id = auth.uid()
      AND ps.status = 'active'
      AND p.deleted_at IS NULL

    UNION

    -- Backward compatibility for pure student account without self-link row yet
    SELECT
      p.id AS student_id,
      p.full_name,
      p.email,
      p.school_id,
      'self_student' AS relationship,
      TRUE AS is_primary,
      'active' AS status,
      p.avatar_url
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'student'
      AND p.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.parent_student ps WHERE ps.parent_id = auth.uid()
      )
  )
  SELECT
    s.student_id,
    s.full_name,
    s.email,
    s.school_id,
    s.relationship,
    s.is_primary,
    s.status,
    s.avatar_url,
    enrollment.class_name,
    enrollment.section_name
  FROM authorized_students s
  LEFT JOIN LATERAL (
    SELECT c.name AS class_name, c.section AS section_name
    FROM public.class_enrollments ce
    JOIN public.classes c ON c.id = ce.class_id AND c.deleted_at IS NULL
    WHERE ce.student_id = s.student_id
      AND ce.deleted_at IS NULL
    ORDER BY ce.enrolled_at DESC NULLS LAST, c.created_at DESC NULLS LAST
    LIMIT 1
  ) enrollment ON TRUE
  ORDER BY s.is_primary DESC, s.full_name ASC, s.student_id ASC;
$$;

REVOKE ALL ON FUNCTION public.fn_get_my_linked_students() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_my_linked_students() TO authenticated;


-- 3. ENHANCE fn_get_my_persona_summary TO INCLUDE CLASS & SECTION IN JSON
CREATE OR REPLACE FUNCTION public.fn_get_my_persona_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_profile RECORD;
    v_roles TEXT[];
    v_staff_record RECORD;
    v_students JSONB := '[]'::JSONB;
    v_pin_status RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
    END IF;

    -- Fetch profile
    SELECT id, email, full_name, role, school_id
    INTO v_profile
    FROM public.profiles
    WHERE id = v_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'PROFILE_NOT_FOUND');
    END IF;

    -- Fetch assigned roles
    v_roles := public.fn_get_my_roles();
    IF v_roles IS NULL OR array_length(v_roles, 1) IS NULL THEN
        v_roles := ARRAY[v_profile.role];
    END IF;

    -- Fetch staff/employee details if any
    SELECT staff_person_name, designation, department
    INTO v_staff_record
    FROM public.employees
    WHERE profile_id = v_user_id
      AND is_active = TRUE
      AND deleted_at IS NULL
    LIMIT 1;

    -- Fetch linked students/children with class & section
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'student_id', s.student_id,
                'full_name', s.full_name,
                'email', s.email,
                'school_id', s.school_id,
                'relationship', s.relationship,
                'is_primary', s.is_primary,
                'status', s.status,
                'avatar_url', s.avatar_url,
                'class_name', s.class_name,
                'section_name', s.section_name
            ) ORDER BY s.is_primary DESC, s.full_name ASC, s.student_id ASC
        ),
        '[]'::JSONB
    )
    INTO v_students
    FROM public.fn_get_my_linked_students() s;

    -- Fetch staff pin info if staff role exists
    SELECT has_pin, must_change, is_locked, locked_until, attempts_remaining, is_temporary
    INTO v_pin_status
    FROM public.fn_check_staff_pin_status(v_profile.school_id, v_user_id);

    RETURN jsonb_build_object(
        'success', true,
        'user_id', v_user_id,
        'email', v_profile.email,
        'full_name', v_profile.full_name,
        'primary_role', v_profile.role,
        'roles', v_roles,
        'school_id', v_profile.school_id,
        'staff_profile', CASE
            WHEN v_staff_record.staff_person_name IS NOT NULL THEN
                jsonb_build_object(
                    'staff_person_name', v_staff_record.staff_person_name,
                    'designation', v_staff_record.designation,
                    'department', v_staff_record.department
                )
            ELSE NULL
        END,
        'linked_students', v_students,
        'staff_pin_status', to_jsonb(v_pin_status)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_my_persona_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_my_persona_summary() TO authenticated;


-- 4. PARAMETRIZE fn_student_performance_summary FOR SAFE MULTI-CHILD QUERIES
CREATE OR REPLACE FUNCTION public.fn_student_performance_summary(target_student_id UUID DEFAULT NULL)
RETURNS TABLE (
  exam_subject_id UUID,
  exam_name TEXT,
  subject_name TEXT,
  chapter_name TEXT,
  exam_date DATE,
  max_marks NUMERIC,
  your_score NUMERIC,
  class_average NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_resolved_student UUID := target_student_id;
BEGIN
    IF v_actor_id IS NULL THEN
        RETURN;
    END IF;

    -- If target_student_id is not supplied, resolve the primary/default student
    IF v_resolved_student IS NULL THEN
        SELECT s.student_id INTO v_resolved_student
        FROM public.fn_get_my_linked_students() s
        LIMIT 1;
    END IF;

    -- If still null, or caller lacks authoritative access, return empty set (safe denial)
    IF v_resolved_student IS NULL OR NOT public.fn_can_access_student(v_resolved_student) THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH current_enrollment AS (
        SELECT ce.class_id, ce.school_id
        FROM public.class_enrollments ce
        WHERE ce.student_id = v_resolved_student
          AND ce.deleted_at IS NULL
        ORDER BY ce.enrolled_at DESC NULLS LAST, ce.created_at DESC NULLS LAST
        LIMIT 1
    )
    SELECT
        es.id AS exam_subject_id,
        e.name AS exam_name,
        s.name AS subject_name,
        es.chapter_name,
        es.exam_date,
        es.max_marks,
        MAX(er.marks_obtained) FILTER (WHERE er.student_id = v_resolved_student) AS your_score,
        AVG(er.marks_obtained) AS class_average
    FROM current_enrollment ce
    JOIN public.exam_subjects es
      ON es.class_id = ce.class_id
     AND es.school_id = ce.school_id
     AND es.deleted_at IS NULL
    JOIN public.exams e
      ON e.id = es.exam_id
     AND e.deleted_at IS NULL
    JOIN public.subjects s ON s.id = es.subject_id
    JOIN public.exam_results er
      ON er.exam_subject_id = es.id
     AND er.school_id = ce.school_id
     AND er.deleted_at IS NULL
     AND er.is_absent IS NOT TRUE
     AND er.marks_obtained IS NOT NULL
    GROUP BY es.id, e.name, s.name, es.chapter_name, es.exam_date, es.max_marks
    ORDER BY es.exam_date DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_student_performance_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_student_performance_summary(UUID) TO authenticated;


-- 5. SAFELY EXTEND RLS POLICIES FOR GUARDIAN ACCESS
-- class_enrollments
DROP POLICY IF EXISTS tenant_select ON public.class_enrollments;
CREATE POLICY tenant_select ON public.class_enrollments FOR SELECT
USING (
    get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher','receptionist','accountant']))
    OR student_id = auth.uid()
    OR public.fn_can_access_student(student_id)
);

-- invoices
DROP POLICY IF EXISTS invoices_select_guardian ON public.invoices;
CREATE POLICY invoices_select_guardian ON public.invoices FOR SELECT
USING (
    get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','accountant']))
    OR student_id = auth.uid()
    OR public.fn_can_access_student(student_id)
);

-- invoice_items
DROP POLICY IF EXISTS inv_items_select ON public.invoice_items;
CREATE POLICY inv_items_select ON public.invoice_items FOR SELECT
USING (
    get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','accountant']))
    OR EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.id = invoice_items.invoice_id
          AND (i.student_id = auth.uid() OR public.fn_can_access_student(i.student_id))
    )
);

-- student_fee_assignments
DROP POLICY IF EXISTS sfa_tenant_select ON public.student_fee_assignments;
CREATE POLICY sfa_tenant_select ON public.student_fee_assignments FOR SELECT
USING (
    get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','accountant']))
    OR student_id = auth.uid()
    OR public.fn_can_access_student(student_id)
);

-- additional_charges
DROP POLICY IF EXISTS ac_tenant_select ON public.additional_charges;
CREATE POLICY ac_tenant_select ON public.additional_charges FOR SELECT
USING (
    get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','accountant','teacher']))
    OR student_id = auth.uid()
    OR public.fn_can_access_student(student_id)
);

-- transactions
DROP POLICY IF EXISTS tenant_select ON public.transactions;
CREATE POLICY tenant_select ON public.transactions FOR SELECT
USING (
    get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','accountant']))
    OR student_id = auth.uid()
    OR public.fn_can_access_student(student_id)
);

-- attendance
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_select_policy ON public.attendance;
CREATE POLICY attendance_select_policy ON public.attendance FOR SELECT
USING (
    get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher','receptionist']))
    OR student_id = auth.uid()
    OR public.fn_can_access_student(student_id)
);

-- exam_results
ALTER TABLE public.exam_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exam_results_select_policy ON public.exam_results;
CREATE POLICY exam_results_select_policy ON public.exam_results FOR SELECT
USING (
    get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher']))
    OR student_id = auth.uid()
    OR public.fn_can_access_student(student_id)
);
