-- ════════════════════════════════════════════════════════════════════
-- Post-Phase-10 Identity, Family, Staff & Security Hardening
-- Migration: 20260924201000_post_phase10_identity_hardening.sql
-- 
-- 1. Phase 10 Hardening: fn_set_student_status
--    - Student lifecycle NEVER touches profiles.is_active.
--    - Target student capability verified via public.has_role() or user_roles.
--    - Caller authority verified via public.has_role() (superadmin/admin).
--    - Superadmin requires explicit _school_id context.
--
-- 2. Phase 11 Hardening: fn_unlink_student_guardian
--    - Superadmin requires explicit _school_id context.
--    - Caller authority verified via public.has_role().
--    - Deterministic compatibility role selection when remaining children = 0.
--    - Returns has_active_persona = false without deleting or deactivating account.
--
-- 3. Phase 12 Hardening: fn_link_student_guardian
--    - Linking child NEVER reactivates a disabled account (profiles.is_active untouched).
--    - Never mutates profiles.roles (pure user_roles capability model).
--    - First active child is automatically primary.
--    - Promoting child demotes by (parent_id, school_id) — NEVER by student_id.
--    - Superadmin requires explicit _school_id context.
--
-- 4. Phase 13 Hardening: fn_update_guardian_relationship
--    - Promoting child demotes other active links for SAME parent (parent_id, school_id).
--    - Unsetting primary deterministically promotes another active child if available.
--    - Rejects unsetting primary if it is the only active child.
--
-- 5. Authoritative Account State Management: fn_admin_set_account_active
--    - Server-authoritative RPC for account activation/deactivation with audit
--      and staff unlock session revocation.
--
-- 6. Primary Child Invariant:
--    - Normalizes existing parent_student links (no duplicate primaries, no orphan families).
--    - Enforces uq_parent_student_active_primary.
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
-- 1. DATA NORMALIZATION FOR PRIMARY CHILD INVARIANT
-- ────────────────────────────────────────────────────────────────────

-- Step A: If any parent has multiple active primary children, keep only the most recently updated as primary
WITH ranked_primaries AS (
    SELECT id, parent_id, school_id,
           ROW_NUMBER() OVER (
               PARTITION BY parent_id, school_id 
               ORDER BY updated_at DESC, created_at ASC, id ASC
           ) AS rn
    FROM public.parent_student
    WHERE status = 'active' AND is_primary = TRUE
)
UPDATE public.parent_student ps
SET is_primary = FALSE, updated_at = now()
FROM ranked_primaries rp
WHERE ps.id = rp.id AND rp.rn > 1;

-- Step B: If any parent has active children but ZERO primary children, promote the most recently updated active child
WITH active_families_without_primary AS (
    SELECT ps.parent_id, ps.school_id
    FROM public.parent_student ps
    WHERE ps.status = 'active'
    GROUP BY ps.parent_id, ps.school_id
    HAVING COUNT(*) FILTER (WHERE ps.is_primary = TRUE) = 0
),
candidate_to_promote AS (
    SELECT DISTINCT ON (ps.parent_id, ps.school_id)
           ps.id
    FROM public.parent_student ps
    JOIN active_families_without_primary f 
      ON ps.parent_id = f.parent_id AND ps.school_id = f.school_id
    WHERE ps.status = 'active'
    ORDER BY ps.parent_id, ps.school_id, ps.updated_at DESC, ps.created_at ASC
)
UPDATE public.parent_student
SET is_primary = TRUE, updated_at = now()
WHERE id IN (SELECT id FROM candidate_to_promote);

-- Ensure partial unique index exists
CREATE UNIQUE INDEX IF NOT EXISTS uq_parent_student_active_primary 
ON public.parent_student (parent_id, school_id) 
WHERE (status = 'active' AND is_primary = true);


-- ────────────────────────────────────────────────────────────────────
-- 2. HARDEN fn_set_student_status
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_set_student_status(
    _school_id UUID,
    _student_id UUID,
    _new_status TEXT,
    _reason TEXT DEFAULT NULL,
    _notes TEXT DEFAULT NULL
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
    v_old_status TEXT;
    v_target_role TEXT;
    v_target_school UUID;
    v_student_name TEXT;
    v_audit_action TEXT;
    v_has_student_capability BOOLEAN := FALSE;
BEGIN
    v_caller_school := public.get_auth_school_id();

    -- Derive caller role using canonical has_role helpers
    IF public.has_role(auth.uid(), 'superadmin') THEN
        IF _school_id IS NULL THEN
            RAISE EXCEPTION 'Explicit school context required';
        END IF;
        v_effective_school := _school_id;
        v_caller_role := 'superadmin';
    ELSIF public.has_role(auth.uid(), 'admin') THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot modify student status for another school';
        END IF;
        v_effective_school := v_caller_school;
        v_caller_role := 'admin';
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    -- Validate new status
    IF _new_status NOT IN ('active', 'withdrawn', 'transferred', 'graduated', 'inactive', 'archived') THEN
        RAISE EXCEPTION 'Invalid student status: %. Must be active, withdrawn, transferred, graduated, inactive, or archived', _new_status;
    END IF;

    -- Fetch target student
    SELECT role, school_id, student_status, full_name
    INTO v_target_role, v_target_school, v_old_status, v_student_name
    FROM public.profiles
    WHERE id = _student_id;

    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'Student not found';
    END IF;

    -- Check student capability (primary role or user_roles)
    v_has_student_capability := (v_target_role = 'student') OR EXISTS (
        SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _student_id AND ur.role = 'student'
    );

    IF NOT v_has_student_capability THEN
        RAISE EXCEPTION 'Target user does not have student capability (role: %)', v_target_role;
    END IF;

    IF v_target_school IS NULL OR v_target_school <> v_effective_school THEN
        RAISE EXCEPTION 'Student does not belong to school %', v_effective_school;
    END IF;

    -- Update profile student_status and metadata departure info ONLY.
    -- NEVER modify profiles.is_active. Student lifecycle is independent from account/login container.
    -- Account activation/deactivation is a separate explicit admin action.
    UPDATE public.profiles
    SET student_status = _new_status,
        metadata = jsonb_set(
            coalesce(metadata, '{}'::jsonb),
            '{departure_info}',
            jsonb_build_object(
                'status', _new_status,
                'previous_status', coalesce(v_old_status, 'active'),
                'reason', _reason,
                'notes', _notes,
                'updated_at', now(),
                'updated_by', auth.uid()
            )
        ),
        updated_at = now()
    WHERE id = _student_id;

    -- Determine canonical audit action name
    IF _new_status = 'archived' OR _new_status = 'inactive' THEN
        v_audit_action := 'student archived';
    ELSIF _new_status = 'withdrawn' THEN
        v_audit_action := 'student withdrawn';
    ELSE
        v_audit_action := 'student status changed';
    END IF;

    -- Canonical Audit log
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
        _student_id,
        v_audit_action,
        jsonb_build_object(
            'student_id', _student_id,
            'student_name', v_student_name,
            'previous_status', coalesce(v_old_status, 'active'),
            'new_status', _new_status,
            'reason', _reason,
            'notes', _notes
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'student_id', _student_id,
        'student_name', v_student_name,
        'previous_status', coalesce(v_old_status, 'active'),
        'new_status', _new_status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_set_student_status(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_set_student_status(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 3. HARDEN fn_unlink_student_guardian
-- ────────────────────────────────────────────────────────────────────
-- Drop legacy 3-argument overload from Phase 18 to eliminate RPC overload ambiguity
DROP FUNCTION IF EXISTS public.fn_unlink_student_guardian(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION public.fn_unlink_student_guardian(
    _school_id UUID,
    _link_id UUID
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
    v_parent_id UUID;
    v_student_id UUID;
    v_was_primary BOOLEAN;
    v_link_school UUID;
    v_next_link_id UUID;
    v_student_name TEXT;
    v_parent_name TEXT;
    v_parent_current_role TEXT;
    v_remaining_children INT := 0;
    v_has_active_teacher BOOLEAN := false;
    v_other_staff_role TEXT := null;
    v_new_primary_role TEXT := null;
    v_has_active_persona BOOLEAN := true;
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
            RAISE EXCEPTION 'Access denied: cannot unlink accounts for another school';
        END IF;
        v_effective_school := v_caller_school;
        v_caller_role := 'admin';
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    -- Locate target relationship
    SELECT parent_id, student_id, is_primary, school_id
    INTO v_parent_id, v_student_id, v_was_primary, v_link_school
    FROM public.parent_student
    WHERE id = _link_id;

    IF v_parent_id IS NULL THEN
        RAISE EXCEPTION 'Family link not found';
    END IF;

    IF v_link_school IS NULL OR v_link_school <> v_effective_school THEN
        RAISE EXCEPTION 'Link does not belong to school %', v_effective_school;
    END IF;

    SELECT full_name INTO v_student_name FROM public.profiles WHERE id = v_student_id;
    SELECT full_name, role INTO v_parent_name, v_parent_current_role FROM public.profiles WHERE id = v_parent_id;

    -- Mark link inactive (revokes access immediately; never deletes student or academic records)
    UPDATE public.parent_student
    SET status = 'inactive',
        is_primary = false,
        updated_at = now()
    WHERE id = _link_id;

    -- Check remaining active children in the same school
    SELECT COUNT(*) INTO v_remaining_children
    FROM public.parent_student
    WHERE parent_id = v_parent_id
      AND school_id = v_effective_school
      AND status = 'active';

    -- If this was the primary child and other children remain, promote the next active child deterministically
    IF v_was_primary AND v_remaining_children > 0 THEN
        SELECT id INTO v_next_link_id
        FROM public.parent_student
        WHERE parent_id = v_parent_id
          AND school_id = v_effective_school
          AND status = 'active'
        ORDER BY updated_at DESC, created_at ASC
        LIMIT 1;

        IF v_next_link_id IS NOT NULL THEN
            UPDATE public.parent_student
            SET is_primary = true, updated_at = now()
            WHERE id = v_next_link_id;
        END IF;
    END IF;

    -- If 0 active children remain, evaluate other capabilities
    IF v_remaining_children = 0 THEN
        -- Check active teacher capability
        SELECT EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.profile_id = v_parent_id
              AND e.school_id = v_effective_school
              AND e.status = 'active'
              AND e.deleted_at IS NULL
              AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_parent_id AND ur.role = 'teacher')
        ) INTO v_has_active_teacher;

        -- Check other staff capabilities in deterministic priority order
        IF NOT v_has_active_teacher THEN
            SELECT ur.role INTO v_other_staff_role
            FROM public.user_roles ur
            WHERE ur.user_id = v_parent_id
              AND ur.role IN ('admin', 'principal', 'accountant', 'receptionist')
            ORDER BY CASE ur.role
                WHEN 'admin' THEN 1
                WHEN 'principal' THEN 2
                WHEN 'accountant' THEN 3
                WHEN 'receptionist' THEN 4
                ELSE 99
            END ASC
            LIMIT 1;
        END IF;

        IF v_has_active_teacher THEN
            v_new_primary_role := 'teacher';
            UPDATE public.profiles
            SET role = 'teacher', updated_at = now()
            WHERE id = v_parent_id;
            v_has_active_persona := true;
        ELSIF v_other_staff_role IS NOT NULL THEN
            v_new_primary_role := v_other_staff_role;
            UPDATE public.profiles
            SET role = v_other_staff_role, updated_at = now()
            WHERE id = v_parent_id;
            v_has_active_persona := true;
        ELSE
            -- No teacher, no staff, no children: no active school persona remaining.
            -- DO NOT delete Auth/profile, and DO NOT set is_active = false implicitly.
            v_has_active_persona := false;
        END IF;
    END IF;

    -- Canonical Audit log
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
        'unlink_student_guardian',
        jsonb_build_object(
            'link_id', _link_id,
            'parent_id', v_parent_id,
            'parent_name', v_parent_name,
            'student_id', v_student_id,
            'student_name', v_student_name,
            'was_primary', v_was_primary,
            'promoted_next_primary_link_id', v_next_link_id,
            'remaining_children_count', v_remaining_children,
            'has_active_teacher', v_has_active_teacher,
            'other_staff_role', v_other_staff_role,
            'new_primary_role', v_new_primary_role,
            'has_active_persona', v_has_active_persona
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'link_id', _link_id,
        'parent_id', v_parent_id,
        'parent_name', v_parent_name,
        'student_id', v_student_id,
        'student_name', v_student_name,
        'was_primary', v_was_primary,
        'next_primary_link_id', v_next_link_id,
        'remaining_children_count', v_remaining_children,
        'has_active_teacher', v_has_active_teacher,
        'new_primary_role', v_new_primary_role,
        'has_active_persona', v_has_active_persona
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_unlink_student_guardian(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_unlink_student_guardian(UUID, UUID) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 4. HARDEN fn_link_student_guardian
-- ────────────────────────────────────────────────────────────────────
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

    -- Validate target student
    SELECT role, school_id, full_name INTO v_student_role, v_student_school, v_student_name
    FROM public.profiles
    WHERE id = _student_id;

    IF v_student_role IS NULL THEN
        RAISE EXCEPTION 'Student profile not found';
    END IF;

    IF v_student_role <> 'student' AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _student_id AND ur.role = 'student'
    ) THEN
        RAISE EXCEPTION 'Target user is not a student (role: %)', v_student_role;
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
    -- Count other active children for this parent in this school
    SELECT COUNT(*) INTO v_active_children_count
    FROM public.parent_student
    WHERE parent_id = _parent_id 
      AND school_id = v_effective_school 
      AND status = 'active'
      AND student_id <> _student_id;

    -- If this is the parent's only active child, it MUST be primary; otherwise honor _is_primary
    v_make_primary := CASE 
        WHEN v_active_children_count = 0 THEN TRUE 
        ELSE COALESCE(_is_primary, FALSE) 
    END;

    -- If this child is being made primary, demote any other active primary links for SAME parent
    -- (Scoped strictly by parent_id and school_id — NEVER by student_id!)
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
            school_id,
            relationship,
            is_primary,
            status,
            created_at,
            updated_at
        ) VALUES (
            _parent_id,
            _student_id,
            v_effective_school,
            _relationship,
            v_make_primary,
            'active',
            now(),
            now()
        )
        RETURNING id INTO v_link_id;
        v_was_reactivated := FALSE;
    END IF;

    -- Ensure 'parent' capability in user_roles ONLY
    -- DO NOT mutate profiles.roles
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_parent_id, 'parent')
    ON CONFLICT (user_id, role) DO NOTHING;

    -- CRITICAL: NEVER modify profiles.is_active!
    -- A family link mutation must NOT silently reactivate a disabled account.

    -- Canonical Audit log: child linked
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
            'parent_id', _parent_id,
            'parent_name', v_parent_name,
            'student_id', _student_id,
            'student_name', v_student_name,
            'target_student_identity', _student_id,
            'relationship', _relationship,
            'is_primary', v_make_primary,
            'was_reactivated', v_was_reactivated,
            'previous_state', CASE WHEN v_was_reactivated THEN 'unlinked' ELSE 'none' END,
            'new_state', 'linked'
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'link_id', v_link_id,
        'was_reactivated', v_was_reactivated,
        'parent_id', _parent_id,
        'student_id', _student_id,
        'relationship', _relationship,
        'is_primary', v_make_primary
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_link_student_guardian(UUID, UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_link_student_guardian(UUID, UUID, UUID, TEXT, BOOLEAN) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 5. HARDEN fn_update_guardian_relationship
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_update_guardian_relationship(
    _school_id UUID,
    _link_id UUID,
    _relationship TEXT DEFAULT NULL,
    _is_primary BOOLEAN DEFAULT NULL
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
    v_old_is_primary BOOLEAN;
    v_new_relationship TEXT;
    v_new_is_primary BOOLEAN;
    v_parent_id UUID;
    v_student_id UUID;
    v_student_name TEXT;
    v_parent_name TEXT;
    v_promoted_link_id UUID;
BEGIN
    v_caller_school := public.get_auth_school_id();

    SELECT * INTO v_link FROM public.parent_student WHERE id = _link_id;
    IF v_link.id IS NULL THEN
        RAISE EXCEPTION 'Relationship link not found';
    END IF;

    v_parent_id := v_link.parent_id;
    v_student_id := v_link.student_id;
    v_old_relationship := v_link.relationship;
    v_old_is_primary := v_link.is_primary;
    v_effective_school := v_link.school_id;

    IF public.has_role(auth.uid(), 'superadmin') THEN
        v_caller_role := 'superadmin';
    ELSIF public.has_role(auth.uid(), 'admin') THEN
        IF v_caller_school IS NULL OR (v_effective_school IS NOT NULL AND v_effective_school <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot update relationship for another school';
        END IF;
        v_caller_role := 'admin';
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    v_new_relationship := COALESCE(NULLIF(TRIM(_relationship), ''), v_old_relationship);
    v_new_is_primary := COALESCE(_is_primary, v_old_is_primary);

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
        -- Deterministically promote another active child if available.
        SELECT id INTO v_promoted_link_id
        FROM public.parent_student
        WHERE parent_id = v_parent_id
          AND school_id = v_effective_school
          AND id <> _link_id
          AND status = 'active'
        ORDER BY updated_at DESC, created_at ASC
        LIMIT 1;

        IF v_promoted_link_id IS NOT NULL THEN
            -- First demote the current link to avoid transient uniqueness conflict with uq_parent_student_active_primary
            UPDATE public.parent_student
            SET is_primary = FALSE, updated_at = now()
            WHERE id = _link_id;

            -- Then promote the replacement active child
            UPDATE public.parent_student
            SET is_primary = TRUE, updated_at = now()
            WHERE id = v_promoted_link_id;
        ELSE
            -- Cannot unset the only active child as primary
            RAISE EXCEPTION 'Cannot unset primary: family account must have at least one primary active child';
        END IF;
    END IF;

    UPDATE public.parent_student
    SET relationship = v_new_relationship,
        is_primary = v_new_is_primary,
        updated_at = now()
    WHERE id = _link_id;

    -- Canonical Audit log: guardian relationship edited
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
        'guardian relationship edited',
        jsonb_build_object(
            'link_id', _link_id,
            'parent_id', v_parent_id,
            'parent_name', v_parent_name,
            'student_id', v_student_id,
            'student_name', v_student_name,
            'target_student_identity', v_student_id,
            'promoted_link_id', v_promoted_link_id,
            'previous_state', jsonb_build_object(
                'relationship', v_old_relationship,
                'is_primary', v_old_is_primary
            ),
            'new_state', jsonb_build_object(
                'relationship', v_new_relationship,
                'is_primary', v_new_is_primary
            )
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'link_id', _link_id,
        'parent_id', v_parent_id,
        'student_id', v_student_id,
        'relationship', v_new_relationship,
        'is_primary', v_new_is_primary,
        'previous_relationship', v_old_relationship,
        'previous_is_primary', v_old_is_primary,
        'promoted_link_id', v_promoted_link_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_update_guardian_relationship(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_guardian_relationship(UUID, UUID, TEXT, BOOLEAN) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 6. AUTHORITATIVE ACCOUNT MUTATION: fn_admin_set_account_active
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_admin_set_account_active(
    _school_id UUID,
    _target_user_id UUID,
    _is_active BOOLEAN,
    _reason TEXT DEFAULT NULL
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
    v_audit_action TEXT;
    v_protected_emails TEXT[] := ARRAY['admin@admin.com', 'superadmin@edunex.com'];
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
            RAISE EXCEPTION 'Access denied: cannot modify account status for another school';
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

    -- Tenant validation
    IF v_caller_role = 'admin' AND v_target_profile.school_id <> v_effective_school THEN
        RAISE EXCEPTION 'Access denied: target user belongs to another school';
    END IF;

    -- If deactivating, automatically revoke active staff unlock sessions immediately
    IF NOT _is_active THEN
        UPDATE public.staff_unlock_sessions
        SET is_revoked = TRUE,
            revoked_reason = 'account_deactivated',
            revoked_at = now()
        WHERE user_id = _target_user_id AND is_revoked = FALSE;
    END IF;

    -- Authoritative status update
    UPDATE public.profiles
    SET is_active = _is_active,
        updated_at = now()
    WHERE id = _target_user_id;

    v_audit_action := CASE WHEN _is_active THEN 'account_reactivated' ELSE 'account_deactivated' END;

    -- Canonical Audit log
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
        _target_user_id,
        v_audit_action,
        jsonb_build_object(
            'target_id', _target_user_id,
            'target_name', v_target_profile.full_name,
            'target_email', v_target_profile.email,
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
        'action', v_audit_action
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_set_account_active(UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_set_account_active(UUID, UUID, BOOLEAN, TEXT) TO authenticated;
