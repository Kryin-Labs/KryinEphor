import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { schoolDate } from '../../lib/timetable';
import type { Database } from '../../integrations/supabase/types';

type Lesson = Database['public']['Functions']['timetable_schedule']['Returns'][number];

export default function TodayTimetable({ schoolId, studentId, teacherId }: { schoolId: string | null; studentId?: string; teacherId?: string }) {
    const { data, isLoading, error } = useQuery({
        queryKey: ['dashboard-timetable', schoolId, studentId, teacherId], enabled: !!schoolId,
        refetchInterval: 60_000,
        queryFn: async () => {
            const zone = await supabase.from('schools').select('time_zone').eq('id', schoolId!).single();
            if (zone.error) throw zone.error;
            const today = schoolDate(zone.data.time_zone);
            let classIds: string[] | null = null;
            if (studentId) {
                const enrolled = await supabase.from('class_enrollments').select('class_id')
                    .eq('student_id', studentId).eq('school_id', schoolId!).is('deleted_at', null);
                if (enrolled.error) throw enrolled.error;
                classIds = (enrolled.data ?? []).map(row => row.class_id);
            }
            if (classIds?.length === 0) return { today, zone: zone.data.time_zone, lessons: [] };
            const result = await supabase.rpc('timetable_schedule', { p_from: today, p_to: today });
            if (result.error) throw result.error;
            return { today, zone: zone.data.time_zone,
                lessons: ((result.data ?? []) as Lesson[]).filter(row =>
                    (!classIds || classIds.includes(row.class_id)) && (!teacherId || row.teacher_id === teacherId)),
            };
        },
    });
    return <section className="clay-card p-5 sm:p-6" aria-labelledby="today-timetable-title">
        <div className="mb-4 flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-primary"><CalendarDays size={19} /></span><div><h2 id="today-timetable-title" className="text-lg font-bold">Today's timetable</h2><p className="text-xs text-muted">{data?.zone ?? 'School time'} · {data?.today ?? ''}</p></div></div><Link to="/timetable" className="text-xs font-bold text-primary">Full timetable →</Link></div>
        {isLoading ? <p className="text-sm text-muted">Loading lessons…</p> : error ? <p className="text-sm text-rose-700">Could not load lessons.</p> : !data?.lessons.length ? <p className="text-sm text-muted">No published lessons today.</p> : <div className="space-y-2">{data.lessons.slice(0, 6).map(lesson => <div key={lesson.id} className="flex justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2 text-sm"><div><strong>{lesson.subject_name}</strong><p className="text-xs text-muted">{lesson.class_name} · {lesson.teacher_name ?? 'Teacher unassigned'}{lesson.room ? ` · ${lesson.room}` : ''}</p></div><span className="shrink-0 font-bold text-primary">{lesson.start_time.slice(0, 5)}</span></div>)}{data.lessons.length > 6 && <p className="text-sm text-muted">{data.lessons.length - 6} more lesson{data.lessons.length === 7 ? '' : 's'} in the full timetable.</p>}</div>}
    </section>;
}
