-- ════════════════════════════════════════════════════════════════════
-- Phase 14 Migration: Duplicate Detection
--
-- 1. fn_detect_duplicate_identities:
--    Detects probable and exact duplicate identities when adding Teacher,
--    Parent, or Child access within the tenant school.
--    - Exact identifiers: verified email, verified phone, admission number / login ID, employee code.
--    - Probable identifiers: matching full name within the same school.
--    - Never silently merges: returns candidate identities with match reasons
--      so admin explicitly chooses between linking existing identity or creating new person.
--
-- 2. fn_audit_duplicate_decision:
--    Audits the administrator's explicit duplicate resolution decision
--    into public.admin_action_audit with full context.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_detect_duplicate_identities(
    _school_id UUID,
    _name TEXT DEFAULT NULL,
    _email TEXT DEFAULT NULL,
    _phone TEXT DEFAULT NULL,
    _admission_number TEXT DEFAULT NULL,
    _employee_number TEXT DEFAULT NULL,
    _role TEXT DEFAULT NULL
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
    v_clean_name TEXT;
    v_clean_email TEXT;
    v_clean_phone TEXT;
    v_clean_adm TEXT;
    v_clean_emp TEXT;
    v_results JSONB;
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role = 'superadmin' THEN
        v_effective_school := _school_id;
    ELSIF v_caller_role = 'admin' THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot check duplicates for another school';
        END IF;
        v_effective_school := v_caller_school;
    ELSE
        RAISE EXCEPTION 'Access denied: only school admins can perform duplicate detection';
    END IF;

    IF v_effective_school IS NULL THEN
        RAISE EXCEPTION 'School ID is required for duplicate detection';
    END IF;

    v_clean_name := NULLIF(btrim(_name), '');
    v_clean_email := NULLIF(lower(btrim(_email)), '');
    v_clean_phone := NULLIF(btrim(_phone), '');
    v_clean_adm := NULLIF(lower(btrim(_admission_number)), '');
    v_clean_emp := NULLIF(lower(btrim(_employee_number)), '');

    -- If no search terms provided, return empty
    IF v_clean_name IS NULL AND v_clean_email IS NULL AND v_clean_phone IS NULL AND v_clean_adm IS NULL AND v_clean_emp IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;

    WITH candidate_matches AS (
        SELECT 
            p.id,
            p.full_name,
            p.email,
            p.role AS primary_role,
            p.phone,
            p.login_id,
            p.is_active,
            e.employee_code,
            e.designation,
            e.department,
            cls.class_name,
            cls.section_name,
            ARRAY_REMOVE(ARRAY[
                CASE WHEN v_clean_email IS NOT NULL AND (lower(p.email) = v_clean_email OR lower(COALESCE(p.recovery_email, '')) = v_clean_email) THEN 'Exact email match: ' || p.email ELSE NULL END,
                CASE WHEN v_clean_phone IS NOT NULL AND (btrim(COALESCE(p.phone, '')) = v_clean_phone OR btrim(COALESCE(p.emergency_contact, '')) = v_clean_phone) THEN 'Exact phone match: ' || p.phone ELSE NULL END,
                CASE WHEN v_clean_adm IS NOT NULL AND lower(COALESCE(p.login_id, '')) = v_clean_adm THEN 'Exact admission number / Login ID match: ' || p.login_id ELSE NULL END,
                CASE WHEN v_clean_emp IS NOT NULL AND lower(COALESCE(e.employee_code, '')) = v_clean_emp THEN 'Exact employee code match: ' || e.employee_code ELSE NULL END,
                CASE WHEN v_clean_name IS NOT NULL AND length(v_clean_name) >= 3 AND lower(btrim(p.full_name)) = lower(v_clean_name) THEN 'Probable match: identical full name in school' ELSE NULL END
            ], NULL) AS match_reasons,
            CASE 
                WHEN (v_clean_email IS NOT NULL AND (lower(p.email) = v_clean_email OR lower(COALESCE(p.recovery_email, '')) = v_clean_email))
                  OR (v_clean_phone IS NOT NULL AND (btrim(COALESCE(p.phone, '')) = v_clean_phone OR btrim(COALESCE(p.emergency_contact, '')) = v_clean_phone))
                  OR (v_clean_adm IS NOT NULL AND lower(COALESCE(p.login_id, '')) = v_clean_adm)
                  OR (v_clean_emp IS NOT NULL AND lower(COALESCE(e.employee_code, '')) = v_clean_emp)
                THEN 'exact'
                ELSE 'probable'
            END AS match_strength
        FROM public.profiles p
        LEFT JOIN public.employees e ON e.profile_id = p.id AND e.school_id = v_effective_school AND e.deleted_at IS NULL
        LEFT JOIN LATERAL (
            SELECT c.name AS class_name, c.section AS section_name
            FROM public.class_enrollments ce
            JOIN public.classes c ON c.id = ce.class_id AND c.deleted_at IS NULL
            WHERE ce.student_id = p.id AND ce.school_id = v_effective_school AND ce.deleted_at IS NULL
            ORDER BY ce.enrolled_at DESC
            LIMIT 1
        ) cls ON true
        WHERE p.school_id = v_effective_school
          AND p.deleted_at IS NULL
          AND (
               (v_clean_email IS NOT NULL AND (lower(p.email) = v_clean_email OR lower(COALESCE(p.recovery_email, '')) = v_clean_email))
            OR (v_clean_phone IS NOT NULL AND (btrim(COALESCE(p.phone, '')) = v_clean_phone OR btrim(COALESCE(p.emergency_contact, '')) = v_clean_phone))
            OR (v_clean_adm IS NOT NULL AND lower(COALESCE(p.login_id, '')) = v_clean_adm)
            OR (v_clean_emp IS NOT NULL AND lower(COALESCE(e.employee_code, '')) = v_clean_emp)
            OR (v_clean_name IS NOT NULL AND length(v_clean_name) >= 3 AND lower(btrim(p.full_name)) = lower(v_clean_name))
          )
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', cm.id,
        'full_name', cm.full_name,
        'email', cm.email,
        'primary_role', cm.primary_role,
        'phone', cm.phone,
        'login_id', cm.login_id,
        'employee_code', cm.employee_code,
        'designation', cm.designation,
        'department', cm.department,
        'class_name', cm.class_name,
        'section_name', cm.section_name,
        'is_active', cm.is_active,
        'match_strength', cm.match_strength,
        'match_reasons', cm.match_reasons
    ) ORDER BY CASE WHEN cm.match_strength = 'exact' THEN 0 ELSE 1 END, cm.full_name ASC), '[]'::jsonb)
    INTO v_results
    FROM candidate_matches cm;

    RETURN v_results;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_detect_duplicate_identities(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_detect_duplicate_identities(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;


-- ════════════════════════════════════════════════════════════════════
-- Audit duplicate decision resolution
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_audit_duplicate_decision(
    _school_id UUID,
    _resolution TEXT,
    _candidate_id UUID DEFAULT NULL,
    _candidate_name TEXT DEFAULT NULL,
    _input_name TEXT DEFAULT NULL,
    _input_email TEXT DEFAULT NULL,
    _match_reasons JSONB DEFAULT '[]'::jsonb,
    _detail_notes TEXT DEFAULT NULL
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
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role = 'superadmin' THEN
        v_effective_school := _school_id;
    ELSIF v_caller_role = 'admin' THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot audit for another school';
        END IF;
        v_effective_school := v_caller_school;
    ELSE
        RAISE EXCEPTION 'Access denied: only school admins can audit duplicate resolutions';
    END IF;

    IF _resolution NOT IN ('link_existing', 'create_new_person', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid resolution: %', _resolution;
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
        auth.uid(),
        v_caller_role,
        v_effective_school,
        COALESCE(_candidate_id, auth.uid()),
        'duplicate_detection_resolution',
        jsonb_build_object(
            'resolution', _resolution,
            'candidate_id', _candidate_id,
            'candidate_name', _candidate_name,
            'input_name', _input_name,
            'input_email', _input_email,
            'match_reasons', _match_reasons,
            'notes', _detail_notes
        ),
        now()
    );

    RETURN jsonb_build_object('success', true, 'resolution', _resolution);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_audit_duplicate_decision(UUID, TEXT, UUID, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_audit_duplicate_decision(UUID, TEXT, UUID, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;
