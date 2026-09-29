import React, { useEffect, useState } from 'react';
import { Plus, Loader2, Trash2, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';
import { currency, Modal } from './shared';

interface FeeHead {
    id: string; name: string; amount: number; frequency: string | null;
    is_mandatory: boolean | null; class_id: string | null;
}

interface Props { schoolId: string }

const FeeHeadsTab: React.FC<Props> = ({ schoolId }) => {
    const [rows, setRows] = useState<FeeHead[]>([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ name: '', amount: '', frequency: 'monthly', is_mandatory: true });

    const load = async () => {
        setLoading(true);
        const { data, error } = await supabase.from('fee_structures')
            .select('id,name,amount,frequency,is_mandatory,class_id')
            .eq('school_id', schoolId).is('deleted_at', null).order('name');
        if (error) toast.error(error.message);
        setRows(data ?? []);
        setLoading(false);
    };
    useEffect(() => { load(); }, [schoolId]);

    const save = async () => {
        if (!form.name || !form.amount) return toast.error('Name and amount are required');
        setSaving(true);
        const { error } = await supabase.from('fee_structures').insert({
            school_id: schoolId, name: form.name, amount: Number(form.amount),
            frequency: form.frequency, is_mandatory: form.is_mandatory,
        });
        setSaving(false);
        if (error) return toast.error(error.message);
        toast.success('Fee head added');
        setOpen(false); setForm({ name: '', amount: '', frequency: 'monthly', is_mandatory: true });
        load();
    };

    const remove = async (id: string) => {
        if (!confirm('Delete this fee head?')) return;
        const { error } = await supabase.from('fee_structures').update({ deleted_at: new Date().toISOString() }).eq('id', id);
        if (error) return toast.error(error.message);
        toast.success('Deleted'); load();
    };

    const filtered = rows.filter(r => !q || r.name.toLowerCase().includes(q.toLowerCase()));

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search fee heads…" className="clay-input pl-9 w-full" />
                </div>
                <button onClick={() => setOpen(true)} className="clay-btn inline-flex items-center gap-2"><Plus size={16} /> New Fee Head</button>
            </div>

            <div className="clay-card overflow-hidden">
                {loading ? (
                    <div className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted" /></div>
                ) : filtered.length === 0 ? (
                    <div className="p-10 text-center text-muted text-sm">No fee heads yet. Create one to get started.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-stone-50 text-muted uppercase text-[11px] tracking-wider">
                                <tr><th className="px-4 py-3 text-left">Name</th><th className="px-4 py-3 text-left">Frequency</th><th className="px-4 py-3 text-right">Default Amount</th><th className="px-4 py-3 text-center">Mandatory</th><th className="px-4 py-3"></th></tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                                {filtered.map(r => (
                                    <tr key={r.id} className="hover:bg-stone-50/50">
                                        <td className="px-4 py-3 font-semibold">{r.name}</td>
                                        <td className="px-4 py-3 capitalize text-muted">{r.frequency ?? '—'}</td>
                                        <td className="px-4 py-3 text-right font-mono">{currency(r.amount)}</td>
                                        <td className="px-4 py-3 text-center">{r.is_mandatory ? '✓' : '—'}</td>
                                        <td className="px-4 py-3 text-right">
                                            <button onClick={() => remove(r.id)} className="text-rose-500 hover:bg-rose-50 p-1.5 rounded-lg"><Trash2 size={14} /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <Modal open={open} onClose={() => setOpen(false)} title="New Fee Head">
                <div className="space-y-3">
                    <div>
                        <label className="text-xs font-bold uppercase text-muted">Name</label>
                        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="clay-input w-full mt-1" placeholder="Tuition / Bus / Lab…" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-bold uppercase text-muted">Amount (₹)</label>
                            <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="clay-input w-full mt-1" />
                        </div>
                        <div>
                            <label className="text-xs font-bold uppercase text-muted">Frequency</label>
                            <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })} className="clay-input w-full mt-1">
                                <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option>
                                <option value="annual">Annual</option><option value="one_time">One-time</option>
                            </select>
                        </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={form.is_mandatory} onChange={e => setForm({ ...form, is_mandatory: e.target.checked })} />
                        Mandatory for all students
                    </label>
                    <button onClick={save} disabled={saving} className="clay-btn w-full inline-flex items-center justify-center gap-2">
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save Fee Head
                    </button>
                </div>
            </Modal>
        </div>
    );
};

export default FeeHeadsTab;
