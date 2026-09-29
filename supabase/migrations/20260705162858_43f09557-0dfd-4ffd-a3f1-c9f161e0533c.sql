
-- ═══════════════════════════════════════════════════════════════════
-- Add email_domain to schools + notification triggers + realtime
-- ═══════════════════════════════════════════════════════════════════

-- 1. schools.email_domain (used to auto-append when admin creates users)
ALTER TABLE public.schools
    ADD COLUMN IF NOT EXISTS email_domain TEXT;

-- Backfill: use existing subdomain as a fallback domain shape (subdomain.edunex.com)
UPDATE public.schools
   SET email_domain = LOWER(subdomain) || '.edunex.local'
 WHERE email_domain IS NULL AND subdomain IS NOT NULL;

-- Loose validation: xxx.yyy shape, lowercased
CREATE OR REPLACE FUNCTION public.normalize_email_domain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_domain IS NOT NULL THEN
    NEW.email_domain := LOWER(TRIM(BOTH FROM NEW.email_domain));
    NEW.email_domain := REGEXP_REPLACE(NEW.email_domain, '^@', '');
    IF NEW.email_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
      RAISE EXCEPTION 'invalid email domain: %', NEW.email_domain;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schools_normalize_email_domain ON public.schools;
CREATE TRIGGER trg_schools_normalize_email_domain
BEFORE INSERT OR UPDATE OF email_domain ON public.schools
FOR EACH ROW EXECUTE FUNCTION public.normalize_email_domain();

-- 2. Notification insertion helper (used by triggers below)
CREATE OR REPLACE FUNCTION public.fn_notify_school_admins(
  p_school UUID, p_title TEXT, p_message TEXT, p_type TEXT, p_action_url TEXT DEFAULT NULL, p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM public.profiles
     WHERE school_id = p_school AND is_active = true AND role IN ('admin','accountant','receptionist')
  LOOP
    INSERT INTO public.notifications (school_id, user_id, title, message, type, channel, is_read, action_url, metadata)
    VALUES (p_school, r.id, p_title, p_message, p_type, 'in_app', false, p_action_url, p_metadata);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.fn_notify_school_admins(UUID,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_notify_school_admins(UUID,TEXT,TEXT,TEXT,TEXT,JSONB) TO service_role;

-- 3. Trigger: new class enrollment → notify admins
CREATE OR REPLACE FUNCTION public.trg_notify_new_enrollment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_student_name TEXT; v_class_name TEXT;
BEGIN
  SELECT full_name INTO v_student_name FROM public.profiles WHERE id = NEW.student_id;
  SELECT name INTO v_class_name FROM public.classes WHERE id = NEW.class_id;
  PERFORM public.fn_notify_school_admins(
    NEW.school_id,
    'New student enrolled',
    COALESCE(v_student_name,'A student') || ' joined ' || COALESCE(v_class_name,'a class'),
    'enrollment',
    '/classes',
    jsonb_build_object('student_id', NEW.student_id, 'class_id', NEW.class_id)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_class_enrollments_notify ON public.class_enrollments;
CREATE TRIGGER trg_class_enrollments_notify
AFTER INSERT ON public.class_enrollments
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_new_enrollment();

-- 4. Trigger: payment received → notify admins
CREATE OR REPLACE FUNCTION public.trg_notify_payment_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type = 'payment' AND NEW.status = 'completed' THEN
    PERFORM public.fn_notify_school_admins(
      NEW.school_id,
      'Payment received',
      '₹' || TO_CHAR(NEW.amount,'FM999,999,999.00') || ' collected'
        || COALESCE(' via ' || NEW.payment_method,''),
      'payment',
      '/school-finance',
      jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount, 'invoice_id', NEW.invoice_id)
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_transactions_notify ON public.transactions;
CREATE TRIGGER trg_transactions_notify
AFTER INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_payment_received();

-- 5. Trigger: invoice becomes overdue → notify admins
CREATE OR REPLACE FUNCTION public.trg_notify_invoice_overdue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'overdue' AND (OLD.status IS DISTINCT FROM 'overdue') THEN
    PERFORM public.fn_notify_school_admins(
      NEW.school_id,
      'Invoice overdue',
      'Invoice ' || COALESCE(NEW.invoice_number,'') || ' (₹' || TO_CHAR(NEW.amount,'FM999,999,999.00') || ') is overdue',
      'overdue',
      '/school-finance',
      jsonb_build_object('invoice_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoices_overdue_notify ON public.invoices;
CREATE TRIGGER trg_invoices_overdue_notify
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_invoice_overdue();

-- 6. Enable realtime on notifications
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- 7. Admin dashboard stats view (per school, RLS-scoped via SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.fn_admin_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school UUID := get_auth_school_id();
  v_role TEXT := get_auth_role();
  v_students INT := 0; v_teachers INT := 0; v_classes INT := 0;
  v_month_revenue NUMERIC := 0; v_pending NUMERIC := 0; v_overdue NUMERIC := 0;
  v_paid_count INT := 0; v_pending_count INT := 0;
  v_collection_pct NUMERIC := 0;
  v_top_payers JSONB;
BEGIN
  IF v_school IS NULL AND v_role <> 'superadmin' THEN
    RETURN jsonb_build_object('error','no school context');
  END IF;

  SELECT COUNT(*) INTO v_students FROM public.profiles
   WHERE school_id = v_school AND role = 'student' AND is_active = true AND deleted_at IS NULL;
  SELECT COUNT(*) INTO v_teachers FROM public.profiles
   WHERE school_id = v_school AND role = 'teacher' AND is_active = true AND deleted_at IS NULL;
  SELECT COUNT(*) INTO v_classes FROM public.classes
   WHERE school_id = v_school AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount),0) INTO v_month_revenue
    FROM public.transactions
   WHERE school_id = v_school AND type='payment' AND status='completed'
     AND created_at >= date_trunc('month', now());

  SELECT COALESCE(SUM(amount - COALESCE(paid_amount,0)),0),
         COUNT(*) FILTER (WHERE status='paid'),
         COUNT(*) FILTER (WHERE status IN ('pending','partial','overdue'))
    INTO v_pending, v_paid_count, v_pending_count
    FROM public.invoices
   WHERE school_id = v_school AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount - COALESCE(paid_amount,0)),0) INTO v_overdue
    FROM public.invoices
   WHERE school_id = v_school AND status='overdue' AND deleted_at IS NULL;

  IF (v_paid_count + v_pending_count) > 0 THEN
    v_collection_pct := ROUND(v_paid_count::numeric * 100 / (v_paid_count + v_pending_count), 1);
  END IF;

  -- Top fee payers this month (top 5)
  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_top_payers FROM (
    SELECT p.full_name AS name, p.id AS student_id,
           SUM(tx.amount) AS total_paid
      FROM public.transactions tx
      JOIN public.profiles p ON p.id = tx.student_id
     WHERE tx.school_id = v_school AND tx.type='payment' AND tx.status='completed'
       AND tx.created_at >= date_trunc('month', now())
     GROUP BY p.id, p.full_name
     ORDER BY total_paid DESC
     LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'students', v_students,
    'teachers', v_teachers,
    'classes', v_classes,
    'month_revenue', v_month_revenue,
    'pending_amount', v_pending,
    'overdue_amount', v_overdue,
    'paid_invoices', v_paid_count,
    'pending_invoices', v_pending_count,
    'collection_pct', v_collection_pct,
    'top_payers', v_top_payers
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_admin_dashboard_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_dashboard_stats() TO authenticated;
