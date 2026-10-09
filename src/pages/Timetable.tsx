import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, Plus } from 'lucide-react';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { addDays, niceDate, schoolDate, shiftAnchor, timetableRange, weekday, type TimetableView } from '../lib/timetable';
import type { Database } from '../integrations/supabase/types';

type Lesson = Database['public']['Functions']['timetable_schedule']['Returns'][number];
type Weekly = Database['public']['Tables']['timetable']['Row'];
type Exception = Database['public']['Tables']['timetable_exceptions']['Row'];
type Draft = Database['public']['Tables']['timetable_drafts']['Row'];
type DraftPreviewResult = { before: Lesson[]; after: Lesson[]; error: string | null; affected_user_count: number; from_date: string; to_date: string };
type Form = Pick<Draft, 'kind' | 'target_id' | 'base_id' | 'class_id' | 'start_date' | 'end_date' |
    'day_of_week' | 'start_time' | 'end_time' | 'subject_id' | 'teacher_id' | 'room' | 'cancelled'> & { id?: string };
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const input = 'w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40';
const teacherName = (value: unknown) => {
    const person = Array.isArray(value) ? value[0] : value;
    return (person as { full_name?: string | null } | null)?.full_name ?? null;
};

export default function Timetable() {
    const { user, role, activeStudentId, linkedStudents } = useAuth();
    const qc = useQueryClient();
    const schoolId = user?.schoolId;
    const managing = role === 'admin' || role === 'teacher';
    const [view, setView] = useState<TimetableView>('Week');
    const [anchor, setAnchor] = useState(() => schoolDate('UTC'));
    const [customEnd, setCustomEnd] = useState(() => addDays(schoolDate('UTC'), 6));
    const [classId, setClassId] = useState('');
    const [form, setForm] = useState<Form | null>(null);
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const previewQuery = useQuery({
        queryKey: ['timetable-preview', user?.id, schoolId, previewId], enabled: !!previewId,
        queryFn: async () => {
            const { data, error } = await supabase.rpc('timetable_preview_draft', { p_id: previewId! });
            if (error) throw error;
            return data as unknown as DraftPreviewResult;
        },
    });
    const studentId = activeStudentId ?? linkedStudents.find(s => s.isPrimary)?.studentId ?? linkedStudents[0]?.studentId ?? user?.id;

    const schoolQuery = useQuery({
        queryKey: ['timetable-school', schoolId], enabled: !!schoolId,
        queryFn: async () => {
            const { data, error } = await supabase.from('schools').select('time_zone').eq('id', schoolId!).single();
            if (error) throw error;
            return data.time_zone;
        },
    });
    const zone = schoolQuery.data ?? 'UTC';
    useEffect(() => {
        if (schoolQuery.data) {
            const today = schoolDate(schoolQuery.data);
            setAnchor(today); setCustomEnd(addDays(today, 6));
        }
    }, [schoolQuery.data]);

    const classesQuery = useQuery({
        queryKey: ['timetable-classes', schoolId, role, studentId, user?.id], enabled: !!schoolId && !!user,
        queryFn: async () => {
            if (role === 'admin') {
                const { data, error } = await supabase.from('classes').select('id,name,section,academic_year_id')
                    .eq('school_id', schoolId!).is('deleted_at', null).order('name');
                if (error) throw error;
                return data ?? [];
            }
            let classIds: string[];
            let teacherAssignments: { class_id: string; academic_year_id: string | null }[] = [];
            let homeroomIds: string[] = [];
            if (role === 'teacher') {
                const [subjects, home] = await Promise.all([
                    supabase.from('subject_teachers').select('class_id,academic_year_id').eq('school_id', schoolId!).eq('teacher_id', user!.id),
                    supabase.from('classes').select('id').eq('school_id', schoolId!).eq('teacher_id', user!.id).is('deleted_at', null),
                ]);
                if (subjects.error || home.error) throw subjects.error ?? home.error;
                teacherAssignments = subjects.data ?? [];
                homeroomIds = (home.data ?? []).map(row => row.id);
                classIds = [...new Set([...teacherAssignments.map(row => row.class_id), ...homeroomIds])];
            } else {
                const ids = await supabase.from('class_enrollments').select('class_id')
                    .eq('school_id', schoolId!).eq('student_id', studentId!).is('deleted_at', null);
                if (ids.error) throw ids.error;
                classIds = [...new Set((ids.data ?? []).map(row => row.class_id))];
            }
            if (!classIds.length) return [];
            const { data, error } = await supabase.from('classes').select('id,name,section,academic_year_id')
                .in('id', classIds).is('deleted_at', null).order('name');
            if (error) throw error;
            return role === 'teacher' ? (data ?? []).filter(item => homeroomIds.includes(item.id)
                || teacherAssignments.some(assignment => assignment.class_id === item.id &&
                    (assignment.academic_year_id === null || assignment.academic_year_id === item.academic_year_id))) : data ?? [];
        },
    });
    const classes = useMemo(() => classesQuery.data ?? [], [classesQuery.data]);
    const selectedClass = classes.find(c => c.id === classId);
    useEffect(() => {
        if (classes.length && !classes.some(c => c.id === classId)) setClassId(classes[0].id);
    }, [classes, classId]);
    const range = timetableRange(view, anchor, customEnd);
    const validRange = range.to >= range.from && range.to <= addDays(range.from, 365);
    const scheduleQuery = useQuery({
        queryKey: ['timetable-schedule', schoolId, user?.id, role, studentId, classId, range.from, range.to],
        enabled: !!schoolQuery.data && classes.some(c => c.id === classId) && validRange,
        queryFn: async () => {
            const lessons: Lesson[] = [];
            for (let page = 0; ; page++) {
                const { data, error } = await supabase.rpc('timetable_schedule', {
                    p_from: range.from, p_to: range.to, p_class: classId,
                }).range(page * 1000, page * 1000 + 999);
                if (error) throw error;
                const rows = (data ?? []) as Lesson[];
                lessons.push(...rows);
                if (rows.length < 1000) return lessons;
            }
        },
    });
    const optionsQuery = useQuery({
        queryKey: ['timetable-options', schoolId, user?.id, role, classId, selectedClass?.academic_year_id],
        enabled: !!schoolId && classes.some(c => c.id === classId) && managing,
        queryFn: async () => {
            const [subjects, assignments, weekly, exceptions, drafts] = await Promise.all([
                supabase.from('subjects').select('id,name').eq('school_id', schoolId!).is('deleted_at', null).order('name'),
                supabase.from('subject_teachers').select('class_id,subject_id,teacher_id,academic_year_id,profiles:teacher_id(full_name)').eq('school_id', schoolId!).eq('class_id', classId),
                supabase.from('timetable').select('*').eq('school_id', schoolId!).eq('class_id', classId).is('deleted_at', null),
                supabase.from('timetable_exceptions').select('*').eq('school_id', schoolId!).eq('class_id', classId),
                supabase.from('timetable_drafts').select('*').eq('school_id', schoolId!).eq('class_id', classId).order('created_at'),
            ]);
            for (const result of [subjects, assignments, weekly, exceptions, drafts]) if (result.error) throw result.error;
            return {
                subjects: subjects.data ?? [], assignments: (assignments.data ?? []).filter(assignment =>
                    assignment.academic_year_id === null || assignment.academic_year_id === selectedClass?.academic_year_id),
                weekly: weekly.data ?? [], exceptions: exceptions.data ?? [], drafts: drafts.data ?? [],
            };
        },
    });
    const options = optionsQuery.data;
    const lessons: Lesson[] = (scheduleQuery.data ?? []).filter(lesson => role !== 'teacher' || lesson.teacher_id === user?.id);
    const drafts = (options?.drafts ?? []).filter(d => d.class_id === classId && (role === 'admin' || d.author_id === user?.id));
    const exceptions = (options?.exceptions ?? []).filter(e => e.class_id === classId && (role !== 'teacher' || e.teacher_id === user?.id));
    const visibleSubjects = role === 'teacher'
        ? options?.subjects.filter(s => options.assignments.some(a => a.class_id === classId && a.subject_id === s.id && a.teacher_id === user?.id)) ?? []
        : options?.subjects ?? [];
    const teacherChoices = options?.assignments.filter(a => a.class_id === classId && a.subject_id === form?.subject_id) ?? [];

    const newForm = (kind: 'weekly' | 'exception'): Form => ({
        kind, class_id: classId, target_id: null, base_id: null,
        start_date: kind === 'exception' ? anchor : null,
        end_date: kind === 'exception' ? anchor : null,
        day_of_week: weekday(anchor), start_time: '09:00', end_time: '10:00',
        subject_id: visibleSubjects[0]?.id ?? '', teacher_id: role === 'teacher' ? user?.id ?? null : null,
        room: null, cancelled: false,
    });
    const editLesson = (lesson: Lesson, kind: 'weekly' | 'exception') => {
        const weekly = options?.weekly.find(t => t.id === lesson.base_id);
        const exception = lesson.source === 'exception' ? options?.exceptions.find(e => e.id === lesson.id) : null;
        if (kind === 'weekly' && !weekly) return;
        const source: Weekly | Exception | Lesson = kind === 'weekly' ? weekly! : exception ?? lesson;
        setForm({
            ...newForm(kind), target_id: kind === 'weekly' ? weekly!.id : exception?.id ?? null,
            base_id: kind === 'exception' ? lesson.base_id : null,
            day_of_week: source.day_of_week, start_time: source.start_time.slice(0, 5),
            end_time: source.end_time.slice(0, 5), subject_id: source.subject_id,
            teacher_id: source.teacher_id, room: source.room,
            start_date: kind === 'exception' ? exception?.start_date ?? lesson.lesson_date : weekly!.effective_start,
            end_date: kind === 'exception' ? exception?.end_date ?? lesson.lesson_date : weekly!.effective_end,
            cancelled: kind === 'exception' ? exception?.cancelled ?? false : false,
        });
    };
    const editDraft = (draft: Draft) => setForm({
        id: draft.id, kind: draft.kind, target_id: draft.target_id, base_id: draft.base_id,
        class_id: draft.class_id, start_date: draft.start_date, end_date: draft.end_date,
        day_of_week: draft.day_of_week, start_time: draft.start_time.slice(0, 5),
        end_time: draft.end_time.slice(0, 5), subject_id: draft.subject_id,
        teacher_id: draft.teacher_id, room: draft.room, cancelled: draft.cancelled,
    });
    const editException = (exception: Exception, restore = false) => setForm({
        ...newForm('exception'), target_id: exception.id, base_id: restore ? null : exception.base_id,
        start_date: exception.start_date, end_date: exception.end_date,
        day_of_week: exception.day_of_week, start_time: exception.start_time.slice(0, 5),
        end_time: exception.end_time.slice(0, 5), subject_id: exception.subject_id,
        teacher_id: exception.teacher_id, room: exception.room, cancelled: restore || exception.cancelled,
    });
    const refresh = () => {
        qc.invalidateQueries({ queryKey: ['timetable-schedule'] });
        qc.invalidateQueries({ queryKey: ['timetable-options'] });
        qc.invalidateQueries({ queryKey: ['timetable-preview'] });
        qc.invalidateQueries({ queryKey: ['dashboard-timetable'] });
    };
    const saveDraft = async () => {
        if (!form || !form.subject_id || !form.class_id || form.start_time >= form.end_time) {
            toast.error('Choose a subject and valid lesson time.'); return;
        }
        if (form.kind === 'exception' && (!form.start_date || !form.end_date || form.end_date < form.start_date)) {
            toast.error('Choose a valid exception date range.'); return;
        }
        setBusy(true);
        const { data, error } = await supabase.rpc('timetable_save_draft', { p_data: form });
        setBusy(false);
        if (error) { toast.error(error.message); return; }
        toast.success('Draft saved'); setForm(null); setPreviewId(data); refresh();
    };
    const actOnDraft = async (draft: Draft, action: 'publish' | 'discard') => {
        setBusy(true);
        const { error } = action === 'publish'
            ? await supabase.rpc('timetable_publish_draft', { p_id: draft.id })
            : await supabase.rpc('timetable_discard_draft', { p_id: draft.id });
        setBusy(false);
        if (error) { toast.error(error.message); return; }
        toast.success(action === 'publish' ? 'Schedule published' : 'Draft discarded');
        setPreviewId(null); refresh();
    };
    const setZone = async (timeZone: string) => {
        if (!schoolId) return;
        try { new Intl.DateTimeFormat('en-US', { timeZone }); }
        catch { toast.error('Enter a valid IANA time zone.'); return; }
        const { error } = await supabase.rpc('timetable_set_zone', { p_zone: timeZone });
        if (error) toast.error(error.message);
        else {
            toast.success('School time zone saved');
            qc.invalidateQueries({ queryKey: ['timetable-school', schoolId] });
            qc.invalidateQueries({ queryKey: ['dashboard-timetable', schoolId] });
        }
    };
    const grouped = lessons.reduce<Record<string, Lesson[]>>((all, lesson) => {
        (all[lesson.lesson_date] ??= []).push(lesson);
        return all;
    }, {});
    const preview = previewQuery.data;
    const displayed = (item: Lesson) => [item.lesson_date, item.start_time, item.end_time,
        item.subject_id, item.teacher_id, item.room, item.class_id].join('|');
    const previewDates = preview ? [...new Set([...preview.before, ...preview.after].map(item => item.lesson_date))]
        .filter(date => JSON.stringify(preview.before.filter(item => item.lesson_date === date).map(displayed).sort())
            !== JSON.stringify(preview.after.filter(item => item.lesson_date === date).map(displayed).sort())).sort() : [];

    return <div className="flex min-h-screen bg-background">
        <Sidebar activePage="Timetable" />
        <div className="flex min-h-screen flex-1 flex-col lg:ml-72">
            <Header title="Timetable" />
            <main className="flex-1 space-y-5 p-4 pb-24 sm:p-8">
                <div className="clay-card p-5 sm:p-7">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-teal-50 text-primary"><CalendarDays size={21} /></span><div><h1 className="text-2xl font-extrabold text-foreground">School timetable</h1><p className="text-sm text-muted">{schoolQuery.data ? `Times shown in ${schoolQuery.data}` : 'Loading school time zone…'}</p></div></div></div>
                        {managing && classId && <div className="flex flex-wrap gap-2"><button className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={!visibleSubjects.length} onClick={() => setForm(newForm('weekly'))}><Plus size={15} className="mr-1 inline" /> Weekly lesson</button><button className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-bold disabled:opacity-50" disabled={!visibleSubjects.length} onClick={() => setForm(newForm('exception'))}>Add date lesson</button></div>}
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <label className="text-xs font-bold text-muted">Class<select className={`${input} mt-1`} value={classId} onChange={e => setClassId(e.target.value)}>{classes.map(c => <option key={c.id} value={c.id}>{c.name}{c.section ? ` · ${c.section}` : ''}</option>)}</select></label>
                        <label className="text-xs font-bold text-muted">View<select className={`${input} mt-1`} value={view} onChange={e => setView(e.target.value as TimetableView)}>{(['Day', 'Week', 'Month', '3 Months', 'Custom Range'] as TimetableView[]).map(v => <option key={v}>{v}</option>)}</select></label>
                        <label className="text-xs font-bold text-muted">{view === 'Custom Range' ? 'From' : 'Choose date'}<input className={`${input} mt-1`} type="date" value={anchor} onChange={e => setAnchor(e.target.value || schoolDate(zone))} /></label>
                        {view === 'Custom Range' ? <label className="text-xs font-bold text-muted">To<input className={`${input} mt-1`} type="date" min={anchor} max={addDays(anchor, 365)} value={customEnd} onChange={e => setCustomEnd(e.target.value || anchor)} /></label> : <div className="flex items-end gap-2"><button className={`${input} font-bold`} onClick={() => setAnchor(shiftAnchor(anchor, view, -1))}>Previous</button><button className={`${input} font-bold`} onClick={() => setAnchor(shiftAnchor(anchor, view, 1))}>Next</button></div>}
                    </div>
                    {role === 'admin' && <label className="mt-4 block max-w-sm text-xs font-bold text-muted">School time zone<input className={`${input} mt-1`} key={zone} defaultValue={zone} list="time-zones" onBlur={e => { if (e.target.value !== zone) setZone(e.target.value); }} /><datalist id="time-zones">{Intl.supportedValuesOf?.('timeZone').map(z => <option key={z} value={z} />)}</datalist></label>}
                </div>
                {!validRange && <p className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">Choose a range of up to 366 days.</p>}
                {schoolQuery.error && <p className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">Could not load the school time zone: {schoolQuery.error.message}</p>}
                {managing && optionsQuery.error && <p className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">Could not load lesson editor: {optionsQuery.error.message}</p>}
                {schoolQuery.isLoading || classesQuery.isLoading || scheduleQuery.isLoading ? <div className="clay-card p-8 text-sm text-muted">Loading timetable…</div> : classesQuery.error ? <div className="clay-card p-8 text-sm text-rose-700">{classesQuery.error.message}</div> : classes.length === 0 ? <div className="clay-card p-8 text-sm text-muted">No class is available for this account.</div> : !schoolQuery.error && validRange && (scheduleQuery.error ? <div className="clay-card p-8 text-sm text-rose-700">{scheduleQuery.error.message}</div> : <section className="clay-card p-5 sm:p-6" aria-label="Published timetable"><h2 className="text-lg font-bold">Published schedule</h2><p className="mb-4 text-xs text-muted">{niceDate(range.from)} – {niceDate(range.to)} · {selectedClass?.name}</p>{lessons.length === 0 ? <p className="py-8 text-center text-sm text-muted">No published lessons in this range.</p> : <div className="space-y-5">{Object.entries(grouped).map(([date, items]) => <div key={date}><h3 className="mb-2 text-sm font-extrabold text-primary">{niceDate(date)}</h3><div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">{(items ?? []).map(lesson => <article key={`${lesson.id}-${date}`} className="rounded-xl border border-stone-200 bg-white p-4"><div className="flex justify-between gap-2"><div><p className="font-bold text-foreground">{lesson.subject_name}</p><p className="text-xs text-muted">{lesson.start_time.slice(0, 5)}–{lesson.end_time.slice(0, 5)} · {lesson.teacher_name ?? 'Teacher unassigned'}{lesson.room ? ` · ${lesson.room}` : ''}</p></div>{lesson.source === 'exception' && <span className="h-fit rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">Changed</span>}</div>{managing && <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold text-primary"><button onClick={() => editLesson(lesson, 'weekly')} disabled={!options?.weekly.some(t => t.id === lesson.base_id)}>Edit weekly</button><button onClick={() => editLesson(lesson, 'exception')}>Change dates</button></div>}</article>)}</div></div>)}</div>}</section>)}
                {managing && <section className="clay-card p-5 sm:p-6"><h2 className="text-lg font-bold">Drafts awaiting publication</h2><p className="mb-4 text-xs text-muted">Save a draft, preview it, then publish it for students and parents.</p>{drafts.length === 0 ? <p className="text-sm text-muted">No drafts for this class.</p> : <div className="space-y-3">{drafts.map(d => <article key={d.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-bold">{options?.subjects.find(s => s.id === d.subject_id)?.name ?? 'Lesson'} · {dayNames[d.day_of_week]}</p><p className="text-xs text-muted">{d.kind === 'weekly' ? 'Every week' : `${d.start_date} to ${d.end_date}`} · {d.start_time.slice(0, 5)}–{d.end_time.slice(0, 5)}{d.cancelled ? ' · Cancelled' : ''}</p></div><div className="flex gap-3 text-xs font-bold text-primary"><button onClick={() => editDraft(d)}>Edit</button><button onClick={() => setPreviewId(previewId === d.id ? null : d.id)}>Preview</button><button onClick={() => actOnDraft(d, 'discard')} disabled={busy}>Discard</button></div></div>{previewId === d.id && <div className="mt-3 border-t border-amber-200 pt-3 text-sm">
    {previewQuery.isLoading ? <p className="text-muted">Checking draft and conflicts…</p> : previewQuery.error
        ? <p role="alert" className="text-rose-700">{previewQuery.error.message}</p> : preview && <>
        <p className="font-bold">Preview: {niceDate(preview.from_date)} – {niceDate(preview.to_date)}</p>
        {preview.error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-3 text-rose-700">{preview.error}</p>}
        <p className="mt-2 text-xs text-muted">{previewDates.length} changed date{previewDates.length === 1 ? '' : 's'} · {preview.affected_user_count} people notified if the next 7 days change</p>
        <div className="mt-3 max-h-80 space-y-3 overflow-y-auto">
            {previewDates.map(date => <div key={date} className="rounded-lg border border-amber-200 bg-white p-3">
                <p className="font-bold">{niceDate(date)}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div><p className="text-xs font-bold uppercase text-muted">Before</p>
                        {preview.before.filter(item => item.lesson_date === date).map(item =>
                            <p key={item.id} className="text-xs">{item.start_time.slice(0, 5)}–{item.end_time.slice(0, 5)} {item.subject_name} · {item.teacher_name ?? 'Unassigned'}{item.room ? ` · ${item.room}` : ''}</p>)}
                        {!preview.before.some(item => item.lesson_date === date) && <p className="text-xs text-muted">No lessons</p>}
                    </div>
                    <div><p className="text-xs font-bold uppercase text-muted">After</p>
                        {preview.after.filter(item => item.lesson_date === date).map(item =>
                            <p key={item.id} className="text-xs">{item.start_time.slice(0, 5)}–{item.end_time.slice(0, 5)} {item.subject_name} · {item.teacher_name ?? 'Unassigned'}{item.room ? ` · ${item.room}` : ''}</p>)}
                        {!preview.after.some(item => item.lesson_date === date) && <p className="text-xs text-muted">No lessons</p>}
                    </div>
                </div>
            </div>)}
        </div>
        <button className="mt-3 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            onClick={() => actOnDraft(d, 'publish')} disabled={busy || !!preview.error || previewQuery.isFetching || !previewDates.length}>Publish schedule</button>
    </>}
</div>}</article>)}</div>}</section>}
                {form && <dialog ref={node => { if (node && !node.open) node.showModal(); }} onCancel={event => { event.preventDefault(); setForm(null); }} className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-y-auto border-0 bg-black/40 p-3 sm:p-8 backdrop:bg-transparent" aria-label="Edit timetable draft"><div className="mx-auto max-w-xl rounded-3xl bg-background p-5 shadow-xl sm:p-7"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-xl font-extrabold">{form.id ? 'Edit draft' : form.target_id ? 'Edit lesson' : 'Add lesson'}</h2><p className="text-xs text-muted">Changes remain private until published.</p></div><button className="text-sm font-bold text-muted" onClick={() => setForm(null)}>Close</button></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-muted">Subject<select className={`${input} mt-1`} value={form.subject_id} onChange={e => setForm({ ...form, subject_id: e.target.value, teacher_id: role === 'teacher' ? user?.id ?? null : null })}>{visibleSubjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="text-xs font-bold text-muted">Teacher<select className={`${input} mt-1`} value={form.teacher_id ?? ''} disabled={role === 'teacher'} onChange={e => setForm({ ...form, teacher_id: e.target.value || null })}><option value="">Unassigned</option>{teacherChoices.map(a => <option key={a.teacher_id} value={a.teacher_id}>{teacherName(a.profiles) ?? a.teacher_id}</option>)}</select></label><label className="text-xs font-bold text-muted">Day<select className={`${input} mt-1`} value={form.day_of_week} onChange={e => setForm({ ...form, day_of_week: Number(e.target.value) })}>{dayNames.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label><label className="text-xs font-bold text-muted">Room<input className={`${input} mt-1`} value={form.room ?? ''} onChange={e => setForm({ ...form, room: e.target.value })} maxLength={80} /></label><label className="text-xs font-bold text-muted">Starts<input className={`${input} mt-1`} type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} /></label><label className="text-xs font-bold text-muted">Ends<input className={`${input} mt-1`} type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} /></label><label className="text-xs font-bold text-muted">{form.kind === 'weekly' ? 'Effective from (optional)' : 'From date'}<input className={`${input} mt-1`} type="date" value={form.start_date ?? ''} onChange={e => setForm({ ...form, start_date: e.target.value || null })} /></label><label className="text-xs font-bold text-muted">{form.kind === 'weekly' ? 'Effective until (optional)' : 'To date'}<input className={`${input} mt-1`} type="date" value={form.end_date ?? ''} onChange={e => setForm({ ...form, end_date: e.target.value || null })} /></label></div>{((form.kind === 'exception' && form.base_id) || (form.kind === 'weekly' && form.target_id)) && <label className="mt-4 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.cancelled} onChange={e => setForm({ ...form, cancelled: e.target.checked })} /> {form.kind === 'weekly' ? 'Remove recurring lesson' : 'Cancel matching lesson instead'}</label>}<div className="mt-6 flex justify-end gap-2"><button className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-bold" onClick={() => setForm(null)}>Cancel</button><button className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={saveDraft} disabled={busy}>Save draft</button></div></div></dialog>}
                {managing && exceptions.length > 0 &&
                    <section className="clay-card p-5 sm:p-6">
                        <h2 className="mb-3 text-lg font-bold">Published date exceptions</h2>
                        <div className="space-y-2">{exceptions.map(e =>
                            <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm">
                                <span><strong>{dayNames[e.day_of_week]}</strong> · {e.start_date} to {e.end_date} · {e.cancelled ? 'Cancelled' : options?.subjects.find(s => s.id === e.subject_id)?.name ?? 'Lesson'}</span>
                                <span className="flex gap-3 text-xs font-bold text-primary"><button onClick={() => editException(e)}>Edit</button><button onClick={() => editException(e, true)}>{e.base_id ? 'Restore weekly' : 'Remove date lesson'}</button></span>
                            </div>)}</div>
                    </section>}
            </main>
        </div>
    </div>;
}
