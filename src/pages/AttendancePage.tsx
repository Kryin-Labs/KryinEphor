import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckSquare } from 'lucide-react';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';
import AttendanceTab from '../components/classes/tabs/AttendanceTab';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { schoolDate } from '../lib/timetable';

type Summary = {
    id: string; name: string; teacher_id: string | null;
    total: number; present: number; absent: number; late: number; marked: number;
    excused: number; half_day: number;
};

export default function AttendancePage() {
    const { user, roles } = useAuth();
    const schoolId = user?.schoolId;
    const [classId, setClassId] = useState('');
    const school = useQuery({
        queryKey: ['attendance-school-zone', schoolId], enabled: !!schoolId,
        queryFn: async () => {
            const { data, error } = await supabase.from('schools').select('time_zone').eq('id', schoolId!).single();
            if (error) throw error;
            return data.time_zone;
        },
    });
    const today = school.data ? schoolDate(school.data) : '';
    const summary = useQuery({
        queryKey: ['attendance-summary', schoolId, user?.id, today], enabled: !!schoolId && !!today,
        queryFn: async () => {
            const { data, error } = await supabase.rpc('fn_attendance_summary', { p_date: today });
            if (error) throw error;
            return data as unknown as Summary[];
        },
    });
    const classes = summary.data ?? [];
    const selectedId = classes.some(item => item.id === classId) ? classId : classes[0]?.id;
    const totals = classes.reduce((all, item) => ({
        students: all.students + item.total,
        present: all.present + item.present,
        absent: all.absent + item.absent,
        late: all.late + item.late,
        excused: all.excused + item.excused, half_day: all.half_day + item.half_day,
        unmarked: all.unmarked + item.total - item.marked,
    }), { students: 0, present: 0, absent: 0, late: 0, excused: 0, half_day: 0, unmarked: 0 });
    const canEdit = roles.includes('admin') || roles.includes('superadmin')
        || (roles.includes('teacher') && classes.find(item => item.id === selectedId)?.teacher_id === user?.id);
    const ready = school.isSuccess && summary.isSuccess;

    return <div className="flex min-h-screen bg-background">
        <Sidebar activePage="Attendance" />
        <div className="flex min-h-screen flex-1 flex-col lg:ml-72">
            <Header title="Attendance Management" />
            <main className="flex-1 space-y-5 p-4 pb-24 sm:p-8">
                <section className="clay-card p-5 sm:p-7">
                    <div className="flex items-center gap-3">
                        <span className="grid h-11 w-11 place-items-center rounded-xl bg-teal-50 text-primary"><CheckSquare size={21} /></span>
                        <div><h1 className="text-2xl font-extrabold">Daily attendance</h1>
                            <p className="text-sm text-muted">Today's summary uses your school's time zone{school.data ? ` (${school.data})` : ''}.</p></div>
                    </div>
                    {school.error && <p role="alert" className="mt-4 text-sm text-rose-700">{school.error.message}</p>}
                    {summary.error && <p role="alert" className="mt-4 text-sm text-rose-700">{summary.error.message}</p>}
                    {!school.error && !summary.error && !ready && <p className="mt-5 text-sm text-muted">Loading attendance…</p>}
                    {ready && <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {([
                            ['Students', totals.students], ['Present', totals.present],
                            ['Absent', totals.absent], ['Late', totals.late],
                            ['Excused', totals.excused], ['Half day', totals.half_day], ['Unmarked', totals.unmarked],
                        ] as const).map(([label, count]) => <div key={label} className="rounded-xl border border-stone-200 bg-white p-4">
                            <p className="text-xs font-bold uppercase text-muted">{label}</p><p className="mt-1 text-2xl font-extrabold">{count}</p>
                        </div>)}
                    </div>}
                </section>
                {ready && <section className="clay-card p-5 sm:p-6">
                    <h2 className="text-lg font-bold">Class attendance</h2>
                    <p className="text-xs text-muted">Choose a class to review or mark its full roster.</p>
                    {classes.length ? <label className="mt-4 block max-w-sm text-xs font-bold text-muted">Class
                        <select value={selectedId} onChange={event => setClassId(event.target.value)}
                            className="clay-input mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm">
                            {classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                    </label> : <p className="mt-4 text-sm text-muted">No classes are available to this account.</p>}
                </section>}
                {ready && selectedId && schoolId && <AttendanceTab key={selectedId} classId={selectedId} schoolId={schoolId} canEdit={canEdit} />}
            </main>
        </div>
    </div>;
}
