import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Coins, CheckCircle2, XCircle, Plus } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { qk } from '../../../lib/queryKeys';

interface Props { classId: string; schoolId: string; canEdit: boolean; }

const FeesTab: React.FC<Props> = ({ classId, schoolId, canEdit }) => {
    const qc = useQueryClient();
    const [planId, setPlanId] = useState('');

    const { data, isLoading } = useQuery({
        queryKey: qk.classes.feesCoverage(classId),
        queryFn: async () => {
            const [enrolls, plans] = await Promise.all([
                supabase.from('class_enrollments').select('student_id, profiles:student_id(full_name)').eq('class_id', classId).is('deleted_at', null),
                supabase.from('fee_plans').select('id, name, frequency, is_active').eq('school_id', schoolId).eq('is_active', true).is('deleted_at', null),
            ]);
            if (enrolls.error) throw enrolls.error;
            const ids = (enrolls.data ?? []).map(e => e.student_id);
            let assigns: { student_id: string; plan_id: string }[] = [];
            if (ids.length) {
                const { data } = await supabase.from('student_fee_assignments').select('student_id, plan_id').in('student_id', ids).eq('is_active', true);
                assigns = data ?? [];
            }
            const assignedSet = new Set(assigns.map(a => a.student_id));
            return {
                enrolls: enrolls.data ?? [],
                plans: plans.data ?? [],
                assignedSet,
            };
        },
    });

    const bulk = useMutation({
        mutationFn: async () => {
            if (!planId) throw new Error('Pick a plan');
            const { data, error } = await supabase.rpc('fn_bulk_assign_fee_plan', { p_class: classId, p_plan: planId });
            if (error) throw error;
            return data as number;
        },
        onSuccess: (n) => {
            toast.success(`Assigned to ${n} student(s)`);
            qc.invalidateQueries({ queryKey: qk.classes.feesCoverage(classId) });
            qc.invalidateQueries({ queryKey: qk.classes.overview(classId) });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    return (
        <div className="space-y-4">
            {canEdit && (
                <div className="clay-card p-4">
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Bulk assign a fee plan</p>
                        <button onClick={() => { window.location.href = '/school-finance?tab=plans&newPlan=1'; }} className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">
                            <Plus className="w-3.5 h-3.5" /> Create fee plan
                        </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                        <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="clay-input px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm">
                            <option value="">— Choose an active plan —</option>
                            {data?.plans.map(p => <option key={p.id} value={p.id}>{p.name} · {p.frequency}</option>)}
                        </select>
                        <button onClick={() => bulk.mutate()} disabled={!planId || bulk.isPending} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold shadow-md disabled:opacity-50">
                            <Coins className="w-4 h-4" /> {bulk.isPending ? 'Assigning…' : 'Assign to all enrolled'}
                        </button>
                    </div>
                    <p className="text-[11px] text-muted mt-2">Existing assignments are kept; only students without this plan get it added.</p>
                </div>
            )}

            <div className="clay-card overflow-hidden">
                {isLoading ? (
                    <div className="p-6 text-center text-muted text-sm">Loading…</div>
                ) : (data?.enrolls.length ?? 0) === 0 ? (
                    <div className="p-6 text-center text-muted text-sm">No students enrolled.</div>
                ) : (
                    <div className="divide-y divide-stone-100">
                        {data!.enrolls.map((e) => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const prof = e.profiles as any;
                            const has = data!.assignedSet.has(e.student_id);
                            return (
                                <div key={e.student_id} className="flex items-center justify-between px-4 py-3">
                                    <p className="text-sm font-bold truncate">{prof?.full_name || e.student_id.slice(0, 8)}</p>
                                    {has ? (
                                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg ring-1 ring-emerald-200"><CheckCircle2 className="w-3 h-3" /> Assigned</span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-700 bg-rose-50 px-2 py-1 rounded-lg ring-1 ring-rose-200"><XCircle className="w-3 h-3" /> Missing</span>
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

export default FeesTab;
