import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Search, X, Mail, BookOpen, GraduationCap, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSchoolTeachers } from '../../hooks/queries';
import { supabase } from '../../lib/supabase';
import { getRoleStyle } from '../../config/roles';
import { useAuth } from '../../context/AuthContext';

interface Props {
    open: boolean;
    onClose: () => void;
    schoolId: string;
    canManage?: boolean;
}

const AllTeachersModal: React.FC<Props> = ({ open, onClose, schoolId, canManage }) => {
    const navigate = useNavigate();
    const { user: currentUser } = useAuth();
    const [search, setSearch] = useState('');

    const { data: teachers = [], isLoading: teachersLoading } = useSchoolTeachers(open ? schoolId : null);

    // Fetch classes and subject assignments to show teaching workload
    const { data: assignmentsData } = useQuery({
        queryKey: ['school_teacher_assignments', schoolId],
        enabled: open && !!schoolId,
        queryFn: async () => {
            const [classesRes, subjectTeachersRes] = await Promise.all([
                supabase
                    .from('classes')
                    .select('id, name, section, grade_level, teacher_id')
                    .eq('school_id', schoolId)
                    .is('deleted_at', null),
                supabase
                    .from('subject_teachers')
                    .select('id, teacher_id, subject_id, class_id, subjects:subject_id(name, code), classes:class_id(name, section)')
                    .eq('school_id', schoolId),
            ]);

            const classTeacherMap = new Map<string, string[]>();
            (classesRes.data ?? []).forEach(c => {
                if (c.teacher_id) {
                    if (!classTeacherMap.has(c.teacher_id)) classTeacherMap.set(c.teacher_id, []);
                    classTeacherMap.get(c.teacher_id)!.push(c.name || `Grade ${c.grade_level || ''} ${c.section || ''}`.trim());
                }
            });

            const subjectsMap = new Map<string, { subject: string; classNames: string[] }[]>();
            (subjectTeachersRes.data ?? []).forEach((st) => {
                if (!st.teacher_id) return;
                const subObj = st.subjects as unknown as { name?: string; code?: string | null } | null;
                const classObj = st.classes as unknown as { name?: string; section?: string | null } | null;
                const subName = subObj?.name || 'Subject';
                const className = classObj?.name || (classObj?.section ? `Section ${classObj.section}` : '');

                if (!subjectsMap.has(st.teacher_id)) subjectsMap.set(st.teacher_id, []);
                const list = subjectsMap.get(st.teacher_id)!;
                let existing = list.find(item => item.subject === subName);
                if (!existing) {
                    existing = { subject: subName, classNames: [] };
                    list.push(existing);
                }
                if (className && !existing.classNames.includes(className)) {
                    existing.classNames.push(className);
                }
            });

            return {
                classTeacherMap,
                subjectsMap,
            };
        },
    });

    const filteredTeachers = useMemo(() => {
        const q = search.toLowerCase().trim();
        if (!q) return teachers;
        return teachers.filter(t =>
            (t.full_name || '').toLowerCase().includes(q) ||
            (t.email || '').toLowerCase().includes(q) ||
            (t.role || '').toLowerCase().includes(q) ||
            (t.roles || []).some(r => r.toLowerCase().includes(q))
        );
    }, [teachers, search]);

    if (!open) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[85] flex items-center justify-center p-3 sm:p-4">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-stone-950/45 backdrop-blur-xs"
                    onClick={onClose}
                />

                <motion.div
                    initial={{ scale: 0.95, opacity: 0, y: 16 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.95, opacity: 0, y: 16 }}
                    transition={{ type: 'spring', damping: 24, stiffness: 280 }}
                    className="relative w-full max-w-3xl rounded-3xl bg-[#FAF9F6] border border-stone-200/80 shadow-2xl flex flex-col max-h-[88vh] overflow-hidden"
                    onClick={e => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="p-5 sm:p-6 border-b border-stone-200 bg-white/60 flex items-start justify-between gap-4 shrink-0">
                        <div className="flex items-center gap-3.5">
                            <div className="w-12 h-12 rounded-2xl bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-600 shadow-sm shrink-0">
                                <Users className="w-6 h-6" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h2 className="text-xl font-black text-foreground tracking-tight">All Teachers</h2>
                                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-700 tracking-wide">
                                        {teachers.length} {teachers.length === 1 ? 'Teacher' : 'Teachers'}
                                    </span>
                                </div>
                                <p className="text-xs text-muted mt-0.5">
                                    Directory of all educators and multi-role staff with teacher access in this school.
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={onClose}
                            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors shrink-0"
                            aria-label="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Toolbar */}
                    <div className="p-4 sm:px-6 border-b border-stone-200/60 bg-stone-50/60 flex items-center gap-3 flex-wrap shrink-0">
                        <div className="relative flex-1 min-w-[220px]">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                            <input
                                autoFocus
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search by name, email, or role tag..."
                                className="clay-input w-full pl-9 pr-3 py-2 rounded-xl border border-stone-200 text-sm bg-white"
                            />
                        </div>

                        {canManage && (
                            <button
                                onClick={() => {
                                    onClose();
                                    navigate('/users?newUser=teacher');
                                }}
                                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-primary text-white text-xs font-bold shadow-sm hover:opacity-95 transition-all shrink-0"
                            >
                                <UserPlus className="w-4 h-4" /> Add Teacher
                            </button>
                        )}
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
                        {teachersLoading ? (
                            <div className="py-20 text-center text-muted flex flex-col items-center justify-center gap-2">
                                <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                                <span className="text-xs font-semibold">Loading teachers directory...</span>
                            </div>
                        ) : filteredTeachers.length === 0 ? (
                            <div className="p-12 text-center text-muted clay-card bg-white/40">
                                <div className="w-12 h-12 rounded-2xl bg-stone-100 text-stone-400 mx-auto flex items-center justify-center mb-3">
                                    <Users className="w-6 h-6" />
                                </div>
                                <p className="text-sm font-bold text-foreground">No teachers found</p>
                                <p className="text-xs text-muted mt-1">
                                    {search ? `No teacher matching "${search}"` : 'No teachers found in this school.'}
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {filteredTeachers.map((teacher) => {
                                    const isCurrentUser = currentUser?.id === teacher.id;
                                    const classTeacherOf = assignmentsData?.classTeacherMap?.get(teacher.id) || [];
                                    const subjectsTaught = assignmentsData?.subjectsMap?.get(teacher.id) || [];
                                    const allRoles = (teacher.roles && teacher.roles.length > 0 ? teacher.roles : [teacher.role]).filter(r => r !== 'student');

                                    return (
                                        <div
                                            key={teacher.id}
                                            className="clay-card p-4 bg-white/80 border border-stone-200/70 hover:border-sky-300 hover:shadow-md transition-all flex flex-col justify-between"
                                        >
                                            <div>
                                                {/* Card Header: Avatar, Name & Roles */}
                                                <div className="flex items-start gap-3">
                                                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 text-white flex items-center justify-center font-bold text-sm shadow-sm shrink-0">
                                                        {teacher.avatar_url ? (
                                                            <img
                                                                src={teacher.avatar_url}
                                                                alt={teacher.full_name || 'Teacher'}
                                                                className="w-full h-full object-cover rounded-2xl"
                                                            />
                                                        ) : (
                                                            (teacher.full_name || 'T').substring(0, 2).toUpperCase()
                                                        )}
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <h3 className="font-bold text-sm text-foreground truncate">
                                                                {teacher.full_name || 'Anonymous User'}
                                                            </h3>
                                                            {isCurrentUser && (
                                                                <span className="text-[10px] font-extrabold text-primary bg-primary/10 px-1.5 py-0.5 rounded-md">
                                                                    YOU
                                                                </span>
                                                            )}
                                                        </div>

                                                        <p className="text-xs text-muted truncate flex items-center gap-1 mt-0.5">
                                                            <Mail className="w-3 h-3 text-stone-400 shrink-0" />
                                                            <span className="truncate">{teacher.email}</span>
                                                        </p>

                                                        {/* Role badges (handles multi-role users properly) */}
                                                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                                            {allRoles.map((r) => {
                                                                const rStyle = getRoleStyle(r);
                                                                return (
                                                                    <span
                                                                        key={r}
                                                                        className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest ${rStyle.bg} ${rStyle.color}`}
                                                                    >
                                                                        {rStyle.label}
                                                                    </span>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Class Teacher assignment badge */}
                                                {classTeacherOf.length > 0 && (
                                                    <div className="mt-3 p-2 rounded-xl bg-amber-50/80 border border-amber-200/60 flex items-center gap-2">
                                                        <GraduationCap className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                                        <span className="text-[11px] font-bold text-amber-800 truncate">
                                                            Class Teacher: {classTeacherOf.join(', ')}
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Subjects workload */}
                                                <div className="mt-2.5">
                                                    {subjectsTaught.length > 0 ? (
                                                        <div className="flex flex-wrap gap-1">
                                                            {subjectsTaught.map((item, idx) => (
                                                                <span
                                                                    key={idx}
                                                                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-stone-100 text-stone-700"
                                                                >
                                                                    <BookOpen className="w-2.5 h-2.5 text-stone-400" />
                                                                    {item.subject}
                                                                    {item.classNames.length > 0 && (
                                                                        <span className="text-[9px] text-stone-500 font-normal">
                                                                            ({item.classNames.join(', ')})
                                                                        </span>
                                                                    )}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <p className="text-[11px] text-stone-400 italic">
                                                            No subject assignments yet
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="p-4 sm:px-6 border-t border-stone-200 bg-white/70 flex items-center justify-between gap-4 shrink-0">
                        <span className="text-xs text-muted font-medium">
                            Showing {filteredTeachers.length} of {teachers.length} teachers
                        </span>

                        <button
                            onClick={onClose}
                            className="clay-btn px-4 py-1.5 text-xs font-bold rounded-xl"
                        >
                            Close
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default AllTeachersModal;
