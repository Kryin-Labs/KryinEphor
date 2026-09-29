import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Check, Clock3, ImagePlus, Megaphone, Pencil, Plus, Send, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';
import AnnouncementContent from '../components/announcements/AnnouncementContent';
import { announcementDate, useAnnouncements, type Announcement } from '../components/announcements/useAnnouncements';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { subscribeToAnnouncementPush } from '../lib/announcementPush';
import { ROLE_CONFIG } from '../config/roles';

type Form = Pick<Announcement, 'id' | 'school_id' | 'title' | 'body' | 'accent' | 'audience' | 'role_targets' | 'class_targets' | 'user_targets' | 'status' | 'expires_at'>;
const blank = (schoolId: string | null, teacher: boolean): Form => ({ id: '', school_id: schoolId, title: '', body: '', accent: '#0f766e', audience: teacher ? 'classes' : 'everyone', role_targets: [], class_targets: [], user_targets: [], status: 'draft', expires_at: null });
const inputClass = 'w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-800 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100';

export default function Announcements() {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const teacher = role === 'teacher';
  const canCompose = role === 'superadmin' || role === 'admin' || teacher;
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const [search, setSearch] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const { data: announcements = [], isLoading, error } = useAnnouncements(user?.id);

  const { data: schools = [] } = useQuery({
    queryKey: ['announcement-schools'], enabled: role === 'superadmin',
    queryFn: async () => { const { data, error } = await supabase.from('schools').select('id,name').is('deleted_at', null).order('name'); if (error) throw error; return data ?? []; },
  });
  const { data: classes = [] } = useQuery({
    queryKey: ['announcement-classes', form?.school_id, teacher, user?.id], enabled: !!form?.school_id && canCompose,
    queryFn: async () => {
      let request = supabase.from('classes').select('id,name,section,teacher_id').eq('school_id', form!.school_id!).is('deleted_at', null).order('name');
      if (teacher) request = request.eq('teacher_id', user!.id);
      const { data, error } = await request; if (error) throw error; return data ?? [];
    },
  });
  const { data: people = [] } = useQuery({
    queryKey: ['announcement-people', form?.school_id], enabled: !!form?.school_id && !teacher && !!form,
    queryFn: async () => { const { data, error } = await supabase.from('profiles').select('id,full_name,email,role').eq('school_id', form!.school_id!).eq('is_active', true).is('deleted_at', null).order('full_name').limit(1000); if (error) throw error; return data ?? []; },
  });

  const visible = useMemo(() => announcements.filter(a => {
    if (a.status === 'draft' && !canCompose) return false;
    if (!canCompose && a.status === 'published' && a.expires_at && new Date(a.expires_at) <= new Date()) return false;
    return !search || `${a.title} ${a.body}`.toLowerCase().includes(search.toLowerCase());
  }), [announcements, canCompose, search]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['announcements', user?.id] });
  const persist = async (status: 'draft' | 'published', source = form): Promise<string | null> => {
    if (!source || !user) return null;
    if (!source.title.trim()) { toast.error('Add a title first.'); return null; }
    if (status === 'published' && !source.body.trim()) { toast.error('Add a message before publishing.'); return null; }
    if (status === 'published' && (source.audience === 'roles' && !source.role_targets.length || source.audience === 'classes' && !source.class_targets.length || source.audience === 'users' && !source.user_targets.length)) {
      toast.error('Select at least one recipient.'); return null;
    }
    if (source.expires_at && new Date(source.expires_at) <= new Date()) { toast.error('Expiry must be in the future.'); return null; }
    setBusy(true);
    const payload = { school_id: source.school_id, title: source.title.trim(), body: source.body, accent: source.accent,
      audience: source.audience, role_targets: source.audience === 'roles' ? source.role_targets : [],
      class_targets: source.audience === 'classes' ? source.class_targets : [],
      user_targets: source.audience === 'users' ? source.user_targets : [],
      status, expires_at: source.expires_at ? new Date(source.expires_at).toISOString() : null };
    const response = source.id
      ? await supabase.from('announcements').update(payload).eq('id', source.id).select('id').single()
      : await supabase.from('announcements').insert({ ...payload, created_by: user.id }).select('id').single();
    setBusy(false);
    if (response.error) { toast.error(response.error.message); return null; }
    const id = response.data.id as string;
    setForm({ ...source, id, status });
    await refresh();
    if (status === 'published' && import.meta.env.VITE_VAPID_PUBLIC_KEY) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const { data, error } = await supabase.functions.invoke('announcement_push', { body: { action: 'deliver', announcementId: id } });
        if (error) { toast.warning('Published, but background push delivery needs attention.'); break; }
        if (!data?.remaining) break;
      }
    }
    return id;
  };

  const save = async (status: 'draft' | 'published') => {
    const id = await persist(status);
    if (id) { toast.success(status === 'published' ? 'Announcement published' : 'Draft saved'); setForm(null); }
  };

  const remove = async (a: Announcement) => {
    if (!window.confirm(`Delete “${a.title}”? Recipients will no longer see it.`)) return;
    const { error } = await supabase.from('announcements').update({ deleted_at: new Date().toISOString() }).eq('id', a.id);
    if (error) toast.error(error.message); else { toast.success('Announcement deleted'); await refresh(); }
  };

  const upload = async (file?: File) => {
    if (!file || !form) return;
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) { toast.error('Use a JPG, PNG, WebP or GIF under 5 MB.'); return; }
    const id = form.id || await persist('draft');
    if (!id) return;
    setBusy(true);
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
    const path = `${id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from('announcement-images').upload(path, file, { contentType: file.type });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setForm(previous => previous ? { ...previous, id, body: `${previous.body}${previous.body ? '\n\n' : ''}![Attached image](announcement-image://${path})` } : previous);
    toast.success('Image added. Save to keep it in the announcement.');
  };

  const insert = (before: string, after = '') => {
    if (!form) return;
    const el = bodyRef.current; const start = el?.selectionStart ?? form.body.length; const end = el?.selectionEnd ?? start;
    const selected = form.body.slice(start, end) || 'text';
    setForm({ ...form, body: form.body.slice(0, start) + before + selected + after + form.body.slice(end) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + before.length, start + before.length + selected.length); });
  };
  const toggle = (field: 'role_targets' | 'class_targets' | 'user_targets', value: string) =>
    setForm(previous => previous ? { ...previous, [field]: previous[field].includes(value) ? previous[field].filter(x => x !== value) : [...previous[field], value] } : previous);

  const enableAlerts = async () => {
    try {
      if (!('Notification' in window)) { toast.error('Device alerts are unavailable here. On iPhone or iPad, add this site to your Home Screen and open it from there.'); return; }
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') { toast.error('Allow notifications in your browser settings to receive alerts.'); return; }
      if ('serviceWorker' in navigator) await navigator.serviceWorker.register('/announcement-sw.js');
      const background = await subscribeToAnnouncementPush();
      toast.success(background ? 'Background alerts enabled on this device.' : 'Alerts enabled while the app is open.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not enable background alerts.'); }
  };

  return <div className="flex min-h-screen bg-[#f8f7f3]">
    <Sidebar activePage="Announcements" />
    <div className="flex min-h-screen flex-1 flex-col lg:ml-72">
      <Header title="Announcements" />
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-7 p-5 pb-24 sm:p-8">
        <section className="overflow-hidden rounded-[2rem] bg-[#183d36] px-6 py-8 text-white shadow-xl sm:px-9 sm:py-10">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div><div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.22em] text-lime-200"><Megaphone size={17} /> School communications</div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">The announcement board</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-emerald-100">Messages for your school and classes, all in one place. Times are shown in your device’s time zone.</p><p className="mt-1 text-xs text-emerald-200">On iPhone or iPad, add this site to your Home Screen before enabling device alerts.</p></div>
            <div className="flex flex-wrap gap-2"><button type="button" onClick={enableAlerts} className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 px-5 py-3 text-sm font-bold text-white hover:bg-white/10"><BellRing size={17} /> {permission === 'granted' ? 'Sync device alerts' : 'Enable device alerts'}</button>{canCompose && <button type="button" onClick={() => setForm(blank(role === 'superadmin' ? null : user?.schoolId ?? null, teacher))} className="inline-flex items-center gap-2 rounded-xl bg-lime-300 px-5 py-3 text-sm font-bold text-emerald-950 hover:bg-lime-200"><Plus size={17} /> New announcement</button>}</div>
          </div>
        </section>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-stone-900">Latest updates</h2><p className="text-xs text-stone-500">{visible.length} {visible.length === 1 ? 'message' : 'messages'} visible to you</p></div><input aria-label="Search announcements" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search announcements" className={`${inputClass} max-w-xs`} /></div>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load announcements: {error.message}</div>}
        {isLoading ? <p className="text-sm text-stone-500">Loading announcements…</p> : !visible.length ? <div className="rounded-3xl border border-dashed border-stone-300 bg-white p-12 text-center"><Megaphone className="mx-auto mb-3 text-stone-300" size={35} /><h3 className="font-bold text-stone-800">No announcements yet</h3><p className="mt-1 text-sm text-stone-500">Published messages for your audience will appear here.</p></div> : <div className="grid gap-4">{visible.map(a => <article key={a.id} className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm" style={{ borderLeftColor: a.accent, borderLeftWidth: 5 }}><div className="p-5 sm:p-7"><div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><div className="mb-2 flex flex-wrap items-center gap-2"><span className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: a.accent, backgroundColor: `${a.accent}18` }}>{a.school_id ? 'School' : 'Global'} · {a.audience === 'everyone' ? 'Everyone' : a.audience}</span>{a.status === 'draft' && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-800">Draft</span>}</div><h3 className="text-xl font-bold text-stone-900">{a.title}</h3><p className="mt-1 flex items-center gap-1.5 text-xs text-stone-500"><Clock3 size={13} /><time dateTime={a.published_at ?? a.updated_at}>{announcementDate(a.status === 'published' ? a.published_at : a.updated_at)}</time>{a.expires_at && <> · Until {announcementDate(a.expires_at)}</>}</p></div>{canCompose && (role === 'superadmin' || role === 'admin' && a.school_id === user?.schoolId || a.created_by === user?.id) && <div className="flex gap-1"><button type="button" aria-label={`Edit ${a.title}`} onClick={() => setForm({ id: a.id, school_id: a.school_id, title: a.title, body: a.body, accent: a.accent, audience: a.audience, role_targets: a.role_targets, class_targets: a.class_targets, user_targets: a.user_targets, status: a.status, expires_at: a.expires_at })} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100"><Pencil size={16} /></button><button type="button" aria-label={`Delete ${a.title}`} onClick={() => remove(a)} className="rounded-lg p-2 text-stone-500 hover:bg-red-50 hover:text-red-600"><Trash2 size={16} /></button></div>}</div><AnnouncementContent body={a.body} /></div></article>)}</div>}
      </main>
    </div>
    {form && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-stone-950/60 p-3 sm:p-6" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setForm(null); }}><section role="dialog" aria-modal="true" aria-labelledby="announcement-editor-title" className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-[#faf9f6] shadow-2xl"><div className="flex items-center justify-between border-b border-stone-200 px-5 py-4 sm:px-7"><div><h2 id="announcement-editor-title" className="text-xl font-bold text-stone-900">{form.id ? 'Edit announcement' : 'New announcement'}</h2><p className="text-xs text-stone-500">Draft first, preview, then publish.</p></div><button type="button" aria-label="Close editor" onClick={() => setForm(null)} className="rounded-lg p-2 hover:bg-stone-100"><X size={20} /></button></div>
      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1fr_0.85fr]"><div className="space-y-5 p-5 sm:p-7"><label className="block text-xs font-bold uppercase tracking-wider text-stone-600">Title<input maxLength={180} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className={`${inputClass} mt-2`} placeholder="What should everyone know?" /></label>
        {role === 'superadmin' && <label className="block text-xs font-bold uppercase tracking-wider text-stone-600">Send within<select disabled={!!form.id} value={form.school_id ?? ''} onChange={e => setForm({ ...form, school_id: e.target.value || null, audience: !e.target.value && (form.audience === 'classes' || form.audience === 'users') ? 'everyone' : form.audience, class_targets: [], user_targets: [] })} className={`${inputClass} mt-2`}><option value="">All schools · global</option>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
        <div><label htmlFor="announcement-audience" className="text-xs font-bold uppercase tracking-wider text-stone-600">Audience</label><select id="announcement-audience" value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value as Form['audience'] })} className={`${inputClass} mt-2`} disabled={teacher}><option value="everyone">Everyone {form.school_id ? 'in this school' : 'across all schools'}</option>{!teacher && <option value="roles">Selected roles</option>}{form.school_id && <option value="classes">Selected classes · students</option>}{form.school_id && !teacher && <option value="users">Specific people</option>}</select></div>
        {form.audience === 'roles' && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{Object.entries(ROLE_CONFIG).map(([value, config]) => <label key={value} className="flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-white p-3 text-xs font-semibold"><input type="checkbox" checked={form.role_targets.includes(value)} onChange={() => toggle('role_targets', value)} />{config.label}</label>)}</div>}
        {form.audience === 'classes' && <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-stone-200 bg-white p-2">{classes.length ? classes.map(c => <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-sm hover:bg-stone-50"><input type="checkbox" checked={form.class_targets.includes(c.id)} onChange={() => toggle('class_targets', c.id)} />{c.name}{c.section ? ` · ${c.section}` : ''}</label>) : <p className="p-2 text-xs text-stone-500">No available classes.</p>}</div>}
        {form.audience === 'users' && <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-stone-200 bg-white p-2">{people.map(p => <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-sm hover:bg-stone-50"><input type="checkbox" checked={form.user_targets.includes(p.id)} onChange={() => toggle('user_targets', p.id)} />{p.full_name || p.email} <span className="text-xs text-stone-400">{p.role}</span></label>)}</div>}
        <div className="flex flex-wrap items-end gap-4"><label className="text-xs font-bold uppercase tracking-wider text-stone-600">Accent color<input aria-label="Accent color" type="color" value={form.accent} onChange={e => setForm({ ...form, accent: e.target.value })} className="mt-2 block h-10 w-14 cursor-pointer rounded-lg border border-stone-200 bg-white" /></label><label className="min-w-52 flex-1 text-xs font-bold uppercase tracking-wider text-stone-600">Expires (optional)<input type="datetime-local" value={form.expires_at ? new Date(form.expires_at).toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T') : ''} onChange={e => setForm({ ...form, expires_at: e.target.value ? new Date(e.target.value).toISOString() : null })} className={`${inputClass} mt-2`} /></label></div>
        <div><label htmlFor="announcement-body" className="text-xs font-bold uppercase tracking-wider text-stone-600">Message · Markdown</label><div className="mt-2 flex flex-wrap items-center gap-1 rounded-t-xl border border-b-0 border-stone-200 bg-white p-2">{[['B','**','**'],['I','*','*'],['S','~~','~~'],['H','# ',''],['❝','> ',''],['•','- ',''],['Link','[','](https://example.com)'],['Color','{'+form.accent+'|','}']].map(([label,before,after]) => <button key={label} type="button" onClick={() => insert(before, after)} className="rounded-md px-2 py-1 text-xs font-bold text-stone-600 hover:bg-teal-50 hover:text-teal-800" aria-label={`Insert ${label} formatting`}>{label}</button>)}<label className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-bold text-stone-600 hover:bg-teal-50"><ImagePlus size={15} /> Image<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label></div><textarea ref={bodyRef} id="announcement-body" rows={12} maxLength={30000} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} className={`${inputClass} rounded-t-none font-mono leading-6`} placeholder="## Your update\nWrite a clear message here. Use **bold**, links, lists, quotes, colors and images." /><p className="mt-1 text-xs text-stone-500">Images are private to announcement recipients. External links must use HTTPS.</p></div>
      </div><aside className="border-t border-stone-200 bg-white p-5 sm:p-7 lg:border-l lg:border-t-0"><div className="mb-4 text-xs font-bold uppercase tracking-widest text-stone-400">Live preview</div><div className="rounded-2xl border border-stone-200 p-5" style={{ borderTop: `5px solid ${form.accent}` }}><div className="mb-2 text-xs text-stone-400">{announcementDate(new Date().toISOString())}</div><h3 className="mb-3 text-xl font-bold text-stone-900">{form.title || 'Announcement title'}</h3><AnnouncementContent body={form.body || 'Your message preview appears here.'} /></div></aside></div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-white px-5 py-4 sm:px-7"><span className="text-xs text-stone-500">{form.status === 'published' ? <span className="inline-flex items-center gap-1 text-teal-700"><Check size={14} /> Published · edits notify recipients</span> : 'Only you and school administrators can see a draft.'}</span><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => save('draft')} className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-bold text-stone-700 hover:bg-stone-50 disabled:opacity-50">{form.status === 'published' ? 'Unpublish to draft' : 'Save draft'}</button><button type="button" disabled={busy} onClick={() => save('published')} className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-800 disabled:opacity-50"><Send size={15} /> {form.status === 'published' ? 'Save changes' : 'Publish'}</button></div></footer>
    </section></div>}
  </div>;
}
