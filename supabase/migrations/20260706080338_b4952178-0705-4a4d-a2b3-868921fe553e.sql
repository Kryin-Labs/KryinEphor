CREATE OR REPLACE FUNCTION public.sync_profile_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM public.user_roles WHERE user_id = OLD.id;
        RETURN OLD;
    END IF;
    -- Ensure the profile's primary role is present in user_roles.
    -- Additional roles (assigned via the user management UI) are preserved.
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, NEW.role)
    ON CONFLICT (user_id, role) DO NOTHING;
    RETURN NEW;
END;
$function$;