import React, { useState } from 'react';
import { Pencil, LayoutList, Users, BookOpen, CheckSquare, Coins } from 'lucide-react';
import { Drawer } from './shared';
import OverviewTab from './tabs/OverviewTab';
import RosterTab from './tabs/RosterTab';
import TeachersSubjectsTab from './tabs/TeachersSubjectsTab';
import AttendanceTab from './tabs/AttendanceTab';
import FeesTab from './tabs/FeesTab';

type Tab = 'overview' | 'roster' | 'teachers' | 'attendance' | 'fees';

interface Props {
    open: boolean;
    onClose: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    klass: any;
    schoolId: string;
    teacherName?: string | null;
    canEdit: boolean;
    onEdit: () => void;
}

const ClassDetailDrawer: React.FC<Props> = ({ open, onClose, klass, schoolId, teacherName, canEdit, onEdit }) => {
    const [tab, setTab] = useState<Tab>('overview');

    if (!klass) return null;
    const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
        { key: 'overview', label: 'Overview', icon: LayoutList },
        { key: 'roster', label: 'Students', icon: Users },
        { key: 'teachers', label: 'Teachers', icon: BookOpen },
        { key: 'attendance', label: 'Attendance', icon: CheckSquare },
        { key: 'fees', label: 'Fees', icon: Coins },
    ];

    return (
        <Drawer
            open={open}
            onClose={onClose}
            title={klass.name}
            subtitle={[klass.grade_level && `Class ${klass.grade_level}`, klass.section && `Section ${klass.section}`, klass.room_number && `Room ${klass.room_number}`].filter(Boolean).join(' · ') || undefined}
        >
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="clay-card p-1 inline-flex flex-wrap gap-1">
                    {tabs.map(t => {
                        const Icon = t.icon;
                        const active = tab === t.key;
                        return (
                            <button key={t.key} onClick={() => setTab(t.key)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition ${active ? 'bg-primary text-white shadow-md' : 'text-muted hover:bg-stone-100'}`}>
                                <Icon size={13} /> {t.label}
                            </button>
                        );
                    })}
                </div>
                {canEdit && (
                    <button onClick={onEdit} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-200 bg-white text-xs font-bold text-muted hover:text-primary hover:border-primary/30 transition">
                        <Pencil className="w-3.5 h-3.5" /> Edit class
                    </button>
                )}
            </div>

            <div>
                {tab === 'overview' && <OverviewTab klass={klass} teacherName={teacherName} />}
                {tab === 'roster' && <RosterTab classId={klass.id} schoolId={schoolId} canEdit={canEdit} />}
                {tab === 'teachers' && <TeachersSubjectsTab classId={klass.id} schoolId={schoolId} canEdit={canEdit} />}
                {tab === 'attendance' && <AttendanceTab classId={klass.id} canEdit={canEdit} />}
                {tab === 'fees' && <FeesTab classId={klass.id} schoolId={schoolId} canEdit={canEdit} />}
            </div>
        </Drawer>
    );
};

export default ClassDetailDrawer;
