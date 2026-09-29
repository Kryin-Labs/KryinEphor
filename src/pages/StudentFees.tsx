import { useMemo } from 'react';
import StudentPortalLayout from '../components/student/StudentPortalLayout';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { ChildSelector } from '../components/dashboard/ChildSelector';
import { GraduationCap } from 'lucide-react';

type Invoice = {
    id: string;
    invoice_number: string;
    amount: number;
    paid_amount: number | null;
    status: string;
    due_date: string | null;
    period_label: string | null;
};

const money = (value: number) =>
    new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(value || 0);

export default function StudentFees() {
    const { user, linkedStudents, activeStudentId } = useAuth();

    // Authoritatively resolve effective student ID (no raw fallback to user.id)
    const effectiveStudentId = activeStudentId
        ?? linkedStudents.find(s => s.isPrimary)?.studentId
        ?? linkedStudents[0]?.studentId
        ?? null;

    const { data: invoices = [], isLoading: loading } = useQuery({
        queryKey: ['student-fees', effectiveStudentId, user?.schoolId],
        enabled: !!effectiveStudentId && !!user?.schoolId,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('invoices')
                .select('id,invoice_number,amount,paid_amount,status,due_date,period_label')
                .eq('school_id', user!.schoolId!)
                .eq('student_id', effectiveStudentId!)
                .is('deleted_at', null)
                .order('due_date', { ascending: false });

            if (error) throw error;
            return (data ?? []) as Invoice[];
        }
    });

    const summary = useMemo(() =>
        invoices.reduce(
            (total, item) => ({
                billed: total.billed + Number(item.amount || 0),
                paid: total.paid + Number(item.paid_amount || 0)
            }),
            { billed: 0, paid: 0 }
        ),
        [invoices]
    );

    return (
        <StudentPortalLayout title="Fees">
            <div className="space-y-7">
                {/* Child selector for multi-child accounts */}
                <div className="flex items-center justify-between">
                    <ChildSelector />
                </div>

                {!effectiveStudentId ? (
                    <div className="clay-card p-10 text-center text-stone-500 rounded-3xl">
                        <GraduationCap className="w-12 h-12 mx-auto text-stone-300 mb-3" />
                        <h3 className="text-lg font-bold text-foreground">No Student Profile Selected</h3>
                        <p className="text-sm text-muted mt-1 max-w-md mx-auto">
                            No student record is linked to this account to view fee invoices.
                        </p>
                    </div>
                ) : (
                    <>
                        <section className="clay-card p-6 sm:p-8">
                            <p className="text-sm font-bold text-primary">Fee overview</p>
                            <h1 className="mt-1 text-3xl font-bold text-foreground">School fees</h1>
                            <p className="mt-2 text-muted">See each fee record and payment status for the selected student.</p>
                            <div className="mt-6 grid gap-4 sm:grid-cols-3">
                                {[
                                    ['Total billed', summary.billed],
                                    ['Paid', summary.paid],
                                    ['Pending', Math.max(0, summary.billed - summary.paid)]
                                ].map(([label, amount]) => (
                                    <div key={String(label)} className="rounded-2xl border border-border bg-white/65 p-4">
                                        <p className="text-xs font-bold uppercase tracking-wider text-muted">{label}</p>
                                        <p className="mt-2 text-2xl font-bold text-foreground">{money(Number(amount))}</p>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="clay-card overflow-hidden">
                            <div className="border-b border-border px-6 py-4">
                                <h2 className="font-bold text-foreground">Fee records</h2>
                            </div>
                            {loading ? (
                                <p className="p-6 text-muted">Loading fees…</p>
                            ) : invoices.length === 0 ? (
                                <p className="p-6 text-muted">No fee records found for this student.</p>
                            ) : (
                                <div className="divide-y divide-border">
                                    {invoices.map(item => (
                                        <div key={item.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                                            <div>
                                                <p className="font-bold text-foreground">{item.period_label || item.invoice_number}</p>
                                                <p className="mt-1 text-sm text-muted">Due {item.due_date || 'not set'}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-bold text-foreground">{money(Number(item.amount))}</p>
                                                <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                                                    item.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                                }`}>
                                                    {item.status}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    </>
                )}
            </div>
        </StudentPortalLayout>
    );
}
