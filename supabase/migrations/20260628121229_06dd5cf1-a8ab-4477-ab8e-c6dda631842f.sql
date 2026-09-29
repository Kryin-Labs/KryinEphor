-- Manual unlock should also un-archive, otherwise recompute snaps it back to 'archived'
CREATE OR REPLACE FUNCTION public.fn_manual_unlock(p_school uuid, p_until date, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'superadmin') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.schools
     SET manual_unlock_until = p_until,
         archived_at = NULL
   WHERE id = p_school;
  PERFORM public.fn_recompute_school_status(p_school);
  INSERT INTO public.subscription_events(school_id,event_type,actor_id,metadata)
  VALUES (p_school,'manual_unlock',p_actor,jsonb_build_object('until',p_until));
END $$;

-- Extending the due date on an archived school should also bring it back
CREATE OR REPLACE FUNCTION public.fn_extend_due_date(p_school uuid, p_days integer, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'superadmin') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_days <= 0 OR p_days > 365 THEN RAISE EXCEPTION 'invalid days'; END IF;
  UPDATE public.invoices
     SET due_date = due_date + p_days, status = 'pending'
   WHERE school_id = p_school AND status IN ('pending','overdue') AND deleted_at IS NULL;
  UPDATE public.schools
     SET next_due_date = COALESCE(next_due_date, CURRENT_DATE) + p_days,
         archived_at = NULL
   WHERE id = p_school;
  PERFORM public.fn_recompute_school_status(p_school);
  INSERT INTO public.subscription_events(school_id,event_type,actor_id,metadata)
  VALUES (p_school,'due_extended',p_actor,jsonb_build_object('days',p_days));
END $$;

-- Recompute ndmfs now that its data already reflects an unlock attempt
UPDATE public.schools SET archived_at = NULL
 WHERE id = '02784a1b-2890-41e9-b3cd-85485b4835f7' AND manual_unlock_until >= CURRENT_DATE;
SELECT public.fn_recompute_school_status('02784a1b-2890-41e9-b3cd-85485b4835f7');