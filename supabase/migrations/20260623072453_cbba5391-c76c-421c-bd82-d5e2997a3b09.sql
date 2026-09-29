-- Restore EXECUTE on user-facing admin-action functions to authenticated.
-- These functions perform internal has_role(auth.uid(),'superadmin'|'admin') checks
-- so privilege enforcement remains correct. The earlier blanket lockdown broke
-- the in-app admin actions (Unlock / Extend / Archive / Restore / Mark Paid).
-- Internal scheduling/trigger helpers remain restricted to service_role.
GRANT EXECUTE ON FUNCTION public.fn_manual_unlock(uuid, date, uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_extend_due_date(uuid, integer, uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mark_invoice_paid(uuid, uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_archive_school(uuid, uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_restore_school(uuid, uuid)            TO authenticated;