import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, Trash2, Users, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';
import { currency, Modal, Pill } from './shared';

interface Assignment {
    id: string; student_id: string; plan_id: string;
    start_date: string; end_date: string | null;
    discount_pct: number; scholarship_amount: number; is_active: boolean;
}
interface Student { id: string; full_name: string | null; email: string }
interface Plan { id: string; name: string; frequency: string }

interface Props { schoolId: string }

const AssignmentsTab: React.FC<Props> = ({ schoolId }) => {
    const [rows, setRows] = useState<Assignment[]>([]);
    const [students, setStudents] = useState<Student[]>([]);
    const [plans, setPlans] = useState<Plan[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [bulk, setBulk] = useState(false);
    const [q, setQ] = useState('');
    const [form, setForm] = useState({ student_ids: [] as string[], plan_id: '', discount_pct: 0, scholarship_amount: 0, start_date: new Date().toISOString().slice(0, 10) });
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        const [a, s, p] = await Promise.all([
            supabase.from('student_fee_assignments').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }),
            supabase.from('profiles').select('id,full_name,email').eq('school_id', schoolId).eq('role', 'student').eq('is_active', true).limit(1000),
            supabase.from('fee_plans').select('id,name,frequency').eq('school_id', schoolId).eq('is_active', true).is('deleted_at', null),
        ]);
        setRows(a.data ?? []); setStudents(s.data ?? []); setPlans(p.data ?? []);
        setLoading(false);
    };
    useEffect(() => { load(); }, [schoolId]);

    const save = async () => {
        if (!form.plan_id || form.student_ids.length === 0) return toast.error('Choose plan and at least one student');
        setSaving(true);
        const payload = form.student_ids.map(sid => ({
            school_id: schoolId, student_id: sid, plan_id: form.plan_id,
            discount_pct: form.discount_pct, scholarship_amount: form.scholarship_amount,
            start_date: form.start_date, is_active: true,
        }));
        const { error } = await supabase.from('student_fee_assignments').upsert(payload, { onConflict: 'student_id,plan_id' });
        setSaving(false);
        if (error) return toast.error(error.message);
        toast.success(`Assigned to ${form.student_ids.length} student(s)`);
        setOpen(false); setForm({ student_ids: [], plan_id: '', discount_pct: 0, scholarship_amount: 0, start_date: new Date().toISOString().slice(0, 10) });
        load();
    };

    const remove = async (id: string) => {
        if (!confirm('Remove this assignment?')) return;
        const { error } = await supabase.from('student_fee_assignments').delete().eq('id', id);
        if (error) return toast.error(error.message);
        toast.success('Removed'); load();
    };

    const studentMap = useMemo(() => Object.fromEntries(students.map(s => [s.id, s])), [students]);
    const planMap = useMemo(() => Object.fromEntries(plans.map(p => [p.id, p])), [plans]);
    const filtered = rows.filter(r => {
        if (!q) return true;
        const s = studentMap[r.student_id];
        return s && (s.full_name || s.email).toLowerCase().includes(q.toLowerCase());
    });

    const filteredStudents = students.filter(s => !q || (s.full_name || s.email).toLowerCase().includes(q.toLowerCase()));

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search students…" className="clay-input pl-9 w-full" />
                </div>
                <button onClick={() => { setBulk(false); setOpen(true); }} className="clay-btn inline-flex items-center gap-2"><Plus size={16} /> Assign Plan</button>
            </div>

            <div className="clay-card overflow-hidden">
                {loading ? (
                    <div className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted" /></div>
                ) : filtered.length === 0 ? (
                    <div className="p-10 text-center text-muted text-sm">No assignments yet.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-stone-50 text-muted uppercase text-[11px] tracking-wider">
                                <tr><th className="px-4 py-3 text-left">Student</th><th className="px-4 py-3 text-left">Plan</th><th className="px-4 py-3 text-left">Start</th><th className="px-4 py-3 text-right">Discount</th><th className="px-4 py-3 text-right">Scholarship</th><th className="px-4 py-3 text-center">Status</th><th className="px-4 py-3"></th></tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                                {filtered.map(r => {
                                    const s = studentMap[r.student_id]; const p = planMap[r.plan_id];
                                    return (
                                        <tr key={r.id} className="hover:bg-stone-50/50">
                                            <td className="px-4 py-3 font-semibold">{s?.full_name ?? s?.email ?? '—'}</td>
                                            <td className="px-4 py-3">{p?.name ?? '—'} <span className="text-muted text-xs">({p?.frequency})</span></td>
                                            <td className="px-4 py-3 text-muted">{r.start_date}</td>
                                            <td className="px-4 py-3 text-right">{r.discount_pct}%</td>
                                            <td className="px-4 py-3 text-right">{currency(r.scholarship_amount)}</td>
                                            <td className="px-4 py-3 text-center"><Pill status={r.is_active ? 'active' : 'waived'} /></td>
                                            <td className="px-4 py-3 text-right"><button onClick={() => remove(r.id)} className="text-rose-500 hover:bg-rose-50 p-1.5 rounded-lg"><Trash2 size={14} /></button></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <Modal open={open} onClose={() => setOpen(false)} title="Assign Fee Plan" wide>
                <div className="space-y-3">
                    <div>
                        <label className="text-xs font-bold uppercase text-muted">Fee Plan</label>
                        <select value={form.plan_id} onChange={e => setForm({ ...form, plan_id: e.target.value })} className="clay-input w-full mt-1">
                            <option value="">Select…</option>
                            {plans.map(p => <option key={p.id} value={p.id}>{p.name} · {p.frequency}</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="text-xs font-bold uppercase text-muted">Start Date</label>
                            <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className="clay-input w-full mt-1" />
                        </div>
                        <div>
                            <label className="text-xs font-bold uppercase text-muted">Discount %</label>
                            <input type="number" value={form.discount_pct} onChange={e => setForm({ ...form, discount_pct: Number(e.target.value) })} className="clay-input w-full mt-1" />
                        </div>
                        <div>
                            <label className="text-xs font-bold uppercase text-muted">Scholarship ₹</label>
                            <input type="number" value={form.scholarship_amount} onChange={e => setForm({ ...form, scholarship_amount: Number(e.target.value) })} className="clay-input w-full mt-1" />
                        </div>
                    </div>
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-bold uppercase text-muted">Students ({form.student_ids.length} selected)</label>
                            <label className="text-xs flex items-center gap-1">
                                <input type="checkbox" checked={bulk} onChange={e => { setBulk(e.target.checked); setForm({ ...form, student_ids: e.target.checked ? filteredStudents.map(s => s.id) : [] }); }} />
                                Select all visible
                            </label>
                        </div>
                        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter students…" className="clay-input w-full mb-2 text-xs" />
                        <div className="max-h-56 overflow-y-auto border border-stone-200 rounded-xl p-2 space-y-1">
                            {filteredStudents.map(s => (
                                <label key={s.id} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-stone-50 rounded-lg cursor-pointer">
                                    <input type="checkbox" checked={form.student_ids.includes(s.id)} onChange={e => {
                                        setForm({ ...form, student_ids: e.target.checked ? [...form.student_ids, s.id] : form.student_ids.filter(x => x !== s.id) });
                                    }} />
                                    <span>{s.full_name ?? s.email}</span>
                                </label>
                            ))}
                            {filteredStudents.length === 0 && <div className="text-xs text-muted italic px-2 py-4 text-center">No matching students.</div>}
                        </div>
                    </div>
                    <button onClick={save} disabled={saving} className="clay-btn w-full inline-flex items-center justify-center gap-2">
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />} <Users size={14} /> Assign
                    </button>
                </div>
            </Modal>
        </div>
    );
};

export default AssignmentsTab;
