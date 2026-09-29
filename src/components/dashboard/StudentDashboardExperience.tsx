import { useState } from 'react';
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, Megaphone, Target, TimerReset, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

type AttendanceStatus = 'present' | 'absent' | 'late';
type FeedItem = { id: string; title: string; message: string | null; created_at: string | null };
type ExamRow = { marks_obtained: number | null; grade: string | null; exam_subjects: { max_marks: number; subjects: { name: string } | null } | null };

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const statusStyle: Record<AttendanceStatus, string> = {
    present: 'bg-emerald-100 text-emerald-800',
    absent: 'bg-rose-100 text-rose-800',
    late: 'bg-amber-100 text-amber-800',
};

export default function StudentDashboardExperience({ studentId, schoolId, feed, isFeedLoading, isParentView }: {
    studentId: string; schoolId: string | null; feed: FeedItem[]; isFeedLoading: boolean; isParentView?: boolean;
}) {
    const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerYear, setPickerYear] = useState(month.getFullYear());
    const start = dateKey(month);
    const end = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    const attendanceQuery = useQuery({
        queryKey: ['student-dashboard-attendance', studentId, schoolId, start],
        enabled: !!studentId,
        queryFn: async () => {
            let query = supabase.from('attendance').select('date, status').eq('student_id', studentId).gte('date', start).lte('date', end).is('deleted_at', null);
            if (schoolId) query = query.eq('school_id', schoolId);
            const { data, error } = await query;
            if (error) throw error;
            return new Map((data ?? []).map(row => [row.date, (row.status ?? '').toLowerCase() as AttendanceStatus]));
        },
    });
    const progressQuery = useQuery({
        queryKey: ['student-dashboard-progress', studentId],
        enabled: !!studentId,
        queryFn: async () => {
            const { data, error } = await supabase.from('exam_results').select('marks_obtained, grade, exam_subjects(max_marks, subjects(name))').eq('student_id', studentId).not('marks_obtained', 'is', null).is('deleted_at', null);
            if (error) throw error;
            const grouped = new Map<string, { total: number; count: number; grade: string | null }>();
            for (const row of (data ?? []) as unknown as ExamRow[]) {
                const name = row.exam_subjects?.subjects?.name;
                if (!name || row.marks_obtained === null || !row.exam_subjects?.max_marks) continue;
                const item = grouped.get(name) ?? { total: 0, count: 0, grade: null };
                item.total += (Number(row.marks_obtained) / row.exam_subjects.max_marks) * 100;
                item.count += 1;
                item.grade = row.grade ?? item.grade;
                grouped.set(name, item);
            }
            return [...grouped.entries()].map(([name, item]) => ({ name, score: Math.round(item.total / item.count), grade: item.grade })).slice(0, 5);
        },
    });

    const records = attendanceQuery.data ?? new Map<string, AttendanceStatus>();
    const days = Array.from({ length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1));
    const counts = (['present', 'absent', 'late'] as AttendanceStatus[]).map(status => [status, [...records.values()].filter(value => value === status).length] as const);
    const marked = counts.reduce((total, [, count]) => total + count, 0);
    const subjects = progressQuery.data ?? [];
    const topSubjects = [...subjects].sort((a, b) => b.score - a.score).slice(0, 3);
    const average = subjects.length ? Math.round(subjects.reduce((total, subject) => total + subject.score, 0) / subjects.length) : null;
    const attendanceRate = marked ? Math.round((counts[0][1] / marked) * 100) : null;
    const changeMonth = (delta: number) => setMonth(current => new Date(current.getFullYear(), current.getMonth() + delta, 1));
    const chooseMonth = (selectedMonth: number) => { setMonth(new Date(pickerYear, selectedMonth, 1)); setPickerOpen(false); };

    return (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-8 animate-fade-up delay-100">
            <div className="xl:col-span-3 space-y-5">
            <section className="clay-card p-5" aria-labelledby="school-feed-title">
                <div className="flex items-center justify-between gap-3 mb-5">
                    <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-teal-50 text-primary grid place-items-center"><Megaphone className="w-5 h-5" /></span>
                    <div><h2 id="school-feed-title" className="text-lg font-bold text-foreground">{isParentView ? "Ward's School Feed" : "School Feed"}</h2><p className="text-xs text-muted">{isParentView ? "Announcements and school notices" : "Updates selected for you"}</p></div>
                    </div>
                    {!isParentView && <Link to="/focus" className="inline-flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-bold text-primary transition hover:bg-teal-100"><TimerReset className="w-3.5 h-3.5" /> Focus</Link>}
                </div>
                {isFeedLoading ? <div className="h-16 rounded-xl bg-stone-100 animate-pulse" /> : feed.length === 0 ? <p className="py-4 text-sm text-muted text-center">No school updates yet.</p> : <div className="space-y-2">{feed.slice(0, 3).map(item => <article key={item.id} className="rounded-xl bg-stone-50 px-4 py-2.5"><h3 className="text-sm font-bold text-foreground">{item.title}</h3><p className="text-xs text-muted mt-0.5 line-clamp-1">{item.message}</p></article>)}</div>}
            </section>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <section className="clay-card p-6" aria-labelledby="subject-snapshot-title"><div className="flex items-center gap-3 mb-5"><span className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 grid place-items-center"><Trophy className="w-5 h-5" /></span><div><h2 id="subject-snapshot-title" className="text-lg font-bold text-foreground">Subject Snapshot</h2><p className="text-xs text-muted">{isParentView ? "Your child's strongest subjects" : "Your strongest subjects from published results"}</p></div></div><div className="text-xs font-bold text-muted mb-3">Top Subjects</div>{topSubjects.length === 0 ? <p className="py-4 text-sm text-muted">{isParentView ? "Top subjects will appear after results are published." : "Your top subjects will appear after results are published."}</p> : <div className="space-y-3">{topSubjects.map(subject => <div key={subject.name} className="flex items-center justify-between text-sm"><span className="font-semibold text-foreground">{subject.name}</span><span className="font-bold text-primary">{subject.score}%</span></div>)}<span className="inline-block pt-1 text-sm font-bold text-primary">View All →</span></div>}</section>
                <section className="clay-card p-6" aria-labelledby="current-standing-title"><div className="flex items-center gap-3 mb-5"><span className="w-10 h-10 rounded-xl bg-violet-50 text-violet-700 grid place-items-center"><Target className="w-5 h-5" /></span><div><h2 id="current-standing-title" className="text-lg font-bold text-foreground">Current Standing</h2><p className="text-xs text-muted">{isParentView ? "Ward's performance this month" : "Your performance this month"}</p></div></div><dl className="space-y-3 text-sm"><div className="flex justify-between"><dt className="text-muted">Class Rank</dt><dd className="font-bold text-foreground">—</dd></div><div className="flex justify-between"><dt className="text-muted">Average</dt><dd className="font-bold text-foreground">{average === null ? '—' : `${average}%`}</dd></div><div className="flex justify-between"><dt className="text-muted">Attendance</dt><dd className="font-bold text-foreground">{attendanceRate === null ? '—' : `${attendanceRate}%`}</dd></div><div className="flex justify-between"><dt className="text-muted">Assignments</dt><dd className="font-bold text-foreground">—</dd></div></dl></section>
            </div>
            </div>

            <aside className="xl:col-span-2 space-y-5">
                <section className="clay-card p-6" aria-labelledby="academic-progress-title">
                    <div className="flex items-center gap-3 mb-5"><span className="w-10 h-10 rounded-xl bg-sky-50 text-sky-700 grid place-items-center"><BarChart3 className="w-5 h-5" /></span><div><h2 id="academic-progress-title" className="text-lg font-bold text-foreground">Academic Progress</h2><p className="text-xs text-muted">{isParentView ? "Subject-wise performance from published results" : "Subject-wise performance from published results"}</p></div></div>
                    {progressQuery.isLoading ? <div className="space-y-4">{[1, 2, 3].map(item => <div key={item} className="h-9 bg-stone-100 rounded-lg animate-pulse" />)}</div> : (progressQuery.data?.length ?? 0) === 0 ? <p className="py-8 text-center text-sm text-muted">{isParentView ? "Progress will appear after exam results are published." : "Your progress will appear after exam results are published."}</p> : <div className="space-y-5">{progressQuery.data?.map(subject => <div key={subject.name}><div className="flex justify-between text-sm mb-2"><span className="font-bold text-foreground">{subject.name}</span><span className="font-bold text-primary">{subject.score}%{subject.grade ? ` · ${subject.grade}` : ''}</span></div><div className="h-2 rounded-full bg-stone-100 overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${subject.score}%` }} /></div></div>)}</div>}
                </section>

                <section className="clay-card p-6" aria-labelledby="attendance-calendar-title">
                    <div className="flex items-center justify-between mb-5">
                        <div className="flex items-center gap-3"><span className="w-10 h-10 rounded-xl bg-teal-50 text-primary grid place-items-center"><CalendarDays className="w-5 h-5" /></span><div><h2 id="attendance-calendar-title" className="text-lg font-bold text-foreground">Attendance History</h2><p className="text-xs text-muted">{isParentView ? "Ward's attendance record this month" : "Your attendance record this month"}</p></div></div>
                        <div className="relative flex items-center gap-0.5">
                            <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month" className="p-1.5 rounded-md hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-primary"><ChevronLeft className="w-3.5 h-3.5" /></button>
                            <button type="button" onClick={() => { setPickerYear(month.getFullYear()); setPickerOpen(value => !value); }} className="px-1.5 py-1 text-xs font-bold text-foreground rounded-md hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-primary">{months[month.getMonth()]} {month.getFullYear()}</button>
                            <button type="button" onClick={() => changeMonth(1)} aria-label="Next month" className="p-1.5 rounded-md hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-primary"><ChevronRight className="w-3.5 h-3.5" /></button>
                            {pickerOpen && <div className="absolute z-20 top-9 right-0 w-64 rounded-xl bg-white border border-stone-200 shadow-lg p-3"><p className="text-xs font-bold text-foreground text-center mb-2">Select Date</p><div className="flex items-center justify-between mb-2"><button type="button" onClick={() => setPickerYear(year => year - 1)} className="p-1 rounded-md hover:bg-stone-100" aria-label="Previous year"><ChevronLeft className="w-3.5 h-3.5" /></button><span className="font-bold text-xs">{pickerYear}</span><button type="button" onClick={() => setPickerYear(year => year + 1)} className="p-1 rounded-md hover:bg-stone-100" aria-label="Next year"><ChevronRight className="w-3.5 h-3.5" /></button></div><div className="grid grid-cols-4 gap-1">{months.map((label, index) => <button key={label} type="button" onClick={() => chooseMonth(index)} className="py-1.5 rounded-md text-xs font-semibold hover:bg-teal-50 hover:text-primary">{label.slice(0, 3)}</button>)}</div></div>}
                        </div>
                    </div>
                    <div className="grid grid-cols-7 gap-2 text-center text-xs font-bold text-muted mb-3">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}</div>
                    <div className="grid grid-cols-7 gap-2">{Array.from({ length: (days[0].getDay() + 6) % 7 }, (_, index) => <span key={`blank-${index}`} />)}{days.map(date => { const key = dateKey(date); const status = records.get(key); const today = key === dateKey(new Date()); return <div key={key} title={status ? `${key}: ${status}` : `${key}: not marked`} className={`w-9 h-9 mx-auto rounded-lg grid place-items-center text-sm font-semibold transition-transform duration-200 hover:scale-105 ${status ? statusStyle[status] : 'text-stone-600 hover:bg-stone-100'} ${today ? 'ring-2 ring-primary/40 ring-offset-1' : ''}`}>{date.getDate()}</div>; })}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 mt-5 text-xs font-semibold text-muted"><span><i className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5" />Present</span><span><i className="inline-block w-2 h-2 rounded-full bg-rose-500 mr-1.5" />Absent</span><span><i className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1.5" />Late</span><span>{marked ? `${Math.round((counts[0][1] / marked) * 100)}% present` : 'Not marked'}</span></div>
                </section>
            </aside>
        </div>
    );
}
