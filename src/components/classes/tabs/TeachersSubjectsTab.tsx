import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, BookOpen } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { qk } from '../../../lib/queryKeys';
import { EmptyState } from '../shared';
import { fetchSchoolTeachers } from '../../../hooks/queries';

interface Props { classId: string; schoolId: string; canEdit: boolean; }

const TeachersSubjectsTab: React.FC<Props> = ({ classId, schoolId, canEdit }) => {
    const qc = useQueryClient();
    const [subjectId, setSubjectId] = useState('');
    const [teacherId, setTeacherId] = useState('');

    // Batched load: assignments + subjects list + teachers list
    const { data, isLoading } = useQuery({
        queryKey: qk.classes.teachers(classId),
        queryFn: async () => {
            const [assign, subs, ts, classInfo] = await Promise.all([
                supabase.from('subject_teachers').select('id, subject_id, teacher_id, subjects:subject_id(name, code), profiles:teacher_id(full_name)').eq('class_id', classId),
                supabase.from('subjects').select('id, name, code').eq('school_id', schoolId).is('deleted_at', null).limit(200),
                fetchSchoolTeachers(schoolId),
                supabase.from('classes').select('teacher_id, teacher:teacher_id(full_name)').eq('id', classId).single(),
            ]);
            if (assign.error) throw assign.error;
            if (classInfo.error) throw classInfo.error;
            return { assignments: assign.data ?? [], subjects: subs.data ?? [], teachers: ts, classTeacher: classInfo.data };
        },
    });

    const add = useMutation({
        mutationFn: async () => {
            if (!subjectId || !teacherId) throw new Error('Pick a subject and teacher');
            const { error } = await supabase.from('subject_teachers').insert({ school_id: schoolId, class_id: classId, subject_id: subjectId, teacher_id: teacherId });
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('Assigned');
            setSubjectId(''); setTeacherId('');
            qc.invalidateQueries({ queryKey: qk.classes.teachers(classId) });
            qc.invalidateQueries({ queryKey: qk.classes.overview(classId) });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const remove = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from('subject_teachers').delete().eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => { qc.invalidateQueries({ queryKey: qk.classes.teachers(classId) }); qc.invalidateQueries({ queryKey: qk.classes.overview(classId) }); },
        onError: (e: Error) => toast.error(e.message),
    });

    return (
        <div className="space-y-4">
            <div className="clay-card p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted mb-2">Class Teacher</p>
                {isLoading ? <p className="text-sm text-muted">Loading…</p> : data?.classTeacher?.teacher_id ? (
                    <p className="text-sm font-bold text-foreground">{(data.classTeacher.teacher as { full_name?: string | null } | null)?.full_name || 'Assigned teacher'}</p>
                ) : (
                    <p className="text-sm text-muted">Not assigned</p>
                )}
            </div>
            {canEdit && (
                <div className="clay-card p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted mb-2">Assign a teacher</p>
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="clay-input px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm">
                            <option value="">— Subject —</option>
                            {data?.subjects.map(s => <option key={s.id} value={s.id}>{s.code ? `[${s.code}] ` : ''}{s.name}</option>)}
                        </select>
                        <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="clay-input px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm">
                            <option value="">— Teacher —</option>
                            {data?.teachers.map(t => (
                                <option key={t.id} value={t.id}>
                                    {t.full_name || t.email?.split('@')[0] || t.id.slice(0, 8)}{t.role && t.role !== 'teacher' && t.role !== 'student' ? ` (${t.role.charAt(0).toUpperCase() + t.role.slice(1)} · Teacher)` : ''}
                                </option>
                            ))}
                        </select>
                        <button onClick={() => add.mutate()} disabled={add.isPending} className="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold shadow-md hover:opacity-90 disabled:opacity-50">
                            <Plus className="w-4 h-4" /> Add
                        </button>
                    </div>
                </div>
            )}

            <div className="clay-card overflow-hidden">
                {isLoading ? (
                    <div className="p-6 text-center text-muted text-sm">Loading…</div>
                ) : (data?.assignments.length ?? 0) === 0 ? (
                    <EmptyState title="No subject-teacher assignments yet" icon={<BookOpen className="w-5 h-5" />} />
                ) : (
                    <div className="divide-y divide-stone-100">
                        {data!.assignments.map((a) => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const subj = a.subjects as any;
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const prof = a.profiles as any;
                            return (
                                <div key={a.id} className="flex items-center justify-between px-4 py-3 hover:bg-stone-50 transition">
                                    <div>
                                        <p className="text-sm font-bold">{subj?.name ?? a.subject_id.slice(0, 8)}</p>
                                        <p className="text-xs text-muted">Teacher · {prof?.full_name ?? a.teacher_id.slice(0, 8)}</p>
                                    </div>
                                    {canEdit && (
                                        <button onClick={() => remove.mutate(a.id)} className="w-8 h-8 rounded-lg text-muted hover:text-rose-500 hover:bg-rose-50 flex items-center justify-center transition">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TeachersSubjectsTab;
