import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

const inlinePattern = /(!?\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|\{#[0-9a-fA-F]{6}\|[^}]+\}|\*[^*\n]+\*)/g;
const safeUrl = (value: string) => /^https:\/\//i.test(value) ? value : '';
const parseLines = (body: string) => {
  let fenced = false;
  return body.split('\n').map(text => {
    if (text.startsWith('```')) { fenced = !fenced; return { text: '', fence: true, code: false }; }
    return { text, fence: false, code: fenced };
  });
};

export default function AnnouncementContent({ body }: { body: string }) {
  const imagePaths = useMemo(() => Array.from(body.matchAll(/!\[[^\]]+\]\(announcement-image:\/\/([a-f\d-]+\/[^)]+)\)/gi), m => m[1]), [body]);
  const [signed, setSigned] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    Promise.all(imagePaths.map(async path => {
      const { data } = await supabase.storage.from('announcement-images').createSignedUrl(path, 3600);
      return [path, data?.signedUrl ?? ''] as const;
    })).then(rows => { if (alive) setSigned(Object.fromEntries(rows)); });
    return () => { alive = false; };
  }, [imagePaths]);

  const inline = (value: string) => value.split(inlinePattern).filter(Boolean).map((part, i) => {
    if (part.startsWith('![')) {
      const [, alt, raw] = part.match(/^!\[([^\]]+)\]\(([^)]+)\)$/) ?? [];
      const src = raw?.startsWith('announcement-image://') ? signed[raw.slice(21)] : '';
      return src ? <img key={i} src={src} alt={alt} loading="lazy" className="my-3 max-h-[32rem] max-w-full rounded-xl object-contain" /> : <span key={i} className="text-xs text-stone-400">Image unavailable</span>;
    }
    if (part.startsWith('[')) {
      const [, label, raw] = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/) ?? [];
      const href = safeUrl(raw ?? '');
      return href ? <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="text-teal-700 underline underline-offset-2">{label}</a> : <span key={i}>{label}</span>;
    }
    if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('~~')) return <del key={i}>{part.slice(2, -2)}</del>;
    if (part.startsWith('`')) return <code key={i} className="rounded bg-stone-100 px-1 py-0.5 text-[.9em]">{part.slice(1, -1)}</code>;
    if (part.startsWith('{#')) return <span key={i} style={{ color: part.slice(1, 8) }}>{part.slice(9, -1)}</span>;
    if (part.startsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>;
    return <span key={i}>{part}</span>;
  });

  const lines = parseLines(body);
  return <div className="space-y-2 break-words text-sm leading-7 text-stone-700">
    {lines.map(({ text: line, fence, code }, i) => {
      if (fence) return null;
      if (code) return <pre key={i} className="overflow-x-auto rounded bg-stone-900 px-3 font-mono text-xs text-white">{line || ' '}</pre>;
      if (!line.trim()) return <div key={i} className="h-2" />;
      if (/^#{1,3} /.test(line)) return <h3 key={i} className="pt-2 text-lg font-bold text-stone-900">{inline(line.replace(/^#{1,3} /, ''))}</h3>;
      if (/^> /.test(line)) return <blockquote key={i} className="border-l-4 border-teal-300 bg-teal-50/50 py-1 pl-4 italic">{inline(line.slice(2))}</blockquote>;
      if (/^[-*] /.test(line)) return <p key={i} className="pl-2">• &nbsp;{inline(line.slice(2))}</p>;
      if (/^\d+\. /.test(line)) return <p key={i} className="pl-2">{line.match(/^\d+/)?.[0]}. &nbsp;{inline(line.replace(/^\d+\. /, ''))}</p>;
      return <p key={i}>{inline(line)}</p>;
    })}
  </div>;
}
