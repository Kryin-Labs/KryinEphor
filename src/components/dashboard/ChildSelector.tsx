import React, { useState, useRef, useEffect } from 'react';
import { GraduationCap, ChevronDown, Check, User, Users, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface ChildSelectorProps {
    className?: string;
    showSingleStudentBadge?: boolean;
}

export const ChildSelector: React.FC<ChildSelectorProps> = ({
    className = '',
    showSingleStudentBadge = true
}) => {
    const { linkedStudents, activeStudentId, setActiveStudentId } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // 0 Students
    if (linkedStudents.length === 0) {
        return (
            <div className={`p-4 rounded-2xl bg-amber-50/80 border border-amber-200 text-amber-900 flex items-center gap-3 ${className}`}>
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                <div className="text-xs">
                    <p className="font-bold">No linked student records found</p>
                    <p className="text-amber-700 mt-0.5">Please contact school administration to link your student/ward profiles to this account.</p>
                </div>
            </div>
        );
    }

    const activeChild = linkedStudents.find(s => s.studentId === activeStudentId)
        ?? linkedStudents.find(s => s.isPrimary)
        ?? linkedStudents[0];

    // 1 Student: Show static context badge without unnecessary dropdown
    if (linkedStudents.length === 1) {
        if (!showSingleStudentBadge) return null;

        return (
            <div className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-teal-50/80 border border-teal-200/80 text-teal-950 text-xs shadow-2xs ${className}`}>
                <div className="w-5 h-5 rounded-full bg-teal-600/15 flex items-center justify-center text-teal-700 shrink-0">
                    <GraduationCap className="w-3 h-3" />
                </div>
                <span className="text-stone-500 font-medium">Viewing student:</span>
                <span className="font-bold text-foreground">{activeChild.fullName}</span>
                {activeChild.className && (
                    <span className="px-1.5 py-0.5 rounded-md bg-white border border-teal-200 text-[10px] font-extrabold text-teal-800">
                        {activeChild.className}{activeChild.sectionName ? ` - ${activeChild.sectionName}` : ''}
                    </span>
                )}
            </div>
        );
    }

    // 2+ Students: Interactive Dropdown / Switcher
    return (
        <div className={`relative inline-block ${className}`} ref={dropdownRef}>
            <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-stone-500 hidden sm:inline">Viewing child:</span>
                <button
                    type="button"
                    onClick={() => setIsOpen(!isOpen)}
                    className="inline-flex items-center gap-2.5 px-4 py-2 rounded-2xl bg-white border border-stone-200 hover:border-teal-400 hover:shadow-xs transition-all text-xs font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20 active:scale-[0.99] group cursor-pointer"
                    aria-haspopup="listbox"
                    aria-expanded={isOpen}
                >
                    <div className="w-6 h-6 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white flex items-center justify-center font-bold text-[11px] shrink-0 shadow-2xs">
                        {activeChild.fullName ? activeChild.fullName.charAt(0).toUpperCase() : <GraduationCap className="w-3.5 h-3.5" />}
                    </div>

                    <div className="text-left">
                        <div className="flex items-center gap-1.5">
                            <span className="font-extrabold text-foreground truncate max-w-[160px]">
                                {activeChild.fullName}
                            </span>
                            {activeChild.className && (
                                <span className="px-1.5 py-0.5 rounded-md bg-stone-100 border border-stone-200 text-[10px] font-bold text-stone-600">
                                    {activeChild.className}{activeChild.sectionName ? ` · ${activeChild.sectionName}` : ''}
                                </span>
                            )}
                            {activeChild.isPrimary && (
                                <span className="text-[9px] font-extrabold uppercase px-1 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    Primary
                                </span>
                            )}
                            {activeChild.studentStatus && activeChild.studentStatus !== 'active' && (
                                <span className="text-[9px] font-extrabold capitalize px-1 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                    {activeChild.studentStatus}
                                </span>
                            )}
                        </div>
                    </div>

                    <ChevronDown className={`w-3.5 h-3.5 text-stone-400 group-hover:text-stone-600 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                </button>
            </div>

            {/* Dropdown Menu */}
            {isOpen && (
                <div
                    role="listbox"
                    className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-xl border border-stone-200/90 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150 overflow-hidden"
                >
                    <div className="px-3.5 pb-2 border-b border-stone-100 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-stone-400">
                            <Users className="w-3 h-3" />
                            <span>Select Student</span>
                        </div>
                        <span className="text-[10px] font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-100">
                            {linkedStudents.length} Children
                        </span>
                    </div>

                    <div className="p-1.5 space-y-1 max-h-64 overflow-y-auto">
                        {linkedStudents.map((child) => {
                            const isSelected = child.studentId === activeChild.studentId;

                            return (
                                <button
                                    key={child.studentId}
                                    type="button"
                                    role="option"
                                    aria-selected={isSelected}
                                    onClick={() => {
                                        setActiveStudentId(child.studentId);
                                        setIsOpen(false);
                                    }}
                                    className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all ${
                                        isSelected
                                            ? 'bg-teal-50/90 text-teal-950 font-bold border border-teal-200/80 shadow-2xs'
                                            : 'hover:bg-stone-50 text-stone-700 hover:text-stone-950 border border-transparent'
                                    }`}
                                >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                                            isSelected
                                                ? 'bg-teal-600 text-white shadow-2xs'
                                                : 'bg-stone-100 text-stone-600 border border-stone-200'
                                        }`}>
                                            {child.fullName ? child.fullName.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <p className="text-xs font-bold truncate">{child.fullName}</p>
                                                {child.isPrimary && (
                                                    <span className="text-[9px] font-extrabold uppercase px-1 rounded bg-emerald-100/70 text-emerald-800">
                                                        Primary
                                                    </span>
                                                )}
                                                {child.studentStatus && child.studentStatus !== 'active' && (
                                                    <span className="text-[9px] font-extrabold capitalize px-1 rounded bg-amber-100/70 text-amber-800 border border-amber-200">
                                                        {child.studentStatus}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-[11px] text-stone-500 truncate mt-0.5">
                                                {child.className
                                                    ? `${child.className}${child.sectionName ? ` · ${child.sectionName}` : ''}`
                                                    : 'Enrolled Student'}
                                                {child.relationship && child.relationship !== 'self_student'
                                                    ? ` · ${child.relationship}`
                                                    : ''}
                                            </p>
                                        </div>
                                    </div>

                                    {isSelected && (
                                        <Check className="w-4 h-4 text-teal-600 shrink-0 ml-2" />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChildSelector;
