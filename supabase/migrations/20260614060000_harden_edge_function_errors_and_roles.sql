-- Harden role assignment by reading authorization fields from app metadata.
-- raw_user_meta_data is user-editable in Supabase and must not carry roles.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  requested_role TEXT := COALESCE(NEW.raw_app_meta_data ->> 'role', 'student');
  requested_school_id UUID := NULLIF(NEW.raw_app_meta_data ->> 'school_id', '')::UUID;
BEGIN
  IF requested_role <> 'superadmin' AND requested_school_id IS NULL THEN
    requested_role := 'student';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, school_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ''),
    requested_role,
    requested_school_id
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    role = COALESCE(EXCLUDED.role, public.profiles.role),
    school_id = COALESCE(EXCLUDED.school_id, public.profiles.school_id),
    updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
