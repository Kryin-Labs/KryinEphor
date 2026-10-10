import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import type { ActivityEvent } from '../../lib/operations';
import { describeClient } from '../../lib/activityClient';

export default function ActivityDetail({ event, onClose }: { event: ActivityEvent; onClose(): void }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const title = useId();
    const client = describeClient(event.user_agent);
    useEffect(() => {
        const element = dialog.current!;
        const previousFocus = document.activeElement;
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        element.showModal();
        return () => { element.close(); document.body.style.overflow = overflow; if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
    }, []);
    const identityHint = event.identity_source === 'event_snapshot' ? 'Username and email were recorded with this event.' : event.identity_source === 'profile_backfill' ? 'Username and email were recovered from the profile available when logs were upgraded; their historical values were not recorded.' : event.identity_source === 'current_profile' ? 'Username and email come from the currently available profile; their historical values were not recorded.' : 'Username and email were not captured for this event.';
    const fields = [
        ['Name', event.user_name || 'Unknown actor'], ['Username / login ID', event.user_username || 'Not captured'],
        ['Email', event.user_email || 'Not captured'], ['Role', event.actor_role || 'Not captured'],
        ['School', event.school_name ?? 'Platform'], ['Time', new Date(event.created_at).toLocaleString()],
        ['Status', event.status || 'Recorded'], ['Source', String(event.details?.source ?? 'Not captured')],
        ['Browser', client.browser], ['Browser version · reported', client.version],
        ['Device', client.device], ['Operating system', client.os], ['IP address', event.ip_address || 'Not captured'],
    ];
    return <dialog ref={dialog} aria-labelledby={title} aria-label="Activity detail" className="clay-card m-auto max-h-[85dvh] max-w-2xl overflow-y-auto bg-white p-5 backdrop:bg-stone-900/40 sm:p-7" style={{ width: 'calc(100% - 2rem)' }} onCancel={e => { e.preventDefault(); onClose(); }} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }} onClick={e => {
        if (e.target !== e.currentTarget) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) onClose();
    }}>
        <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-xs text-muted">Activity details</p><h2 id={title} className="mt-1 break-words text-lg font-bold">{event.action}</h2></div><button aria-label="Close activity detail" onClick={onClose} className="shrink-0 rounded-lg p-2 hover:bg-stone-100"><X size={20} /></button></div>
        <p className="mt-3 break-words text-sm">{event.message}</p>
        <dl className="my-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value}</dd>{label === 'IP address' && event.ip_address_source === 'auth_session' && <p className="mt-1 text-xs text-muted">IP recorded at session sign-in</p>}</div>)}</dl>
        <p className="text-xs text-muted">{identityHint} Browser and device labels use the recorded user agent.</p>
        <details className="mt-5 rounded-xl border border-stone-200 p-4"><summary className="cursor-pointer text-sm font-semibold">Technical details</summary><dl className="mt-4 space-y-3 text-xs">{[['Event ID', event.id], ['Actor ID', event.user_id ?? 'System / not captured'], ['IP source', event.ip_address_source || 'Not captured'], ['User-agent source', event.user_agent_source || 'Not captured'], ['Raw user agent', event.user_agent || 'Not captured']].map(([label, value]) => <div key={label}><dt className="text-muted">{label}</dt><dd className="mt-1 break-all font-mono">{value}</dd></div>)}</dl><h3 className="mt-4 text-xs font-semibold">Recorded details</h3><pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-stone-50 p-3 text-xs">{JSON.stringify(event.details, null, 2)}</pre></details>
        <div className="mt-5 flex justify-end"><button className="clay-btn px-5 py-2 text-sm" onClick={onClose}>Close</button></div>
    </dialog>;
}
