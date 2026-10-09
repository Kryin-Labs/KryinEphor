import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { schoolDate } from '../../../lib/timetable';
import { qk } from '../../../lib/queryKeys';
import { useAuth } from '../../../context/AuthContext';

interface Props { classId: string; schoolId: string; canEdit: boolean; }
type Status = 'present' | 'absent' | 'late' | 'excused' | 'half_day';
type Student = { student_id: string; full_name: string | null; email: string | null };
type Mark = { student_id: string; status: Status; notes: string | null };
const statuses: Status[] = ['present', 'absent', 'late', 'excused', 'half_day'];
const tone: Record<Status, string> = {
    present: 'bg-emerald-500 text-white', absent: 'bg-rose-500 text-white', late: 'bg-amber-500 text-white',
    excused: 'bg-sky-500 text-white', half_day: 'bg-violet-500 text-white',
};

export default function AttendanceTab({ classId, schoolId, canEdit }: Props) {
    const { user } = useAuth();
    const qc = useQueryClient();
    const [chosenDate, setChosenDate] = useState('');
    const [edited, setEdited] = useState<{ scope: string; marks: Record<string, Status> }>({ scope: '', marks: {} });
    const school = useQuery({
        queryKey: ['attendance-school-zone', schoolId],
        queryFn: async () => {
            const { data, error } = await supabase.from('schools').select('time_zone').eq('id', schoolId).single();
            if (error) throw error;
            return data.time_zone;
        },
    });
    const today = school.data ? schoolDate(school.data) : '';
    const date = chosenDate || today;
    const scope = `${user?.id}:${schoolId}:${classId}:${date}`;
    const roster = useQuery({
        queryKey: [...qk.classes.attendance(classId, date), user?.id], enabled: !!date && !!user,
        queryFn: async () => {
            const { data, error } = await supabase.rpc('fn_class_attendance_roster', {
                p_class: classId, p_date: date,
            });
            if (error) throw error;
            return data as { students: Student[]; existing: Mark[] };
        },
    });
    const current = useMemo(() => {
        const saved = new Map((roster.data?.existing ?? []).map(row => [row.student_id, row]));
        return (roster.data?.students ?? []).map(row => ({
            ...row, status: (edited.scope === scope ? edited.marks[row.student_id] : undefined) ?? saved.get(row.student_id)?.status,
            notes: saved.get(row.student_id)?.notes ?? null,
        }));
    }, [roster.data, edited, scope]);
    const counts = statuses.map(status => ({ status, count: current.filter(row => row.status === status).length }));
    const unmarked = current.filter(row => !row.status).length;
    const save = useMutation({
        mutationFn: async (submitted: { classId: string; date: string; scope: string; marks: Mark[] }) => {
            if (!canEdit || !roster.isSuccess || roster.isFetching || school.error || !today || !current.length || unmarked || !date || date > today) throw new Error('Review every student and choose a valid date.');
            const { data, error } = await supabase.rpc('fn_mark_class_attendance', {
                p_class: submitted.classId, p_date: submitted.date, p_marks: submitted.marks,
            });
            if (error) throw error;
            return data;
        },
        onSuccess: async (count, submitted) => {
            toast.success(`Attendance saved for ${count} students`);
            await Promise.all([
                qc.invalidateQueries({ queryKey: qk.classes.attendance(submitted.classId, submitted.date) }),
                qc.invalidateQueries({ queryKey: qk.classes.overview(submitted.classId) }),
                qc.invalidateQueries({ queryKey: ['attendance-summary'] }),
                qc.invalidateQueries({ queryKey: ['dashboard', 'attendance-snapshot'] }),
            ]);
            setEdited(previous => previous.scope === submitted.scope ? { scope: '', marks: {} } : previous);
        },
        onError: (error: Error) => toast.error(error.message),
    });
    const locked = !canEdit || save.isPending || roster.isFetching || !roster.isSuccess || !!school.error || !today;

    return <div className="space-y-4">
        <div className="clay-card flex flex-wrap items-center justify-between gap-3 p-4">
            <label className="text-xs font-bold uppercase text-muted">Date
                <input type="date" value={date} max={today} disabled={save.isPending || !today}
                    onChange={event => { setChosenDate(event.target.value); setEdited({ scope: '', marks: {} }); }}
                    className="clay-input ml-2 rounded-lg border border-stone-200 px-3 py-2 text-sm" />
            </label>
            <div className="flex flex-wrap gap-2 text-xs font-bold">
                {counts.map(item => <span key={item.status} className="rounded-md bg-stone-100 px-2 py-1 capitalize">{item.status.replace('_', ' ')} {item.count}</span>)}
                <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-800">Unmarked {unmarked}</span>
            </div>
            {canEdit && <div className="flex gap-2">
                <button type="button" onClick={() => setEdited({ scope, marks: Object.fromEntries(current.map(row => [row.student_id, 'present' as Status])) })}
                    disabled={locked || !current.length} className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-bold disabled:opacity-50">Mark all present</button>
                <button type="button" onClick={() => save.mutate({ classId, date, scope, marks: current.map(row => ({ student_id: row.student_id, status: row.status!, notes: row.notes })) })}
                    disabled={locked || !current.length || !!unmarked || date > today}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                    <Save size={15} />{save.isPending ? 'Saving…' : 'Save attendance'}
                </button>
            </div>}
        </div>
        {school.error && <p role="alert" className="text-sm text-rose-700">{school.error.message}</p>}
        {roster.error && <p role="alert" className="text-sm text-rose-700">Attendance could not be loaded: {roster.error.message}</p>}
        <div className="clay-card divide-y divide-stone-100 overflow-hidden">
            {!school.error && (school.isPending || roster.isPending) ? <p className="p-6 text-sm text-muted">Loading roster…</p> : !school.error && !roster.error && !current.length
                ? <p className="p-6 text-sm text-muted">No active students are enrolled in this class.</p>
                : current.map(row => {
                    return <div key={row.student_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0"><p className="truncate text-sm font-bold">{row.full_name || row.student_id.slice(0, 8)}</p>
                            <p className="truncate text-xs text-muted">{row.email ?? '—'}</p>
                            {!row.status && <p className="mt-1 text-xs font-semibold text-amber-800">Unmarked</p>}</div>
                        <div className="flex flex-wrap gap-1" role="group" aria-label={`Attendance for ${row.full_name ?? row.student_id}`}>
                            {statuses.map(status => <button type="button" key={status} disabled={locked} aria-pressed={row.status === status}
                                onClick={() => setEdited(previous => ({ scope, marks: { ...(previous.scope === scope ? previous.marks : {}), [row.student_id]: status } }))}
                                className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize disabled:opacity-50 ${row.status === status ? tone[status] : 'bg-stone-100 text-stone-700'}`}>
                                {status.replace('_', ' ')}</button>)}
                        </div>
                    </div>;
                })}
        </div>
    </div>;
}
