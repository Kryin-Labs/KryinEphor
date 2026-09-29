
-- 1) Expand notifications.type allowed values so trigger notifications succeed
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type = ANY (ARRAY[
        'info','success','warning','error','reminder',
        'enrollment','payment','overdue','message'
    ]));

-- 2) Enforce class capacity on enrollment
CREATE OR REPLACE FUNCTION public.fn_enforce_class_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_capacity int;
    v_count int;
BEGIN
    SELECT capacity INTO v_capacity FROM public.classes WHERE id = NEW.class_id;
    IF v_capacity IS NULL OR v_capacity <= 0 THEN
        RETURN NEW; -- no limit configured
    END IF;

    SELECT COUNT(*) INTO v_count
      FROM public.class_enrollments
     WHERE class_id = NEW.class_id
       AND deleted_at IS NULL;

    IF v_count >= v_capacity THEN
        RAISE EXCEPTION 'You have limited student for this class'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_class_enrollments_capacity ON public.class_enrollments;
CREATE TRIGGER trg_class_enrollments_capacity
    BEFORE INSERT ON public.class_enrollments
    FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_class_capacity();
