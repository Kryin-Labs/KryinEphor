-- ════════════════════════════════════════════════════════════════════
-- Migration: 20260924240000_post_phase20_security_fixes.sql
-- Description:
--   1. Enforce Admin same-school tenant boundary in fn_setup_or_change_staff_pin (Item 2)
--   2. Enforce Admin same-school tenant boundary in fn_revoke_staff_session (Item 3)
--   3. Restrict fn_admin_set_account_active so School Admin cannot touch NULL-school/platform profiles (Item 4)
--   4. Server-validate guardian relationship in fn_update_guardian_relationship & fn_link_student_guardian (Item 6)
--   5. Fail and revoke legacy staff sessions with NULL auth_session_id in fn_validate_staff_session (Item 7)
--   6. Ensure fn_disable_teacher_access_internal populates revoked_at on staff sessions (Item 8)
--   7. Replace homework SELECT policy with staff-unlocked + assignment-scoped policy (Item 9)
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
-- 1. HARDEN fn_setup_or_change_staff_pin (Item 2)
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_setup_or_change_staff_pin(UUID, UUID, TEXT, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION public.fn_setup_or_change_staff_pin(
    _school_id UUID,
    _target_user_id UUID,
    _new_pin TEXT,
    _current_pin TEXT DEFAULT NULL,
    _is_temporary BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_existing_pin RECORD;
    v_new_hash TEXT;
    v_must_change BOOLEAN;
    v_revoked_count INT;
    v_target_emp_id UUID;
    v_audit_action TEXT;
BEGIN
    v_caller_id := auth.uid();
    v_caller_role := public.get_auth_role();

    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: authentication required';
    END IF;

    -- Validate format: 4 to 8 numeric digits
    IF _new_pin !~ '^[0-9]{4,8}$' THEN
        RAISE EXCEPTION 'Invalid format: PIN must be between 4 and 8 numeric digits';
    END IF;

    -- Fetch employee identity and verify active staff status
    SELECT id INTO v_target_emp_id
    FROM public.employees
    WHERE profile_id = _target_user_id 
      AND school_id = _school_id
      AND status = 'active'
      AND deleted_at IS NULL
    LIMIT 1;

    -- Must have an active staff employment record or superadmin
    IF v_target_emp_id IS NULL AND NOT public.has_role(v_caller_id, 'superadmin') THEN
        RAISE EXCEPTION 'Access denied: staff PIN can only be configured for active staff members';
    END IF;

    -- Lookup existing PIN
    SELECT * INTO v_existing_pin
    FROM public.staff_pins
    WHERE user_id = _target_user_id AND school_id = _school_id;

    -- Check caller permissions & tenant boundary
    IF v_caller_id = _target_user_id THEN
        -- Self setup or change
        IF v_existing_pin.id IS NOT NULL THEN
            IF _current_pin IS NULL OR _current_pin = '' THEN
                RAISE EXCEPTION 'Current PIN is required to change Staff PIN';
            END IF;

            IF extensions.crypt(_current_pin, v_existing_pin.pin_hash) != v_existing_pin.pin_hash THEN
                RAISE EXCEPTION 'Incorrect current PIN';
            END IF;
            v_audit_action := 'staff PIN changed';
        ELSE
            v_audit_action := 'staff PIN configured';
        END IF;

        v_must_change := FALSE;
    ELSE
        -- Admin reset: enforce strict tenant boundary
        IF public.has_role(v_caller_id, 'superadmin') THEN
            NULL; -- Superadmin allowed across tenants
        ELSIF public.has_role(v_caller_id, 'admin') THEN
            IF public.get_auth_school_id() IS NULL OR public.get_auth_school_id() <> _school_id THEN
                RAISE EXCEPTION 'Access denied: cannot reset staff PIN for another school';
            END IF;
        ELSE
            RAISE EXCEPTION 'Access denied: administrator privileges required to reset staff PIN';
        END IF;

        v_must_change := TRUE;
        v_audit_action := 'staff PIN reset';
    END IF;

    -- Generate secure hash using blowfish salt (NEVER log this)
    v_new_hash := extensions.crypt(_new_pin, extensions.gen_salt('bf', 10));

    -- Upsert PIN
    INSERT INTO public.staff_pins (
        user_id,
        school_id,
        pin_hash,
        must_change,
        failed_attempts,
        locked_until,
        created_at,
        updated_at
    ) VALUES (
        _target_user_id,
        _school_id,
        v_new_hash,
        v_must_change,
        0,
        NULL,
        now(),
        now()
    )
    ON CONFLICT (user_id, school_id) DO UPDATE SET
        pin_hash = EXCLUDED.pin_hash,
        must_change = EXCLUDED.must_change,
        failed_attempts = 0,
        locked_until = NULL,
        updated_at = now();

    -- Invalidate all existing unlock sessions upon PIN change/reset
    UPDATE public.staff_unlock_sessions
    SET is_revoked = TRUE,
        revoked_reason = 'PIN_CHANGED',
        revoked_at = now()
    WHERE user_id = _target_user_id
      AND school_id = _school_id
      AND is_revoked IS FALSE;

    GET DIAGNOSTICS v_revoked_count = ROW_COUNT;

    -- Audit log PIN modification
    INSERT INTO public.admin_action_audit (
        actor_id,
        actor_role,
        school_id,
        target_user_id,
        action,
        detail,
        created_at
    ) VALUES (
        v_caller_id,
        v_caller_role,
        _school_id,
        _target_user_id,
        v_audit_action,
        jsonb_build_object(
            'target_user_id', _target_user_id,
            'is_self_service', (v_caller_id = _target_user_id),
            'must_change', v_must_change,
            'sessions_revoked', v_revoked_count
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', CASE WHEN v_caller_id = _target_user_id THEN 'Staff PIN successfully updated' ELSE 'Staff PIN reset by administrator' END,
        'must_change', v_must_change,
        'sessions_revoked', v_revoked_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_setup_or_change_staff_pin(UUID, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_setup_or_change_staff_pin(UUID, UUID, TEXT, TEXT, BOOLEAN) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 2. HARDEN fn_revoke_staff_session (Item 3)
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_revoke_staff_session(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.fn_revoke_staff_session(
    _session_token TEXT,
    _reason TEXT DEFAULT 'manual_lock'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session RECORD;
    v_caller_id UUID := auth.uid();
BEGIN
    IF _session_token IS NULL OR trim(_session_token) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session token required');
    END IF;

    SELECT id, user_id, school_id, is_revoked
    INTO v_session
    FROM public.staff_unlock_sessions
    WHERE session_token = _session_token;

    IF v_session.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session not found');
    END IF;

    -- Only allow the session owner or an admin/superadmin to revoke
    IF v_caller_id <> v_session.user_id THEN
        IF public.has_role(v_caller_id, 'superadmin') THEN
            NULL; -- Allowed
        ELSIF public.has_role(v_caller_id, 'admin') THEN
            IF public.get_auth_school_id() IS NULL OR public.get_auth_school_id() <> v_session.school_id THEN
                RAISE EXCEPTION 'Access denied: cannot revoke staff session for another school';
            END IF;
        ELSE
            RAISE EXCEPTION 'Access denied: cannot revoke another user''s staff unlock session';
        END IF;
    END IF;

    UPDATE public.staff_unlock_sessions
    SET is_revoked = TRUE,
        revoked_at = now(),
        revoked_reason = COALESCE(_reason, 'manual_lock')
    WHERE id = v_session.id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Staff session revoked successfully'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_revoke_staff_session(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_revoke_staff_session(TEXT, TEXT) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 3. HARDEN fn_admin_set_account_active (Item 4)
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_admin_set_account_active(UUID, BOOLEAN, TEXT, UUID);
CREATE OR REPLACE FUNCTION public.fn_admin_set_account_active(
    _target_user_id UUID,
    _is_active BOOLEAN,
    _reason TEXT DEFAULT NULL,
    _school_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_school UUID;
    v_effective_school UUID;
    v_target_profile RECORD;
    v_protected_emails TEXT[] := ARRAY['admin@admin.com', 'superadmin@edunex.com'];
    v_audit_action TEXT;
BEGIN
    v_caller_school := public.get_auth_school_id();

    -- Role and tenant authorization
    IF public.has_role(auth.uid(), 'superadmin') THEN
        v_effective_school := _school_id;
        v_caller_role := 'superadmin';
    ELSIF public.has_role(auth.uid(), 'admin') THEN
        IF v_caller_school IS NULL THEN
            RAISE EXCEPTION 'Access denied: administrator has no assigned school';
        END IF;
        IF _school_id IS NOT NULL AND _school_id <> v_caller_school THEN
            RAISE EXCEPTION 'Access denied: cannot manage accounts for another school';
        END IF;
        v_effective_school := v_caller_school;
        v_caller_role := 'admin';
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    -- Self-deactivation prevention
    IF auth.uid() = _target_user_id AND NOT _is_active THEN
        RAISE EXCEPTION 'You cannot deactivate your own account';
    END IF;

    -- Target user lookup
    SELECT id, email, full_name, role, school_id, is_active
    INTO v_target_profile
    FROM public.profiles
    WHERE id = _target_user_id;

    IF v_target_profile.id IS NULL THEN
        RAISE EXCEPTION 'Target user not found';
    END IF;

    -- Protected root accounts
    IF v_target_profile.email = ANY(v_protected_emails) AND NOT _is_active THEN
        RAISE EXCEPTION 'This root account is protected and cannot be deactivated';
    END IF;

    -- Tenant validation:
    -- School Admin must NEVER manage NULL-school/platform profiles or users from other schools
    IF v_caller_role = 'admin' THEN
        IF v_target_profile.school_id IS NULL OR v_target_profile.school_id <> v_effective_school THEN
            RAISE EXCEPTION 'Access denied: school admin may only manage users belonging to their own school';
        END IF;
    ELSIF v_target_profile.school_id IS NOT NULL AND v_effective_school IS NOT NULL AND v_target_profile.school_id <> v_effective_school THEN
        RAISE EXCEPTION 'Access denied: target user belongs to school %, not selected school %', v_target_profile.school_id, v_effective_school;
    END IF;

    -- If no change needed, return current state
    IF v_target_profile.is_active = _is_active THEN
        RETURN jsonb_build_object(
            'success', true,
            'user_id', _target_user_id,
            'is_active', _is_active,
            'message', 'Account status was already ' || CASE WHEN _is_active THEN 'active' ELSE 'inactive' END
        );
    END IF;

    -- Update profiles.is_active
    UPDATE public.profiles
    SET is_active = _is_active,
        updated_at = now()
    WHERE id = _target_user_id;

    -- If deactivating, also immediately revoke any active staff unlock sessions
    IF NOT _is_active THEN
        UPDATE public.staff_unlock_sessions
        SET is_revoked = TRUE,
            revoked_at = now(),
            revoked_reason = 'account_deactivated'
        WHERE user_id = _target_user_id
          AND is_revoked IS FALSE;
    END IF;

    v_audit_action := CASE WHEN _is_active THEN 'account_activated' ELSE 'account_deactivated' END;

    -- Audit log
    INSERT INTO public.admin_action_audit (
        actor_id,
        actor_role,
        school_id,
        target_user_id,
        action,
        detail,
        created_at
    ) VALUES (
        auth.uid(),
        v_caller_role,
        COALESCE(v_target_profile.school_id, v_effective_school),
        _target_user_id,
        v_audit_action,
        jsonb_build_object(
            'target_user_id', _target_user_id,
            'target_email', v_target_profile.email,
            'target_name', v_target_profile.full_name,
            'target_role', v_target_profile.role,
            'previous_is_active', v_target_profile.is_active,
            'new_is_active', _is_active,
            'reason', _reason
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'user_id', _target_user_id,
        'is_active', _is_active,
        'message', 'Account status updated to ' || CASE WHEN _is_active THEN 'active' ELSE 'inactive' END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_set_account_active(UUID, BOOLEAN, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_set_account_active(UUID, BOOLEAN, TEXT, UUID) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 4. HARDEN GUARDIAN RELATIONSHIP VALIDATION IN RPCs (Item 6)
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_update_guardian_relationship(UUID, UUID, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION public.fn_update_guardian_relationship(
    _link_id UUID,
    _school_id UUID,
    _relationship TEXT,
    _is_primary BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_school UUID;
    v_effective_school UUID;
    v_link RECORD;
    v_old_relationship TEXT;
    v_new_relationship TEXT;
    v_old_is_primary BOOLEAN;
    v_new_is_primary BOOLEAN;
    v_parent_id UUID;
    v_student_id UUID;
    v_parent_name TEXT;
    v_student_name TEXT;
    v_promoted_link_id UUID;
BEGIN
    v_caller_school := public.get_auth_school_id();

    SELECT * INTO v_link FROM public.parent_student WHERE id = _link_id;
    IF v_link.id IS NULL THEN
        RAISE EXCEPTION 'Relationship link not found';
    END IF;

    -- Strict tenant validation
    IF public.has_role(auth.uid(), 'superadmin') THEN
        IF _school_id IS NULL THEN
            RAISE EXCEPTION 'Explicit school context required';
        END IF;
        v_effective_school := _school_id;
        v_caller_role := 'superadmin';
    ELSIF public.has_role(auth.uid(), 'admin') THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot update relationship for another school';
        END IF;
        v_effective_school := v_caller_school;
        v_caller_role := 'admin';
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    -- Validate that target guardian link belongs to effective school
    IF v_link.school_id IS NULL OR v_link.school_id <> v_effective_school THEN
        RAISE EXCEPTION 'Relationship link does not belong to school %', v_effective_school;
    END IF;

    v_parent_id := v_link.parent_id;
    v_student_id := v_link.student_id;
    v_old_relationship := v_link.relationship;
    v_old_is_primary := v_link.is_primary;

    v_new_relationship := COALESCE(NULLIF(TRIM(_relationship), ''), v_old_relationship);
    v_new_is_primary := COALESCE(_is_primary, v_old_is_primary);

    -- Item 6: Server-validate relationship value
    IF LOWER(TRIM(v_new_relationship)) NOT IN (
        'mother', 'father', 'guardian', 'other authorized guardian',
        'primary guardian', 'emergency contact', 'son', 'daughter',
        'ward', 'parent', 'self_student'
    ) THEN
        RAISE EXCEPTION 'Invalid relationship: %. Must be one of: Mother, Father, Guardian, Other authorized guardian, Primary guardian, Emergency contact, Son, Daughter, Ward, Parent, self_student', v_new_relationship;
    END IF;

    SELECT full_name INTO v_student_name FROM public.profiles WHERE id = v_student_id;
    SELECT full_name INTO v_parent_name FROM public.profiles WHERE id = v_parent_id;

    -- Primary Child Invariant:
    IF v_new_is_primary AND NOT v_old_is_primary THEN
        -- When promoting this child, demote all other active children for the SAME parent in this school
        UPDATE public.parent_student
        SET is_primary = FALSE, updated_at = now()
        WHERE parent_id = v_parent_id 
          AND school_id = v_effective_school 
          AND id <> _link_id 
          AND status = 'active'
          AND is_primary = TRUE;
    ELSIF NOT v_new_is_primary AND v_old_is_primary THEN
        -- Attempting to unset primary: an active family MUST have exactly one primary child.
        SELECT id INTO v_promoted_link_id
        FROM public.parent_student
        WHERE parent_id = v_parent_id
          AND school_id = v_effective_school
          AND id <> _link_id
          AND status = 'active'
        ORDER BY created_at ASC
        LIMIT 1;

        IF v_promoted_link_id IS NOT NULL THEN
            -- First demote the current link to avoid transient uniqueness conflict with uq_parent_student_active_primary
            UPDATE public.parent_student
            SET is_primary = FALSE, updated_at = now()
            WHERE id = _link_id;

            -- Then promote the sibling
            UPDATE public.parent_student
            SET is_primary = TRUE, updated_at = now()
            WHERE id = v_promoted_link_id;
        ELSE
            -- No other active child exists; this child MUST remain primary
            v_new_is_primary := TRUE;
        END IF;
    END IF;

    -- Apply update to the target link
    UPDATE public.parent_student
    SET relationship = v_new_relationship,
        is_primary = v_new_is_primary,
        updated_at = now()
    WHERE id = _link_id;

    -- Audit log
    INSERT INTO public.admin_action_audit (
        actor_id,
        actor_role,
        school_id,
        target_user_id,
        action,
        detail,
        created_at
    ) VALUES (
        auth.uid(),
        v_caller_role,
        v_effective_school,
        v_parent_id,
        'guardian_relationship_updated',
        jsonb_build_object(
            'link_id', _link_id,
            'parent_id', v_parent_id,
            'parent_name', v_parent_name,
            'student_id', v_student_id,
            'student_name', v_student_name,
            'old_relationship', v_old_relationship,
            'new_relationship', v_new_relationship,
            'old_is_primary', v_old_is_primary,
            'new_is_primary', v_new_is_primary,
            'promoted_sibling_link_id', v_promoted_link_id
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'link_id', _link_id,
        'relationship', v_new_relationship,
        'is_primary', v_new_is_primary,
        'promoted_sibling_link_id', v_promoted_link_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_update_guardian_relationship(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_guardian_relationship(UUID, UUID, TEXT, BOOLEAN) TO authenticated;


DROP FUNCTION IF EXISTS public.fn_link_student_guardian(UUID, UUID, UUID, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION public.fn_link_student_guardian(
    _school_id UUID,
    _parent_id UUID,
    _student_id UUID,
    _relationship TEXT DEFAULT 'Parent',
    _is_primary BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_school UUID;
    v_effective_school UUID;
    v_parent_role TEXT;
    v_parent_school UUID;
    v_student_role TEXT;
    v_student_school UUID;
    v_link_id UUID;
    v_link_status TEXT;
    v_was_reactivated BOOLEAN := FALSE;
    v_student_name TEXT;
    v_parent_name TEXT;
    v_active_children_count INT := 0;
    v_make_primary BOOLEAN;
BEGIN
    v_caller_school := public.get_auth_school_id();

    IF public.has_role(auth.uid(), 'superadmin') THEN
        IF _school_id IS NULL THEN
            RAISE EXCEPTION 'Explicit school context required';
        END IF;
        v_effective_school := _school_id;
        v_caller_role := 'superadmin';
    ELSIF public.has_role(auth.uid(), 'admin') THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot link students for another school';
        END IF;
        v_effective_school := v_caller_school;
        v_caller_role := 'admin';
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    -- Prevent self-linking
    IF _parent_id = _student_id THEN
        RAISE EXCEPTION 'A user cannot be linked to themselves as a guardian';
    END IF;

    -- Item 6: Server-validate relationship value
    IF LOWER(TRIM(_relationship)) NOT IN (
        'mother', 'father', 'guardian', 'other authorized guardian',
        'primary guardian', 'emergency contact', 'son', 'daughter',
        'ward', 'parent', 'self_student'
    ) THEN
        RAISE EXCEPTION 'Invalid relationship: %. Must be one of: Mother, Father, Guardian, Other authorized guardian, Primary guardian, Emergency contact, Son, Daughter, Ward, Parent, self_student', _relationship;
    END IF;

    -- Validate target student
    SELECT role, school_id, full_name INTO v_student_role, v_student_school, v_student_name
    FROM public.profiles
    WHERE id = _student_id;

    IF v_student_role IS NULL THEN
        RAISE EXCEPTION 'Student profile not found';
    END IF;

    IF v_student_school <> v_effective_school THEN
        RAISE EXCEPTION 'Student does not belong to school %', v_effective_school;
    END IF;

    -- Validate target parent
    SELECT role, school_id, full_name INTO v_parent_role, v_parent_school, v_parent_name
    FROM public.profiles
    WHERE id = _parent_id;

    IF v_parent_role IS NULL THEN
        RAISE EXCEPTION 'Parent profile not found';
    END IF;

    IF v_parent_school <> v_effective_school THEN
        RAISE EXCEPTION 'Parent does not belong to school %', v_effective_school;
    END IF;

    -- Check for existing link
    SELECT id, status INTO v_link_id, v_link_status
    FROM public.parent_student
    WHERE parent_id = _parent_id AND student_id = _student_id;

    -- Primary Child Invariant:
    SELECT COUNT(*) INTO v_active_children_count
    FROM public.parent_student
    WHERE parent_id = _parent_id 
      AND school_id = v_effective_school 
      AND status = 'active'
      AND student_id <> _student_id;

    v_make_primary := CASE 
        WHEN v_active_children_count = 0 THEN TRUE 
        ELSE COALESCE(_is_primary, FALSE) 
    END;

    IF v_make_primary THEN
        UPDATE public.parent_student
        SET is_primary = FALSE, updated_at = now()
        WHERE parent_id = _parent_id 
          AND school_id = v_effective_school 
          AND student_id <> _student_id 
          AND is_primary = TRUE;
    END IF;

    IF v_link_id IS NOT NULL THEN
        UPDATE public.parent_student
        SET status = 'active',
            relationship = _relationship,
            is_primary = v_make_primary,
            school_id = v_effective_school,
            updated_at = now()
        WHERE id = v_link_id;
        v_was_reactivated := (v_link_status <> 'active');
    ELSE
        INSERT INTO public.parent_student (
            parent_id,
            student_id,
            relationship,
            is_primary,
            school_id,
            status,
            created_at,
            updated_at
        ) VALUES (
            _parent_id,
            _student_id,
            _relationship,
            v_make_primary,
            v_effective_school,
            'active',
            now(),
            now()
        ) RETURNING id INTO v_link_id;
    END IF;

    -- Ensure parent capability in user_roles (NEVER modify profiles.is_active!)
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_parent_id, 'parent')
    ON CONFLICT (user_id, role) DO NOTHING;

    -- Audit log
    INSERT INTO public.admin_action_audit (
        actor_id,
        actor_role,
        school_id,
        target_user_id,
        action,
        detail,
        created_at
    ) VALUES (
        auth.uid(),
        v_caller_role,
        v_effective_school,
        _parent_id,
        'child linked',
        jsonb_build_object(
            'link_id', v_link_id,
            'parent_id', _parent_id,
            'parent_name', v_parent_name,
            'student_id', _student_id,
            'student_name', v_student_name,
            'target_student_identity', _student_id,
            'relationship', _relationship,
            'is_primary', v_make_primary,
            'was_reactivated', v_was_reactivated
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'link_id', v_link_id,
        'is_primary', v_make_primary,
        'was_reactivated', v_was_reactivated
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_link_student_guardian(UUID, UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_link_student_guardian(UUID, UUID, UUID, TEXT, BOOLEAN) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 5. HARDEN fn_validate_staff_session & REVOKE NULL AUTH SESSIONS (Item 7)
-- ────────────────────────────────────────────────────────────────────
-- One-time cleanup: revoke any legacy sessions lacking auth_session_id
UPDATE public.staff_unlock_sessions
SET is_revoked = TRUE,
    revoked_reason = 'LEGACY_NULL_AUTH_SESSION',
    revoked_at = now()
WHERE auth_session_id IS NULL
  AND is_revoked IS FALSE;

DROP FUNCTION IF EXISTS public.fn_validate_staff_session(TEXT);
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
    v_session RECORD;
    v_emp_active BOOLEAN;
    v_jwt_session_id UUID;
BEGIN
    IF v_caller_id IS NULL OR _session_token IS NULL OR _session_token = '' THEN
        RETURN jsonb_build_object('is_valid', false);
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

    -- Item 7: Sessions lacking auth_session_id must FAIL and be revoked
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

        -- Verify user still has teacher/staff capability
        IF NOT (
            public.has_role(v_caller_id, 'teacher')
            OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_caller_id AND ur.role = 'teacher')
            OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_caller_id AND p.role = 'teacher')
        ) THEN
            UPDATE public.staff_unlock_sessions
            SET is_revoked = TRUE,
                revoked_reason = 'ROLE_REVOKED',
                revoked_at = now()
            WHERE id = v_session.id;

            RETURN jsonb_build_object('is_valid', false, 'reason', 'ROLE_REVOKED');
        END IF;
    END IF;

    -- Fail-closed Auth session binding verification
    BEGIN
        v_jwt_session_id := COALESCE(
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id')::uuid,
            (nullif(current_setting('request.jwt.claim.session_id', true), ''))::uuid
        );
    EXCEPTION WHEN OTHERS THEN
        v_jwt_session_id := NULL;
    END;

    IF v_jwt_session_id IS NULL OR v_jwt_session_id <> v_session.auth_session_id THEN
        RETURN jsonb_build_object('is_valid', false, 'reason', 'SESSION_MISMATCH');
    END IF;

    -- Update last activity timestamp
    UPDATE public.staff_unlock_sessions
    SET last_activity_at = now()
    WHERE id = v_session.id;

    RETURN jsonb_build_object(
        'is_valid', true,
        'school_id', v_session.school_id,
        'expires_at', v_session.expires_at,
        'must_change', COALESCE(v_session.must_change, false)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_validate_staff_session(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_validate_staff_session(TEXT) TO authenticated;


DROP FUNCTION IF EXISTS public.fn_disable_teacher_access_internal(UUID, UUID, UUID, BOOLEAN, TEXT);
CREATE OR REPLACE FUNCTION public.fn_disable_teacher_access_internal(
    _school_id UUID,
    _target_profile_id UUID,
    _actor_profile_id UUID,
    _clear_assignments BOOLEAN DEFAULT false,
    _notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_target_profile RECORD;
    v_existing_emp RECORD;
    v_actor_role TEXT;
    v_actor_name TEXT;
    v_assigned_classes_count INT := 0;
    v_assigned_subjects_count INT := 0;
    v_assigned_subject_teachers_count INT := 0;
    v_assigned_timetable_count INT := 0;
    v_assigned_online_classes_count INT := 0;
    v_active_children_count INT := 0;
    v_has_parent_role BOOLEAN := FALSE;
    v_new_role TEXT := 'parent';
    v_revoked_session_count INT := 0;
BEGIN
    SELECT id, email, full_name, role, school_id, is_active
    INTO v_target_profile
    FROM public.profiles
    WHERE id = _target_profile_id;

    IF v_target_profile.id IS NULL THEN
        RAISE EXCEPTION 'Target user not found';
    END IF;

    IF v_target_profile.school_id <> _school_id THEN
        RAISE EXCEPTION 'Target user belongs to school %, not %', v_target_profile.school_id, _school_id;
    END IF;

    SELECT full_name, role INTO v_actor_name, v_actor_role
    FROM public.profiles
    WHERE id = _actor_profile_id;

    SELECT * INTO v_existing_emp
    FROM public.employees
    WHERE profile_id = _target_profile_id AND school_id = _school_id;

    SELECT COUNT(*) INTO v_assigned_classes_count
    FROM public.classes
    WHERE teacher_id = _target_profile_id AND school_id = _school_id AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_assigned_subjects_count
    FROM public.subjects
    WHERE teacher_id = _target_profile_id AND school_id = _school_id;

    SELECT COUNT(*) INTO v_assigned_subject_teachers_count
    FROM public.subject_teachers
    WHERE teacher_id = _target_profile_id AND school_id = _school_id;

    SELECT COUNT(*) INTO v_assigned_timetable_count
    FROM public.timetable
    WHERE teacher_id = _target_profile_id AND school_id = _school_id;

    SELECT COUNT(*) INTO v_assigned_online_classes_count
    FROM public.online_classes
    WHERE teacher_id = _target_profile_id 
      AND school_id = _school_id
      AND (status = 'live' OR (status = 'scheduled' AND scheduled_at >= now()))
      AND deleted_at IS NULL;

    IF (v_assigned_classes_count > 0 OR 
        v_assigned_subjects_count > 0 OR 
        v_assigned_subject_teachers_count > 0 OR 
        v_assigned_timetable_count > 0 OR 
        v_assigned_online_classes_count > 0) AND NOT _clear_assignments THEN
        RAISE EXCEPTION 'Active assignments exist (% classes, % subjects, % subject-teacher links, % timetable slots, % active online classes). Cannot disable teacher without explicit assignment clearing authorization.',
            v_assigned_classes_count,
            v_assigned_subjects_count,
            v_assigned_subject_teachers_count,
            v_assigned_timetable_count,
            v_assigned_online_classes_count;
    END IF;

    IF _clear_assignments THEN
        -- A. Classes
        INSERT INTO public.teacher_assignment_history (
            school_id, teacher_id, teacher_name_at_time, employee_id_at_time, designation_at_time,
            assignment_type, class_id, class_name_at_time, source_assignment_id, assigned_at, ended_at,
            unassigned_by, unassigned_by_name_at_time, ended_reason, metadata
        )
        SELECT c.school_id, c.teacher_id, COALESCE(v_existing_emp.staff_person_name, v_target_profile.full_name), v_existing_emp.id, v_existing_emp.designation,
               'class_teacher', c.id, c.name, c.id, NULL, now(),
               _actor_profile_id, v_actor_name, COALESCE(_notes, 'teacher_access_disabled'),
               jsonb_build_object('name', c.name, 'section', c.section, 'grade_level', c.grade_level, 'source_row_created_at', c.created_at)
        FROM public.classes c
        WHERE c.teacher_id = _target_profile_id AND c.school_id = _school_id AND c.deleted_at IS NULL;

        UPDATE public.classes
        SET teacher_id = NULL
        WHERE teacher_id = _target_profile_id AND school_id = _school_id AND deleted_at IS NULL;

        -- B. Subjects
        INSERT INTO public.teacher_assignment_history (
            school_id, teacher_id, teacher_name_at_time, employee_id_at_time, designation_at_time,
            assignment_type, subject_id, subject_name_at_time, class_id, class_name_at_time, source_assignment_id, assigned_at, ended_at,
            unassigned_by, unassigned_by_name_at_time, ended_reason, metadata
        )
        SELECT s.school_id, s.teacher_id, COALESCE(v_existing_emp.staff_person_name, v_target_profile.full_name), v_existing_emp.id, v_existing_emp.designation,
               'subject', s.id, s.name, s.class_id, c.name, s.id, NULL, now(),
               _actor_profile_id, v_actor_name, COALESCE(_notes, 'teacher_access_disabled'),
               jsonb_build_object('name', s.name, 'code', s.code, 'source_row_created_at', s.created_at)
        FROM public.subjects s
        LEFT JOIN public.classes c ON c.id = s.class_id
        WHERE s.teacher_id = _target_profile_id AND s.school_id = _school_id AND s.deleted_at IS NULL;

        UPDATE public.subjects
        SET teacher_id = NULL
        WHERE teacher_id = _target_profile_id AND school_id = _school_id AND deleted_at IS NULL;

        -- C. Subject Teachers
        INSERT INTO public.teacher_assignment_history (
            school_id, teacher_id, teacher_name_at_time, employee_id_at_time, designation_at_time,
            assignment_type, subject_id, subject_name_at_time, class_id, class_name_at_time, source_assignment_id, assigned_at, ended_at,
            unassigned_by, unassigned_by_name_at_time, ended_reason, metadata
        )
        SELECT st.school_id, st.teacher_id, COALESCE(v_existing_emp.staff_person_name, v_target_profile.full_name), v_existing_emp.id, v_existing_emp.designation,
               'subject_teacher', st.subject_id, s.name, st.class_id, c.name, st.id, st.created_at, now(),
               _actor_profile_id, v_actor_name, COALESCE(_notes, 'teacher_access_disabled'),
               jsonb_build_object('subject_id', st.subject_id, 'class_id', st.class_id, 'source_row_created_at', st.created_at)
        FROM public.subject_teachers st
        JOIN public.subjects s ON s.id = st.subject_id
        JOIN public.classes c ON c.id = st.class_id
        WHERE st.teacher_id = _target_profile_id AND st.school_id = _school_id;

        DELETE FROM public.subject_teachers
        WHERE teacher_id = _target_profile_id AND school_id = _school_id;

        -- D. Timetable
        INSERT INTO public.teacher_assignment_history (
            school_id, teacher_id, teacher_name_at_time, employee_id_at_time, designation_at_time,
            assignment_type, subject_id, subject_name_at_time, class_id, class_name_at_time, source_assignment_id, assigned_at, ended_at,
            unassigned_by, unassigned_by_name_at_time, ended_reason, metadata
        )
        SELECT tt.school_id, tt.teacher_id, COALESCE(v_existing_emp.staff_person_name, v_target_profile.full_name), v_existing_emp.id, v_existing_emp.designation,
               'timetable', tt.subject_id, s.name, tt.class_id, c.name, tt.id, NULL, now(),
               _actor_profile_id, v_actor_name, COALESCE(_notes, 'teacher_access_disabled'),
               jsonb_build_object('day_of_week', tt.day_of_week, 'start_time', tt.start_time, 'end_time', tt.end_time, 'room', tt.room, 'source_row_created_at', tt.created_at)
        FROM public.timetable tt
        JOIN public.classes c ON c.id = tt.class_id
        JOIN public.subjects s ON s.id = tt.subject_id
        WHERE tt.teacher_id = _target_profile_id AND tt.school_id = _school_id AND tt.deleted_at IS NULL;

        UPDATE public.timetable
        SET teacher_id = NULL
        WHERE teacher_id = _target_profile_id AND school_id = _school_id AND deleted_at IS NULL;

        -- E. Online Classes
        INSERT INTO public.teacher_assignment_history (
            school_id, teacher_id, teacher_name_at_time, employee_id_at_time, designation_at_time,
            assignment_type, subject_id, subject_name_at_time, class_id, class_name_at_time, source_assignment_id, assigned_at, ended_at,
            unassigned_by, unassigned_by_name_at_time, ended_reason, metadata
        )
        SELECT oc.school_id, oc.teacher_id, COALESCE(v_existing_emp.staff_person_name, v_target_profile.full_name), v_existing_emp.id, v_existing_emp.designation,
               'online_class', oc.subject_id, s.name, oc.class_id, c.name, oc.id, NULL, now(),
               _actor_profile_id, v_actor_name, COALESCE(_notes, 'teacher_access_disabled'),
               jsonb_build_object('title', oc.title, 'scheduled_at', oc.scheduled_at, 'status', oc.status, 'source_row_created_at', oc.created_at)
        FROM public.online_classes oc
        LEFT JOIN public.subjects s ON s.id = oc.subject_id
        LEFT JOIN public.classes c ON c.id = oc.class_id
        WHERE oc.teacher_id = _target_profile_id AND oc.school_id = _school_id
          AND (oc.status = 'live' OR (oc.status = 'scheduled' AND oc.scheduled_at >= now()))
          AND oc.deleted_at IS NULL;

        UPDATE public.online_classes 
        SET teacher_id = NULL, status = 'cancelled'
        WHERE teacher_id = _target_profile_id 
          AND school_id = _school_id
          AND (status = 'live' OR (status = 'scheduled' AND scheduled_at >= now()))
          AND deleted_at IS NULL;
    END IF;

    -- Item 8: Revoke Active Staff Unlock Sessions with explicit revoked_at = now()
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'staff_unlock_sessions'
    ) THEN
        UPDATE public.staff_unlock_sessions
        SET is_revoked = TRUE,
            revoked_at = now(),
            revoked_reason = 'teacher_access_disabled'
        WHERE user_id = _target_profile_id
          AND is_revoked IS FALSE;
        GET DIAGNOSTICS v_revoked_session_count = ROW_COUNT;
    END IF;

    IF v_existing_emp.id IS NOT NULL THEN
        UPDATE public.employees
        SET status = 'inactive'
        WHERE id = v_existing_emp.id;
    END IF;

    DELETE FROM public.user_roles
    WHERE user_id = _target_profile_id
      AND role = 'teacher';

    IF v_target_profile.role = 'teacher' THEN
        SELECT COUNT(*) INTO v_active_children_count
        FROM public.parent_student
        WHERE parent_id = _target_profile_id
          AND school_id = _school_id
          AND status = 'active'
          AND student_id <> _target_profile_id;

        SELECT EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_id = _target_profile_id
              AND role = 'parent'
        ) INTO v_has_parent_role;

        IF v_active_children_count > 0 OR v_has_parent_role THEN
            v_new_role := 'parent';
            UPDATE public.profiles
            SET role = 'parent', updated_at = now()
            WHERE id = _target_profile_id;
        ELSE
            SELECT role INTO v_new_role
            FROM public.user_roles
            WHERE user_id = _target_profile_id AND role <> 'teacher'
            ORDER BY CASE role
                WHEN 'admin' THEN 1
                WHEN 'superadmin' THEN 2
                WHEN 'accountant' THEN 3
                WHEN 'receptionist' THEN 4
                WHEN 'parent' THEN 5
                WHEN 'student' THEN 6
                ELSE 7
            END ASC
            LIMIT 1;

            IF v_new_role IS NOT NULL THEN
                UPDATE public.profiles
                SET role = v_new_role, updated_at = now()
                WHERE id = _target_profile_id;
            ELSE
                v_new_role := 'parent';
                UPDATE public.profiles
                SET role = 'parent', updated_at = now()
                WHERE id = _target_profile_id;
            END IF;
        END IF;
    ELSE
        v_new_role := v_target_profile.role;
    END IF;

    INSERT INTO public.admin_action_audit (
        actor_id,
        actor_role,
        school_id,
        target_user_id,
        action,
        detail,
        created_at
    ) VALUES (
        _actor_profile_id,
        v_actor_role,
        _school_id,
        _target_profile_id,
        'teacher_access_disabled',
        jsonb_build_object(
            'target_profile_id', _target_profile_id,
            'target_user_name', v_target_profile.full_name,
            'cleared_classes', v_assigned_classes_count,
            'cleared_subjects', v_assigned_subjects_count,
            'cleared_subject_teachers', v_assigned_subject_teachers_count,
            'cleared_timetable', v_assigned_timetable_count,
            'cancelled_online_classes', v_assigned_online_classes_count,
            'revoked_staff_sessions', v_revoked_session_count,
            'resulting_primary_role', v_new_role,
            'notes', _notes
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Teacher capability disabled safely',
        'target_profile_id', _target_profile_id,
        'resulting_primary_role', v_new_role,
        'sessions_revoked', v_revoked_session_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_disable_teacher_access_internal(UUID, UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_disable_teacher_access_internal(UUID, UUID, UUID, BOOLEAN, TEXT) TO service_role;


-- ────────────────────────────────────────────────────────────────────
-- 7. HOMEWORK SELECT POLICY: STAFF-UNLOCKED + ASSIGNMENT-SCOPED (Item 9)
-- ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant_select" ON public.homework;
DROP POLICY IF EXISTS "homework_select_policy" ON public.homework;

CREATE POLICY "homework_select_policy"
  ON public.homework FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (
          public.fn_has_valid_staff_unlock(school_id)
          AND (
            teacher_id = auth.uid()
            OR public.fn_is_assigned_teacher_for_class(class_id)
            OR EXISTS (
              SELECT 1 FROM public.subject_teachers st
              WHERE st.class_id = homework.class_id
                AND st.subject_id = homework.subject_id
                AND st.teacher_id = auth.uid()
                AND st.school_id = public.get_auth_school_id()
            )
          )
        )
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.class_enrollments ce
      WHERE ce.class_id = homework.class_id
        AND (
          ce.student_id = auth.uid()
          OR public.fn_can_access_student(ce.student_id)
        )
    )
  );
