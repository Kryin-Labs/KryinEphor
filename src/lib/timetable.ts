export type TimetableView = 'Day' | 'Week' | 'Month' | '3 Months' | 'Custom Range';

export const schoolDate = (timeZone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const get = (type: string) => parts.find(part => part.type === type)!.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
};

const utc = (date: string) => new Date(`${date}T12:00:00Z`);
export const dateKey = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => {
    const next = utc(date);
    next.setUTCDate(next.getUTCDate() + days);
    return dateKey(next);
};
export const weekday = (date: string) => utc(date).getUTCDay();
export const shiftAnchor = (date: string, view: TimetableView, direction: -1 | 1) => {
    if (view === 'Day') return addDays(date, direction);
    if (view === 'Week') return addDays(date, direction * 7);
    const next = utc(date);
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + direction * (view === '3 Months' ? 3 : 1));
    return dateKey(next);
};

export function timetableRange(view: TimetableView, anchor: string, customEnd: string) {
    const d = utc(anchor);
    if (view === 'Day') return { from: anchor, to: anchor };
    if (view === 'Week') {
        const from = addDays(anchor, -((weekday(anchor) + 6) % 7));
        return { from, to: addDays(from, 6) };
    }
    if (view === 'Custom Range') return { from: anchor, to: customEnd };
    const from = dateKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
    const to = dateKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (view === 'Month' ? 1 : 3), 0)));
    return { from, to };
}

export const niceDate = (date: string) => new Intl.DateTimeFormat(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}).format(utc(date));
