-- ====================================================================
-- Migration: 20260915051000_phase16_row_level_security.sql
-- Description: Comprehensive Row Level Security (RLS) hardening across
--              domain tables (profiles, parent_student, attendance,
--              exam_results, classes, subject_teachers, homework,
--              homework_submissions, invoices).
-- ====================================================================

-- 1. HARDEN fn_can_access_student
-- Guarantees strict school tenancy validation and prevents cross-tenant access.
CREATE OR REPLACE FUNCTION public.fn_can_access_student(target_student_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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

    -- Non-superadmin must belong to a valid school tenant
    IF v_actor_school IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Case 1: Caller is the student directly
    IF target_student_id = v_actor_id THEN
        RETURN EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = v_actor_id
              AND (p.role = 'student' OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'student'))
              AND p.school_id = v_actor_school
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
          AND ps.school_id = v_actor_school
          AND s.school_id = v_actor_school
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_can_access_student(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_can_access_student(UUID) TO authenticated, service_role;


-- 2. TEACHER ASSIGNMENT HELPER FUNCTIONS
-- Validates whether an authenticated educator is assigned to a class or exam subject.
CREATE OR REPLACE FUNCTION public.fn_is_assigned_teacher_for_class(_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = _class_id
      AND c.school_id = public.get_auth_school_id()
      AND (
        c.teacher_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.subject_teachers st
          WHERE st.class_id = _class_id
            AND st.teacher_id = auth.uid()
            AND st.school_id = public.get_auth_school_id()
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.fn_is_assigned_teacher_for_class(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_is_assigned_teacher_for_class(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_is_assigned_teacher_for_exam_subject(_exam_subject_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exam_subjects es
    JOIN public.classes c ON c.id = es.class_id
    WHERE es.id = _exam_subject_id
      AND es.school_id = public.get_auth_school_id()
      AND (
        c.teacher_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.subject_teachers st
          WHERE st.class_id = es.class_id
            AND st.subject_id = es.subject_id
            AND st.teacher_id = auth.uid()
            AND st.school_id = public.get_auth_school_id()
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.fn_is_assigned_teacher_for_exam_subject(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_is_assigned_teacher_for_exam_subject(UUID) TO authenticated, service_role;


-- 3. PROFILES: GUARDIAN STUDENT ACCESS
-- Allows parent/guardian to select their linked children's profiles while blocking unlinked students.
DROP POLICY IF EXISTS "profiles_guardian_student_select" ON public.profiles;
CREATE POLICY "profiles_guardian_student_select"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.fn_can_access_student(id));


-- 4. PARENT_STUDENT: CLEAN UP LOOSE/REDUNDANT POLICIES
DROP POLICY IF EXISTS "self_select" ON public.parent_student;
DROP POLICY IF EXISTS "self_delete" ON public.parent_student;
DROP POLICY IF EXISTS "self_insert" ON public.parent_student;
DROP POLICY IF EXISTS "self_update" ON public.parent_student;


-- 5. CLASSES: RESTRICT MUTATIONS TO ADMIN & ASSIGNED TEACHERS
DROP POLICY IF EXISTS "tenant_insert" ON public.classes;
CREATE POLICY "classes_admin_insert"
  ON public.classes FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin')
    OR (school_id = public.get_auth_school_id() AND public.has_role(auth.uid(), 'admin'))
  );

DROP POLICY IF EXISTS "tenant_delete" ON public.classes;
CREATE POLICY "classes_admin_delete"
  ON public.classes FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (school_id = public.get_auth_school_id() AND public.has_role(auth.uid(), 'admin'))
  );

DROP POLICY IF EXISTS "tenant_update" ON public.classes;
CREATE POLICY "classes_update"
  ON public.classes FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (public.has_role(auth.uid(), 'teacher') AND teacher_id = auth.uid())
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (public.has_role(auth.uid(), 'teacher') AND teacher_id = auth.uid())
      )
    )
  );


-- 6. SUBJECT_TEACHERS: RESTRICT ASSIGNMENT MODIFICATIONS TO ADMIN
DROP POLICY IF EXISTS "tenant_insert" ON public.subject_teachers;
CREATE POLICY "subject_teachers_admin_insert"
  ON public.subject_teachers FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin')
    OR (school_id = public.get_auth_school_id() AND public.has_role(auth.uid(), 'admin'))
  );

DROP POLICY IF EXISTS "tenant_update" ON public.subject_teachers;
CREATE POLICY "subject_teachers_admin_update"
  ON public.subject_teachers FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (school_id = public.get_auth_school_id() AND public.has_role(auth.uid(), 'admin'))
  );

DROP POLICY IF EXISTS "tenant_delete" ON public.subject_teachers;
CREATE POLICY "subject_teachers_admin_delete"
  ON public.subject_teachers FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (school_id = public.get_auth_school_id() AND public.has_role(auth.uid(), 'admin'))
  );


-- 7. ATTENDANCE: CLEAN UP DUPLICATE SELECT & SCOPE TEACHER WRITES
DROP POLICY IF EXISTS "tenant_select" ON public.attendance;
DROP POLICY IF EXISTS "attendance_select_policy" ON public.attendance;

CREATE POLICY "attendance_select_policy"
  ON public.attendance FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'teacher')
        OR public.has_role(auth.uid(), 'receptionist')
      )
    )
    OR student_id = auth.uid()
    OR public.fn_can_access_student(student_id)
  );

DROP POLICY IF EXISTS "tenant_insert" ON public.attendance;
CREATE POLICY "attendance_insert_policy"
  ON public.attendance FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'receptionist')
        OR (public.has_role(auth.uid(), 'teacher') AND public.fn_is_assigned_teacher_for_class(class_id))
      )
    )
  );

DROP POLICY IF EXISTS "tenant_update" ON public.attendance;
CREATE POLICY "attendance_update_policy"
  ON public.attendance FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'receptionist')
        OR (public.has_role(auth.uid(), 'teacher') AND public.fn_is_assigned_teacher_for_class(class_id))
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'receptionist')
        OR (public.has_role(auth.uid(), 'teacher') AND public.fn_is_assigned_teacher_for_class(class_id))
      )
    )
  );


-- 8. EXAM_RESULTS: CLEAN UP DUPLICATE SELECT & SCOPE TEACHER MARKS ENTRY
DROP POLICY IF EXISTS "tenant_select" ON public.exam_results;
DROP POLICY IF EXISTS "exam_results_select_policy" ON public.exam_results;

CREATE POLICY "exam_results_select_policy"
  ON public.exam_results FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'teacher')
      )
    )
    OR student_id = auth.uid()
    OR public.fn_can_access_student(student_id)
  );

DROP POLICY IF EXISTS "tenant_insert" ON public.exam_results;
CREATE POLICY "exam_results_insert_policy"
  ON public.exam_results FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (public.has_role(auth.uid(), 'teacher') AND public.fn_is_assigned_teacher_for_exam_subject(exam_subject_id))
      )
    )
  );

DROP POLICY IF EXISTS "tenant_update" ON public.exam_results;
CREATE POLICY "exam_results_update_policy"
  ON public.exam_results FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (public.has_role(auth.uid(), 'teacher') AND public.fn_is_assigned_teacher_for_exam_subject(exam_subject_id))
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (public.has_role(auth.uid(), 'teacher') AND public.fn_is_assigned_teacher_for_exam_subject(exam_subject_id))
      )
    )
  );


-- 9. HOMEWORK & SUBMISSIONS: SCOPE WRITES AND ALLOW GUARDIAN SUBMISSION READ
DROP POLICY IF EXISTS "tenant_insert" ON public.homework;
CREATE POLICY "homework_insert_policy"
  ON public.homework FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (public.has_role(auth.uid(), 'teacher') AND public.fn_is_assigned_teacher_for_class(class_id))
      )
    )
  );

DROP POLICY IF EXISTS "tenant_update" ON public.homework;
CREATE POLICY "homework_update_policy"
  ON public.homework FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (public.has_role(auth.uid(), 'teacher') AND public.fn_is_assigned_teacher_for_class(class_id))
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (public.has_role(auth.uid(), 'teacher') AND public.fn_is_assigned_teacher_for_class(class_id))
      )
    )
  );

DROP POLICY IF EXISTS "tenant_delete" ON public.homework;
CREATE POLICY "homework_delete_policy"
  ON public.homework FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (public.has_role(auth.uid(), 'teacher') AND public.fn_is_assigned_teacher_for_class(class_id))
      )
    )
  );

DROP POLICY IF EXISTS "tenant_select" ON public.homework_submissions;
CREATE POLICY "homework_submissions_select"
  ON public.homework_submissions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'teacher')
      )
    )
    OR student_id = auth.uid()
    OR public.fn_can_access_student(student_id)
  );


-- 10. INVOICES: CLEAN UP DUPLICATE SELECT
DROP POLICY IF EXISTS "tenant_select" ON public.invoices;

