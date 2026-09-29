alter table public.exam_subjects
  add column if not exists chapter_name text;

create or replace function public.fn_student_performance_summary()
returns table (
  exam_subject_id uuid,
  exam_name text,
  subject_name text,
  chapter_name text,
  exam_date date,
  max_marks numeric,
  your_score numeric,
  class_average numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with current_enrollment as (
    select distinct on (ce.student_id) ce.class_id, ce.school_id
    from public.class_enrollments ce
    where ce.student_id = auth.uid()
      and ce.deleted_at is null
    order by ce.student_id, ce.enrolled_at desc nulls last
  )
  select
    es.id,
    e.name,
    s.name,
    es.chapter_name,
    es.exam_date,
    es.max_marks,
    max(er.marks_obtained) filter (where er.student_id = auth.uid()),
    avg(er.marks_obtained)
  from current_enrollment ce
  join public.exam_subjects es
    on es.class_id = ce.class_id
   and es.school_id = ce.school_id
   and es.deleted_at is null
  join public.exams e
    on e.id = es.exam_id
   and e.deleted_at is null
  join public.subjects s on s.id = es.subject_id
  join public.exam_results er
    on er.exam_subject_id = es.id
   and er.school_id = ce.school_id
   and er.deleted_at is null
   and er.is_absent is not true
   and er.marks_obtained is not null
  group by es.id, e.name, s.name, es.chapter_name, es.exam_date, es.max_marks
  order by es.exam_date desc nulls last;
$$;

revoke all on function public.fn_student_performance_summary() from public;
revoke all on function public.fn_student_performance_summary() from anon;
grant execute on function public.fn_student_performance_summary() to authenticated;
