import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, AlertCircle, Loader2, GraduationCap, BookOpen, UserPlus, X, Users, Library } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { qk } from '../lib/queryKeys';
import ClassCard from '../components/classes/ClassCard';
import ClassFormModal from '../components/classes/ClassFormModal';
import ClassDetailDrawer from '../components/classes/ClassDetailDrawer';
import AllTeachersModal from '../components/classes/AllTeachersModal';
import AllSubjectsModal from '../components/classes/AllSubjectsModal';

interface ClassRow {
    id: string;
    name: string;
    section: string | null;
    grade_level: string | null;
    room_number: string | null;
    capacity: number | null;
    teacher_id: string | null;
    academic_year_id: string | null;
    // joined
    teacher?: { full_name: string | null } | null;
}

const Classes: React.FC = () => {
    const { user, roles, role } = useAuth();
    const schoolId = user?.schoolId ?? null;
    const isElevatedAdmin = roles.includes('admin') || roles.includes('superadmin');
    const canEdit = isElevatedAdmin;
    const canQuickCreate = roles.includes('admin');
    const navigate = useNavigate();

    const [search, setSearch] = useState('');
    const [grade, setGrade] = useState<string>('');
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<ClassRow | null>(null);
    const [selected, setSelected] = useState<ClassRow | null>(null);
    const [subjectOpen, setSubjectOpen] = useState(false);
    const [subjectName, setSubjectName] = useState('');
    const [subjectCode, setSubjectCode] = useState('');
    const [subjectSaving, setSubjectSaving] = useState(false);
    const [allTeachersOpen, setAllTeachersOpen] = useState(false);
    const [allSubjectsOpen, setAllSubjectsOpen] = useState(false);

    const createSubject = async () => {
        if (!schoolId || !subjectName.trim()) return;
        setSubjectSaving(true);
        const { error } = await supabase.from('subjects').insert({
            school_id: schoolId,
            name: subjectName.trim(),
            code: subjectCode.trim() || null,
            created_by: user?.id ?? null,
        });
        setSubjectSaving(false);
        if (!error) {
            setSubjectName('');
            setSubjectCode('');
            setSubjectOpen(false);
        }
    };

    const { data: classes = [], isLoading } = useQuery({
        queryKey: qk.classes.list(schoolId, { role }),
        enabled: !!schoolId,
        queryFn: async () => {
            let query = supabase
                .from('classes')
                .select('id, name, section, grade_level, room_number, capacity, teacher_id, academic_year_id, teacher:teacher_id(full_name)')
                .eq('school_id', schoolId!)
                .is('deleted_at', null)
                .order('grade_level', { ascending: true })
                .order('section', { ascending: true });
            // Phase 15: Authoritative role check - non-admins are strictly scoped to their assigned classes
            if (!isElevatedAdmin || role === 'teacher') query = query.eq('teacher_id', user!.id);
            const { data, error } = await query;
            if (error) throw error;
            return (data ?? []) as unknown as ClassRow[];
        },
    });

    const filtered = useMemo(() => {
        return classes.filter(c => {
            if (grade && (c.grade_level ?? '') !== grade) return false;
            if (search) {
                const q = search.toLowerCase();
                return c.name.toLowerCase().includes(q) || (c.section ?? '').toLowerCase().includes(q) || (c.grade_level ?? '').toLowerCase().includes(q);
            }
            return true;
        });
    }, [classes, search, grade]);

    const grades = useMemo(() => Array.from(new Set(classes.map(c => c.grade_level).filter(Boolean))) as string[], [classes]);

    if (!schoolId) {
        return (
            <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center p-6">
                <div className="clay-card p-8 max-w-md text-center">
                    <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
                    <h3 className="text-lg font-bold">No school linked to your account</h3>
                    <p className="text-sm text-muted mt-2">Contact your administrator.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen bg-background relative selection:bg-teal-100 selection:text-primary">
            <Sidebar activePage="Classes" />
            <div className="flex-1 lg:ml-72 flex flex-col min-h-screen min-w-0 transition-[margin] duration-300 ease-out">
                <Header title="Classes" />
                <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 overflow-x-hidden overflow-y-auto pb-24 min-w-0">
                    <div className="clay-card p-4 flex items-center gap-3 flex-wrap">
                        <div className="relative flex-1 min-w-[200px]">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search classes…" className="clay-input w-full pl-10 pr-3 py-2 rounded-xl border border-stone-200 text-sm" />
                        </div>
                        {grades.length > 0 && (
                            <select value={grade} onChange={(e) => setGrade(e.target.value)} className="clay-input px-3 py-2 rounded-xl border border-stone-200 bg-white text-sm">
                                <option value="">All classes</option>
                                {grades.map(g => <option key={g} value={g}>Class {g}</option>)}

                            </select>
                        )}
                        {canEdit && (
                            <button onClick={() => { setEditing(null); setFormOpen(true); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold shadow-md hover:opacity-90">
                                <Plus className="w-4 h-4" /> New class
                            </button>
                        )}
                        {canQuickCreate && (
                            <>
                                <button onClick={() => setSubjectOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-stone-200 bg-white text-sm font-bold text-foreground hover:border-primary/30 hover:text-primary transition-colors">
                                    <BookOpen className="w-4 h-4" /> New subject
                                </button>
                                <button onClick={() => navigate('/users?newUser=teacher')} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-stone-200 bg-white text-sm font-bold text-foreground hover:border-primary/30 hover:text-primary transition-colors">
                                    <UserPlus className="w-4 h-4" /> New teacher
                                </button>
                            </>
                        )}
                        <button onClick={() => setAllTeachersOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-stone-200 bg-white text-sm font-bold text-foreground hover:border-primary/30 hover:text-primary transition-colors">
                            <Users className="w-4 h-4 text-sky-600" /> All Teachers
                        </button>
                        <button onClick={() => setAllSubjectsOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-stone-200 bg-white text-sm font-bold text-foreground hover:border-primary/30 hover:text-primary transition-colors">
                            <Library className="w-4 h-4 text-emerald-600" /> All Subjects
                        </button>
                    </div>

                    {isLoading ? (
                        <div className="flex items-center justify-center py-20 text-muted"><Loader2 className="w-6 h-6 animate-spin" /></div>
                    ) : filtered.length === 0 ? (
                        <div className="clay-card p-12 text-center">
                            <div className="mx-auto w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center text-stone-400 mb-3">
                                <GraduationCap className="w-6 h-6" />
                            </div>
                            <p className="text-sm font-bold">No classes yet</p>
                            <p className="text-xs text-muted mt-1">{canEdit ? 'Create your first class to get started.' : 'Ask an admin to create classes.'}</p>
                        </div>
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            {filtered.map(c => (
                                <ClassCard key={c.id} klass={c} teacherName={c.teacher?.full_name} onOpen={() => setSelected(c)} />
                            ))}
                        </div>
                    )}
                </main>
            </div>

            <ClassFormModal open={formOpen} onClose={() => { setFormOpen(false); if (editing) setSelected(editing); }} schoolId={schoolId} editing={editing} />

            {subjectOpen && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="new-subject-title">
                    <button className="absolute inset-0 bg-stone-950/40" aria-label="Close" onClick={() => setSubjectOpen(false)} />
                    <div className="relative w-full max-w-md rounded-2xl bg-[#FAF9F6] p-6 shadow-2xl">
                        <div className="flex items-center justify-between gap-4 mb-5">
                            <div><h2 id="new-subject-title" className="text-xl font-bold">New Subject</h2><p className="text-xs text-muted mt-1">Add it now, then assign it from the class Teachers menu.</p></div>
                            <button onClick={() => setSubjectOpen(false)} className="p-2 rounded-lg text-muted hover:bg-stone-100" aria-label="Close"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="space-y-4">
                            <label className="block text-sm font-semibold">Subject name<input autoFocus value={subjectName} onChange={e => setSubjectName(e.target.value)} className="clay-input mt-1.5 w-full" placeholder="e.g. Mathematics" /></label>
                            <label className="block text-sm font-semibold">Code <span className="font-normal text-muted">(optional)</span><input value={subjectCode} onChange={e => setSubjectCode(e.target.value)} className="clay-input mt-1.5 w-full" placeholder="e.g. MATH" /></label>
                            <button onClick={createSubject} disabled={!subjectName.trim() || subjectSaving} className="clay-btn w-full py-2.5 disabled:opacity-50">{subjectSaving ? 'Creating…' : 'Create Subject'}</button>
                        </div>
                    </div>
                </div>
            )}

            {selected && (
                <ClassDetailDrawer
                    open={!!selected}
                    onClose={() => setSelected(null)}
                    klass={selected}
                    schoolId={schoolId}
                    teacherName={selected.teacher?.full_name}
                    canEdit={canEdit}
                    onEdit={() => { setEditing(selected); setSelected(null); setFormOpen(true); }}
                />
            )}

            {schoolId && (
                <>
                    <AllTeachersModal
                        open={allTeachersOpen}
                        onClose={() => setAllTeachersOpen(false)}
                        schoolId={schoolId}
                        canManage={canQuickCreate || canEdit}
                    />
                    <AllSubjectsModal
                        open={allSubjectsOpen}
                        onClose={() => setAllSubjectsOpen(false)}
                        schoolId={schoolId}
                        canEdit={canEdit}
                    />
                </>
            )}
        </div>
    );
};

export default Classes;
