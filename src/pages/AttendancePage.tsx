import React, { useState, useEffect } from 'react';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';
import { Calendar, Download, Users, UserCheck, UserX, Clock, Filter, Save, School } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';

interface ClassStats {
    id: string;
    name: string;
    teacher_name: string;
    total: number;
    present: number;
    absent: number;
    late: number;
}

const AttendancePage: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [classStats, setClassStats] = useState<ClassStats[]>([]);
    const [students, setStudents] = useState<{ id: string; full_name: string | null; role: string }[]>([]);
    const [attendance, setAttendance] = useState<Record<string, string>>({});
    const [stats, setStats] = useState([
        { label: 'Total Students', value: '0', icon: Users, color: 'teal', sub: 'Across all classes' },
        { label: 'Present Today', value: '0', icon: UserCheck, color: 'emerald', sub: '0% attendance rate' },
        { label: 'Absent Today', value: '0', icon: UserX, color: 'rose', sub: '0% of total' },
        { label: 'Late Arrivals', value: '0', icon: Clock, color: 'amber', sub: '0% of present' },
    ]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const today = format(new Date(), 'yyyy-MM-dd');

            // Parallel bulk fetches
            const [
                { count: totalStudentsCount },
                { data: allAttendance },
                { data: allStudents },
                { data: classesData }
            ] = await Promise.all([
                supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'student'),
                supabase.from('attendance').select('class_id, status, student_id').eq('date', today),
                supabase.from('profiles').select('metadata').eq('role', 'student'),
                supabase.from('classes').select('id, name, profiles!classes_teacher_id_fkey(full_name)')
            ]);

            const totalStudents = totalStudentsCount || 0;
            const present = allAttendance?.filter(a => a.status === 'present').length || 0;
            const absent = allAttendance?.filter(a => a.status === 'absent').length || 0;
            const late = allAttendance?.filter(a => a.status === 'late').length || 0;

            const rate = totalStudents > 0 ? Math.round((present / totalStudents) * 100) : 0;

            setStats([
                { label: 'Total Students', value: totalStudents.toLocaleString(), icon: Users, color: 'teal', sub: 'Active students' },
                { label: 'Present Today', value: present.toString(), icon: UserCheck, color: 'emerald', sub: `${rate}% attendance rate` },
                { label: 'Absent Today', value: absent.toString(), icon: UserX, color: 'rose', sub: 'Requiring follow-up' },
                { label: 'Late Arrivals', value: late.toString(), icon: Clock, color: 'amber', sub: 'Recorded entries' },
            ]);

            // Aggregate student count per class in memory
            const classStudentCounts: Record<string, number> = {};
            allStudents?.forEach(s => {
                const classId = s.metadata?.class_id;
                if (classId) {
                    classStudentCounts[classId] = (classStudentCounts[classId] || 0) + 1;
                }
            });

            // Aggregate attendance stats per class in memory
            const classAttendanceStats: Record<string, { present: number; absent: number; late: number }> = {};
            allAttendance?.forEach(a => {
                if (a.class_id) {
                    if (!classAttendanceStats[a.class_id]) {
                        classAttendanceStats[a.class_id] = { present: 0, absent: 0, late: 0 };
                    }
                    if (a.status === 'present') classAttendanceStats[a.class_id].present++;
                    else if (a.status === 'absent') classAttendanceStats[a.class_id].absent++;
                    else if (a.status === 'late') classAttendanceStats[a.class_id].late++;
                }
            });

            const transformedClasses: ClassStats[] = (classesData || []).map((c) => {
                const statsForClass = classAttendanceStats[c.id] || { present: 0, absent: 0, late: 0 };
                return {
                    id: c.id,
                    name: c.name,
                    teacher_name: c.profiles?.[0]?.full_name || 'Unassigned',
                    total: classStudentCounts[c.id] || 0,
                    present: statsForClass.present,
                    absent: statsForClass.absent,
                    late: statsForClass.late,
                };
            });
            setClassStats(transformedClasses);

            // Fetch Students for marking
            const { data: studentList } = await supabase
                .from('profiles')
                .select('id, full_name, role')
                .eq('role', 'student')
                .limit(10);

            setStudents(studentList || []);

            const markingMap: Record<string, string> = {};
            allAttendance?.forEach(a => {
                markingMap[a.student_id] = a.status;
            });
            setAttendance(markingMap);

        } catch (err) {
            console.error('Error fetching attendance data:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleMark = async (studentId: string, status: string) => {
        setAttendance(prev => ({ ...prev, [studentId]: status }));

        try {
            const today = format(new Date(), 'yyyy-MM-dd');

            // Try to update an existing attendance record for this student today.
            // If no record exists, insert a new one.
            const { data: existing, error: fetchError } = await supabase
                .from('attendance')
                .select('id')
                .eq('student_id', studentId)
                .eq('date', today)
                .maybeSingle();

            if (fetchError) throw fetchError;

            if (existing) {
                // Update existing record
                const { error } = await supabase
                    .from('attendance')
                    .update({ status })
                    .eq('id', existing.id);
                if (error) throw error;
            } else {
                // Insert new record (class_id will be required once the
                // unique constraint is added — for now we insert without it
                // and let the teacher assign via the class-specific view)
                const { error } = await supabase
                    .from('attendance')
                    .insert({
                        student_id: studentId,
                        status,
                        date: today,
                    });
                if (error) throw error;
            }
        } catch (err) {
            console.error('Error marking attendance:', err);
        }
    };

    return (
        <div className="flex min-h-screen bg-background relative selection:bg-teal-100 selection:text-primary">
            <div className="beam beam-left fixed"></div>
            <div className="beam beam-right fixed"></div>

            <Sidebar activePage="Attendance" />

            <div className="flex-1 lg:ml-72 flex flex-col min-h-screen">
                <Header title="Attendance Management" />

                <main className="flex-1 p-8 space-y-8 overflow-y-auto pb-24">

                    <div className="clay-card p-8 relative overflow-hidden flex flex-col md:flex-row justify-between items-center gap-6 animate-fade-up">
                        <div className="relative z-10 w-full md:w-auto">
                            <h1 className="text-3xl font-bold text-foreground mb-1">Attendance Management 📋</h1>
                            <p className="text-muted">Analyze and manage student attendance records.</p>
                        </div>
                        <div className="relative z-10 flex gap-3 w-full md:w-auto">
                            <div className="clay-input px-4 py-2 flex items-center gap-2 text-sm font-bold text-muted bg-white/50">
                                <Calendar className="w-4 h-4 text-primary" />
                                Today, {format(new Date(), 'MMM dd, yyyy')}
                            </div>
                            <button className="clay-btn px-6 py-2.5 text-sm font-bold flex items-center gap-2 bg-primary hover:bg-teal-800">
                                <Save className="w-4 h-4" /> Auto-Saved
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 animate-fade-up delay-100">
                        {stats.map((s, i) => {
                            const Icon = s.icon;
                            return (
                                <div key={i} className="clay-card p-5 flex flex-col justify-between h-full relative overflow-hidden group">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className={`w-12 h-12 rounded-2xl bg-stone-50 flex items-center justify-center text-primary text-xl shadow-inner`}>
                                            <Icon className="w-6 h-6" />
                                        </div>
                                    </div>
                                    <div>
                                        <h3 className="text-3xl font-extrabold text-foreground mb-1">{s.value}</h3>
                                        <p className="text-sm font-bold text-muted">{s.label}</p>
                                        <p className="text-xs text-gray-400 mt-1">{s.sub}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="clay-card p-6 animate-fade-up delay-200 overflow-hidden">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                            <div>
                                <h3 className="text-lg font-bold text-foreground">Class-wise Attendance</h3>
                                <p className="text-xs text-muted">Daily data distribution per class</p>
                            </div>
                            <div className="flex gap-3">
                                <button className="clay-btn-outline px-4 py-2 text-xs font-bold flex items-center gap-2">
                                    <Download className="w-3.5 h-3.5" /> Export
                                </button>
                                <button className="clay-btn-outline px-4 py-2 text-xs font-bold flex items-center gap-2">
                                    <Filter className="w-3.5 h-3.5" /> Filter
                                </button>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="border-b border-gray-100">
                                        <th className="pb-4 font-bold text-xs text-muted uppercase tracking-wider">Class</th>
                                        <th className="pb-4 font-bold text-xs text-muted uppercase tracking-wider">Total</th>
                                        <th className="pb-4 font-bold text-xs text-muted uppercase tracking-wider">Present</th>
                                        <th className="pb-4 font-bold text-xs text-muted uppercase tracking-wider">Absent</th>
                                        <th className="pb-4 font-bold text-xs text-muted uppercase tracking-wider">Late</th>
                                        <th className="pb-4 font-bold text-xs text-muted uppercase tracking-wider">Rate</th>
                                        <th className="pb-4 font-bold text-xs text-muted uppercase tracking-wider">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {loading ? (
                                        <tr><td colSpan={7} className="py-8 text-center text-muted italic">Loading class data...</td></tr>
                                    ) : classStats.length === 0 ? (
                                        <tr><td colSpan={7} className="py-8 text-center text-muted italic">No classes found.</td></tr>
                                    ) : (
                                        classStats.map((cls, i) => {
                                            const rate = cls.total > 0 ? Math.round((cls.present / cls.total) * 100) : 0;
                                            return (
                                                <tr key={i} className="group hover:bg-gray-50/50 transition-colors">
                                                    <td className="py-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center text-primary">
                                                                <School className="w-4 h-4" />
                                                            </div>
                                                            <div>
                                                                <div className="text-sm font-bold text-foreground">{cls.name}</div>
                                                                <div className="text-[10px] text-muted">{cls.teacher_name}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="py-4 text-sm font-bold text-muted">{cls.total}</td>
                                                    <td className="py-4 text-sm font-bold text-emerald-600">{cls.present}</td>
                                                    <td className="py-4 text-sm font-bold text-rose-500">{cls.absent}</td>
                                                    <td className="py-4 text-sm font-bold text-amber-500">{cls.late}</td>
                                                    <td className="py-4">
                                                        <div className="w-24 bg-gray-100 h-1.5 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full ${rate >= 90 ? 'bg-emerald-500' : rate >= 70 ? 'bg-amber-500' : 'bg-rose-500'}`}
                                                                style={{ width: `${rate}%` }}
                                                            ></div>
                                                        </div>
                                                        <span className="text-[10px] font-bold mt-1 block">{rate}%</span>
                                                    </td>
                                                    <td className="py-4">
                                                        <button className="text-primary hover:text-teal-700 text-xs font-bold transition-colors">Details</button>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="clay-card p-6 animate-fade-up delay-300">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-foreground">Quick Mark (Recent Students)</h3>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {loading ? (
                                <div className="col-span-full py-12 text-center text-muted italic">Loading students...</div>
                            ) : students.length === 0 ? (
                                <div className="col-span-full py-12 text-center text-muted italic">No students found.</div>
                            ) : (
                                students.map((student, i) => (
                                    <div key={i} className="p-4 rounded-2xl bg-white border border-gray-100 shadow-sm flex items-center justify-between group hover:border-teal-200 transition-all">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center text-foreground font-bold text-xs`}>
                                                {student.full_name?.substring(0, 2).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="text-sm font-bold text-foreground">{student.full_name}</div>
                                                <div className="text-[10px] text-muted">{student.id.substring(0, 8)}</div>
                                            </div>
                                        </div>
                                        <div className="flex gap-1.5">
                                            <button
                                                onClick={() => handleMark(student.id, 'present')}
                                                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${attendance[student.id] === 'present' ? 'bg-emerald-500 text-white shadow-lg' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}
                                            >
                                                P
                                            </button>
                                            <button
                                                onClick={() => handleMark(student.id, 'absent')}
                                                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${attendance[student.id] === 'absent' ? 'bg-rose-500 text-white shadow-lg' : 'bg-rose-50 text-rose-600 hover:bg-rose-100'}`}
                                            >
                                                A
                                            </button>
                                            <button
                                                onClick={() => handleMark(student.id, 'late')}
                                                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${attendance[student.id] === 'late' ? 'bg-amber-500 text-white shadow-lg' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'}`}
                                            >
                                                L
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                </main>
            </div>
        </div>
    );
};

export default AttendancePage;
