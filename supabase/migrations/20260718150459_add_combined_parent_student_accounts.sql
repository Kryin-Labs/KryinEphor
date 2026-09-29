ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS combined_parent_student_account BOOLEAN NOT NULL DEFAULT true;
