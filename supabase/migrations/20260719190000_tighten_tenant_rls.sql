-- Tighten over-broad tenant policies: several tables allowed ANY school member
-- (students/parents included) to read financial data, read all rosters, or even
-- write staff-only tables. Scope writes to the roles that own the workflow and
-- scope private reads to staff + the row owner.

-- schools: only admins may edit their own school (was: any school member)
DROP POLICY IF EXISTS tenant_update ON public.schools;
CREATE POLICY tenant_update ON public.schools FOR UPDATE
USING (get_auth_role() = 'superadmin' OR (id = get_auth_school_id() AND get_auth_role() = 'admin'))
WITH CHECK (get_auth_role() = 'superadmin' OR (id = get_auth_school_id() AND get_auth_role() = 'admin'));

-- transactions: payments readable by finance staff + the paying student only (was: whole school)
DROP POLICY IF EXISTS tenant_select ON public.transactions;
CREATE POLICY tenant_select ON public.transactions FOR SELECT
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','accountant']))
    OR student_id = auth.uid());

-- class_enrollments: rosters readable by staff; students see only their own row (was: whole school, writable by anyone)
DROP POLICY IF EXISTS tenant_select ON public.class_enrollments;
CREATE POLICY tenant_select ON public.class_enrollments FOR SELECT
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher','receptionist','accountant']))
    OR student_id = auth.uid());
DROP POLICY IF EXISTS tenant_insert ON public.class_enrollments;
CREATE POLICY tenant_insert ON public.class_enrollments FOR INSERT
WITH CHECK (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher','receptionist'])));
DROP POLICY IF EXISTS tenant_update ON public.class_enrollments;
CREATE POLICY tenant_update ON public.class_enrollments FOR UPDATE
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher','receptionist'])));
DROP POLICY IF EXISTS tenant_delete ON public.class_enrollments;
CREATE POLICY tenant_delete ON public.class_enrollments FOR DELETE
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','receptionist'])));

-- events (announcements/calendar): writes restricted to admin/teacher (was: any school member)
DROP POLICY IF EXISTS tenant_insert ON public.events;
CREATE POLICY tenant_insert ON public.events FOR INSERT
WITH CHECK (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher'])));
DROP POLICY IF EXISTS tenant_update ON public.events;
CREATE POLICY tenant_update ON public.events FOR UPDATE
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher'])));
DROP POLICY IF EXISTS tenant_delete ON public.events;
CREATE POLICY tenant_delete ON public.events FOR DELETE
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = 'admin'));

-- online_classes: writes restricted to admin/teacher
DROP POLICY IF EXISTS tenant_insert ON public.online_classes;
CREATE POLICY tenant_insert ON public.online_classes FOR INSERT
WITH CHECK (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher'])));
DROP POLICY IF EXISTS tenant_update ON public.online_classes;
CREATE POLICY tenant_update ON public.online_classes FOR UPDATE
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher'])));
DROP POLICY IF EXISTS tenant_delete ON public.online_classes;
CREATE POLICY tenant_delete ON public.online_classes FOR DELETE
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher'])));

-- academic_years: writes admin-only
DROP POLICY IF EXISTS tenant_insert ON public.academic_years;
CREATE POLICY tenant_insert ON public.academic_years FOR INSERT
WITH CHECK (get_auth_role() = 'superadmin' OR (school_id = get_auth_school_id() AND get_auth_role() = 'admin'));
DROP POLICY IF EXISTS tenant_update ON public.academic_years;
CREATE POLICY tenant_update ON public.academic_years FOR UPDATE
USING (get_auth_role() = 'superadmin' OR (school_id = get_auth_school_id() AND get_auth_role() = 'admin'));
DROP POLICY IF EXISTS tenant_delete ON public.academic_years;
CREATE POLICY tenant_delete ON public.academic_years FOR DELETE
USING (get_auth_role() = 'superadmin' OR (school_id = get_auth_school_id() AND get_auth_role() = 'admin'));

-- exam_subjects / subject_teachers: writes restricted to admin/teacher
DROP POLICY IF EXISTS tenant_insert ON public.exam_subjects;
CREATE POLICY tenant_insert ON public.exam_subjects FOR INSERT
WITH CHECK (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher'])));
DROP POLICY IF EXISTS tenant_update ON public.exam_subjects;
CREATE POLICY tenant_update ON public.exam_subjects FOR UPDATE
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher'])));
DROP POLICY IF EXISTS tenant_delete ON public.exam_subjects;
CREATE POLICY tenant_delete ON public.exam_subjects FOR DELETE
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher'])));
DROP POLICY IF EXISTS tenant_insert ON public.subject_teachers;
CREATE POLICY tenant_insert ON public.subject_teachers FOR INSERT
WITH CHECK (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher'])));
DROP POLICY IF EXISTS tenant_update ON public.subject_teachers;
CREATE POLICY tenant_update ON public.subject_teachers FOR UPDATE
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher'])));
DROP POLICY IF EXISTS tenant_delete ON public.subject_teachers;
CREATE POLICY tenant_delete ON public.subject_teachers FOR DELETE
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','teacher'])));

-- front-office tables: admin/receptionist only (was: any school member, read AND write)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['appointments','visitors','call_log','inquiries'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_select ON public.%I', t);
    EXECUTE format('CREATE POLICY tenant_select ON public.%I FOR SELECT USING (get_auth_role() = ''superadmin'' OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY[''admin'',''receptionist''])))', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', t);
    EXECUTE format('CREATE POLICY tenant_insert ON public.%I FOR INSERT WITH CHECK (get_auth_role() = ''superadmin'' OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY[''admin'',''receptionist''])))', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', t);
    EXECUTE format('CREATE POLICY tenant_update ON public.%I FOR UPDATE USING (get_auth_role() = ''superadmin'' OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY[''admin'',''receptionist''])))', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', t);
    EXECUTE format('CREATE POLICY tenant_delete ON public.%I FOR DELETE USING (get_auth_role() = ''superadmin'' OR (school_id = get_auth_school_id() AND get_auth_role() = ''admin''))', t);
  END LOOP;
END $$;

-- messages: only thread participants may post (was: anyone in the school, into any thread)
DROP POLICY IF EXISTS tenant_insert ON public.messages;
CREATE POLICY tenant_insert ON public.messages FOR INSERT
WITH CHECK (get_auth_role() = 'superadmin'
    OR (sender_id = auth.uid() AND EXISTS (
        SELECT 1 FROM public.thread_participants tp
        WHERE tp.thread_id = messages.thread_id AND tp.user_id = auth.uid())));

-- message_threads: only the creator or an admin may edit a thread (was: whole school)
DROP POLICY IF EXISTS tenant_update ON public.message_threads;
CREATE POLICY tenant_update ON public.message_threads FOR UPDATE
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND (created_by = auth.uid() OR has_role(auth.uid(), 'admin'))));

-- fee/billing detail reads: finance staff + row owner only (was: whole school)
DROP POLICY IF EXISTS ac_tenant_select ON public.additional_charges;
CREATE POLICY ac_tenant_select ON public.additional_charges FOR SELECT
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','accountant','teacher']))
    OR student_id = auth.uid());
DROP POLICY IF EXISTS sfa_tenant_select ON public.student_fee_assignments;
CREATE POLICY sfa_tenant_select ON public.student_fee_assignments FOR SELECT
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','accountant']))
    OR student_id = auth.uid());
DROP POLICY IF EXISTS inv_items_select ON public.invoice_items;
CREATE POLICY inv_items_select ON public.invoice_items FOR SELECT
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','accountant']))
    OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_items.invoice_id AND i.student_id = auth.uid()));

-- operational/billing metadata: admin-only reads (was: whole school)
DROP POLICY IF EXISTS tenant_select ON public.dashboard_metrics;
CREATE POLICY tenant_select ON public.dashboard_metrics FOR SELECT
USING (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','accountant'])));
DROP POLICY IF EXISTS tenant_select ON public.school_subscriptions;
CREATE POLICY tenant_select ON public.school_subscriptions FOR SELECT
USING (get_auth_role() = 'superadmin' OR (school_id = get_auth_school_id() AND get_auth_role() = 'admin'));
DROP POLICY IF EXISTS tenant_select ON public.storage_usage;
CREATE POLICY tenant_select ON public.storage_usage FOR SELECT
USING (get_auth_role() = 'superadmin' OR (school_id = get_auth_school_id() AND get_auth_role() = 'admin'));
DROP POLICY IF EXISTS tenant_select ON public.system_alerts;
CREATE POLICY tenant_select ON public.system_alerts FOR SELECT
USING (get_auth_role() = 'superadmin' OR (school_id = get_auth_school_id() AND get_auth_role() = 'admin'));
DROP POLICY IF EXISTS tenant_insert ON public.data_exports;
CREATE POLICY tenant_insert ON public.data_exports FOR INSERT
WITH CHECK (get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND get_auth_role() = ANY (ARRAY['admin','accountant'])));

-- profiles: let school members see teacher names (timetable/schedule joins were returning null teachers)
DROP POLICY IF EXISTS profiles_school_teacher_select ON public.profiles;
CREATE POLICY profiles_school_teacher_select ON public.profiles FOR SELECT TO authenticated
USING (school_id IS NOT NULL AND school_id = get_auth_school_id() AND role = 'teacher' AND deleted_at IS NULL);
