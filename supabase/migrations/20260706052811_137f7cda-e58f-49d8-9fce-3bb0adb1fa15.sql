DROP VIEW IF EXISTS public.school_summary_metrics;
CREATE VIEW public.school_summary_metrics
WITH (security_invoker=on) AS
SELECT s.id, s.name, s.subdomain, s.email_domain, s.subscription_tier, s.status, s.settings,
       s.created_at, s.updated_at, s.slug, s.address, s.city, s.state, s.country, s.phone,
       s.email, s.logo_url, s.website, s.max_students, s.deleted_at, s.created_by, s.updated_by,
       COALESCE(st.student_count, 0::bigint) AS student_count,
       COALESCE(adm.admin_count, 0::bigint) AS admin_count,
       COALESCE(inv.revenue, 0::numeric) AS revenue,
       ad.admin_id, ad.admin_email, ad.admin_name
  FROM public.schools s
  LEFT JOIN (SELECT school_id, count(*) AS student_count FROM public.profiles
             WHERE role = 'student' AND deleted_at IS NULL GROUP BY school_id) st ON st.school_id = s.id
  LEFT JOIN (SELECT school_id, count(*) AS admin_count FROM public.profiles
             WHERE role IN ('admin','Admin') AND deleted_at IS NULL GROUP BY school_id) adm ON adm.school_id = s.id
  LEFT JOIN (SELECT school_id, sum(amount) AS revenue FROM public.invoices
             WHERE status = 'paid' AND deleted_at IS NULL GROUP BY school_id) inv ON inv.school_id = s.id
  LEFT JOIN LATERAL (SELECT id AS admin_id, email AS admin_email, full_name AS admin_name
                     FROM public.profiles
                     WHERE school_id = s.id AND role IN ('admin','Admin') AND deleted_at IS NULL
                     ORDER BY created_at LIMIT 1) ad ON true
 WHERE s.deleted_at IS NULL;

GRANT SELECT ON public.school_summary_metrics TO authenticated;
GRANT SELECT ON public.school_summary_metrics TO service_role;