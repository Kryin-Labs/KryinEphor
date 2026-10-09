-- Migration: 20261009180000_student_parent_search_and_persona_hardening.sql
-- Description: Fix parent/guardian account search, student dual student+parent capability,
--              persona summary role handling, and student module relationship resolution.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. FIX fn_search_guardians_for_student
-- ════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.fn_search_guardians_for_student(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.fn_search_guardians_for_student(
    _school_id UUID,
    _query TEXT DEFAULT ''
)
RETURNS TABLE (
    guardian_id UUID,
    email TEXT,
    full_name TEXT,
    phone TEXT,
    primary_role TEXT,
    roles TEXT[],
    is_active BOOLEAN,
    has_staff_role BOOLEAN,
    staff_person_name TEXT,
    designation TEXT,
    department TEXT,
    linked_children_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_school UUID;
    v_clean TEXT;
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role <> 'superadmin' AND (v_caller_school IS NULL OR v_caller_school <> _school_id) THEN
        RAISE EXCEPTION 'Access denied: cannot search accounts for another school';
    END IF;

    v_clean := btrim(COALESCE(_query, ''));
    -- By default, display no search results until a query is entered
    IF v_clean = '' THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH user_roles_agg AS (
        SELECT
            ur.user_id,
            ARRAY_AGG(DISTINCT ur.role::TEXT) AS roles
        FROM public.user_roles ur
        GROUP BY ur.user_id
    )
    SELECT
        p.id AS guardian_id,
        p.email::TEXT,
        COALESCE(p.full_name, '')::TEXT AS full_name,
        p.phone::TEXT AS phone,
        p.role::TEXT AS primary_role,
        COALESCE(
            (
                SELECT array_agg(DISTINCT r)
                FROM unnest(ARRAY[p.role::TEXT] || COALESCE(ura.roles, ARRAY[]::TEXT[])) AS r
                WHERE r IS NOT NULL
            ),
            ARRAY[p.role::TEXT]
        ) AS roles,
        COALESCE(p.is_active, true) AS is_active,
        EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.profile_id = p.id
              AND e.school_id = _school_id
              AND e.deleted_at IS NULL
              AND e.status = 'active'
        ) AS has_staff_role,
        emp.staff_person_name::TEXT,
        emp.designation::TEXT,
        emp.department::TEXT,
        COUNT(ps.student_id) FILTER (WHERE ps.status = 'active' AND ps.student_id <> p.id) AS linked_children_count
    FROM public.profiles p
    LEFT JOIN user_roles_agg ura ON ura.user_id = p.id
    LEFT JOIN public.employees emp ON emp.profile_id = p.id AND emp.school_id = _school_id AND emp.deleted_at IS NULL
    LEFT JOIN public.parent_student ps ON ps.parent_id = p.id AND ps.school_id = _school_id
    WHERE p.school_id = _school_id
      AND p.deleted_at IS NULL
      AND (
          p.email ILIKE '%' || v_clean || '%'
          OR p.full_name ILIKE '%' || v_clean || '%'
          OR (p.phone IS NOT NULL AND p.phone ILIKE '%' || v_clean || '%')
          OR (emp.staff_person_name IS NOT NULL AND emp.staff_person_name ILIKE '%' || v_clean || '%')
      )
      -- Eligible as guardian: user has parent or staff/admin role or employee record or is not a pure student
      AND (
          p.role <> 'student'
          OR 'parent' = ANY(COALESCE(ura.roles, ARRAY[]::TEXT[]))
          OR 'teacher' = ANY(COALESCE(ura.roles, ARRAY[]::TEXT[]))
          OR emp.id IS NOT NULL
      )
    GROUP BY p.id, p.email, p.full_name, p.phone, p.role, ura.roles, p.is_active, emp.staff_person_name, emp.designation, emp.department
    ORDER BY has_staff_role DESC, p.full_name ASC
    LIMIT 30;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_search_guardians_for_student(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_search_guardians_for_student(UUID, TEXT) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. FIX fn_get_my_persona_summary
-- ════════════════════════════════════════════════════════════════════════════
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
    v_pin_status JSONB := '{}'::JSONB;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
    END IF;

    -- Fetch profile
    SELECT id, email, full_name, role, school_id, student_status
    INTO v_profile
    FROM public.profiles
    WHERE id = v_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'PROFILE_NOT_FOUND');
    END IF;

    -- Fetch assigned roles safely into TEXT[] array
    SELECT ARRAY(SELECT public.fn_get_my_roles()) INTO v_roles;
    IF v_roles IS NULL OR array_length(v_roles, 1) IS NULL THEN
        v_roles := ARRAY[v_profile.role];
    END IF;
    IF NOT (v_profile.role = ANY(v_roles)) THEN
        v_roles := array_append(v_roles, v_profile.role);
    END IF;

    -- Fetch staff/employee details if any (status = 'active', NOT is_active)
    SELECT staff_person_name, designation, department
    INTO v_staff_record
    FROM public.employees
    WHERE profile_id = v_user_id
      AND status = 'active'
      AND deleted_at IS NULL
    LIMIT 1;

    -- Fetch linked students/children with class, section & student_status
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
                'section_name', s.section_name,
                'student_status', s.student_status
            ) ORDER BY s.is_primary DESC, s.full_name ASC, s.student_id ASC
        ),
        '[]'::JSONB
    )
    INTO v_students
    FROM public.fn_get_my_linked_students() s;

    -- Fetch staff pin info if school is assigned
    IF v_profile.school_id IS NOT NULL THEN
        v_pin_status := public.fn_check_staff_pin_status(v_profile.school_id, v_user_id);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'user_id', v_user_id,
        'email', v_profile.email,
        'full_name', v_profile.full_name,
        'primary_role', v_profile.role,
        'student_status', v_profile.student_status,
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
        'staff_pin_status', v_pin_status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_my_persona_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_my_persona_summary() TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 3. FIX fn_get_my_linked_students (Always Include Self If Student Role Exists)
-- ════════════════════════════════════════════════════════════════════════════
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
  section_name TEXT,
  student_status TEXT
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH authorized_students AS (
    -- Direct parent_student links: returns all active links regardless of student_status
    SELECT
      p.id AS student_id,
      p.full_name,
      p.email,
      ps.school_id,
      ps.relationship,
      ps.is_primary,
      ps.status,
      p.avatar_url,
      COALESCE(p.student_status, 'active') AS student_status
    FROM public.parent_student ps
    JOIN public.profiles p ON p.id = ps.student_id
    WHERE ps.parent_id = auth.uid()
      AND ps.status = 'active'
      AND p.deleted_at IS NULL

    UNION

    -- Always include own student identity if caller has student capability and self-link row is missing
    SELECT
      p.id AS student_id,
      p.full_name,
      p.email,
      p.school_id,
      'self_student' AS relationship,
      TRUE AS is_primary,
      'active' AS status,
      p.avatar_url,
      COALESCE(p.student_status, 'active') AS student_status
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (p.role = 'student' OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'student'))
      AND p.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.parent_student ps 
        WHERE ps.parent_id = auth.uid() 
          AND ps.student_id = auth.uid() 
          AND ps.status = 'active'
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
    enrollment.section_name,
    s.student_status
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


-- ════════════════════════════════════════════════════════════════════════════
-- 4. HARDEN fn_setup_tenant_user_domain (Ensure Student Dual Student+Parent Capability)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_setup_tenant_user_domain(
    _user_id UUID,
    _email TEXT,
    _full_name TEXT,
    _role TEXT,
    _school_id UUID,
    _caller_id UUID,
    _class_id UUID DEFAULT NULL,
    _guardian_id UUID DEFAULT NULL,
    _guardian_relationship TEXT DEFAULT 'Parent',
    _is_primary_guardian BOOLEAN DEFAULT NULL,
    _combined_account BOOLEAN DEFAULT FALSE,
    _employee_designation TEXT DEFAULT NULL,
    _employee_department TEXT DEFAULT NULL,
    _employee_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_school UUID;
    v_norm_rel TEXT;
    v_guardian_profile RECORD;
    v_system_role RECORD;
    v_other_children_count INT := 0;
    v_should_be_primary BOOLEAN;
BEGIN
    -- Verify caller exists, is active, and is not deleted
    SELECT school_id INTO v_caller_school
    FROM public.profiles
    WHERE id = _caller_id AND is_active IS TRUE AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access denied: caller account is inactive or deleted';
    END IF;

    -- Authoritative role capability determination (supports profiles.role and user_roles)
    IF public.has_role(_caller_id, 'superadmin') THEN
        v_caller_role := 'superadmin';
    ELSIF public.has_role(_caller_id, 'admin') THEN
        v_caller_role := 'admin';
    ELSE
        RAISE EXCEPTION 'Access denied: admin authorization required';
    END IF;

    IF v_caller_role = 'admin' AND (v_caller_school IS NULL OR v_caller_school <> _school_id) THEN
        RAISE EXCEPTION 'Access denied: school admin may only configure users for their own school';
    END IF;

    -- Validate target school is not deleted and active
    IF _school_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.schools
            WHERE id = _school_id
              AND deleted_at IS NULL
              AND (status IS NULL OR status = 'active' OR status = 'Active')
        ) THEN
            RAISE EXCEPTION 'Target school % is deleted or not active', _school_id;
        END IF;
    END IF;

    -- 1. Profile Upsert
    INSERT INTO public.profiles (
        id, email, login_id, full_name, role, school_id, is_active, created_at, updated_at
    ) VALUES (
        _user_id, _email, _email, _full_name, _role, _school_id, true, now(), now()
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        login_id = EXCLUDED.login_id,
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        school_id = EXCLUDED.school_id,
        is_active = true,
        updated_at = now();

    -- 2. Role capabilities setup
    IF _role = 'student' THEN
        -- Every student account also has parent persona capability
        INSERT INTO public.user_roles (user_id, role)
        VALUES (_user_id, 'student'), (_user_id, 'parent')
        ON CONFLICT (user_id, role) DO NOTHING;
    ELSIF _combined_account THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (_user_id, _role), (_user_id, 'parent')
        ON CONFLICT (user_id, role) DO NOTHING;
    ELSE
        INSERT INTO public.user_roles (user_id, role)
        VALUES (_user_id, _role)
        ON CONFLICT (user_id, role) DO NOTHING;
    END IF;

    -- 3. Membership
    IF _school_id IS NOT NULL THEN
        SELECT id INTO v_system_role
        FROM public.roles
        WHERE name = _role AND is_system IS TRUE
        LIMIT 1;

        IF v_system_role.id IS NOT NULL THEN
            INSERT INTO public.memberships (user_id, school_id, role_id, status)
            VALUES (_user_id, _school_id, v_system_role.id, 'active')
            ON CONFLICT (user_id, school_id) DO UPDATE SET
                role_id = EXCLUDED.role_id,
                status = 'active';
        END IF;
    END IF;

    -- 4. Teacher employee record
    IF _role = 'teacher' THEN
        INSERT INTO public.employees (
            profile_id, school_id, designation, department, status, staff_person_name
        ) VALUES (
            _user_id,
            _school_id,
            COALESCE(NULLIF(TRIM(_employee_designation), ''), 'Teacher'),
            COALESCE(NULLIF(TRIM(_employee_department), ''), 'Academics'),
            'active',
            COALESCE(NULLIF(TRIM(_employee_name), ''), _full_name)
        )
        ON CONFLICT (profile_id) DO UPDATE SET
            school_id = EXCLUDED.school_id,
            designation = EXCLUDED.designation,
            department = EXCLUDED.department,
            status = 'active',
            staff_person_name = EXCLUDED.staff_person_name;
    END IF;

    -- 5. Student domain setup (Self-link & Guardian link)
    IF _role = 'student' THEN
        -- Self-link (ensures student can view own academic profile in parent persona)
        INSERT INTO public.parent_student (
            parent_id, student_id, school_id, relationship, is_primary, status, created_at, updated_at
        ) VALUES (
            _user_id, _user_id, _school_id, 'self_student', true, 'active', now(), now()
        )
        ON CONFLICT (parent_id, student_id) DO UPDATE SET
            status = 'active',
            is_primary = true,
            updated_at = now();

        -- Guardian link (links student to existing parent/guardian account without overwriting self-link)
        IF _guardian_id IS NOT NULL THEN
            SELECT id, school_id, is_active, deleted_at INTO v_guardian_profile
            FROM public.profiles
            WHERE id = _guardian_id;

            IF v_guardian_profile.id IS NULL THEN
                RAISE EXCEPTION 'Selected guardian not found';
            END IF;

            IF v_guardian_profile.deleted_at IS NOT NULL THEN
                RAISE EXCEPTION 'Selected guardian account is deleted';
            END IF;

            IF v_guardian_profile.school_id IS NULL OR v_guardian_profile.school_id <> _school_id THEN
                RAISE EXCEPTION 'Selected guardian belongs to a different school';
            END IF;

            -- Validate relationship against canonical whitelist
            v_norm_rel := LOWER(TRIM(COALESCE(_guardian_relationship, '')));
            IF v_norm_rel = 'self_student' OR v_norm_rel NOT IN (
                'mother', 'father', 'guardian', 'legal guardian', 'parent',
                'son', 'daughter', 'child', 'ward', 'other authorized guardian',
                'primary guardian', 'emergency contact'
            ) THEN
                RAISE EXCEPTION 'Invalid guardian relationship: %', _guardian_relationship;
            END IF;

            SELECT COUNT(*) INTO v_other_children_count
            FROM public.parent_student
            WHERE parent_id = _guardian_id
              AND school_id = _school_id
              AND status = 'active'
              AND student_id <> _guardian_id;

            -- Primary Child Default Invariant:
            -- First non-self child linked is primary. Subsequent children are NOT primary unless explicitly requested as true.
            v_should_be_primary := (v_other_children_count = 0) OR COALESCE(_is_primary_guardian, FALSE);

            IF v_should_be_primary THEN
                UPDATE public.parent_student
                SET is_primary = FALSE, updated_at = now()
                WHERE parent_id = _guardian_id
                  AND school_id = _school_id
                  AND status = 'active'
                  AND is_primary = TRUE;
            END IF;

            INSERT INTO public.parent_student (
                parent_id, student_id, school_id, relationship, is_primary, status, created_by, created_at, updated_at
            ) VALUES (
                _guardian_id, _user_id, _school_id, _guardian_relationship, v_should_be_primary, 'active', _caller_id, now(), now()
            )
            ON CONFLICT (parent_id, student_id) DO UPDATE SET
                relationship = EXCLUDED.relationship,
                is_primary = EXCLUDED.is_primary,
                status = 'active',
                updated_at = now();

            -- Ensure guardian has parent role in user_roles
            INSERT INTO public.user_roles (user_id, role)
            VALUES (_guardian_id, 'parent')
            ON CONFLICT (user_id, role) DO NOTHING;

            INSERT INTO public.admin_action_audit (
                actor_id, actor_role, school_id, target_user_id, action, detail, created_at
            ) VALUES (
                _caller_id,
                v_caller_role,
                _school_id,
                _guardian_id,
                'child linked',
                jsonb_build_object(
                    'parent_id', _guardian_id,
                    'student_id', _user_id,
                    'student_name', _full_name,
                    'relationship', _guardian_relationship,
                    'is_primary', v_should_be_primary,
                    'created_new_student', true
                ),
                now()
            );
        END IF;
    END IF;

    -- 6. Class enrollment (if provided)
    IF _class_id IS NOT NULL THEN
        -- Verify class belongs to this school and is not deleted
        IF NOT EXISTS (
            SELECT 1 FROM public.classes
            WHERE id = _class_id AND school_id = _school_id AND deleted_at IS NULL
        ) THEN
            RAISE EXCEPTION 'Target class % not found or not active in this school', _class_id;
        END IF;

        INSERT INTO public.class_enrollments (class_id, school_id, student_id, enrolled_at)
        VALUES (_class_id, _school_id, _user_id, now())
        ON CONFLICT (class_id, student_id) DO UPDATE SET
            deleted_at = NULL;
    END IF;

    -- 7. Audit log user creation
    INSERT INTO public.admin_action_audit (
        actor_id, actor_role, school_id, target_user_id, action, detail, created_at
    ) VALUES (
        _caller_id,
        v_caller_role,
        _school_id,
        _user_id,
        'user created',
        jsonb_build_object(
            'email', _email,
            'full_name', _full_name,
            'role', _role,
            'has_class', _class_id IS NOT NULL,
            'has_guardian', _guardian_id IS NOT NULL
        ),
        now()
    );

    RETURN jsonb_build_object('success', true, 'user_id', _user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_setup_tenant_user_domain(UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_setup_tenant_user_domain(UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT) TO service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 5. DATA BACKFILL: ENSURE ALL EXISTING STUDENTS HAVE PARENT ROLE & SELF-LINK
-- ════════════════════════════════════════════════════════════════════════════
-- Ensure 'parent' role in user_roles for all existing student profiles
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, 'parent'
FROM public.profiles p
WHERE (p.role = 'student' OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'student'))
  AND p.deleted_at IS NULL
ON CONFLICT (user_id, role) DO NOTHING;

-- Ensure self-link in parent_student for all existing student profiles
INSERT INTO public.parent_student (parent_id, student_id, school_id, relationship, is_primary, status)
SELECT p.id, p.id, p.school_id, 'self_student', true, 'active'
FROM public.profiles p
WHERE (p.role = 'student' OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'student'))
  AND p.deleted_at IS NULL
ON CONFLICT (parent_id, student_id) DO UPDATE SET
  status = 'active';


-- ════════════════════════════════════════════════════════════════════════════
-- 6. FIX fn_student_performance_summary (Remove invalid ce.created_at order)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_student_performance_summary(target_student_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(exam_subject_id uuid, exam_name text, subject_name text, chapter_name text, exam_date date, max_marks numeric, your_score numeric, class_average numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
        ORDER BY ce.enrolled_at DESC NULLS LAST
        LIMIT 1
    )
    SELECT
        es.id AS exam_subject_id,
        e.name AS exam_name,
        s.name AS subject_name,
        es.chapter_name,
        es.exam_date,
        es.max_marks::numeric AS max_marks,
        (MAX(er.marks_obtained) FILTER (WHERE er.student_id = v_resolved_student))::numeric AS your_score,
        (AVG(er.marks_obtained))::numeric AS class_average
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
$function$;

GRANT EXECUTE ON FUNCTION public.fn_student_performance_summary(uuid) TO authenticated;

