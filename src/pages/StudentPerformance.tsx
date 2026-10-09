import { useMemo } from 'react';
import StudentPortalLayout from '../components/student/StudentPortalLayout';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { ChildSelector } from '../components/dashboard/ChildSelector';
import { GraduationCap, AlertCircle } from 'lucide-react';

type Result = {
    exam_subject_id: string;
    exam_name: string;
    subject_name: string;
    chapter_name: string | null;
    exam_date: string | null;
    max_marks: number;
    your_score: number | null;
    class_average: number | null;
};

const pct = (score: number | null, max: number) =>
    max > 0 && score !== null ? Math.round((Number(score) / Number(max)) * 100) : 0;

export default function StudentPerformance() {
    const { user, role, linkedStudents, activeStudentId } = useAuth();

    // Authoritatively resolve effective student ID
    const currentPersona = linkedStudents.find(s => s.studentId === activeStudentId)
        ?? (role === 'student' ? linkedStudents.find(s => s.studentId === user?.id || s.relationship === 'self_student') : null)
        ?? linkedStudents.find(s => s.isPrimary)
        ?? linkedStudents[0]
        ?? null;

    const effectiveStudentId = currentPersona?.studentId
        ?? (role === 'student' ? user?.id : null);

    // Verify if student is enrolled in a class (Case B check)
    const { data: isEnrolled = true, isLoading: checkingEnrollment } = useQuery({
        queryKey: ['student-enrollment-check', effectiveStudentId],
        enabled: !!effectiveStudentId,
        queryFn: async () => {
            if (currentPersona?.className) return true;
            const { count, error } = await supabase
                .from('class_enrollments')
                .select('id', { count: 'exact', head: true })
                .eq('student_id', effectiveStudentId!)
                .eq('status', 'active')
                .is('deleted_at', null);
            if (error) return false;
            return (count ?? 0) > 0;
        }
    });

    const { data: rows = [], isLoading: loading } = useQuery({
        queryKey: ['student-performance', effectiveStudentId],
        enabled: !!effectiveStudentId && isEnrolled,
        queryFn: async () => {
            const { data, error } = await supabase.rpc('fn_student_performance_summary', {
                target_student_id: effectiveStudentId!
            });
            if (error) throw error;
            return (data ?? []) as Result[];
        }
    });

    const subjects = useMemo(() =>
        Object.values(
            rows.reduce<Record<string, { name: string; your: number[]; average: number[] }>>((all, row) => {
                const item = all[row.subject_name] ?? { name: row.subject_name, your: [], average: [] };
                item.your.push(pct(row.your_score, row.max_marks));
                item.average.push(pct(row.class_average, row.max_marks));
                all[row.subject_name] = item;
                return all;
            }, {})
        ).map(item => ({
            name: item.name,
            your: Math.round(item.your.reduce((a, b) => a + b, 0) / item.your.length),
            average: Math.round(item.average.reduce((a, b) => a + b, 0) / item.average.length)
        })),
        [rows]
    );

    const points = rows
        .slice()
        .reverse()
        .map((row, index) =>
            `${rows.length < 2 ? 50 : index * (100 / (rows.length - 1))},${100 - pct(row.your_score, row.max_marks)}`
        )
        .join(' ');

    return (
        <StudentPortalLayout title="Performance">
            <div className="space-y-7">
                {/* Child selector for multi-child accounts */}
                <div className="flex items-center justify-between">
                    <ChildSelector />
                </div>

                {!effectiveStudentId ? (
                    /* Case D: Missing student record setup */
                    <div className="clay-card p-10 text-center text-stone-500 rounded-3xl">
                        <GraduationCap className="w-12 h-12 mx-auto text-stone-300 mb-3" />
                        <h3 className="text-lg font-bold text-foreground">
                            {role === 'student' ? 'Student Profile Incomplete' : 'No Student Profile Selected'}
                        </h3>
                        <p className="text-sm text-muted mt-1 max-w-md mx-auto">
                            {role === 'student'
                                ? 'Your student account is not associated with an active student record. Please contact your school administrator to complete your student profile setup.'
                                : 'No student record is linked to this account to view academic performance.'}
                        </p>
                    </div>
                ) : checkingEnrollment ? (
                    <section className="clay-card p-8 text-center text-muted">Checking student enrollment status…</section>
                ) : !isEnrolled ? (
                    /* Case B: Student exists but has no class assigned */
                    <div className="clay-card p-10 text-center text-stone-500 rounded-3xl border border-amber-200/50 bg-amber-50/20">
                        <AlertCircle className="w-12 h-12 mx-auto text-amber-500 mb-3" />
                        <h3 className="text-lg font-bold text-foreground">Class Assignment Pending</h3>
                        <p className="text-sm text-muted mt-1 max-w-md mx-auto">
                            Your student account is not yet linked to a class. Please contact your school administrator to complete your class assignment.
                        </p>
                    </div>
                ) : (
                    /* Case A & C: Student exists and has a class */
                    <>
                        <section className="clay-card p-6 sm:p-8">
                            <p className="text-sm font-bold text-primary">Learning progress</p>
                            <h1 className="mt-1 text-3xl font-bold text-foreground">Academic Performance</h1>
                            <p className="mt-2 text-muted">Assessment scores compared with class average for the selected student.</p>
                        </section>

                        {loading ? (
                            <section className="clay-card p-6 text-muted">Loading performance…</section>
                        ) : rows.length === 0 ? (
                            /* Case C: Class assigned, but no performance records published yet */
                            <section className="clay-card p-8 text-center text-muted">
                                <p className="text-base font-semibold text-stone-700">No performance records available yet.</p>
                                <p className="text-sm text-stone-500 mt-1">Assessment marks will appear here once published by your teachers.</p>
                            </section>
                        ) : (
                            <>
                                <section className="clay-card p-6">
                                    <div className="mb-5">
                                        <h2 className="font-bold text-foreground">Marks trend</h2>
                                        <p className="mt-1 text-sm text-muted">Percentage across recorded assessments.</p>
                                    </div>
                                    <div className="h-44 rounded-2xl bg-teal-50/60 p-4">
                                        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
                                            <polyline
                                                points={points}
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2.5"
                                                vectorEffect="non-scaling-stroke"
                                                className="text-primary"
                                            />
                                        </svg>
                                    </div>
                                </section>

                                <section className="clay-card overflow-hidden">
                                    <div className="border-b border-border px-6 py-4">
                                        <h2 className="font-bold text-foreground">Subject scores</h2>
                                    </div>
                                    <div className="divide-y divide-border">
                                        {subjects.map(subject => (
                                            <div key={subject.name} className="px-6 py-4">
                                                <div className="flex justify-between gap-4 text-sm">
                                                    <p className="font-bold text-foreground">{subject.name}</p>
                                                    <p className="text-muted">Student: {subject.your}% · Class Avg: {subject.average}%</p>
                                                </div>
                                                <div className="mt-3 grid gap-2">
                                                    <div className="h-2 rounded-full bg-stone-100">
                                                        <div className="h-full rounded-full bg-primary" style={{ width: `${subject.your}%` }} />
                                                    </div>
                                                    <div className="h-1.5 rounded-full bg-stone-100">
                                                        <div className="h-full rounded-full bg-stone-400" style={{ width: `${subject.average}%` }} />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            </>
                        )}
                    </>
                )}
            </div>
        </StudentPortalLayout>
    );
}
