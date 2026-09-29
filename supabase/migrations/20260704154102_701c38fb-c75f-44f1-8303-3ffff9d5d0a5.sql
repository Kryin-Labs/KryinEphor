
-- ============ 1. FEE PLANS ============
CREATE TABLE IF NOT EXISTS public.fee_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  section text,
  name text NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('monthly','quarterly','annual','one_time')),
  due_day_of_month int DEFAULT 5 CHECK (due_day_of_month BETWEEN 1 AND 28),
  late_fee_amount numeric(12,2) DEFAULT 0,
  late_fee_grace_days int DEFAULT 0,
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fee_plans TO authenticated;
GRANT ALL ON public.fee_plans TO service_role;
ALTER TABLE public.fee_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY fee_plans_tenant_select ON public.fee_plans FOR SELECT TO authenticated
  USING ((get_auth_role() = 'superadmin') OR (school_id = get_auth_school_id()));
CREATE POLICY fee_plans_tenant_insert ON public.fee_plans FOR INSERT TO authenticated
  WITH CHECK (school_id = get_auth_school_id() AND get_auth_role() = ANY(ARRAY['admin','accountant','superadmin']));
CREATE POLICY fee_plans_tenant_update ON public.fee_plans FOR UPDATE TO authenticated
  USING (school_id = get_auth_school_id() AND get_auth_role() = ANY(ARRAY['admin','accountant','superadmin']))
  WITH CHECK (school_id = get_auth_school_id() AND get_auth_role() = ANY(ARRAY['admin','accountant','superadmin']));
CREATE POLICY fee_plans_tenant_delete ON public.fee_plans FOR DELETE TO authenticated
  USING (school_id = get_auth_school_id() AND get_auth_role() = ANY(ARRAY['admin','superadmin']));

CREATE TRIGGER trg_fee_plans_updated BEFORE UPDATE ON public.fee_plans
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============ 2. FEE PLAN ITEMS ============
CREATE TABLE IF NOT EXISTS public.fee_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.fee_plans(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  fee_head_id uuid REFERENCES public.fee_structures(id) ON DELETE SET NULL,
  label text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  tax numeric(12,2) DEFAULT 0,
  is_optional boolean DEFAULT false,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fee_plan_items TO authenticated;
GRANT ALL ON public.fee_plan_items TO service_role;
ALTER TABLE public.fee_plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY fpi_tenant_select ON public.fee_plan_items FOR SELECT TO authenticated
  USING ((get_auth_role() = 'superadmin') OR (school_id = get_auth_school_id()));
CREATE POLICY fpi_tenant_write ON public.fee_plan_items FOR INSERT TO authenticated
  WITH CHECK (school_id = get_auth_school_id() AND get_auth_role() = ANY(ARRAY['admin','accountant','superadmin']));
CREATE POLICY fpi_tenant_update ON public.fee_plan_items FOR UPDATE TO authenticated
  USING (school_id = get_auth_school_id() AND get_auth_role() = ANY(ARRAY['admin','accountant','superadmin']))
  WITH CHECK (school_id = get_auth_school_id());
CREATE POLICY fpi_tenant_delete ON public.fee_plan_items FOR DELETE TO authenticated
  USING (school_id = get_auth_school_id() AND get_auth_role() = ANY(ARRAY['admin','accountant','superadmin']));

-- ============ 3. STUDENT FEE ASSIGNMENTS ============
CREATE TABLE IF NOT EXISTS public.student_fee_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.fee_plans(id) ON DELETE CASCADE,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  discount_pct numeric(5,2) DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  scholarship_amount numeric(12,2) DEFAULT 0,
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (student_id, plan_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_fee_assignments TO authenticated;
GRANT ALL ON public.student_fee_assignments TO service_role;
ALTER TABLE public.student_fee_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY sfa_tenant_select ON public.student_fee_assignments FOR SELECT TO authenticated
  USING (
    (get_auth_role() = 'superadmin')
    OR (school_id = get_auth_school_id())
    OR (student_id = auth.uid())
  );
CREATE POLICY sfa_tenant_insert ON public.student_fee_assignments FOR INSERT TO authenticated
  WITH CHECK (school_id = get_auth_school_id() AND get_auth_role() = ANY(ARRAY['admin','accountant','superadmin']));
CREATE POLICY sfa_tenant_update ON public.student_fee_assignments FOR UPDATE TO authenticated
  USING (school_id = get_auth_school_id() AND get_auth_role() = ANY(ARRAY['admin','accountant','superadmin']))
  WITH CHECK (school_id = get_auth_school_id());
CREATE POLICY sfa_tenant_delete ON public.student_fee_assignments FOR DELETE TO authenticated
  USING (school_id = get_auth_school_id() AND get_auth_role() = ANY(ARRAY['admin','superadmin']));

CREATE TRIGGER trg_sfa_updated BEFORE UPDATE ON public.student_fee_assignments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============ 4. INVOICE ITEMS ============
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  fee_head_id uuid REFERENCES public.fee_structures(id) ON DELETE SET NULL,
  label text NOT NULL,
  amount numeric(12,2) NOT NULL,
  tax numeric(12,2) DEFAULT 0,
  discount numeric(12,2) DEFAULT 0,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_items TO authenticated;
GRANT ALL ON public.invoice_items TO service_role;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY inv_items_select ON public.invoice_items FOR SELECT TO authenticated
  USING (
    (get_auth_role() = 'superadmin')
    OR (school_id = get_auth_school_id())
    OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND i.student_id = auth.uid())
  );
CREATE POLICY inv_items_write ON public.invoice_items FOR INSERT TO authenticated
  WITH CHECK (school_id = get_auth_school_id() AND get_auth_role() = ANY(ARRAY['admin','accountant','superadmin']));
CREATE POLICY inv_items_update ON public.invoice_items FOR UPDATE TO authenticated
  USING (school_id = get_auth_school_id() AND get_auth_role() = ANY(ARRAY['admin','accountant','superadmin']))
  WITH CHECK (school_id = get_auth_school_id());
CREATE POLICY inv_items_delete ON public.invoice_items FOR DELETE TO authenticated
  USING (school_id = get_auth_school_id() AND get_auth_role() = ANY(ARRAY['admin','accountant','superadmin']));

-- ============ 5. ADDITIONAL CHARGES ============
CREATE TABLE IF NOT EXISTS public.additional_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN ('fine','extra_class','damage','event','uniform','books','transport','other')),
  description text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  applied_at date DEFAULT CURRENT_DATE,
  status text DEFAULT 'pending' CHECK (status IN ('pending','invoiced','waived','paid')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.additional_charges TO authenticated;
GRANT ALL ON public.additional_charges TO service_role;
ALTER TABLE public.additional_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY ac_tenant_select ON public.additional_charges FOR SELECT TO authenticated
  USING (
    (get_auth_role() = 'superadmin')
    OR (school_id = get_auth_school_id())
    OR (student_id = auth.uid())
  );
CREATE POLICY ac_tenant_insert ON public.additional_charges FOR INSERT TO authenticated
  WITH CHECK (school_id = get_auth_school_id() AND get_auth_role() = ANY(ARRAY['admin','accountant','teacher','superadmin']));
CREATE POLICY ac_tenant_update ON public.additional_charges FOR UPDATE TO authenticated
  USING (school_id = get_auth_school_id() AND get_auth_role() = ANY(ARRAY['admin','accountant','superadmin']))
  WITH CHECK (school_id = get_auth_school_id());
CREATE POLICY ac_tenant_delete ON public.additional_charges FOR DELETE TO authenticated
  USING (school_id = get_auth_school_id() AND get_auth_role() = ANY(ARRAY['admin','superadmin']));

CREATE TRIGGER trg_ac_updated BEFORE UPDATE ON public.additional_charges
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============ 6. EXTEND INVOICES ============
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES public.student_fee_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS period_label text,
  ADD COLUMN IF NOT EXISTS late_fee numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receipt_count int DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS ux_invoice_assignment_period
  ON public.invoices(assignment_id, period_label)
  WHERE assignment_id IS NOT NULL AND period_label IS NOT NULL AND deleted_at IS NULL;

-- ============ 7. HELPER FUNCTIONS ============

-- Generate invoice for a given assignment + period label (idempotent)
CREATE OR REPLACE FUNCTION public.fn_generate_school_invoice(
  p_assignment uuid, p_period_start date, p_period_end date, p_period_label text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_assignment public.student_fee_assignments%ROWTYPE;
  v_plan public.fee_plans%ROWTYPE;
  v_invoice_id uuid;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_total numeric;
  v_seq int;
  v_num text;
  v_due date;
BEGIN
  SELECT * INTO v_assignment FROM public.student_fee_assignments WHERE id = p_assignment AND is_active = true;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_plan FROM public.fee_plans WHERE id = v_assignment.plan_id AND is_active = true;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Skip if already generated
  SELECT id INTO v_invoice_id FROM public.invoices
   WHERE assignment_id = p_assignment AND period_label = p_period_label AND deleted_at IS NULL;
  IF v_invoice_id IS NOT NULL THEN RETURN v_invoice_id; END IF;

  SELECT COALESCE(SUM(amount + COALESCE(tax,0)),0) INTO v_subtotal
    FROM public.fee_plan_items WHERE plan_id = v_plan.id AND is_optional = false;

  v_discount := ROUND(v_subtotal * v_assignment.discount_pct / 100, 2) + COALESCE(v_assignment.scholarship_amount,0);
  v_total := GREATEST(v_subtotal - v_discount, 0);
  v_due := make_date(EXTRACT(YEAR FROM p_period_end)::int, EXTRACT(MONTH FROM p_period_end)::int, LEAST(v_plan.due_day_of_month, 28));

  SELECT COUNT(*) + 1 INTO v_seq FROM public.invoices
    WHERE school_id = v_assignment.school_id AND date_trunc('month',created_at) = date_trunc('month',now());
  v_num := 'SFE-' || to_char(now(),'YYYYMM') || '-' || lpad(v_seq::text,5,'0');

  INSERT INTO public.invoices(
    school_id, student_id, assignment_id, invoice_number, amount, discount,
    status, due_date, billing_period_start, billing_period_end, period_label, created_at
  ) VALUES (
    v_assignment.school_id, v_assignment.student_id, p_assignment, v_num, v_total, v_discount,
    'pending', v_due, p_period_start, p_period_end, p_period_label, now()
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items(invoice_id, school_id, fee_head_id, label, amount, tax, sort_order)
  SELECT v_invoice_id, v_assignment.school_id, fee_head_id, label, amount, COALESCE(tax,0), sort_order
    FROM public.fee_plan_items WHERE plan_id = v_plan.id AND is_optional = false;

  RETURN v_invoice_id;
END $$;

REVOKE ALL ON FUNCTION public.fn_generate_school_invoice(uuid,date,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_generate_school_invoice(uuid,date,date,text) TO service_role, authenticated;

-- Record a payment (partial or full). Updates paid_amount and status.
CREATE OR REPLACE FUNCTION public.fn_record_fee_payment(
  p_invoice uuid, p_amount numeric, p_method text, p_reference text, p_notes text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv public.invoices%ROWTYPE;
  v_txn_id uuid;
  v_new_paid numeric;
  v_status text;
  v_receipt text;
BEGIN
  IF NOT (get_auth_role() = ANY(ARRAY['admin','accountant','superadmin'])) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  IF v_inv.school_id <> get_auth_school_id() AND get_auth_role() <> 'superadmin' THEN
    RAISE EXCEPTION 'cross-tenant not allowed';
  END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;

  v_new_paid := COALESCE(v_inv.paid_amount,0) + p_amount;
  IF v_new_paid >= v_inv.amount + COALESCE(v_inv.late_fee,0) THEN
    v_status := 'paid';
  ELSE
    v_status := 'partial';
  END IF;

  v_receipt := 'RCP-' || to_char(now(),'YYYYMM') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);

  INSERT INTO public.transactions(
    school_id, invoice_id, student_id, amount, type, payment_method, reference_number,
    status, notes, processed_by, created_at
  ) VALUES (
    v_inv.school_id, p_invoice, v_inv.student_id, p_amount, 'payment', p_method, COALESCE(p_reference, v_receipt),
    'completed', p_notes, auth.uid(), now()
  ) RETURNING id INTO v_txn_id;

  UPDATE public.invoices
     SET paid_amount = v_new_paid,
         status = v_status,
         paid_at = CASE WHEN v_status = 'paid' THEN now() ELSE paid_at END,
         receipt_count = COALESCE(receipt_count,0) + 1
   WHERE id = p_invoice;

  RETURN v_txn_id;
END $$;

REVOKE ALL ON FUNCTION public.fn_record_fee_payment(uuid,numeric,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_record_fee_payment(uuid,numeric,text,text,text) TO authenticated, service_role;

-- Extend due date for a specific student invoice
CREATE OR REPLACE FUNCTION public.fn_extend_invoice_due(p_invoice uuid, p_days int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_school uuid;
BEGIN
  IF NOT (get_auth_role() = ANY(ARRAY['admin','accountant','superadmin'])) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_days <= 0 OR p_days > 365 THEN RAISE EXCEPTION 'invalid days'; END IF;
  SELECT school_id INTO v_school FROM public.invoices WHERE id = p_invoice AND deleted_at IS NULL;
  IF v_school IS NULL THEN RAISE EXCEPTION 'invoice not found'; END IF;
  IF v_school <> get_auth_school_id() AND get_auth_role() <> 'superadmin' THEN
    RAISE EXCEPTION 'cross-tenant not allowed';
  END IF;
  UPDATE public.invoices
     SET due_date = due_date + p_days,
         status = CASE WHEN status = 'overdue' THEN 'pending' ELSE status END
   WHERE id = p_invoice;
END $$;

REVOKE ALL ON FUNCTION public.fn_extend_invoice_due(uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_extend_invoice_due(uuid,int) TO authenticated, service_role;

-- Nightly job: mark overdue + apply late fees
CREATE OR REPLACE FUNCTION public.fn_apply_late_fees()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int := 0;
BEGIN
  UPDATE public.invoices i
     SET status = 'overdue',
         late_fee = COALESCE(i.late_fee,0) + COALESCE(p.late_fee_amount,0)
    FROM public.student_fee_assignments a
    JOIN public.fee_plans p ON p.id = a.plan_id
   WHERE i.assignment_id = a.id
     AND i.status IN ('pending','partial')
     AND i.deleted_at IS NULL
     AND i.due_date + COALESCE(p.late_fee_grace_days,0) < CURRENT_DATE
     AND COALESCE(i.late_fee,0) = 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.fn_apply_late_fees() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_apply_late_fees() TO service_role;
