import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { qk } from '../../lib/queryKeys';
import { Modal } from '../school-finance/shared';
import { useSchoolTeachers } from '../../hooks/queries';

interface Props {
    open: boolean;
    onClose: () => void;
    schoolId: string;

    // Optional: existing class to edit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editing?: any;
}

const ClassFormModal: React.FC<Props> = ({ open, onClose, schoolId, editing }) => {
    const qc = useQueryClient();
    const [form, setForm] = useState({
        name: '', grade_level: '', section: '', room_number: '', capacity: '', teacher_id: '', academic_year_id: '',
    });

    useEffect(() => {
        if (editing) {
            setForm({
                name: editing.name ?? '',
                grade_level: editing.grade_level ?? '',
                section: editing.section ?? '',
                room_number: editing.room_number ?? '',
                capacity: editing.capacity?.toString() ?? '',
                teacher_id: editing.teacher_id ?? '',
                academic_year_id: editing.academic_year_id ?? '',
            });
        } else {
            setForm({ name: '', grade_level: '', section: '', room_number: '', capacity: '', teacher_id: '', academic_year_id: '' });
        }
    }, [editing, open]);

    const { data: teachers = [] } = useSchoolTeachers(open ? schoolId : null);

    const { data: years = [] } = useQuery({
        queryKey: qk.academicYears.bySchool(schoolId),
        enabled: open,
        queryFn: async () => {
            const { data, error } = await supabase.from('academic_years').select('id, name, is_current').eq('school_id', schoolId).is('deleted_at', null).order('start_date', { ascending: false });
            if (error) throw error;
            return data ?? [];
        },
    });

    const save = useMutation({
        mutationFn: async () => {
            const payload = {
                school_id: schoolId,
                name: form.name.trim(),
                grade_level: form.grade_level || null,
                section: form.section || null,
                room_number: form.room_number || null,
                capacity: form.capacity ? Number(form.capacity) : null,
                teacher_id: form.teacher_id || null,
                academic_year_id: form.academic_year_id || null,
            };
            if (!payload.name) throw new Error('Name is required');
            if (editing?.id) {
                const { error } = await supabase.from('classes').update(payload).eq('id', editing.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('classes').insert(payload);
                if (error) throw error;
            }
        },
        onSuccess: () => {
            toast.success(editing ? 'Class updated' : 'Class created');
            qc.invalidateQueries({ queryKey: qk.classes.all });
            onClose();
        },
        onError: (e: Error) => toast.error(e.message),
    });

    // Inline academic year creator
    const [showYearForm, setShowYearForm] = useState(false);
    const [yearForm, setYearForm] = useState({ name: '', start_date: '', end_date: '', is_current: false });
    const createYear = useMutation({
        mutationFn: async () => {
            if (!yearForm.name.trim()) throw new Error('Year name is required (e.g. 2025-26)');
            if (!yearForm.start_date || !yearForm.end_date) throw new Error('Start and end dates are required');
            const { data, error } = await supabase
                .from('academic_years')
                .insert({
                    school_id: schoolId,
                    name: yearForm.name.trim(),
                    start_date: yearForm.start_date,
                    end_date: yearForm.end_date,
                    is_current: yearForm.is_current,
                })
                .select('id')
                .single();
            if (error) throw error;
            return data;
        },
        onSuccess: (data) => {
            toast.success('Academic year created');
            qc.invalidateQueries({ queryKey: qk.academicYears.bySchool(schoolId) });
            if (data?.id) setForm(f => ({ ...f, academic_year_id: data.id }));
            setShowYearForm(false);
            setYearForm({ name: '', start_date: '', end_date: '', is_current: false });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    if (!open) return null;
    return (
        <Modal open={open} onClose={onClose} title={editing ? 'Edit class' : 'New class'} wide>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Class Name (Badge) *"><input className="clay-input w-full px-3 py-2 rounded-lg border border-stone-200" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Class 10 A" /></Field>
                <Field label="Class level"><input className="clay-input w-full px-3 py-2 rounded-lg border border-stone-200" value={form.grade_level} onChange={(e) => setForm({ ...form, grade_level: e.target.value })} placeholder="10" /></Field>
                <Field label="Section"><input className="clay-input w-full px-3 py-2 rounded-lg border border-stone-200" value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} placeholder="A" /></Field>
                <Field label="Room #"><input className="clay-input w-full px-3 py-2 rounded-lg border border-stone-200" value={form.room_number} onChange={(e) => setForm({ ...form, room_number: e.target.value })} /></Field>
                <Field label="Capacity"><input type="number" min={0} className="clay-input w-full px-3 py-2 rounded-lg border border-stone-200" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></Field>
                <Field label="Class Teacher">
                    <select className="clay-input w-full px-3 py-2 rounded-lg border border-stone-200 bg-white" value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}>
                        <option value="">— None —</option>
                        {teachers.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.full_name || t.email?.split('@')[0] || t.id.slice(0, 8)}{t.role && t.role !== 'teacher' && t.role !== 'student' ? ` (${t.role.charAt(0).toUpperCase() + t.role.slice(1)} · Teacher)` : ''}
                            </option>
                        ))}
                    </select>
                </Field>
                <div className="sm:col-span-2">
                    <Field label="Academic Year">
                        <div className="flex gap-2">
                            <select className="clay-input flex-1 px-3 py-2 rounded-lg border border-stone-200 bg-white" value={form.academic_year_id} onChange={(e) => setForm({ ...form, academic_year_id: e.target.value })}>
                                <option value="">— None —</option>
                                {years.map((y: { id: string; name: string; is_current: boolean | null }) => <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' (current)' : ''}</option>)}
                            </select>
                            <button type="button" onClick={() => setShowYearForm(v => !v)} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-stone-200 bg-white text-xs font-bold text-primary hover:bg-teal-50 whitespace-nowrap">
                                <Plus className="w-3.5 h-3.5" /> {showYearForm ? 'Cancel' : 'New year'}
                            </button>
                        </div>
                        <p className="text-[11px] text-muted mt-1 normal-case tracking-normal font-normal">Academic year = the school session this class belongs to (e.g. 2025-26). Add one if none exist.</p>
                    </Field>
                    {showYearForm && (
                        <div className="mt-3 p-3 rounded-xl border border-teal-100 bg-teal-50/50 grid grid-cols-1 sm:grid-cols-4 gap-2">
                            <input className="clay-input px-3 py-2 rounded-lg border border-stone-200 sm:col-span-2 text-sm" placeholder="Name (e.g. 2025-26)" value={yearForm.name} onChange={e => setYearForm({ ...yearForm, name: e.target.value })} />
                            <input type="date" className="clay-input px-3 py-2 rounded-lg border border-stone-200 text-sm" value={yearForm.start_date} onChange={e => setYearForm({ ...yearForm, start_date: e.target.value })} />
                            <input type="date" className="clay-input px-3 py-2 rounded-lg border border-stone-200 text-sm" value={yearForm.end_date} onChange={e => setYearForm({ ...yearForm, end_date: e.target.value })} />
                            <label className="flex items-center gap-2 text-xs font-semibold text-muted sm:col-span-2">
                                <input type="checkbox" checked={yearForm.is_current} onChange={e => setYearForm({ ...yearForm, is_current: e.target.checked })} />
                                Mark as current year
                            </label>
                            <button type="button" onClick={() => createYear.mutate()} disabled={createYear.isPending} className="sm:col-span-2 px-3 py-2 rounded-lg bg-primary text-white text-xs font-bold shadow-md hover:opacity-90 disabled:opacity-50">
                                {createYear.isPending ? 'Creating…' : 'Create academic year'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
                <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold text-muted hover:bg-stone-100">Cancel</button>
                <button onClick={() => save.mutate()} disabled={save.isPending} className="px-4 py-2 rounded-xl text-sm font-bold bg-primary text-white shadow-md hover:opacity-90 disabled:opacity-50">
                    {save.isPending ? 'Saving…' : (editing ? 'Save changes' : 'Create class')}
                </button>
            </div>
        </Modal>
    );
};


const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <label className="block">
        <span className="block text-[11px] font-bold uppercase tracking-wider text-muted mb-1">{label}</span>
        {children}
    </label>
);

export default ClassFormModal;
