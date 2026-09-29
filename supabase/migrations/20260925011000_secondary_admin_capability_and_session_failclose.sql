-- ====================================================================
-- Migration: 20260925011000_secondary_admin_capability_and_session_failclose.sql
-- Description: 
--   1. Harden fn_setup_tenant_user_domain:
--      - Support secondary admin/superadmin capabilities from user_roles via public.has_role()
--      - Validate caller is active and not deleted
--      - Enforce tenant isolation for school-level admins
--      - Prevent user creation in soft-deleted or inactive schools
--      - Preserve existing primary children using COALESCE(_is_primary_guardian, FALSE)
--   2. Harden fn_validate_staff_session to FAIL-CLOSED:
--      - If current JWT session_id claim is missing or unresolvable, DENY with MISSING_AUTH_SESSION_CLAIM
--      - If session does not match active JWT session_id, DENY with SESSION_MISMATCH
-- ====================================================================

-- ────────────────────────────────────────────────────────────────────
-- 1. HARDEN fn_setup_tenant_user_domain
-- ────────────────────────────────────────────────────────────────────
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

    -- 2. Combined parent-student account
    IF _combined_account THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (_user_id, 'parent')
        ON CONFLICT (user_id, role) DO NOTHING;
    END IF;

    -- 3. Membership
    IF _school_id IS NOT NULL THEN
        SELECT id INTO v_system_role
        FROM public.roles
        WHERE name = _role AND is_system IS TRUE
        LIMIT 1;

        INSERT INTO public.memberships (user_id, school_id, role_id, status)
        VALUES (_user_id, _school_id, v_system_role.id, 'active')
        ON CONFLICT (user_id, school_id) DO UPDATE SET
            role_id = EXCLUDED.role_id,
            status = 'active';
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
        -- Self-link
        INSERT INTO public.parent_student (
            parent_id, student_id, school_id, relationship, is_primary, status, created_at, updated_at
        ) VALUES (
            _user_id, _user_id, _school_id, 'self_student', true, 'active', now(), now()
        )
        ON CONFLICT (parent_id, student_id) DO UPDATE SET
            status = 'active',
            is_primary = true,
            updated_at = now();

        -- Guardian link
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
              AND status = 'active';

            -- Primary Child Default Invariant:
            -- First child linked is primary. Subsequent children are NOT primary unless explicitly requested as true.
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
        'user_created',
        jsonb_build_object(
            'target_user_id', _user_id,
            'email', _email,
            'full_name', _full_name,
            'role', _role,
            'school_id', _school_id,
            'class_id', _class_id,
            'guardian_id', _guardian_id
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'user_id', _user_id,
        'role', _role,
        'school_id', _school_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_setup_tenant_user_domain(UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_setup_tenant_user_domain(UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT) TO service_role;


-- ────────────────────────────────────────────────────────────────────
-- 2. HARDEN fn_validate_staff_session (FAIL-CLOSED)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_validate_staff_session(
    _session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_caller_rec RECORD;
    v_session RECORD;
    v_emp_active BOOLEAN;
    v_jwt_session_id UUID;
BEGIN
    IF v_caller_id IS NULL OR _session_token IS NULL OR _session_token = '' THEN
        RETURN jsonb_build_object('is_valid', false);
    END IF;

    -- Caller MUST be an active, non-deleted profile
    SELECT id, role, school_id, is_active, deleted_at INTO v_caller_rec
    FROM public.profiles
    WHERE id = v_caller_id;

    IF v_caller_rec.id IS NULL OR v_caller_rec.is_active IS NOT TRUE OR v_caller_rec.deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object('is_valid', false, 'reason', 'ACCOUNT_INACTIVE_OR_DELETED');
    END IF;

    SELECT s.*, p.must_change
    INTO v_session
    FROM public.staff_unlock_sessions s
    LEFT JOIN public.staff_pins p ON p.user_id = s.user_id AND p.school_id = s.school_id
    WHERE s.session_token = _session_token
      AND s.user_id = v_caller_id
      AND s.is_revoked IS FALSE
      AND s.expires_at > now();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('is_valid', false);
    END IF;

    -- Sessions lacking auth_session_id must fail and be revoked
    IF v_session.auth_session_id IS NULL THEN
        UPDATE public.staff_unlock_sessions
        SET is_revoked = TRUE,
            revoked_reason = 'LEGACY_NULL_AUTH_SESSION',
            revoked_at = now()
        WHERE id = v_session.id;

        RETURN jsonb_build_object('is_valid', false, 'reason', 'LEGACY_NULL_AUTH_SESSION');
    END IF;

    -- Verify active staff employment in employees (unless superadmin)
    IF NOT public.has_role(v_caller_id, 'superadmin') THEN
        SELECT (status = 'active') INTO v_emp_active
        FROM public.employees
        WHERE profile_id = v_caller_id
          AND school_id = v_session.school_id
          AND deleted_at IS NULL
        LIMIT 1;

        IF v_emp_active IS NOT TRUE THEN
            UPDATE public.staff_unlock_sessions
            SET is_revoked = TRUE,
                revoked_reason = 'EMPLOYEE_INACTIVE',
                revoked_at = now()
            WHERE id = v_session.id;

            RETURN jsonb_build_object('is_valid', false, 'reason', 'EMPLOYEE_INACTIVE');
        END IF;
    END IF;

    -- Bind unlock session to current JWT auth session
    BEGIN
        v_jwt_session_id := ((current_setting('request.jwt.claims', true)::jsonb)->>'session_id')::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_jwt_session_id := NULL;
    END;

    -- FAIL-CLOSED: Missing or unextractable session ID in JWT must be rejected
    IF v_jwt_session_id IS NULL THEN
        RETURN jsonb_build_object('is_valid', false, 'reason', 'MISSING_AUTH_SESSION_CLAIM');
    END IF;

    -- Session mismatch between unlock session and current JWT auth session
    IF v_session.auth_session_id <> v_jwt_session_id THEN
        RETURN jsonb_build_object('is_valid', false, 'reason', 'SESSION_MISMATCH');
    END IF;

    RETURN jsonb_build_object(
        'is_valid', true,
        'user_id', v_session.user_id,
        'school_id', v_session.school_id,
        'expires_at', v_session.expires_at,
        'must_change', COALESCE(v_session.must_change, false)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_validate_staff_session(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_validate_staff_session(TEXT) TO authenticated;
