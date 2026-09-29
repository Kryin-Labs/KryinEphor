import React from 'react';
import { motion } from 'framer-motion';
import { Pencil, Users, BookOpen, CheckSquare, DoorOpen } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { qk } from '../../lib/queryKeys';
import { Chip } from './shared';

interface ClassRow {
    id: string;
    name: string;
    section: string | null;
    grade_level: string | null;
    room_number: string | null;
    capacity: number | null;
    teacher_id: string | null;
}

interface Props {
    klass: ClassRow;
    teacherName?: string | null;
    onOpen: () => void;
}

const ClassCard: React.FC<Props> = ({ klass, teacherName, onOpen }) => {
    const { data } = useQuery({
        queryKey: qk.classes.overview(klass.id),
        staleTime: 30_000,
        queryFn: async () => {
            const { data, error } = await supabase.rpc('fn_class_overview', { p_class: klass.id });
            if (error) throw error;
            return data as { students: number; subjects: number; attendance_today_pct: number | null; fees_assigned: number };
        },
    });

    return (
        <motion.button
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -2 }}
            onClick={onOpen}
            className="clay-card p-5 text-left relative overflow-hidden group focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
            <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 opacity-15 blur-2xl group-hover:opacity-25 transition" />

            <div className="flex items-start justify-between gap-3 relative">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {klass.grade_level && <Chip tone="teal">Class {klass.grade_level}</Chip>}
                        {klass.section && <Chip>Sec {klass.section}</Chip>}
                    </div>
                    <h3 className="text-lg font-extrabold text-foreground truncate">{klass.name}</h3>
                    {teacherName && <p className="text-xs text-muted mt-0.5 truncate">Class Teacher · {teacherName}</p>}
                </div>
                <div className="w-11 h-11 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 shadow-sm">
                    <Pencil className="w-4 h-4" />
                </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-white/70 border border-stone-100 py-2">
                    <div className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase text-muted tracking-wider"><Users className="w-3 h-3" />Students</div>
                    <div className="text-lg font-extrabold mt-0.5">{data?.students ?? '—'}</div>
                </div>
                <div className="rounded-xl bg-white/70 border border-stone-100 py-2">
                    <div className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase text-muted tracking-wider"><BookOpen className="w-3 h-3" />Subjects</div>
                    <div className="text-lg font-extrabold mt-0.5">{data?.subjects ?? '—'}</div>
                </div>
                <div className="rounded-xl bg-white/70 border border-stone-100 py-2">
                    <div className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase text-muted tracking-wider"><CheckSquare className="w-3 h-3" />Today</div>
                    <div className="text-lg font-extrabold mt-0.5">{data?.attendance_today_pct != null ? `${data.attendance_today_pct}%` : '—'}</div>
                </div>
            </div>

            {(klass.room_number || klass.capacity) && (
                <div className="mt-3 flex items-center gap-3 text-[11px] text-muted">
                    {klass.room_number && <span className="inline-flex items-center gap-1"><DoorOpen className="w-3 h-3" />Room {klass.room_number}</span>}
                    {klass.capacity && <span>Capacity {klass.capacity}</span>}
                </div>
            )}
        </motion.button>
    );
};

export default ClassCard;
