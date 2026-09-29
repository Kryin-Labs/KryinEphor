import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Search, X, Plus, GraduationCap, Users, Check } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { qk } from '../../lib/queryKeys';
import { toast } from 'sonner';

interface Props {
    open: boolean;
    onClose: () => void;
    schoolId: string;
    canEdit?: boolean;
}

interface SubjectItem {
    id: string;
    name: string;
    code: string | null;
    description: string | null;
    credits: number | null;
    created_at: string | null;
}

const AllSubjectsModal: React.FC<Props> = ({ open, onClose, schoolId, canEdit }) => {
    const qc = useQueryClient();
    const [search, setSearch] = useState('');
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState('');
    const [newCode, setNewCode] = useState('');
    const [newCredits, setNewCredits] = useState('');

    // Fetch subjects
    const { data: subjects = [], isLoading: subjectsLoading } = useQuery({
        queryKey: qk.subjects.bySchool(schoolId),
        enabled: open && !!schoolId,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('subjects')
                .select('id, name, code, description, credits, created_at')
                .eq('school_id', schoolId)
                .is('deleted_at', null)
                .order('name');
            if (error) throw error;
            return (data ?? []) as SubjectItem[];
        },
    });

    // Fetch subject-teacher-class assignments
    const { data: assignmentsMap } = useQuery({
        queryKey: ['school_subject_assignments', schoolId],
        enabled: open && !!schoolId,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('subject_teachers')
                .select('id, subject_id, class_id, teacher_id, classes:class_id(name, section), profiles:teacher_id(full_name)')
                .eq('school_id', schoolId);
            if (error) throw error;

            const map = new Map<string, { classNames: string[]; teacherNames: string[] }>();
            (data ?? []).forEach((row) => {
                if (!row.subject_id) return;
                const classObj = row.classes as unknown as { name?: string; section?: string | null } | null;
                const teacherObj = row.profiles as unknown as { full_name?: string | null } | null;
                const className = classObj?.name || (classObj?.section ? `Section ${classObj.section}` : 'Class');
                const teacherName = teacherObj?.full_name;

                if (!map.has(row.subject_id)) {
                    map.set(row.subject_id, { classNames: [], teacherNames: [] });
                }
                const entry = map.get(row.subject_id)!;
                if (className && !entry.classNames.includes(className)) {
                    entry.classNames.push(className);
                }
                if (teacherName && !entry.teacherNames.includes(teacherName)) {
                    entry.teacherNames.push(teacherName);
                }
            });

            return map;
        },
    });

    // Create subject mutation
    const createMutation = useMutation({
        mutationFn: async () => {
            if (!newName.trim()) throw new Error('Subject name is required');
            const { error } = await supabase.from('subjects').insert({
                school_id: schoolId,
                name: newName.trim(),
                code: newCode.trim().toUpperCase() || null,
                credits: newCredits ? Number(newCredits) : null,
            });
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('Subject created successfully');
            qc.invalidateQueries({ queryKey: qk.subjects.bySchool(schoolId) });
            setNewName('');
            setNewCode('');
            setNewCredits('');
            setShowCreate(false);
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to create subject');
        },
    });

    const filteredSubjects = useMemo(() => {
        const q = search.toLowerCase().trim();
        if (!q) return subjects;
        return subjects.filter(s =>
            s.name.toLowerCase().includes(q) ||
            (s.code || '').toLowerCase().includes(q)
        );
    }, [subjects, search]);

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
                            <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm shrink-0">
                                <BookOpen className="w-6 h-6" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h2 className="text-xl font-black text-foreground tracking-tight">All Subjects</h2>
                                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 tracking-wide">
                                        {subjects.length} {subjects.length === 1 ? 'Subject' : 'Subjects'}
                                    </span>
                                </div>
                                <p className="text-xs text-muted mt-0.5">
                                    Curriculum subjects taught across classes in this school.
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
                                placeholder="Search by subject name or code..."
                                className="clay-input w-full pl-9 pr-3 py-2 rounded-xl border border-stone-200 text-sm bg-white"
                            />
                        </div>

                        {canEdit && (
                            <button
                                onClick={() => setShowCreate(!showCreate)}
                                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm transition-all shrink-0 ${
                                    showCreate
                                        ? 'bg-stone-200 text-stone-800'
                                        : 'bg-primary text-white hover:opacity-95'
                                }`}
                            >
                                <Plus className={`w-4 h-4 transition-transform ${showCreate ? 'rotate-45' : ''}`} />
                                {showCreate ? 'Cancel' : 'New Subject'}
                            </button>
                        )}
                    </div>

                    {/* Quick Create Form Drawer/Bar */}
                    <AnimatePresence>
                        {showCreate && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden border-b border-emerald-100 bg-emerald-50/50 px-4 sm:px-6 py-4 shrink-0"
                            >
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-3">
                                    <div>
                                        <label className="text-[11px] font-bold text-emerald-900 block mb-1">
                                            Subject Name *
                                        </label>
                                        <input
                                            autoFocus
                                            value={newName}
                                            onChange={e => setNewName(e.target.value)}
                                            placeholder="e.g. Mathematics"
                                            className="clay-input w-full px-3 py-1.5 rounded-lg border border-emerald-200 bg-white text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] font-bold text-emerald-900 block mb-1">
                                            Code <span className="font-normal text-muted">(optional)</span>
                                        </label>
                                        <input
                                            value={newCode}
                                            onChange={e => setNewCode(e.target.value.toUpperCase())}
                                            placeholder="e.g. MATH10"
                                            className="clay-input w-full px-3 py-1.5 rounded-lg border border-emerald-200 bg-white text-sm uppercase"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] font-bold text-emerald-900 block mb-1">
                                            Credits <span className="font-normal text-muted">(optional)</span>
                                        </label>
                                        <input
                                            type="number"
                                            min={0}
                                            value={newCredits}
                                            onChange={e => setNewCredits(e.target.value)}
                                            placeholder="e.g. 4"
                                            className="clay-input w-full px-3 py-1.5 rounded-lg border border-emerald-200 bg-white text-sm"
                                        />
                                    </div>
                                </div>
                                <div className="flex justify-end gap-2">
                                    <button
                                        onClick={() => setShowCreate(false)}
                                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-stone-600 hover:bg-stone-200/60 transition"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => createMutation.mutate()}
                                        disabled={!newName.trim() || createMutation.isPending}
                                        className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition"
                                    >
                                        <Check className="w-3.5 h-3.5" />
                                        {createMutation.isPending ? 'Saving...' : 'Save Subject'}
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
                        {subjectsLoading ? (
                            <div className="py-20 text-center text-muted flex flex-col items-center justify-center gap-2">
                                <div className="w-8 h-8 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin" />
                                <span className="text-xs font-semibold">Loading curriculum subjects...</span>
                            </div>
                        ) : filteredSubjects.length === 0 ? (
                            <div className="p-12 text-center text-muted clay-card bg-white/40">
                                <div className="w-12 h-12 rounded-2xl bg-stone-100 text-stone-400 mx-auto flex items-center justify-center mb-3">
                                    <BookOpen className="w-6 h-6" />
                                </div>
                                <p className="text-sm font-bold text-foreground">No subjects found</p>
                                <p className="text-xs text-muted mt-1">
                                    {search
                                        ? `No subject matching "${search}"`
                                        : 'No subjects have been configured yet for this school.'}
                                </p>
                                {canEdit && !search && (
                                    <button
                                        onClick={() => setShowCreate(true)}
                                        className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold"
                                    >
                                        <Plus className="w-4 h-4" /> Create First Subject
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {filteredSubjects.map((subject) => {
                                    const assignmentInfo = assignmentsMap?.get(subject.id);
                                    const classNames = assignmentInfo?.classNames ?? [];
                                    const teacherNames = assignmentInfo?.teacherNames ?? [];

                                    return (
                                        <div
                                            key={subject.id}
                                            className="clay-card p-4 bg-white/80 border border-stone-200/70 hover:border-emerald-300 hover:shadow-md transition-all flex flex-col justify-between"
                                        >
                                            <div>
                                                {/* Header: Code Pill & Title */}
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            {subject.code ? (
                                                                <span className="text-[10px] font-black tracking-wider px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200/60 uppercase">
                                                                    {subject.code}
                                                                </span>
                                                            ) : (
                                                                <span className="text-[10px] font-semibold tracking-wider px-2 py-0.5 rounded-lg bg-stone-100 text-stone-600">
                                                                    SUBJECT
                                                                </span>
                                                            )}
                                                            <h3 className="font-bold text-sm text-foreground truncate">
                                                                {subject.name}
                                                            </h3>
                                                        </div>

                                                        {subject.description && (
                                                            <p className="text-xs text-muted mt-1 line-clamp-2">
                                                                {subject.description}
                                                            </p>
                                                        )}
                                                    </div>

                                                    {subject.credits !== null && subject.credits !== undefined && (
                                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-stone-100 text-stone-600 shrink-0">
                                                            {subject.credits} {subject.credits === 1 ? 'Credit' : 'Credits'}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Classes info */}
                                                <div className="mt-3.5 space-y-1.5 text-xs">
                                                    <div className="flex items-center gap-1.5 text-stone-700">
                                                        <GraduationCap className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                                        {classNames.length > 0 ? (
                                                            <span className="font-medium text-[11px] truncate">
                                                                Taught in: <strong className="text-stone-900">{classNames.join(', ')}</strong>
                                                            </span>
                                                        ) : (
                                                            <span className="text-stone-400 italic text-[11px]">
                                                                Not assigned to any class yet
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Teachers assigned */}
                                                    <div className="flex items-center gap-1.5 text-stone-700">
                                                        <Users className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                                                        {teacherNames.length > 0 ? (
                                                            <span className="font-medium text-[11px] truncate">
                                                                Faculty: <strong className="text-stone-900">{teacherNames.join(', ')}</strong>
                                                            </span>
                                                        ) : (
                                                            <span className="text-stone-400 italic text-[11px]">
                                                                No faculty assigned
                                                            </span>
                                                        )}
                                                    </div>
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
                            Showing {filteredSubjects.length} of {subjects.length} subjects
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

export default AllSubjectsModal;
