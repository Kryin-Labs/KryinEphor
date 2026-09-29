import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, CheckCircle2, Clock, CalendarClock, Receipt, RefreshCcw, FileText } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { currency, Modal, Pill } from './shared';
import { useInvoicesPage, useSchoolStudents, type InvoiceRow } from '../../hooks/queries';
import QueryBoundary from '../ui/QueryBoundary';
import Pagination from '../ui/Pagination';

interface Props { schoolId: string }

const PAGE_SIZE = 50;

const InvoicesTab: React.FC<Props> = ({ schoolId }) => {
    const qc = useQueryClient();
    const [qInput, setQInput] = useState('');
    const [q, setQ] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [page, setPage] = useState(0);
    const [payOpen, setPayOpen] = useState<InvoiceRow | null>(null);
    const [extendOpen, setExtendOpen] = useState<InvoiceRow | null>(null);
    const [payForm, setPayForm] = useState({ amount: '', method: 'cash', reference: '', notes: '' });
    const [extendDays, setExtendDays] = useState(7);
    const [saving, setSaving] = useState(false);

    // Debounce search & reset to page 1 on filter change
    useEffect(() => {
        const t = setTimeout(() => { setQ(qInput.trim()); setPage(0); }, 300);
        return () => clearTimeout(t);
    }, [qInput]);
    useEffect(() => { setPage(0); }, [statusFilter, schoolId]);

    const invoicesQuery = useInvoicesPage(schoolId, statusFilter, q, page, PAGE_SIZE);
    const studentsQuery = useSchoolStudents(schoolId);
    const studentMap = useMemo(
        () => Object.fromEntries((studentsQuery.data ?? []).map(s => [s.id, s])),
        [studentsQuery.data],
    );

    const invalidate = () => {
        qc.invalidateQueries({ queryKey: ['invoices'] });
    };

    const openPay = (inv: InvoiceRow) => {
        const remaining = Number(inv.amount) + Number(inv.late_fee || 0) - Number(inv.paid_amount || 0);
        setPayForm({ amount: String(Math.max(remaining, 0)), method: 'cash', reference: '', notes: '' });
        setPayOpen(inv);
    };

    const recordPayment = async () => {
        if (!payOpen) return;
        const amt = Number(payForm.amount);
        if (!amt || amt <= 0) return toast.error('Enter a valid amount');
        setSaving(true);
        const { error } = await supabase.rpc('fn_record_fee_payment', {
            p_invoice: payOpen.id, p_amount: amt, p_method: payForm.method,
            p_reference: payForm.reference || null, p_notes: payForm.notes || null,
        });
        setSaving(false);
        if (error) return toast.error(error.message);
        toast.success('Payment recorded'); setPayOpen(null); invalidate();
    };

    const extend = async () => {
        if (!extendOpen) return;
        setSaving(true);
        const { error } = await supabase.rpc('fn_extend_invoice_due', { p_invoice: extendOpen.id, p_days: extendDays });
        setSaving(false);
        if (error) return toast.error(error.message);
        toast.success(`Extended by ${extendDays} days`); setExtendOpen(null); invalidate();
    };

    const runGenerate = async () => {
        toast.loading('Running invoice generation…', { id: 'gen' });
        const { data, error } = await supabase.functions.invoke('generate_school_invoices');
        if (error) { toast.error(error.message, { id: 'gen' }); return; }
        toast.success(`Generated ${data?.generated ?? 0} invoice(s)`, { id: 'gen' });
        invalidate();
    };

    const total = invoicesQuery.data?.total ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <div className="flex gap-2 flex-1">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                        <input value={qInput} onChange={e => setQInput(e.target.value)} placeholder="Search invoice #…" className="clay-input pl-9 w-full" />
                    </div>
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="clay-input">
                        <option value="all">All</option><option value="pending">Pending</option>
                        <option value="partial">Partial</option><option value="overdue">Overdue</option>
                        <option value="paid">Paid</option><option value="waived">Waived</option>
                    </select>
                </div>
                <button onClick={runGenerate} className="clay-btn-outline inline-flex items-center gap-2"><RefreshCcw size={14} /> Generate Now</button>
            </div>

            <div className="clay-card overflow-hidden">
                <QueryBoundary
                    query={{ ...invoicesQuery, data: invoicesQuery.data?.rows }}
                    isEmpty={(rows) => !rows || rows.length === 0}
                    emptyIcon={FileText}
                    emptyTitle="No invoices match your filter"
                    emptyDescription={q || statusFilter !== 'all' ? 'Try clearing filters to see more results.' : 'Generate invoices for this school to get started.'}
                    loadingRows={6}
                    loadingHeight={48}
                >
                    {(rows) => (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-stone-50 text-muted uppercase text-[11px] tracking-wider">
                                    <tr>
                                        <th className="px-4 py-3 text-left">Invoice</th>
                                        <th className="px-4 py-3 text-left">Student</th>
                                        <th className="px-4 py-3 text-left">Period</th>
                                        <th className="px-4 py-3 text-left">Due</th>
                                        <th className="px-4 py-3 text-right">Total</th>
                                        <th className="px-4 py-3 text-right">Paid</th>
                                        <th className="px-4 py-3 text-center">Status</th>
                                        <th className="px-4 py-3"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-stone-100">
                                    {rows.map(r => {
                                        const s = r.student_id ? studentMap[r.student_id] : null;
                                        const total = Number(r.amount) + Number(r.late_fee || 0);
                                        return (
                                            <tr key={r.id} className="hover:bg-stone-50/50">
                                                <td className="px-4 py-3 font-mono text-xs">{r.invoice_number ?? r.id.slice(0, 8)}</td>
                                                <td className="px-4 py-3 font-semibold">{s?.full_name ?? s?.email ?? '—'}</td>
                                                <td className="px-4 py-3 text-muted">{r.period_label ?? '—'}</td>
                                                <td className="px-4 py-3 text-muted">{r.due_date}</td>
                                                <td className="px-4 py-3 text-right font-mono">{currency(total)}</td>
                                                <td className="px-4 py-3 text-right font-mono text-emerald-700">{currency(r.paid_amount || 0)}</td>
                                                <td className="px-4 py-3 text-center"><Pill status={r.status} /></td>
                                                <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                                                    {r.status !== 'paid' && r.status !== 'waived' && (
                                                        <>
                                                            <button onClick={() => openPay(r)} className="clay-btn-outline inline-flex items-center gap-1 text-xs !py-1 !px-2">
                                                                <CheckCircle2 size={12} /> Pay
                                                            </button>
                                                            <button onClick={() => { setExtendDays(7); setExtendOpen(r); }} className="clay-btn-outline inline-flex items-center gap-1 text-xs !py-1 !px-2">
                                                                <CalendarClock size={12} /> Extend
                                                            </button>
                                                        </>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </QueryBoundary>
            </div>

            <Pagination
                page={page}
                pageCount={pageCount}
                total={total}
                onPageChange={setPage}
                isFetching={invoicesQuery.isFetching}
            />

            <Modal open={!!payOpen} onClose={() => setPayOpen(null)} title="Record Payment">
                {payOpen && (
                    <div className="space-y-3">
                        <div className="p-3 rounded-xl bg-stone-50 text-sm">
                            <div className="flex justify-between"><span className="text-muted">Invoice</span><span className="font-mono">{payOpen.invoice_number}</span></div>
                            <div className="flex justify-between"><span className="text-muted">Total</span><span>{currency(Number(payOpen.amount) + Number(payOpen.late_fee || 0))}</span></div>
                            <div className="flex justify-between"><span className="text-muted">Paid so far</span><span>{currency(payOpen.paid_amount || 0)}</span></div>
                            <div className="flex justify-between font-bold"><span>Remaining</span><span>{currency(Number(payOpen.amount) + Number(payOpen.late_fee || 0) - Number(payOpen.paid_amount || 0))}</span></div>
                        </div>
                        <div>
                            <label className="text-xs font-bold uppercase text-muted">Amount ₹</label>
                            <input type="number" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} className="clay-input w-full mt-1" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs font-bold uppercase text-muted">Method</label>
                                <select value={payForm.method} onChange={e => setPayForm({ ...payForm, method: e.target.value })} className="clay-input w-full mt-1">
                                    <option value="cash">Cash</option><option value="upi">UPI</option>
                                    <option value="card">Card</option><option value="bank_transfer">Bank</option>
                                    <option value="cheque">Cheque</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-bold uppercase text-muted">Reference</label>
                                <input value={payForm.reference} onChange={e => setPayForm({ ...payForm, reference: e.target.value })} className="clay-input w-full mt-1" placeholder="Txn / Cheque #" />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-bold uppercase text-muted">Notes</label>
                            <input value={payForm.notes} onChange={e => setPayForm({ ...payForm, notes: e.target.value })} className="clay-input w-full mt-1" />
                        </div>
                        <button onClick={recordPayment} disabled={saving} className="clay-btn w-full inline-flex items-center justify-center gap-2">
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />} <Receipt size={14} /> Record & Issue Receipt
                        </button>
                    </div>
                )}
            </Modal>

            <Modal open={!!extendOpen} onClose={() => setExtendOpen(null)} title="Extend Due Date">
                {extendOpen && (
                    <div className="space-y-3">
                        <p className="text-sm text-muted">Current due: <span className="font-semibold text-foreground">{extendOpen.due_date}</span></p>
                        <div>
                            <label className="text-xs font-bold uppercase text-muted">Extend by (days)</label>
                            <input type="number" min={1} max={365} value={extendDays} onChange={e => setExtendDays(Number(e.target.value))} className="clay-input w-full mt-1" />
                        </div>
                        <button onClick={extend} disabled={saving} className="clay-btn w-full inline-flex items-center justify-center gap-2">
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />} <Clock size={14} /> Extend Due Date
                        </button>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default InvoicesTab;
