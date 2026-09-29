import React, { useEffect, useState } from 'react';
import { Plus, Loader2, Search, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';
import { currency, Modal, Pill } from './shared';

interface Charge {
    id: string; student_id: string; category: string; description: string;
    amount: number; applied_at: string; status: string; invoice_id: string | null;
}
interface Student { id: string; full_name: string | null; email: string }

interface Props { schoolId: string }

const AdditionalChargesTab: React.FC<Props> = ({ schoolId }) => {
    const [rows, setRows] = useState<Charge[]>([]);
    const [students, setStudents] = useState<Student[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const [form, setForm] = useState({ student_id: '', category: 'fine', description: '', amount: '' });
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        const [c, s] = await Promise.all([
            supabase.from('additional_charges').select('*').eq('school_id', schoolId).order('applied_at', { ascending: false }).limit(500),
            supabase.from('profiles').select('id,full_name,email').eq('school_id', schoolId).eq('role', 'student').limit(1000),
        ]);
        setRows(c.data ?? []); setStudents(s.data ?? []);
        setLoading(false);
    };
    useEffect(() => { load(); }, [schoolId]);

    const save = async () => {
        if (!form.student_id || !form.description || !form.amount) return toast.error('All fields required');
        setSaving(true);
        const { error } = await supabase.from('additional_charges').insert({
            school_id: schoolId, student_id: form.student_id, category: form.category,
            description: form.description, amount: Number(form.amount),
        });
        setSaving(false);
        if (error) return toast.error(error.message);
        toast.success('Charge added'); setOpen(false);
        setForm({ student_id: '', category: 'fine', description: '', amount: '' });
        load();
    };

    const waive = async (id: string) => {
        if (!confirm('Waive this charge?')) return;
        const { error } = await supabase.from('additional_charges').update({ status: 'waived' }).eq('id', id);
        if (error) return toast.error(error.message);
        toast.success('Waived'); load();
    };

    const studentMap = Object.fromEntries(students.map(s => [s.id, s]));
    const filtered = rows.filter(r => {
        if (!q) return true;
        const s = studentMap[r.student_id];
        return (r.description.toLowerCase().includes(q.toLowerCase())) ||
            (s && (s.full_name || s.email).toLowerCase().includes(q.toLowerCase()));
    });

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search charges…" className="clay-input pl-9 w-full" />
                </div>
                <button onClick={() => setOpen(true)} className="clay-btn inline-flex items-center gap-2"><Plus size={16} /> New Charge</button>
            </div>

            <div className="clay-card overflow-hidden">
                {loading ? (
                    <div className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted" /></div>
                ) : filtered.length === 0 ? (
                    <div className="p-10 text-center text-muted text-sm">No additional charges.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-stone-50 text-muted uppercase text-[11px] tracking-wider">
                                <tr><th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-left">Student</th><th className="px-4 py-3 text-left">Category</th><th className="px-4 py-3 text-left">Description</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3 text-center">Status</th><th className="px-4 py-3"></th></tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                                {filtered.map(r => {
                                    const s = studentMap[r.student_id];
                                    return (
                                        <tr key={r.id} className="hover:bg-stone-50/50">
                                            <td className="px-4 py-3 text-muted">{r.applied_at}</td>
                                            <td className="px-4 py-3 font-semibold">{s?.full_name ?? s?.email ?? '—'}</td>
                                            <td className="px-4 py-3 capitalize">{r.category.replace('_', ' ')}</td>
                                            <td className="px-4 py-3">{r.description}</td>
                                            <td className="px-4 py-3 text-right font-mono">{currency(r.amount)}</td>
                                            <td className="px-4 py-3 text-center"><Pill status={r.status} /></td>
                                            <td className="px-4 py-3 text-right">
                                                {r.status === 'pending' && <button onClick={() => waive(r.id)} className="text-xs text-muted hover:text-rose-600">Waive</button>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <Modal open={open} onClose={() => setOpen(false)} title="Add Charge">
                <div className="space-y-3">
                    <div>
                        <label className="text-xs font-bold uppercase text-muted">Student</label>
                        <select value={form.student_id} onChange={e => setForm({ ...form, student_id: e.target.value })} className="clay-input w-full mt-1">
                            <option value="">Select…</option>
                            {students.map(s => <option key={s.id} value={s.id}>{s.full_name ?? s.email}</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-bold uppercase text-muted">Category</label>
                            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="clay-input w-full mt-1">
                                <option value="fine">Fine</option><option value="extra_class">Extra Class</option>
                                <option value="damage">Damage</option><option value="event">Event</option>
                                <option value="uniform">Uniform</option><option value="books">Books</option>
                                <option value="transport">Transport</option><option value="other">Other</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-bold uppercase text-muted">Amount ₹</label>
                            <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="clay-input w-full mt-1" />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-bold uppercase text-muted">Description</label>
                        <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="clay-input w-full mt-1" placeholder="e.g. Late library book return" />
                    </div>
                    <button onClick={save} disabled={saving} className="clay-btn w-full inline-flex items-center justify-center gap-2">
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />} <AlertCircle size={14} /> Add Charge
                    </button>
                </div>
            </Modal>
        </div>
    );
};

export default AdditionalChargesTab;
