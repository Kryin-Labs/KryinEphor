-- Expand the allowed values of schools.status so it can mirror subscription_status
ALTER TABLE public.schools DROP CONSTRAINT IF EXISTS schools_status_check;
ALTER TABLE public.schools ADD CONSTRAINT schools_status_check
  CHECK (status = ANY (ARRAY['active','suspended','trial','payment_due','locked','archived']));

-- Trigger keeps schools.status in sync with schools.subscription_status
CREATE OR REPLACE FUNCTION public.fn_sync_school_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.status := CASE NEW.subscription_status::text
    WHEN 'archived'    THEN 'archived'
    WHEN 'locked'      THEN 'locked'
    WHEN 'payment_due' THEN 'payment_due'
    ELSE 'active'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_school_status ON public.schools;
CREATE TRIGGER trg_sync_school_status
  BEFORE INSERT OR UPDATE OF subscription_status ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_school_status();

-- Back-fill so existing rows show the correct, consistent badge immediately.
UPDATE public.schools
   SET status = CASE subscription_status::text
     WHEN 'archived'    THEN 'archived'
     WHEN 'locked'      THEN 'locked'
     WHEN 'payment_due' THEN 'payment_due'
     ELSE 'active'
   END;