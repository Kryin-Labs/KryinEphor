-- ════════════════════════════════════════════════════════════════════
-- Phase 4A — Track A: Auth Recovery Schema Foundation
-- ────────────────────────────────────────────────────────────────────
-- Adds login_id / recovery_email columns, backfills login_id,
-- deactivates 3 confirmed orphan profiles, and hardens
-- handle_new_user() to reject role-less signups.
--
-- NO RLS work. NO policy work. See Track B for that.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Migration audit table (also used by future migrations) ──────
CREATE TABLE IF NOT EXISTS public.migration_audit (
    id              BIGSERIAL PRIMARY KEY,
    migration_name  TEXT NOT NULL,
    action          TEXT NOT NULL,
    target_table    TEXT,
    target_id       TEXT,
    payload         JSONB,
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.migration_audit TO authenticated;
GRANT ALL    ON public.migration_audit TO service_role;

-- ── 2. New identity columns ────────────────────────────────────────
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS login_id                 TEXT,
    ADD COLUMN IF NOT EXISTS recovery_email           TEXT,
    ADD COLUMN IF NOT EXISTS recovery_email_verified  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS phone_verified           BOOLEAN NOT NULL DEFAULT false;

-- ── 3. Backfill login_id from email ────────────────────────────────
UPDATE public.profiles
   SET login_id = email
 WHERE login_id IS NULL
   AND email IS NOT NULL;

-- ── 4. Unique partial index on login_id ────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS profiles_login_id_uidx
    ON public.profiles (login_id)
    WHERE login_id IS NOT NULL;

-- ── 5. Capture pre-image of orphan rows about to be deactivated ────
INSERT INTO public.migration_audit (migration_name, action, target_table, target_id, payload)
SELECT
    '20260614100000_phase4a_track_a_auth_recovery',
    'deactivate_orphan_profile',
    'profiles',
    p.id::text,
    jsonb_build_object(
        'id',         p.id,
        'email',      p.email,
        'full_name',  p.full_name,
        'role',       p.role,
        'school_id',  p.school_id,
        'is_active',  p.is_active
    )
  FROM public.profiles p
 WHERE p.role <> 'superadmin'
   AND p.school_id IS NULL
   AND p.is_active = true;

-- ── 6. Deactivate the 3 confirmed orphan test accounts ─────────────
UPDATE public.profiles
   SET is_active  = false,
       updated_at = now()
 WHERE role <> 'superadmin'
   AND school_id IS NULL
   AND is_active = true;

-- ── 7. Harden handle_new_user: no silent default to 'student' ──────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_role      TEXT;
    v_full_name TEXT;
    v_school_id UUID;
BEGIN
    -- Prefer app_metadata (server-set, trusted) over user_metadata.
    v_role := COALESCE(
        NEW.raw_app_meta_data  ->> 'role',
        NEW.raw_user_meta_data ->> 'role'
    );

    IF v_role IS NULL OR v_role = '' THEN
        RAISE EXCEPTION 'handle_new_user: role is required (app_metadata.role or user_metadata.role)'
            USING ERRCODE = 'check_violation';
    END IF;

    v_full_name := COALESCE(
        NEW.raw_user_meta_data ->> 'full_name',
        NEW.raw_user_meta_data ->> 'name',
        ''
    );

    v_school_id := NULLIF(
        COALESCE(
            NEW.raw_app_meta_data  ->> 'school_id',
            NEW.raw_user_meta_data ->> 'school_id'
        ),
        ''
    )::UUID;

    INSERT INTO public.profiles (id, email, full_name, role, school_id, login_id)
    VALUES (NEW.id, NEW.email, v_full_name, v_role, v_school_id, NEW.email)
    ON CONFLICT (id) DO UPDATE SET
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
        role      = COALESCE(EXCLUDED.role,      public.profiles.role),
        school_id = COALESCE(EXCLUDED.school_id, public.profiles.school_id),
        login_id  = COALESCE(public.profiles.login_id, EXCLUDED.login_id),
        updated_at = now();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMIT;
