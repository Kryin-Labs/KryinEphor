import { useMemo } from 'react';
import StudentPortalLayout from '../components/student/StudentPortalLayout';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { ChildSelector } from '../components/dashboard/ChildSelector';
import { GraduationCap } from 'lucide-react';

type Test = {
    id: string;
    exam_date: string | null;
    max_marks: number;
    chapter_name: string | null;
    subject_id: string;
    exam_id: string;
};

type Label = { id: string; name: string };

export default function StudentTests() {
    const { user, linkedStudents, activeStudentId } = useAuth();

    // Authoritatively resolve effective student ID (no raw fallback to user.id)
    const effectiveStudentId = activeStudentId
        ?? linkedStudents.find(s => s.isPrimary)?.studentId
        ?? linkedStudents[0]?.studentId
        ?? null;

    const { data, isLoading: loading } = useQuery({
        queryKey: ['student-tests', effectiveStudentId, user?.schoolId],
        enabled: !!effectiveStudentId && !!user?.schoolId,
        queryFn: async () => {
            // 1. Fetch active class enrollment for the selected child
            const { data: enrollment, error: enrollError } = await supabase
                .from('class_enrollments')
                .select('class_id')
                .eq('student_id', effectiveStudentId!)
                .is('deleted_at', null)
                .order('enrolled_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (enrollError || !enrollment) {
                return { tests: [], subjects: [], exams: [] };
            }

            // 2. Fetch exam subjects for this class
            const { data: testRows, error: testsError } = await supabase
                .from('exam_subjects')
                .select('id,exam_date,max_marks,chapter_name,subject_id,exam_id')
                .eq('school_id', user!.schoolId!)
                .eq('class_id', enrollment.class_id)
                .is('deleted_at', null)
                .order('exam_date');

            if (testsError) throw testsError;
            const rows = (testRows ?? []) as Test[];

            const subjectIds = [...new Set(rows.map(row => row.subject_id))];
            const examIds = [...new Set(rows.map(row => row.exam_id))];

            const [subjectData, examData] = await Promise.all([
                subjectIds.length
                    ? supabase.from('subjects').select('id,name').in('id', subjectIds)
                    : Promise.resolve({ data: [] as Label[] }),
                examIds.length
                    ? supabase.from('exams').select('id,name').in('id', examIds)
                    : Promise.resolve({ data: [] as Label[] })
            ]);

            return {
                tests: rows,
                subjects: (subjectData.data ?? []) as Label[],
                exams: (examData.data ?? []) as Label[]
            };
        }
    });

    const tests = data?.tests ?? [];
    const subjects = data?.subjects ?? [];
    const exams = data?.exams ?? [];

    const today = new Date().toISOString().slice(0, 10);
    const lookup = (items: Label[], id: string) => items.find(item => item.id === id)?.name || 'Test';

    const scheduled = useMemo(() => tests.filter(test => (test.exam_date || '') >= today), [tests, today]);
    const past = useMemo(() => tests.filter(test => (test.exam_date || '') < today), [tests, today]);

    const renderTestList = (items: Test[]) =>
        items.length ? (
            <div className="divide-y divide-border">
                {items.map(test => (
                    <div key={test.id} className="flex items-center justify-between gap-4 px-6 py-4">
                        <div>
                            <p className="font-bold text-foreground">{lookup(exams, test.exam_id)}</p>
                            <p className="mt-1 text-sm text-muted">
                                {lookup(subjects, test.subject_id)}
                                {test.chapter_name ? ` · ${test.chapter_name}` : ''}
                            </p>
                        </div>
                        <div className="text-right text-sm">
                            <p className="font-bold text-foreground">{test.exam_date || 'Date not set'}</p>
                            <p className="mt-1 text-muted">Out of {test.max_marks}</p>
                        </div>
                    </div>
                ))}
            </div>
        ) : (
            <p className="p-6 text-muted">No tests recorded in this category.</p>
        );

    return (
        <StudentPortalLayout title="Tests">
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
                            No student record is linked to this account to view assessments.
                        </p>
                    </div>
                ) : (
                    <>
                        <section className="clay-card p-6 sm:p-8">
                            <p className="text-sm font-bold text-primary">Assessments</p>
                            <h1 className="mt-1 text-3xl font-bold text-foreground">Tests & Exams</h1>
                            <p className="mt-2 text-muted">Keep track of upcoming and completed tests for the selected student.</p>
                        </section>

                        {loading ? (
                            <section className="clay-card p-6 text-muted">Loading tests…</section>
                        ) : (
                            <>
                                <section className="clay-card overflow-hidden">
                                    <div className="border-b border-border px-6 py-4">
                                        <h2 className="font-bold text-foreground">Scheduled Tests</h2>
                                    </div>
                                    {renderTestList(scheduled)}
                                </section>

                                <section className="clay-card overflow-hidden">
                                    <div className="border-b border-border px-6 py-4">
                                        <h2 className="font-bold text-foreground">Past Tests</h2>
                                    </div>
                                    {renderTestList(past)}
                                </section>
                            </>
                        )}
                    </>
                )}
            </div>
        </StudentPortalLayout>
    );
}
