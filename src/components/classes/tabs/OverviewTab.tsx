import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, BookOpen, CheckSquare, Coins } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { qk } from '../../../lib/queryKeys';

interface Props {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    klass: any;
    teacherName?: string | null;
}

const OverviewTab: React.FC<Props> = ({ klass, teacherName }) => {
    const { data } = useQuery({
        queryKey: qk.classes.overview(klass.id),
        queryFn: async () => {
            const { data, error } = await supabase.rpc('fn_class_overview', { p_class: klass.id });
            if (error) throw error;
            return data as { students: number; subjects: number; attendance_today_pct: number | null; attendance_marked: number; fees_assigned: number };
        },
    });

    const stats = [
        { label: 'Students', value: data?.students ?? '—', icon: Users, tone: 'bg-gradient-to-br from-teal-500 to-emerald-600' },
        { label: 'Subjects', value: data?.subjects ?? '—', icon: BookOpen, tone: 'bg-gradient-to-br from-indigo-500 to-violet-600' },
        { label: 'Attendance today', value: data?.attendance_today_pct != null ? `${data.attendance_today_pct}%` : '—', icon: CheckSquare, tone: 'bg-gradient-to-br from-amber-500 to-orange-500' },
        { label: 'Fees assigned', value: `${data?.fees_assigned ?? 0}/${data?.students ?? 0}`, icon: Coins, tone: 'bg-gradient-to-br from-rose-500 to-pink-600' },
    ];

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {stats.map(s => {
                    const Icon = s.icon;
                    return (
                        <div key={s.label} className="clay-card p-4 relative overflow-hidden">
                            <div className={`absolute -right-6 -top-6 h-20 w-20 rounded-full ${s.tone} opacity-20 blur-2xl`} />
                            <div className="relative">
                                <div className={`w-9 h-9 rounded-xl ${s.tone} text-white flex items-center justify-center shadow-sm`}><Icon className="w-4 h-4" /></div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted mt-3">{s.label}</p>
                                <p className="text-xl font-extrabold mt-0.5">{s.value}</p>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="clay-card p-5 space-y-3 text-sm">
                <h4 className="text-sm font-extrabold uppercase tracking-wider text-muted">Class details</h4>
                <Row label="Name" value={klass.name} />
                <Row label="Class / Section" value={`${klass.grade_level ?? '—'} / ${klass.section ?? '—'}`} />
                <Row label="Room" value={klass.room_number ?? '—'} />
                <Row label="Capacity" value={klass.capacity?.toString() ?? '—'} />
                <Row label="Class teacher" value={teacherName ?? '—'} />
            </div>
        </div>
    );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="flex justify-between border-b border-stone-100 pb-2 last:border-none last:pb-0">
        <span className="text-muted">{label}</span>
        <span className="font-bold text-foreground">{value}</span>
    </div>
);

export default OverviewTab;
