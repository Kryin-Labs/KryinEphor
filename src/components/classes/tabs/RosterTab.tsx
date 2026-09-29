import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus, Search, Trash2, Users } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { qk } from '../../../lib/queryKeys';
import { usePaginated } from '../../../lib/data/usePaginated';
import Pagination from '../../ui/Pagination';
import { Modal } from '../../school-finance/shared';
import { EmptyState } from '../shared';

interface Props {
    classId: string;
    schoolId: string;
    canEdit: boolean;
}

interface RosterRow {
    id: string;
    student_id: string;
    profiles: { full_name: string | null; email: string | null } | null;
}

const RosterTab: React.FC<Props> = ({ classId, schoolId, canEdit }) => {
    const qc = useQueryClient();
    const [enrollOpen, setEnrollOpen] = useState(false);

    const roster = usePaginated<RosterRow>({
        key: qk.classes.roster(classId, 0, 25).slice(0, 3),
        table: 'class_enrollments',
        columns: 'id, student_id, profiles:student_id(full_name, email)',
        pageSize: 25,
        apply: (q) => q.eq('class_id', classId).is('deleted_at', null).order('enrolled_at', { ascending: false }),
    });

    const remove = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from('class_enrollments').update({ deleted_at: new Date().toISOString() }).eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('Removed');
            qc.invalidateQueries({ queryKey: ['class_enrollments'] });
            qc.invalidateQueries({ queryKey: qk.classes.overview(classId) });
            roster.refetch();
        },
        onError: (e: Error) => toast.error(e.message),
    });

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm text-muted">
                    <span className="font-bold text-foreground">{roster.total}</span> students enrolled
                </div>
                {canEdit && (
                    <button onClick={() => setEnrollOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold shadow-md hover:opacity-90">
                        <UserPlus className="w-4 h-4" /> Enroll students
                    </button>
                )}
            </div>

            <div className="clay-card overflow-hidden">
                {roster.isLoading ? (
                    <div className="p-8 text-center text-muted text-sm">Loading…</div>
                ) : roster.rows.length === 0 ? (
                    <EmptyState title="No students enrolled yet" hint="Use “Enroll students” to add them." icon={<Users className="w-5 h-5" />} />
                ) : (
                    <div className="divide-y divide-stone-100">
                        {roster.rows.map((r) => (
                            <div key={r.id} className="flex items-center justify-between px-4 py-3 hover:bg-stone-50 transition">
                                <div className="min-w-0">
                                    <p className="text-sm font-bold truncate">{r.profiles?.full_name || r.student_id.slice(0, 8)}</p>
                                    <p className="text-xs text-muted truncate">{r.profiles?.email ?? '—'}</p>
                                </div>
                                {canEdit && (
                                    <button onClick={() => remove.mutate(r.id)} className="w-8 h-8 rounded-lg text-muted hover:text-rose-500 hover:bg-rose-50 flex items-center justify-center transition">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <Pagination page={roster.page} pageCount={roster.pageCount} total={roster.total} onPageChange={roster.setPage} isFetching={roster.isFetching} />

            {enrollOpen && (
                <EnrollStudentsDialog
                    open={enrollOpen}
                    onClose={() => setEnrollOpen(false)}
                    classId={classId}
                    schoolId={schoolId}
                    onEnrolled={() => { roster.refetch(); qc.invalidateQueries({ queryKey: qk.classes.overview(classId) }); }}
                />
            )}
        </div>
    );
};

const EnrollStudentsDialog: React.FC<{ open: boolean; onClose: () => void; classId: string; schoolId: string; onEnrolled: () => void }> = ({ open, onClose, classId, schoolId, onEnrolled }) => {
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const { data: students = [], isLoading } = useQuery({
        queryKey: qk.students.unassigned(schoolId, classId, search),
        enabled: open,
        queryFn: async () => {
            // Get all students in this school (limit 100 for picker)
            let q = supabase.from('profiles').select('id, full_name, email').eq('school_id', schoolId).eq('role', 'student').limit(100);
            if (search) q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
            const { data, error } = await q;
            if (error) throw error;
            // Filter out already-enrolled
            const { data: enrolled } = await supabase.from('class_enrollments').select('student_id').eq('class_id', classId).is('deleted_at', null);
            const set = new Set((enrolled ?? []).map(e => e.student_id));
            return (data ?? []).filter(s => !set.has(s.id));
        },
    });

    const enroll = useMutation({
        mutationFn: async () => {
            const ids = Array.from(selected);
            if (ids.length === 0) return 0;
            const { data, error } = await supabase.rpc('fn_bulk_enroll_students', { p_class: classId, p_student_ids: ids });
            if (error) throw error;
            return data as number;
        },
        onSuccess: (n) => {
            toast.success(`Enrolled ${n} student(s)`);
            onEnrolled();
            onClose();
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const toggle = (id: string) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelected(next);
    };

    return (
        <Modal open={open} onClose={onClose} title="Enroll students" wide>
            <div className="relative mb-3">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email…" className="clay-input w-full pl-10 pr-3 py-2 rounded-lg border border-stone-200" />
            </div>
            <div className="max-h-80 overflow-y-auto border border-stone-100 rounded-xl divide-y divide-stone-100">
                {isLoading ? (
                    <div className="p-6 text-center text-muted text-sm">Loading…</div>
                ) : students.length === 0 ? (
                    <div className="p-6 text-center text-muted text-sm">No available students match.</div>
                ) : (
                    students.map((s) => (
                        <label key={s.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-stone-50 cursor-pointer">
                            <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} className="w-4 h-4 accent-teal-600" />
                            <div className="min-w-0">
                                <p className="text-sm font-semibold truncate">{s.full_name || s.id.slice(0, 8)}</p>
                                <p className="text-xs text-muted truncate">{s.email ?? '—'}</p>
                            </div>
                        </label>
                    ))
                )}
            </div>
            <div className="flex justify-between items-center mt-4">
                <p className="text-xs text-muted"><span className="font-bold text-foreground">{selected.size}</span> selected</p>
                <div className="flex gap-2">
                    <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold text-muted hover:bg-stone-100">Cancel</button>
                    <button onClick={() => enroll.mutate()} disabled={selected.size === 0 || enroll.isPending} className="px-4 py-2 rounded-xl text-sm font-bold bg-primary text-white shadow-md disabled:opacity-40">
                        {enroll.isPending ? 'Enrolling…' : 'Enroll'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default RosterTab;
