// Central query-key factories so cache invalidation is consistent.
export const qk = {
    classes: {
        all: ['classes'] as const,
        list: (schoolId: string | null | undefined, filters?: Record<string, unknown>) =>
            ['classes', 'list', schoolId, filters ?? {}] as const,
        detail: (classId: string) => ['classes', 'detail', classId] as const,
        overview: (classId: string) => ['classes', 'overview', classId] as const,
        roster: (classId: string, page: number, pageSize: number) =>
            ['classes', 'roster', classId, page, pageSize] as const,
        teachers: (classId: string) => ['classes', 'teachers', classId] as const,
        attendance: (classId: string, date: string) => ['classes', 'attendance', classId, date] as const,
        feesCoverage: (classId: string) => ['classes', 'fees-coverage', classId] as const,
    },
    students: {
        bySchool: (schoolId: string, search: string, page: number, pageSize: number) =>
            ['students', schoolId, search, page, pageSize] as const,
        unassigned: (schoolId: string, classId: string, search: string) =>
            ['students', 'unassigned', schoolId, classId, search] as const,
    },
    teachers: {
        bySchool: (schoolId: string) => ['teachers', schoolId] as const,
    },
    subjects: {
        bySchool: (schoolId: string) => ['subjects', schoolId] as const,
    },
    feePlans: {
        bySchool: (schoolId: string) => ['fee_plans', schoolId] as const,
    },
    academicYears: {
        bySchool: (schoolId: string) => ['academic_years', schoolId] as const,
    },
};
