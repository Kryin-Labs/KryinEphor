export const currency = (n: number | null | undefined) =>
    '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export const statusStyles: Record<string, string> = {
    paid: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    partial: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
    pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    overdue: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
    waived: 'bg-stone-100 text-stone-600 ring-1 ring-stone-200',
    processed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    active: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    invoiced: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
};
