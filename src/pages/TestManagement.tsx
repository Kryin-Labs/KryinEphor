import { useEffect, useState } from 'react';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

type Item = { id: string; name: string; class_id?: string | null }; type SelectedSubject = { id: string; chapter: string };
export default function TestManagement() {
  const { user, roles, role } = useAuth();
  const [classes, setClasses] = useState<Item[]>([]);
  const [subjects, setSubjects] = useState<Item[]>([]);
  const [classId, setClassId] = useState('');
  const [selected, setSelected] = useState<SelectedSubject[]>([]);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [maxMarks, setMaxMarks] = useState('100');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const isElevatedAdmin = roles.includes('admin') || roles.includes('superadmin');

  useEffect(() => {
    if (!user?.schoolId) return;
    let query = supabase.from('classes').select('id,name').eq('school_id', user.schoolId).is('deleted_at', null).order('name');
    // Phase 15: Authoritative role check - non-admins are strictly scoped to their assigned classes
    if (!isElevatedAdmin || role === 'teacher') {
      query = query.eq('teacher_id', user.id);
    }
    query.then(({ data }) => setClasses((data ?? []) as Item[]));
  }, [role, roles, isElevatedAdmin, user?.id, user?.schoolId]);
  useEffect(() => { const load = async () => { setSelected([]); if (!classId || !user?.schoolId) return setSubjects([]); const { data } = await supabase.from('subjects').select('id,name,class_id').eq('school_id', user.schoolId).is('deleted_at', null).order('name'); setSubjects(((data ?? []) as Item[]).filter(subject => !subject.class_id || subject.class_id === classId)); }; load(); }, [classId, user?.schoolId]);
  const toggle = (subjectId: string) => setSelected(current => current.some(subject => subject.id === subjectId) ? current.filter(subject => subject.id !== subjectId) : [...current, { id: subjectId, chapter: '' }]);
  const updateChapter = (subjectId: string, chapter: string) => setSelected(current => current.map(subject => subject.id === subjectId ? { ...subject, chapter } : subject));
  const create = async () => { if (!user?.schoolId || !classId || !name.trim() || !date || !selected.length) return setMessage('Choose a class, at least one subject, test name and date.'); setSaving(true); setMessage(''); const { data: exam, error: examError } = await supabase.from('exams').insert({ school_id: user.schoolId, name: name.trim(), exam_type: 'written', start_date: date, end_date: date, status: 'scheduled', created_by: user.id } as never).select('id').single(); if (examError || !exam) { setSaving(false); return setMessage(examError?.message || 'Could not create test.'); } const { error } = await supabase.from('exam_subjects').insert(selected.map(subject => ({ school_id: user.schoolId!, class_id: classId, subject_id: subject.id, exam_id: (exam as { id: string }).id, exam_date: date, max_marks: Number(maxMarks) || 100, passing_marks: 0, chapter_name: subject.chapter.trim() || null })) as never); setSaving(false); if (error) return setMessage(error.message); setSelected([]); setName(''); setMessage('Test schedule created. Open Marks to upload student marks.'); };
  return <div className="flex min-h-screen bg-background"><Sidebar activePage="Tests" /><div className="flex min-h-screen flex-1 flex-col lg:ml-72"><Header title="Create test" /><main className="flex-1 overflow-y-auto p-5 pb-24 sm:p-8"><section className="clay-card max-w-5xl p-6 sm:p-8"><p className="text-sm font-bold text-primary">Admin and teacher tools</p><h1 className="mt-1 text-3xl font-bold text-foreground">Create test schedule</h1><p className="mt-2 text-muted">Choose a class, then select one or more subjects for this test. Chapters are optional for each subject.</p><div className="mt-6 grid gap-4 md:grid-cols-3"><label className="grid gap-2 text-sm font-bold">Class<select value={classId} onChange={event => setClassId(event.target.value)} className="rounded-xl border border-border bg-white px-3 py-2.5"><option value="">Choose class</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="grid gap-2 text-sm font-bold">Test name<input value={name} onChange={event => setName(event.target.value)} placeholder="Unit test" className="rounded-xl border border-border bg-white px-3 py-2.5" /></label><label className="grid gap-2 text-sm font-bold">Date<input type="date" value={date} onChange={event => setDate(event.target.value)} className="rounded-xl border border-border bg-white px-3 py-2.5" /></label><label className="grid gap-2 text-sm font-bold">Maximum marks<input type="number" min="1" value={maxMarks} onChange={event => setMaxMarks(event.target.value)} className="rounded-xl border border-border bg-white px-3 py-2.5" /></label></div><div className="mt-7"><h2 className="font-bold text-foreground">Subjects</h2><p className="mt-1 text-sm text-muted">Select the subjects included in this test.</p><div className="mt-3 grid gap-3 md:grid-cols-2">{subjects.length ? subjects.map(subject => { const picked = selected.find(item => item.id === subject.id); return <div key={subject.id} className={`rounded-2xl border p-4 ${picked ? 'border-primary bg-teal-50/60' : 'border-border bg-white/50'}`}><label className="flex cursor-pointer items-center gap-3 font-bold text-foreground"><input type="checkbox" checked={!!picked} onChange={() => toggle(subject.id)} />{subject.name}</label>{picked && <input value={picked.chapter} onChange={event => updateChapter(subject.id, event.target.value)} placeholder="Chapter (optional)" className="mt-3 w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm" />}</div>; }) : <p className="text-sm text-muted">Choose a class to see its available subjects.</p>}</div></div><button type="button" onClick={create} disabled={saving} className="mt-7 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white disabled:opacity-50">Create test schedule</button>{message && <p className="mt-3 text-sm font-medium text-muted">{message}</p>}</section></main></div></div>;
}
