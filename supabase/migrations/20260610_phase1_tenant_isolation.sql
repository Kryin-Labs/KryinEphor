-- ════════════════════════════════════════════════════════════════════
-- PHASE 1 MIGRATION — Emergency Tenant Isolation
-- Date: 2026-06-10
-- Addresses: Problems #1, #2, #3, #12, #29, #30, #34, #35, #45
-- Depends on: 20260610_phase0_hotfix.sql (must be applied first)
-- ════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════
-- 1. ADD school_id TO parent_student (Problem #1)
--    This table links parents to students but has NO tenant isolation.
--    A parent in School A could be linked to a student in School B.
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.parent_student
  ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE;

-- Backfill from the student's profile (most reliable source)
UPDATE public.parent_student ps
  SET school_id = p.school_id
  FROM public.profiles p
  WHERE ps.student_id = p.id
    AND ps.school_id IS NULL;

-- If student had no school_id, try parent
UPDATE public.parent_student ps
  SET school_id = p.school_id
  FROM public.profiles p
  WHERE ps.parent_id = p.id
    AND ps.school_id IS NULL;

-- Make it NOT NULL after backfill
ALTER TABLE public.parent_student
  ALTER COLUMN school_id SET NOT NULL;

-- Add index for RLS performance
CREATE INDEX IF NOT EXISTS idx_parent_student_school ON public.parent_student(school_id);

-- Add RLS policies
ALTER TABLE public.parent_student ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parent_student_tenant_select" ON public.parent_student;
CREATE POLICY "parent_student_tenant_select" ON public.parent_student
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_auth_school_id()
    OR public.get_auth_role() = 'superadmin'
  );

DROP POLICY IF EXISTS "parent_student_tenant_insert" ON public.parent_student;
CREATE POLICY "parent_student_tenant_insert" ON public.parent_student
  FOR INSERT TO authenticated
  WITH CHECK (
    school_id = public.get_auth_school_id()
    AND public.get_auth_role() IN ('superadmin', 'admin')
  );

DROP POLICY IF EXISTS "parent_student_tenant_update" ON public.parent_student;
CREATE POLICY "parent_student_tenant_update" ON public.parent_student
  FOR UPDATE TO authenticated
  USING (school_id = public.get_auth_school_id() AND public.get_auth_role() IN ('superadmin', 'admin'))
  WITH CHECK (school_id = public.get_auth_school_id());

DROP POLICY IF EXISTS "parent_student_tenant_delete" ON public.parent_student;
CREATE POLICY "parent_student_tenant_delete" ON public.parent_student
  FOR DELETE TO authenticated
  USING (school_id = public.get_auth_school_id() AND public.get_auth_role() IN ('superadmin', 'admin'));


-- ════════════════════════════════════════════════════════════════════
-- 2. ADD school_id TO messages (Problem #2)
--    Messages currently have no tenant key. RLS on messages was
--    doing cross-FK lookup via thread_id → message_threads.school_id
--    which is fragile and slow. Adding school_id directly enables
--    efficient RLS and prevents cross-tenant message injection.
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE;

-- Backfill from the thread's school_id
UPDATE public.messages m
  SET school_id = mt.school_id
  FROM public.message_threads mt
  WHERE m.thread_id = mt.id
    AND m.school_id IS NULL;

ALTER TABLE public.messages
  ALTER COLUMN school_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_school ON public.messages(school_id);

-- Add school_id-based RLS policies
DROP POLICY IF EXISTS "messages_tenant_select" ON public.messages;
CREATE POLICY "messages_tenant_select" ON public.messages
  FOR SELECT TO authenticated
  USING (
    (
      school_id = public.get_auth_school_id()
      AND thread_id IN (SELECT thread_id FROM public.thread_participants WHERE user_id = auth.uid())
    )
    OR public.get_auth_role() = 'superadmin'
  );

DROP POLICY IF EXISTS "messages_tenant_insert" ON public.messages;
CREATE POLICY "messages_tenant_insert" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    school_id = public.get_auth_school_id()
    AND sender_id = auth.uid()
    AND thread_id IN (SELECT thread_id FROM public.thread_participants WHERE user_id = auth.uid())
  );


-- ════════════════════════════════════════════════════════════════════
-- 3. ADD school_id TO thread_participants (Problem #3)
--    Same issue as messages — cross-tenant thread membership possible.
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.thread_participants
  ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE;

-- Backfill from thread
UPDATE public.thread_participants tp
  SET school_id = mt.school_id
  FROM public.message_threads mt
  WHERE tp.thread_id = mt.id
    AND tp.school_id IS NULL;

ALTER TABLE public.thread_participants
  ALTER COLUMN school_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_thread_parts_school ON public.thread_participants(school_id);

DROP POLICY IF EXISTS "thread_parts_tenant_select" ON public.thread_participants;
CREATE POLICY "thread_parts_tenant_select" ON public.thread_participants
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_auth_school_id()
    OR public.get_auth_role() = 'superadmin'
  );

DROP POLICY IF EXISTS "thread_parts_tenant_insert" ON public.thread_participants;
CREATE POLICY "thread_parts_tenant_insert" ON public.thread_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    school_id = public.get_auth_school_id()
    AND public.get_auth_role() IN ('superadmin', 'admin', 'teacher')
  );


-- ════════════════════════════════════════════════════════════════════
-- 4. MASS REVOKE anon ACCESS (Problem #34)
--    Only subscription_plans needs public visibility for pricing page.
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('subscription_plans')
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END;
$$;

-- Also revoke from views
REVOKE ALL ON public.invoice_aggregates FROM anon;


-- ════════════════════════════════════════════════════════════════════
-- 5. MOVE pg_trgm EXTENSION (Problem #32)
-- ════════════════════════════════════════════════════════════════════
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
        ALTER EXTENSION pg_trgm SET SCHEMA extensions;
    END IF;
END $$;


-- ════════════════════════════════════════════════════════════════════
-- 6. RE-ROUTE auth.users FKs THROUGH profiles (Problem #35)
--    system_logs and audit_logs reference auth.users directly,
--    causing lock contention and migration fragility.
-- ════════════════════════════════════════════════════════════════════

-- system_logs.user_id → profiles.id instead of auth.users.id
ALTER TABLE public.system_logs DROP CONSTRAINT IF EXISTS system_logs_user_id_fkey;
ALTER TABLE public.system_logs
  ADD CONSTRAINT system_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- audit_logs.user_id → profiles.id
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- activity_logs.user_id → profiles.id
ALTER TABLE public.activity_logs DROP CONSTRAINT IF EXISTS activity_logs_user_id_fkey;
ALTER TABLE public.activity_logs
  ADD CONSTRAINT activity_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- user_sessions.user_id → profiles.id
ALTER TABLE public.user_sessions DROP CONSTRAINT IF EXISTS user_sessions_user_id_fkey;
ALTER TABLE public.user_sessions
  ADD CONSTRAINT user_sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- password_resets.user_id → profiles.id
ALTER TABLE public.password_resets DROP CONSTRAINT IF EXISTS password_resets_user_id_fkey;
ALTER TABLE public.password_resets
  ADD CONSTRAINT password_resets_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


-- ════════════════════════════════════════════════════════════════════
-- 7. ADDITIONAL UNIQUE CONSTRAINTS (Problem #12, #29)
-- ════════════════════════════════════════════════════════════════════

-- Invoices: prevent duplicate invoice numbers per school
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_invoice_number') THEN
    ALTER TABLE public.invoices ADD CONSTRAINT uq_invoice_number UNIQUE (school_id, invoice_number);
  END IF;
END $$;

-- Timetable: prevent overlapping slots per class
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_timetable_slot') THEN
    ALTER TABLE public.timetable ADD CONSTRAINT uq_timetable_slot UNIQUE (school_id, class_id, day_of_week, start_time);
  END IF;
END $$;

-- Employees: prevent duplicate employee codes per school
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_employee_code'
  ) THEN
    -- Only add if no duplicates exist
    ALTER TABLE public.employees
      ADD CONSTRAINT uq_employee_code UNIQUE (school_id, employee_code);
  END IF;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Duplicate employee codes exist. Clean up before adding constraint.';
END;
$$;


-- ════════════════════════════════════════════════════════════════════
-- 8. CHANGE profiles.school_id FK TO ON DELETE RESTRICT (Problem #30)
--    Prevents school deletion while users still exist (they'd become
--    ghost users with NULL school_id).
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_school_id_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE RESTRICT;


-- ════════════════════════════════════════════════════════════════════
-- 9. SOFT DELETE CASCADE TRIGGER (Problem #45)
--    When a school is soft-deleted, cascade to child tables.
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_school_soft_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.profiles SET deleted_at = NEW.deleted_at WHERE school_id = NEW.id AND deleted_at IS NULL;
    UPDATE public.classes SET deleted_at = NEW.deleted_at WHERE school_id = NEW.id AND deleted_at IS NULL;
    UPDATE public.academic_years SET deleted_at = NEW.deleted_at WHERE school_id = NEW.id AND deleted_at IS NULL;
    UPDATE public.invoices SET deleted_at = NEW.deleted_at WHERE school_id = NEW.id AND deleted_at IS NULL;
    UPDATE public.subjects SET deleted_at = NEW.deleted_at WHERE school_id = NEW.id AND deleted_at IS NULL;
    UPDATE public.homework SET deleted_at = NEW.deleted_at WHERE school_id = NEW.id AND deleted_at IS NULL;
    UPDATE public.exams SET deleted_at = NEW.deleted_at WHERE school_id = NEW.id AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_school_soft_delete ON public.schools;
CREATE TRIGGER trigger_school_soft_delete
  AFTER UPDATE OF deleted_at ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.handle_school_soft_delete();


-- ════════════════════════════════════════════════════════════════════
-- 10. COMPOSITE INDEXES FOR PERFORMANCE (Problem #27)
-- ════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_attendance_school_date
  ON public.attendance(school_id, date) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_school_student_date
  ON public.attendance(school_id, student_id, date);

CREATE INDEX IF NOT EXISTS idx_invoices_school_status
  ON public.invoices(school_id, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_homework_school_class_due
  ON public.homework(school_id, class_id, due_date) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_exam_results_exam_student
  ON public.exam_results(exam_subject_id, student_id);

CREATE INDEX IF NOT EXISTS idx_transactions_school_created
  ON public.transactions(school_id, created_at);

CREATE INDEX IF NOT EXISTS idx_system_logs_school_level_created
  ON public.system_logs(school_id, level, created_at DESC);


-- ════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES
-- ════════════════════════════════════════════════════════════════════
-- 1. Confirm school_id added to all 3 tables:
-- SELECT column_name, is_nullable FROM information_schema.columns
--   WHERE table_name IN ('parent_student','messages','thread_participants')
--   AND column_name = 'school_id';

-- 2. Confirm anon has no access:
-- SELECT grantee, table_name, privilege_type
--   FROM information_schema.table_privileges
--   WHERE grantee = 'anon' AND table_schema = 'public';

-- 3. Confirm new constraints:
-- SELECT conname, conrelid::regclass FROM pg_constraint
--   WHERE conname LIKE 'uq_%';

-- 4. Confirm pg_trgm moved:
-- SELECT extname, nspname FROM pg_extension e
--   JOIN pg_namespace n ON e.extnamespace = n.oid
--   WHERE extname = 'pg_trgm';
