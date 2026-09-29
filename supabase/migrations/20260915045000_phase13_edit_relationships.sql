-- ════════════════════════════════════════════════════════════════════
-- Phase 13 Migration: Edit Child / Family Relationships
-- 
-- Hardens public.fn_update_guardian_relationship:
-- 1. Enforces tenant isolation for superadmin and same-school admin.
-- 2. Supports canonical relationships:
--    'Mother', 'Father', 'Guardian', 'Other authorized guardian',
--    'Primary guardian', 'Emergency contact', 'Son', 'Daughter', 'Ward'.
-- 3. If 'Primary guardian' is selected, atomically treats as primary.
-- 4. Atomically rotates primary designation (demoting prior primary links).
-- 5. Preserves accounts: auth.users and profiles remain 100% untouched.
-- 6. Fixes canonical audit insert into public.admin_action_audit
--    (uses detail column, omits id for identity sequence, populates actor_role).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_update_guardian_relationship(
    _school_id UUID,
    _link_id UUID,
    _relationship TEXT DEFAULT NULL,
    _is_primary BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_school UUID;
    v_effective_school UUID;
    v_link_school UUID;
    v_parent_id UUID;
    v_student_id UUID;
    v_old_relationship TEXT;
    v_old_primary BOOLEAN;
    v_target_primary BOOLEAN;
    v_target_relationship TEXT;
    v_parent_name TEXT;
    v_student_name TEXT;
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role = 'superadmin' THEN
        v_effective_school := _school_id;
    ELSIF v_caller_role = 'admin' THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot update relationship for another school';
        END IF;
        v_effective_school := v_caller_school;
    ELSE
        RAISE EXCEPTION 'Access denied: only school admins can update family relationships';
    END IF;

    -- Fetch current link
    SELECT ps.school_id, ps.parent_id, ps.student_id, ps.relationship, ps.is_primary,
           p_parent.full_name, p_student.full_name
    INTO v_link_school, v_parent_id, v_student_id, v_old_relationship, v_old_primary,
         v_parent_name, v_student_name
    FROM public.parent_student ps
    JOIN public.profiles p_parent ON p_parent.id = ps.parent_id
    JOIN public.profiles p_student ON p_student.id = ps.student_id
    WHERE ps.id = _link_id;

    IF v_link_school IS NULL THEN
        RAISE EXCEPTION 'Parent-student link not found: %', _link_id;
    END IF;

    IF v_link_school <> v_effective_school THEN
        RAISE EXCEPTION 'Link does not belong to school %', v_effective_school;
    END IF;

    -- Clean relationship string
    v_target_relationship := COALESCE(NULLIF(btrim(_relationship), ''), v_old_relationship);

    -- If relationship is 'Primary guardian', auto-treat as primary
    IF lower(v_target_relationship) = 'primary guardian' THEN
        v_target_primary := true;
    ELSE
        v_target_primary := COALESCE(_is_primary, v_old_primary);
    END IF;

    -- If promoting to primary, demote any other active children of this parent first
    IF v_target_primary AND NOT v_old_primary THEN
        UPDATE public.parent_student
        SET is_primary = false, updated_at = now()
        WHERE parent_id = v_parent_id
          AND school_id = v_effective_school
          AND id <> _link_id
          AND is_primary = true;
    END IF;

    -- Update only relationship metadata and primary status (Accounts remain untouched)
    UPDATE public.parent_student
    SET relationship = v_target_relationship,
        is_primary = v_target_primary,
        updated_at = now()
    WHERE id = _link_id;

    -- Canonical Audit log (uses detail column, omits id for identity sequence, populates actor_role)
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
        'update_student_guardian_relationship',
        jsonb_build_object(
            'link_id', _link_id,
            'parent_id', v_parent_id,
            'parent_name', v_parent_name,
            'student_id', v_student_id,
            'student_name', v_student_name,
            'old_relationship', v_old_relationship,
            'new_relationship', v_target_relationship,
            'old_primary', v_old_primary,
            'new_primary', v_target_primary
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
        'relationship', v_target_relationship,
        'is_primary', v_target_primary
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_update_guardian_relationship(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_guardian_relationship(UUID, UUID, TEXT, BOOLEAN) TO authenticated;
