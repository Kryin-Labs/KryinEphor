import React, { useEffect, useMemo, useState } from 'react';
import { Search, Download, Receipt as ReceiptIcon } from 'lucide-react';
import { currency } from './shared';
import { useReceiptsPage, useSchoolStudents } from '../../hooks/queries';
import QueryBoundary from '../ui/QueryBoundary';
import Pagination from '../ui/Pagination';

interface Props { schoolId: string }

const PAGE_SIZE = 50;

const ReceiptsTab: React.FC<Props> = ({ schoolId }) => {
    const [qInput, setQInput] = useState('');
    const [q, setQ] = useState('');
    const [page, setPage] = useState(0);

    useEffect(() => {
        const t = setTimeout(() => { setQ(qInput.trim()); setPage(0); }, 300);
        return () => clearTimeout(t);
    }, [qInput]);
    useEffect(() => { setPage(0); }, [schoolId]);

    const receiptsQuery = useReceiptsPage(schoolId, q, page, PAGE_SIZE);
    const studentsQuery = useSchoolStudents(schoolId);
    const studentMap = useMemo(
        () => Object.fromEntries((studentsQuery.data ?? []).map(s => [s.id, s])),
        [studentsQuery.data],
    );

    const rows = receiptsQuery.data?.rows ?? [];
    const total = receiptsQuery.data?.total ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const exportCsv = () => {
        const header = 'Receipt,Student,Amount,Method,Date\n';
        const body = rows.map(r => {
            const s = r.student_id ? studentMap[r.student_id] : null;
            return [r.reference_number, s?.full_name ?? s?.email ?? '', r.amount, r.payment_method, new Date(r.created_at).toISOString()].join(',');
        }).join('\n');
        const blob = new Blob([header + body], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `receipts-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                    <input value={qInput} onChange={e => setQInput(e.target.value)} placeholder="Search receipt ref…" className="clay-input pl-9 w-full" />
                </div>
                <button onClick={exportCsv} className="clay-btn-outline inline-flex items-center gap-2"><Download size={14} /> Export CSV</button>
            </div>

            <div className="clay-card overflow-hidden">
                <QueryBoundary
                    query={{ ...receiptsQuery, data: rows }}
                    isEmpty={(r) => !r || r.length === 0}
                    emptyIcon={ReceiptIcon}
                    emptyTitle="No receipts yet"
                    emptyDescription={q ? 'No receipts match your search.' : 'Payments recorded here will appear as receipts.'}
                    loadingRows={6}
                    loadingHeight={48}
                >
                    {(receipts) => (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-stone-50 text-muted uppercase text-[11px] tracking-wider">
                                    <tr><th className="px-4 py-3 text-left">Receipt #</th><th className="px-4 py-3 text-left">Student</th><th className="px-4 py-3 text-left">Method</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3 text-left">Date</th></tr>
                                </thead>
                                <tbody className="divide-y divide-stone-100">
                                    {receipts.map(r => {
                                        const s = r.student_id ? studentMap[r.student_id] : null;
                                        return (
                                            <tr key={r.id} className="hover:bg-stone-50/50">
                                                <td className="px-4 py-3 font-mono text-xs">{r.reference_number ?? r.id.slice(0, 8)}</td>
                                                <td className="px-4 py-3 font-semibold">{s?.full_name ?? s?.email ?? '—'}</td>
                                                <td className="px-4 py-3 capitalize">{r.payment_method ?? '—'}</td>
                                                <td className="px-4 py-3 text-right font-mono text-emerald-700">{currency(r.amount)}</td>
                                                <td className="px-4 py-3 text-muted">{new Date(r.created_at).toLocaleString()}</td>
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
                isFetching={receiptsQuery.isFetching}
            />
        </div>
    );
};

export default ReceiptsTab;
