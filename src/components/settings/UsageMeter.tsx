import { capacityUsage } from '../../lib/healthUsage';

type Props = { used: number | null | undefined; total: number | null | undefined; basis: string; unavailable?: string; showRemaining?: boolean };
const percent = (value: number) => value > 0 && value < 0.1 ? '<0.1' : value.toLocaleString(undefined, { maximumFractionDigits: 1 });

export default function UsageMeter({ used, total, basis, unavailable = 'Capacity unavailable', showRemaining = false }: Props) {
    const usage = capacityUsage(used, total);
    if (!usage) return <p className="mt-3 text-xs text-muted">{unavailable}</p>;
    return <div className="mt-3 min-w-28 space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs"><span className="text-muted">{basis}</span><span className={`font-semibold tabular-nums ${usage.exceeded ? 'text-rose-700' : 'text-stone-700'}`}>{percent(usage.percent)}% / 100%</span></div>
        <div role="progressbar" aria-label={basis} aria-valuemin={0} aria-valuemax={100} aria-valuenow={usage.barPercent} aria-valuetext={`${percent(usage.percent)} percent${usage.exceeded ? ', over capacity' : ''}`} className="h-1.5 overflow-hidden rounded-full bg-stone-100"><div className={`h-full rounded-full ${usage.exceeded ? 'bg-rose-600' : 'bg-primary'}`} style={{ width: `${usage.barPercent}%` }} /></div>
        {usage.exceeded && <p className="text-xs text-rose-700">Over the configured limit</p>}
        {showRemaining && <p className="text-xs text-muted">{percent(usage.remainingPercent)}% available</p>}
    </div>;
}
