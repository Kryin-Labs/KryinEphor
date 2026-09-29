import { Link } from 'react-router-dom';
import { Megaphone, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { announcementDate, useAnnouncements } from './useAnnouncements';

export default function AnnouncementPreview() {
  const { user } = useAuth();
  const { data = [], isLoading, error } = useAnnouncements(user?.id);
  const latest = data.filter(a => a.status === 'published' && (!a.expires_at || new Date(a.expires_at) > new Date()))
    .sort((a, b) => new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime()).slice(0, 3);
  return <section className="rounded-3xl border border-teal-100 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="dashboard-announcements">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-teal-700"><Megaphone size={19} /></span><div><h2 id="dashboard-announcements" className="text-lg font-bold text-stone-900">Announcements</h2><p className="text-xs text-stone-500">Updates selected for your account</p></div></div><Link to="/announcements" className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:underline">View all <ArrowRight size={14} /></Link></div>
    {isLoading ? <p className="text-sm text-stone-400">Loading updates…</p> : error ? <p role="alert" className="text-sm text-red-700">Announcements are unavailable. Open the board for details.</p> : latest.length ? <div className="grid gap-2 sm:grid-cols-3">{latest.map(a => <Link key={a.id} to="/announcements" className="rounded-2xl border border-stone-100 bg-stone-50 p-4 hover:border-teal-300" style={{ borderTop: `3px solid ${a.accent}` }}><h3 className="line-clamp-2 text-sm font-bold text-stone-900">{a.title}</h3><p className="mt-1 line-clamp-2 text-xs text-stone-500">{a.body.replace(/[#*`_>]|\[|\]/g, '')}</p><time dateTime={a.published_at ?? undefined} className="mt-2 block text-[11px] text-stone-400">{announcementDate(a.published_at)}</time></Link>)}</div> : <p className="rounded-2xl bg-stone-50 p-4 text-sm text-stone-500">No current announcements.</p>}
  </section>;
}
