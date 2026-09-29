import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { qk } from '../../../lib/queryKeys';

interface Props { classId: string; canEdit: boolean; }

type Status = 'present' | 'absent' | 'late';
const STATUSES: Status[] = ['present', 'absent', 'late'];
const toneMap: Record<Status, string> = {
    present: 'bg-emerald-500 text-white',
    absent: 'bg-rose-500 text-white',
    late: 'bg-amber-500 text-white',
};

const AttendanceTab: React.FC<Props> = ({ classId, canEdit }) => {
    const qc = useQueryClient();
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [marks, setMarks] = useState<Record<string, Status>>({});

    const { data, isLoading } = useQuery({
        queryKey: qk.classes.attendance(classId, date),
        queryFn: async () => {
            const [enrolls, existing] = await Promise.all([
                supabase.from('class_enrollments').select('student_id, profiles:student_id(full_name, email)').eq('class_id', classId).is('deleted_at', null),
                supabase.from('attendance').select('student_id, status').eq('class_id', classId).eq('date', date).is('deleted_at', null),
            ]);
            if (enrolls.error) throw enrolls.error;
            return { enrolls: enrolls.data ?? [], existing: existing.data ?? [] };
        },
    });

    useEffect(() => {
        const seed: Record<string, Status> = {};
        (data?.enrolls ?? []).forEach((e) => { seed[e.student_id] = 'present'; });
        (data?.existing ?? []).forEach((e) => { if (STATUSES.includes(e.status as Status)) seed[e.student_id] = e.status as Status; });
        setMarks(seed);
    }, [data]);

    const summary = useMemo(() => {
        const vals = Object.values(marks);
        return { present: vals.filter(v => v === 'present').length, absent: vals.filter(v => v === 'absent').length, late: vals.filter(v => v === 'late').length };
    }, [marks]);

    const save = useMutation({
        mutationFn: async () => {
            const payload = Object.entries(marks).map(([student_id, status]) => ({ student_id, status }));
            const { data, error } = await supabase.rpc('fn_mark_class_attendance', { p_class: classId, p_date: date, p_marks: payload });
            if (error) throw error;
            return data as number;
        },
        onSuccess: (n) => {
            toast.success(`Attendance saved (${n})`);
            qc.invalidateQueries({ queryKey: qk.classes.attendance(classId, date) });
            qc.invalidateQueries({ queryKey: qk.classes.overview(classId) });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    return (
        <div className="space-y-4">
            <div className="clay-card p-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                    <label className="text-xs font-bold uppercase tracking-wider text-muted">Date</label>
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="clay-input px-3 py-2 rounded-lg border border-stone-200 text-sm" />
                </div>
                <div className="flex items-center gap-2 text-xs">
                    <span className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 font-bold">Present {summary.present}</span>
                    <span className="px-2 py-1 rounded-md bg-rose-50 text-rose-700 font-bold">Absent {summary.absent}</span>
                    <span className="px-2 py-1 rounded-md bg-amber-50 text-amber-700 font-bold">Late {summary.late}</span>
                </div>
                {canEdit && (
                    <button onClick={() => save.mutate()} disabled={save.isPending || Object.keys(marks).length === 0} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold shadow-md disabled:opacity-50">
                        <Save className="w-4 h-4" /> {save.isPending ? 'Saving…' : 'Save attendance'}
                    </button>
                )}
            </div>

            <div className="clay-card overflow-hidden">
                {isLoading ? (
                    <div className="p-6 text-center text-muted text-sm">Loading…</div>
                ) : (data?.enrolls.length ?? 0) === 0 ? (
                    <div className="p-8 text-center text-sm text-muted">No students enrolled — enroll students first.</div>
                ) : (
                    <div className="divide-y divide-stone-100">
                        {data!.enrolls.map((e) => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const prof = e.profiles as any;
                            const cur = marks[e.student_id] ?? 'present';
                            return (
                                <div key={e.student_id} className="flex items-center justify-between px-4 py-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold truncate">{prof?.full_name || e.student_id.slice(0, 8)}</p>
                                        <p className="text-xs text-muted truncate">{prof?.email ?? '—'}</p>
                                    </div>
                                    <div className="flex gap-1">
                                        {STATUSES.map(s => (
                                            <button
                                                key={s}
                                                disabled={!canEdit}
                                                onClick={() => setMarks({ ...marks, [e.student_id]: s })}
                                                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold capitalize transition ${cur === s ? toneMap[s] + ' shadow-md' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'} ${!canEdit ? 'cursor-not-allowed opacity-70' : ''}`}
                                            >
                                                {s}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AttendanceTab;
