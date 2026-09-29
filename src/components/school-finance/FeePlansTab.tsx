import React, { useEffect, useState } from 'react';
import { Plus, Loader2, Trash2, Edit3, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';
import { currency, Modal } from './shared';

interface FeePlan {
    id: string; name: string; frequency: string; class_id: string | null;
    section: string | null; due_day_of_month: number; late_fee_amount: number;
    late_fee_grace_days: number; is_active: boolean;
}
interface FeeHead { id: string; name: string; amount: number }
interface ClassRow { id: string; name: string; section: string | null }
interface PlanItem { id?: string; fee_head_id: string | null; label: string; amount: number; tax: number; is_optional: boolean }

interface Props { schoolId: string; autoOpen?: boolean }

const FeePlansTab: React.FC<Props> = ({ schoolId, autoOpen = false }) => {
    const [plans, setPlans] = useState<FeePlan[]>([]);
    const [heads, setHeads] = useState<FeeHead[]>([]);
    const [classes, setClasses] = useState<ClassRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<FeePlan | null>(null);
    const [items, setItems] = useState<PlanItem[]>([]);
    const [form, setForm] = useState({ name: '', class_id: '', section: '', frequency: 'monthly', due_day_of_month: 5, late_fee_amount: 0, late_fee_grace_days: 3 });
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        const [p, h, c] = await Promise.all([
            supabase.from('fee_plans').select('*').eq('school_id', schoolId).is('deleted_at', null).order('name'),
            supabase.from('fee_structures').select('id,name,amount').eq('school_id', schoolId).is('deleted_at', null).order('name'),
            supabase.from('classes').select('id,name,section').eq('school_id', schoolId).is('deleted_at', null).order('name'),
        ]);
        setPlans(p.data ?? []); setHeads(h.data ?? []); setClasses(c.data ?? []);
        setLoading(false);
    };
    useEffect(() => { load(); }, [schoolId]);

    const openNew = () => {
        setEditing(null);
        setForm({ name: '', class_id: '', section: '', frequency: 'monthly', due_day_of_month: 5, late_fee_amount: 0, late_fee_grace_days: 3 });
        setItems([]);
        setOpen(true);
    };
    useEffect(() => { if (autoOpen) openNew(); }, [autoOpen]);

    const openEdit = async (p: FeePlan) => {
        setEditing(p);
        setForm({ name: p.name, class_id: p.class_id ?? '', section: p.section ?? '', frequency: p.frequency, due_day_of_month: p.due_day_of_month, late_fee_amount: p.late_fee_amount, late_fee_grace_days: p.late_fee_grace_days });
        const { data } = await supabase.from('fee_plan_items').select('*').eq('plan_id', p.id).order('sort_order');
        setItems((data ?? []).map(x => ({ id: x.id, fee_head_id: x.fee_head_id, label: x.label, amount: Number(x.amount), tax: Number(x.tax || 0), is_optional: x.is_optional })));
        setOpen(true);
    };

    const addItem = () => setItems([...items, { fee_head_id: null, label: '', amount: 0, tax: 0, is_optional: false }]);
    const applyHead = (idx: number, headId: string) => {
        const h = heads.find(x => x.id === headId);
        if (!h) return;
        const next = [...items]; next[idx] = { ...next[idx], fee_head_id: h.id, label: h.name, amount: h.amount }; setItems(next);
    };
    const updateItem = (idx: number, patch: Partial<PlanItem>) => {
        const next = [...items]; next[idx] = { ...next[idx], ...patch }; setItems(next);
    };
    const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

    const save = async () => {
        if (!form.name) return toast.error('Plan name required');
        if (items.length === 0) return toast.error('Add at least one fee item');
        setSaving(true);
        let planId = editing?.id;
        const payload = {
            school_id: schoolId, name: form.name,
            class_id: form.class_id || null, section: form.section || null,
            frequency: form.frequency, due_day_of_month: form.due_day_of_month,
            late_fee_amount: form.late_fee_amount, late_fee_grace_days: form.late_fee_grace_days,
        };
        if (editing) {
            const { error } = await supabase.from('fee_plans').update(payload).eq('id', editing.id);
            if (error) { setSaving(false); return toast.error(error.message); }
            await supabase.from('fee_plan_items').delete().eq('plan_id', editing.id);
        } else {
            const { data, error } = await supabase.from('fee_plans').insert(payload).select('id').single();
            if (error || !data) { setSaving(false); return toast.error(error?.message ?? 'failed'); }
            planId = data.id;
        }
        const itemsPayload = items.map((it, i) => ({
            plan_id: planId, school_id: schoolId, fee_head_id: it.fee_head_id,
            label: it.label || 'Item', amount: it.amount, tax: it.tax, is_optional: it.is_optional, sort_order: i,
        }));
        const { error: ie } = await supabase.from('fee_plan_items').insert(itemsPayload);
        setSaving(false);
        if (ie) return toast.error(ie.message);
        toast.success('Plan saved'); setOpen(false); load();
    };

    const remove = async (id: string) => {
        if (!confirm('Delete this plan? Assignments referencing it will be removed.')) return;
        const { error } = await supabase.from('fee_plans').delete().eq('id', id);
        if (error) return toast.error(error.message);
        toast.success('Deleted'); load();
    };

    const total = items.reduce((s, i) => s + Number(i.amount || 0) + Number(i.tax || 0), 0);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted">Templates that group fee heads for a class, applied to students via assignments.</p>
                <button onClick={openNew} className="clay-btn inline-flex items-center gap-2"><Plus size={16} /> New Plan</button>
            </div>

            <div className="clay-card overflow-hidden">
                {loading ? (
                    <div className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted" /></div>
                ) : plans.length === 0 ? (
                    <div className="p-10 text-center text-muted text-sm">No fee plans yet.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-stone-50 text-muted uppercase text-[11px] tracking-wider">
                                <tr><th className="px-4 py-3 text-left">Name</th><th className="px-4 py-3 text-left">Class</th><th className="px-4 py-3 text-left">Frequency</th><th className="px-4 py-3 text-center">Due day</th><th className="px-4 py-3 text-right">Late fee</th><th className="px-4 py-3"></th></tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                                {plans.map(p => {
                                    const cls = classes.find(c => c.id === p.class_id);
                                    return (
                                        <tr key={p.id} className="hover:bg-stone-50/50">
                                            <td className="px-4 py-3 font-semibold">{p.name}</td>
                                            <td className="px-4 py-3 text-muted">{cls ? `${cls.name}${p.section ? ` · ${p.section}` : ''}` : (p.section ?? '—')}</td>
                                            <td className="px-4 py-3 capitalize">{p.frequency.replace('_', ' ')}</td>
                                            <td className="px-4 py-3 text-center">{p.due_day_of_month}</td>
                                            <td className="px-4 py-3 text-right">{currency(p.late_fee_amount)} <span className="text-muted text-[10px]">+{p.late_fee_grace_days}d</span></td>
                                            <td className="px-4 py-3 text-right space-x-1">
                                                <button onClick={() => openEdit(p)} className="text-primary hover:bg-primary/10 p-1.5 rounded-lg"><Edit3 size={14} /></button>
                                                <button onClick={() => remove(p.id)} className="text-rose-500 hover:bg-rose-50 p-1.5 rounded-lg"><Trash2 size={14} /></button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Plan' : 'New Fee Plan'} wide>
                <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-bold uppercase text-muted">Plan Name</label>
                            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="clay-input w-full mt-1" placeholder="Grade 5 Monthly" />
                        </div>
                        <div>
                            <label className="text-xs font-bold uppercase text-muted">Class</label>
                            <select value={form.class_id} onChange={e => setForm({ ...form, class_id: e.target.value })} className="clay-input w-full mt-1">
                                <option value="">All classes</option>
                                {classes.map(c => <option key={c.id} value={c.id}>{c.name}{c.section ? ` - ${c.section}` : ''}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-bold uppercase text-muted">Frequency</label>
                            <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })} className="clay-input w-full mt-1">
                                <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option>
                                <option value="annual">Annual</option><option value="one_time">One-time</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-bold uppercase text-muted">Due Day (1-28)</label>
                            <input type="number" min={1} max={28} value={form.due_day_of_month} onChange={e => setForm({ ...form, due_day_of_month: Number(e.target.value) })} className="clay-input w-full mt-1" />
                        </div>
                        <div>
                            <label className="text-xs font-bold uppercase text-muted">Late Fee (₹)</label>
                            <input type="number" value={form.late_fee_amount} onChange={e => setForm({ ...form, late_fee_amount: Number(e.target.value) })} className="clay-input w-full mt-1" />
                        </div>
                        <div>
                            <label className="text-xs font-bold uppercase text-muted">Grace Days</label>
                            <input type="number" value={form.late_fee_grace_days} onChange={e => setForm({ ...form, late_fee_grace_days: Number(e.target.value) })} className="clay-input w-full mt-1" />
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold uppercase text-muted">Line Items</label>
                            <button type="button" onClick={addItem} className="clay-btn-outline inline-flex items-center gap-1 text-xs"><Plus size={12} /> Add</button>
                        </div>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            {items.map((it, idx) => (
                                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                                    <select value={it.fee_head_id ?? ''} onChange={e => applyHead(idx, e.target.value)} className="clay-input col-span-3 text-xs">
                                        <option value="">Custom…</option>
                                        {heads.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                                    </select>
                                    <input value={it.label} onChange={e => updateItem(idx, { label: e.target.value })} placeholder="Label" className="clay-input col-span-4 text-xs" />
                                    <input type="number" value={it.amount} onChange={e => updateItem(idx, { amount: Number(e.target.value) })} placeholder="Amount" className="clay-input col-span-2 text-xs" />
                                    <input type="number" value={it.tax} onChange={e => updateItem(idx, { tax: Number(e.target.value) })} placeholder="Tax" className="clay-input col-span-2 text-xs" />
                                    <button onClick={() => removeItem(idx)} className="col-span-1 text-rose-500 hover:bg-rose-50 rounded-lg p-1"><X size={14} /></button>
                                </div>
                            ))}
                            {items.length === 0 && <div className="text-xs text-muted italic px-1">Click "Add" to include fee items in this plan.</div>}
                        </div>
                        <div className="mt-2 text-right text-sm font-bold text-foreground">Total: {currency(total)}</div>
                    </div>

                    <button onClick={save} disabled={saving} className="clay-btn w-full inline-flex items-center justify-center gap-2">
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />} {editing ? 'Update Plan' : 'Create Plan'}
                    </button>
                </div>
            </Modal>
        </div>
    );
};

export default FeePlansTab;
