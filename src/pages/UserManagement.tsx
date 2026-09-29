import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search,
    MoreVertical,
    Key,
    Lock,
    KeyRound,
    X,
    Crown,
    Building2,
    ShieldCheck,
    GraduationCap,
    Users as UsersIcon,
    ChevronDown,
    ChevronUp,
    BookOpen,
    UserCheck,
    Mail,
    // ChevronsUpDown removed with permissions UI
    User,

    Trash2,
    AlertTriangle,
    CheckCircle2,
    Send,
    RefreshCw,
    BadgeCheck,
    XCircle,
    Pencil,
    Plus,
    UserMinus,
    Settings2,
    ExternalLink,
    ShieldAlert,
    Power,
} from 'lucide-react';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';
import { supabase } from '../lib/supabase';
import { getFunctionErrorMessage } from '../lib/functionErrors';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useUserManagementData, qk } from '../hooks/queries';
import QueryBoundary from '../components/ui/QueryBoundary';
import { useAuth } from '../hooks/useAuth';

interface User {
    id: string;
    full_name: string | null;
    role: string;
    roles?: string[];
    school_id: string | null;
    school_name: string | null;
    status: string;
    is_active: boolean;
    student_status?: string | null;
    metadata: { permissions?: unknown[] } | null;
    updated_at: string;
    email: string;
    avatar_url: string | null;
    recovery_email: string | null;
    recovery_email_verified: boolean;
}

interface SchoolGroup {
    schoolId: string | null;
    schoolName: string;
    users: User[];
    isCore: boolean;
}

import { ROLE_CONFIG, getRoleStyle } from '../config/roles';

/* Permission metadata removed — permissions UI was display-only. */



/* ─── PHASE 8: FAMILY & STAFF MANAGEMENT MODALS ────────── */

interface LinkedStudentTarget {
    link_id: string;
    student_id: string;
    full_name: string;
    email?: string;
    login_id?: string | null;
    class_name: string | null;
    section_name?: string | null;
    relationship: string;
    is_primary: boolean;
    status?: string;
    student_status?: string | null;
    is_active?: boolean;
}

/* 1. Unlink Child Confirmation Modal */
const UnlinkChildConfirmModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    student: LinkedStudentTarget | null;
    onConfirm: () => Promise<void>;
    busy: boolean;
}> = ({ isOpen, onClose, student, onConfirm, busy }) => {
    if (!isOpen || !student) return null;
    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-rose-100 space-y-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center flex-shrink-0">
                        <UserMinus className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-foreground">Unlink Student from Family</h3>
                        <p className="text-xs text-muted">Remove family access for this student</p>
                    </div>
                </div>

                <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 text-xs text-stone-700 space-y-1">
                    <p><strong className="text-stone-900">Student:</strong> {student.full_name}</p>
                    {student.class_name && <p><strong className="text-stone-900">Class:</strong> {student.class_name}{student.section_name ? ` - ${student.section_name}` : ''}</p>}
                    {student.relationship && <p><strong className="text-stone-900">Relationship:</strong> {student.relationship}</p>}
                </div>

                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200/80 text-xs text-amber-900 space-y-1.5 leading-relaxed">
                    <div className="flex items-center gap-1.5 font-bold">
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                        <span>Academic Records Are Preserved</span>
                    </div>
                    <p>
                        <strong>{student.full_name}</strong>'s school record will <strong>NOT</strong> be deleted.
                        Marks, attendance, fees, tests, enrollment, and academic history will remain completely intact.
                    </p>
                    <p className="text-amber-800/90 text-[11px]">
                        Only this family account's access relationship will be removed.
                    </p>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="px-4 py-2 text-xs font-semibold rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-100"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={busy}
                        className="px-4 py-2 text-xs font-bold rounded-xl bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 flex items-center gap-1.5"
                    >
                        {busy ? 'Unlinking…' : 'Confirm Unlink'}
                    </button>
                </div>
            </div>
        </div>
    );
};

/* 1b. Last Child Unlinked - No Active Persona Modal (Phase 11) */
interface LastChildUnlinkedInfo {
    parentId: string;
    parentName: string;
    studentName: string;
    schoolId: string;
}

const LastChildUnlinkedModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    info: LastChildUnlinkedInfo | null;
    onDeactivate: () => Promise<void>;
    onRelink: () => void;
    busy: boolean;
}> = ({ isOpen, onClose, info, onDeactivate, onRelink, busy }) => {
    if (!isOpen || !info) return null;
    return (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-amber-200 space-y-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
                        <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-foreground">Last Child Unlinked</h3>
                        <p className="text-xs text-muted">No remaining children or staff roles</p>
                    </div>
                </div>

                <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 text-xs text-stone-700 space-y-1">
                    <p><strong className="text-stone-900">Guardian:</strong> {info.parentName}</p>
                    <p><strong className="text-stone-900">Unlinked Child:</strong> {info.studentName}</p>
                </div>

                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200/80 text-xs text-amber-900 space-y-1.5 leading-relaxed">
                    <p className="font-semibold text-amber-950">No Active School Persona Remaining</p>
                    <p>
                        <strong>{info.parentName}</strong> has no other active children enrolled and does not hold an active teaching or staff role at this school.
                    </p>
                    <p className="text-[11px] text-amber-800">
                        The user account has <strong>NOT</strong> been deleted. Choose how you would like to handle this account:
                    </p>
                </div>

                <div className="space-y-2 pt-1">
                    <button
                        type="button"
                        disabled={busy}
                        onClick={onDeactivate}
                        className="w-full py-2.5 px-3 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    >
                        <UserMinus className="w-3.5 h-3.5" />
                        {busy ? 'Deactivating…' : 'Deactivate Account (Recommended)'}
                    </button>

                    <button
                        type="button"
                        disabled={busy}
                        onClick={onRelink}
                        className="w-full py-2.5 px-3 rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Link Another Student to This Family
                    </button>

                    <button
                        type="button"
                        disabled={busy}
                        onClick={onClose}
                        className="w-full py-2 px-3 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-600 font-semibold text-xs transition-colors"
                    >
                        Retain Account Active Temporarily
                    </button>
                </div>
            </div>
        </div>
    );
};

/* 2. Edit Relationship Modal */
const EditRelationshipModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    targetName: string;
    targetRoleLabel: string;
    relationship: string;
    setRelationship: (val: string) => void;
    isPrimary: boolean;
    setIsPrimary: (val: boolean) => void;
    onSave: () => Promise<void>;
    busy: boolean;
}> = ({ isOpen, onClose, targetName, targetRoleLabel, relationship, setRelationship, isPrimary, setIsPrimary, onSave, busy }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs">
            <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-gray-200 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-base font-bold text-foreground">Edit Relationship</h3>
                        <p className="text-xs text-muted">Update {targetRoleLabel || 'family'} role for {targetName}</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-600">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="space-y-3">
                    <div>
                        <label className="text-xs font-semibold text-stone-700 block mb-1">Relationship Role</label>
                        <select
                            value={relationship}
                            onChange={e => {
                                const val = e.target.value;
                                setRelationship(val);
                                if (val.toLowerCase() === 'primary guardian') {
                                    setIsPrimary(true);
                                }
                            }}
                            className="clay-input w-full text-sm bg-white"
                        >
                            <option value="Mother">Mother</option>
                            <option value="Father">Father</option>
                            <option value="Guardian">Guardian</option>
                            <option value="Legal Guardian">Legal Guardian</option>
                            <option value="Parent">Parent</option>
                            <option value="Son">Son</option>
                            <option value="Daughter">Daughter</option>
                            <option value="Child">Child</option>
                            <option value="Ward">Ward</option>
                            <option value="Other authorized guardian">Other authorized guardian</option>
                            <option value="Primary guardian">Primary guardian</option>
                            <option value="Emergency contact">Emergency contact</option>
                        </select>
                    </div>

                    <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                        <label className="flex items-center gap-2 text-xs font-medium text-stone-700 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={isPrimary}
                                onChange={e => setIsPrimary(e.target.checked)}
                                className="w-4 h-4 accent-primary rounded"
                            />
                            <span>Set as Primary Contact for this family link</span>
                        </label>
                        <p className="text-[10px] text-muted mt-1 ml-6">
                            Primary status routes default portal views and notification priority.
                        </p>
                    </div>

                    <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200/80 text-[10px] text-amber-900 leading-relaxed">
                        <span className="font-bold">Metadata only:</span> Changing relationship metadata routes family communication without altering login credentials or duplicating student records.
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="px-4 py-2 text-xs font-semibold rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-100"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={busy}
                        className="px-4 py-2 text-xs font-bold rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
                    >
                        {busy ? 'Saving…' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
};

interface StudentCandidate {
    student_id: string;
    full_name: string;
    login_id: string | null;
    class_name: string | null;
    section_name: string | null;
    already_linked: boolean;
}

/* 3. Add Child Modal (Phase 12: Two Paths — Link Existing Student vs Create New Student) */
const AddChildModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    // Common
    relationship: string;
    setRelationship: (val: string) => void;
    isPrimary: boolean;
    setIsPrimary: (val: boolean) => void;
    // Tab 1: Link Existing
    searchQuery: string;
    setSearchQuery: (val: string) => void;
    searching: boolean;
    candidates: StudentCandidate[];
    selected: StudentCandidate | null;
    setSelected: (val: StudentCandidate | null) => void;
    onLinkExisting: () => Promise<void>;
    linkingBusy: boolean;
    // Tab 2: Create New
    schoolDomain: string;
    newStudentName: string;
    setNewStudentName: (val: string) => void;
    newStudentEmailLocal: string;
    setNewStudentEmailLocal: (val: string) => void;
    newStudentPassword: string;
    setNewStudentPassword: (val: string) => void;
    onCreateAndLink: () => Promise<void>;
    creatingBusy: boolean;
}> = ({
    isOpen,
    onClose,
    relationship,
    setRelationship,
    isPrimary,
    setIsPrimary,
    searchQuery,
    setSearchQuery,
    searching,
    candidates,
    selected,
    setSelected,
    onLinkExisting,
    linkingBusy,
    schoolDomain,
    newStudentName,
    setNewStudentName,
    newStudentEmailLocal,
    setNewStudentEmailLocal,
    newStudentPassword,
    setNewStudentPassword,
    onCreateAndLink,
    creatingBusy,
}) => {
    const [mode, setMode] = useState<'link' | 'create'>('link');

    useEffect(() => {
        if (isOpen) {
            setMode('link');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-200 space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
                            <UsersIcon className="w-4 h-4" />
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-foreground">Add Child to Family</h3>
                            <p className="text-xs text-muted">Link an enrolled student or register a new child</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-600">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Mode Selector Tabs */}
                <div className="flex rounded-xl bg-stone-100 p-1 border border-stone-200/60">
                    <button
                        type="button"
                        onClick={() => setMode('link')}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                            mode === 'link' ? 'bg-white shadow-2xs text-purple-900' : 'text-stone-500 hover:text-stone-800'
                        }`}
                    >
                        Link Existing Student
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode('create')}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                            mode === 'create' ? 'bg-white shadow-2xs text-purple-900' : 'text-stone-500 hover:text-stone-800'
                        }`}
                    >
                        Create New Student
                    </button>
                </div>

                {/* Shared Relationship & Primary Settings */}
                <div className="p-3 bg-stone-50/80 rounded-xl border border-stone-200/80 space-y-2">
                    <div className="grid grid-cols-2 gap-2.5">
                        <div>
                            <label className="text-[10px] font-semibold text-stone-600 block mb-0.5">Relationship to Guardian</label>
                            <select
                                value={relationship}
                                onChange={e => setRelationship(e.target.value)}
                                className="clay-input w-full text-xs py-1 bg-white"
                            >
                                <option value="Son">Son</option>
                                <option value="Daughter">Daughter</option>
                                <option value="Child">Child</option>
                                <option value="Ward">Ward</option>
                                <option value="Mother">Mother</option>
                                <option value="Father">Father</option>
                                <option value="Guardian">Guardian</option>
                                <option value="Legal Guardian">Legal Guardian</option>
                                <option value="Parent">Parent</option>
                                <option value="Other authorized guardian">Other authorized guardian</option>
                                <option value="Primary guardian">Primary guardian</option>
                                <option value="Emergency contact">Emergency contact</option>
                            </select>
                        </div>
                        <div className="flex items-center pt-3.5">
                            <label className="flex items-center gap-1.5 text-xs text-stone-700 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={isPrimary}
                                    onChange={e => setIsPrimary(e.target.checked)}
                                    className="w-3.5 h-3.5 accent-purple-600"
                                />
                                <span>Set as Primary Child</span>
                            </label>
                        </div>
                    </div>
                </div>

                {mode === 'link' ? (
                    <div className="space-y-3">
                        <div>
                            <label className="text-xs font-semibold text-stone-700 block mb-1">Search School Roster</label>
                            <div className="relative">
                                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                                <input
                                    type="text"
                                    autoFocus
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    placeholder="Search by student name, admission number, or class…"
                                    className="clay-input w-full pl-9 text-xs bg-stone-50"
                                />
                            </div>
                        </div>

                        <div className="max-h-44 overflow-y-auto space-y-1.5 border border-stone-200 rounded-xl p-2 bg-stone-50/50">
                            {searching && <p className="text-xs text-muted text-center py-3">Searching school roster…</p>}
                            {!searching && candidates.length === 0 && (
                                <p className="text-xs text-stone-400 text-center py-3">
                                    {searchQuery ? 'No matching students found in this school.' : 'Type to search students.'}
                                </p>
                            )}
                            {candidates.map(c => {
                                const isChosen = selected?.student_id === c.student_id;
                                return (
                                    <div
                                        key={c.student_id}
                                        onClick={() => !c.already_linked && setSelected(c)}
                                        className={`p-2.5 rounded-xl border text-xs transition-all flex items-center justify-between ${
                                            c.already_linked
                                                ? 'bg-stone-100 border-stone-200 text-stone-400 cursor-not-allowed opacity-60'
                                                : isChosen
                                                    ? 'bg-purple-100/90 border-purple-400 text-purple-900 font-bold shadow-2xs cursor-pointer'
                                                    : 'bg-white border-stone-200 hover:bg-stone-50 cursor-pointer text-stone-800'
                                        }`}
                                    >
                                        <div className="min-w-0">
                                            <p className="font-semibold truncate">🎓 {c.full_name}</p>
                                            <p className="text-[10px] text-muted">
                                                {c.class_name ? `Class ${c.class_name}${c.section_name ? ` (${c.section_name})` : ''}` : 'No Class Assigned'}
                                                {c.login_id ? ` • Adm ID: ${c.login_id}` : ''}
                                            </p>
                                        </div>
                                        {c.already_linked ? (
                                            <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-stone-200 text-stone-600">
                                                Already Linked
                                            </span>
                                        ) : isChosen ? (
                                            <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-purple-700 text-white">
                                                Selected
                                            </span>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={linkingBusy}
                                className="px-4 py-2 text-xs font-semibold rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-100"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!selected || linkingBusy}
                                onClick={onLinkExisting}
                                className="px-4 py-2 text-xs font-bold rounded-xl bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5 shadow-2xs"
                            >
                                {linkingBusy ? 'Linking Student…' : 'Confirm Link'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div>
                            <label className="text-xs font-semibold text-stone-700 block mb-1">
                                Student Full Name <span className="text-rose-500">*</span>
                            </label>
                            <input
                                type="text"
                                autoFocus
                                value={newStudentName}
                                onChange={e => setNewStudentName(e.target.value)}
                                placeholder="e.g. Aarav Sharma"
                                className="clay-input w-full text-xs bg-stone-50"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-semibold text-stone-700 block mb-1">
                                Student Login Username <span className="text-rose-500">*</span>
                            </label>
                            {schoolDomain ? (
                                <div className="flex items-stretch rounded-xl overflow-hidden border border-gray-200 bg-stone-50 focus-within:ring-2 focus-within:ring-purple-400/20">
                                    <input
                                        type="text"
                                        value={newStudentEmailLocal}
                                        onChange={e => setNewStudentEmailLocal(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                                        placeholder="aarav.s"
                                        className="flex-1 px-3 py-1.5 text-xs outline-none bg-transparent font-mono"
                                    />
                                    <span className="px-2.5 py-1.5 bg-stone-200/70 border-l border-gray-200 text-xs text-stone-600 font-mono">
                                        @{schoolDomain}
                                    </span>
                                </div>
                            ) : (
                                <input
                                    type="email"
                                    value={newStudentEmailLocal}
                                    onChange={e => setNewStudentEmailLocal(e.target.value)}
                                    placeholder="student@example.com"
                                    className="clay-input w-full text-xs bg-stone-50"
                                />
                            )}
                        </div>

                        <div>
                            <label className="text-xs font-semibold text-stone-700 block mb-1">
                                Temporary Password <span className="text-rose-500">*</span>
                            </label>
                            <input
                                type="password"
                                value={newStudentPassword}
                                onChange={e => setNewStudentPassword(e.target.value)}
                                placeholder="Min 6 characters"
                                className="clay-input w-full text-xs bg-stone-50"
                            />
                        </div>

                        <p className="text-[11px] text-stone-500 italic">
                            The student account will be created and immediately connected to this family account with no duplicate logins.
                        </p>

                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={creatingBusy}
                                className="px-4 py-2 text-xs font-semibold rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-100"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!newStudentName.trim() || !newStudentEmailLocal.trim() || newStudentPassword.length < 6 || creatingBusy}
                                onClick={onCreateAndLink}
                                className="px-4 py-2 text-xs font-bold rounded-xl bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5 shadow-2xs"
                            >
                                {creatingBusy ? 'Creating Student…' : 'Create & Link Student'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export interface DuplicateCandidate {
    id: string;
    full_name: string;
    email: string;
    primary_role: string;
    phone: string | null;
    login_id: string | null;
    employee_code: string | null;
    designation: string | null;
    department: string | null;
    class_name: string | null;
    section_name: string | null;
    is_active: boolean;
    match_strength: 'exact' | 'probable';
    match_reasons: string[];
}

/* 3b. Duplicate Detection Modal (Phase 14: Never Silently Merge) */
const DuplicateDetectionModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    candidates: DuplicateCandidate[];
    inputName: string;
    inputEmail: string;
    targetRoleLabel: string;
    onLinkExisting: (candidate: DuplicateCandidate) => Promise<void> | void;
    onCreateNewPerson: () => Promise<void> | void;
    busy?: boolean;
}> = ({
    isOpen,
    onClose,
    candidates,
    inputName,
    inputEmail,
    targetRoleLabel,
    onLinkExisting,
    onCreateNewPerson,
    busy,
}) => {
    const [selectedCandidate, setSelectedCandidate] = useState<DuplicateCandidate | null>(null);

    useEffect(() => {
        if (candidates.length > 0) {
            setSelectedCandidate(candidates[0]);
        }
    }, [candidates]);

    if (!isOpen || candidates.length === 0) return null;

    return (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-amber-300 space-y-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <AlertTriangle className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-foreground">
                                Possible existing account found
                            </h3>
                            <p className="text-xs text-muted mt-0.5">
                                Do you want to link this identity or create a new person?
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={busy}
                        className="p-1 rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-600"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Never Silently Merge warning banner */}
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed space-y-1">
                    <p className="font-semibold flex items-center gap-1.5 text-amber-950">
                        <ShieldAlert className="w-4 h-4 text-amber-700" />
                        Names are not unique — Verification required
                    </p>
                    <p className="text-[11px] text-amber-800/90">
                        Do not silently merge accounts based solely on name. Review matching records below to verify if this is the same person or a distinct individual.
                    </p>
                </div>

                {/* Proposed Identity being created */}
                <div className="p-2.5 rounded-xl bg-stone-100 border border-stone-200 text-xs flex items-center justify-between">
                    <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted block">Attempting to add {targetRoleLabel}</span>
                        <span className="font-semibold text-stone-900">{inputName || 'No Name Entered'}</span>
                        {inputEmail && <span className="text-muted ml-1.5 font-mono text-[11px]">({inputEmail})</span>}
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-stone-200 font-semibold text-stone-700">{candidates.length} match{candidates.length > 1 ? 'es' : ''}</span>
                </div>

                {/* Candidate list */}
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {candidates.map(cand => {
                        const isSelected = selectedCandidate?.id === cand.id;
                        return (
                            <div
                                key={cand.id}
                                onClick={() => setSelectedCandidate(cand)}
                                className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                                    isSelected
                                        ? 'bg-amber-50/80 border-amber-400 shadow-2xs'
                                        : 'bg-stone-50 border-stone-200 hover:bg-stone-100/70'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-bold text-stone-900">{cand.full_name}</span>
                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-stone-200 text-stone-700">
                                                {cand.primary_role}
                                            </span>
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                cand.match_strength === 'exact'
                                                    ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                                            }`}>
                                                {cand.match_strength === 'exact' ? 'Exact Match' : 'Probable Match'}
                                            </span>
                                            {!cand.is_active && (
                                                <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-stone-200 text-stone-600">
                                                    Inactive
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[11px] font-mono text-stone-600 mt-1">
                                            {cand.email} {cand.login_id ? `• Adm/Login ID: ${cand.login_id}` : ''}
                                        </p>
                                        {(cand.class_name || cand.designation) && (
                                            <p className="text-[11px] text-stone-500 mt-0.5">
                                                {cand.class_name ? `Class: ${cand.class_name}${cand.section_name ? ` - ${cand.section_name}` : ''}` : ''}
                                                {cand.designation ? `Designation: ${cand.designation} (${cand.department || 'Staff'})` : ''}
                                                {cand.employee_code ? ` • Emp: ${cand.employee_code}` : ''}
                                            </p>
                                        )}
                                        <div className="mt-1.5 space-y-0.5">
                                            {cand.match_reasons.map((r, i) => (
                                                <div key={i} className="text-[10px] text-stone-700 flex items-center gap-1">
                                                    <span className="text-amber-600 font-bold">•</span>
                                                    <span>{r}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <input
                                        type="radio"
                                        name="duplicate_selected"
                                        checked={isSelected}
                                        onChange={() => setSelectedCandidate(cand)}
                                        className="mt-1 accent-amber-600"
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Actions */}
                <div className="pt-2 border-t border-stone-200 flex items-center justify-between gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="px-3 py-2 text-xs font-semibold rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-100"
                    >
                        Cancel & Review Info
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onCreateNewPerson}
                            disabled={busy}
                            title="Confirm this is a distinct person and proceed"
                            className="px-3 py-2 text-xs font-semibold rounded-xl border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 transition-colors"
                        >
                            Create New Person
                        </button>
                        <button
                            type="button"
                            disabled={!selectedCandidate || busy}
                            onClick={() => selectedCandidate && onLinkExisting(selectedCandidate)}
                            className="px-4 py-2 text-xs font-bold rounded-xl bg-amber-600 text-white hover:bg-amber-700 transition-colors shadow-2xs disabled:opacity-50 flex items-center gap-1.5"
                        >
                            {busy ? 'Processing…' : 'Link This Existing Identity'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

/* 4. Add Teacher Access Modal */
const AddTeacherModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    staffName: string;
    setStaffName: (val: string) => void;
    designation: string;
    setDesignation: (val: string) => void;
    department: string;
    setDepartment: (val: string) => void;
    onConfirm: () => Promise<void>;
    busy: boolean;
}> = ({ isOpen, onClose, staffName, setStaffName, designation, setDesignation, department, setDepartment, onConfirm, busy }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-sky-100 space-y-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center flex-shrink-0">
                        <GraduationCap className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-foreground">Add Teacher Access</h3>
                        <p className="text-xs text-muted">Grant staff educator access to this account</p>
                    </div>
                </div>

                <div className="p-3.5 rounded-xl bg-sky-50 border border-sky-200/80 text-xs text-sky-900 space-y-1 leading-relaxed">
                    <p className="font-semibold">Adult Educator Identity</p>
                    <p className="text-[11px] text-sky-800">
                        Enter the adult staff member's real name. This separates the Teacher persona from any linked student children.
                    </p>
                </div>

                <div className="space-y-3">
                    <div>
                        <label className="text-xs font-semibold text-stone-700 block mb-1">
                            Staff Member Full Name <span className="text-rose-500">*</span>
                        </label>
                        <input
                            type="text"
                            autoFocus
                            value={staffName}
                            onChange={e => setStaffName(e.target.value)}
                            placeholder="e.g. Sunita Sharma"
                            className="clay-input w-full text-sm bg-white"
                        />
                        <p className="text-[10px] text-muted mt-1">Must be the adult teacher's name, not the student's name.</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-xs font-semibold text-stone-700 block mb-1">Designation</label>
                            <input
                                type="text"
                                value={designation}
                                onChange={e => setDesignation(e.target.value)}
                                placeholder="e.g. Senior Teacher"
                                className="clay-input w-full text-sm bg-white"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-stone-700 block mb-1">Department</label>
                            <input
                                type="text"
                                value={department}
                                onChange={e => setDepartment(e.target.value)}
                                placeholder="e.g. Mathematics"
                                className="clay-input w-full text-sm bg-white"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="px-4 py-2 text-xs font-semibold rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-100"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={busy || !staffName.trim()}
                        className="px-4 py-2 text-xs font-bold rounded-xl bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5"
                    >
                        {busy ? 'Granting Access…' : 'Grant Teacher Access'}
                    </button>
                </div>
            </div>
        </div>
    );
};

interface ActiveTeacherAssignments {
    has_active_assignments: boolean;
    total_count: number;
    classes: {
        class_id: string;
        name: string;
        section: string | null;
        grade_level: string | null;
        room_number: string | null;
    }[];
    subjects: {
        subject_id: string;
        name: string;
        code: string | null;
        class_id: string | null;
        class_name: string | null;
        class_section: string | null;
    }[];
    subject_teachers: {
        id: string;
        subject_id: string;
        subject_name: string;
        class_id: string;
        class_name: string;
        class_section: string | null;
        is_primary: boolean;
    }[];
    timetable: {
        id: string;
        day_of_week: number;
        start_time: string;
        end_time: string;
        room: string | null;
        class_name: string;
        class_section: string | null;
        subject_name: string;
    }[];
    online_classes: {
        id: string;
        title: string;
        scheduled_at: string;
        duration_minutes: number | null;
        platform: string | null;
        status: string;
        class_name: string;
        subject_name: string | null;
    }[];
}

/* 5. Disable Teacher Access Modal (Phase 9 - Active Assignments & History Preservation) */
const DisableTeacherModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    staffName: string;
    teacherProfileId: string;
    schoolId: string;
    onConfirm: (clearAssignments: boolean) => Promise<void>;
    busy: boolean;
}> = ({ isOpen, onClose, staffName, teacherProfileId, schoolId, onConfirm, busy }) => {
    const [loadingAssignments, setLoadingAssignments] = useState(false);
    const [assignments, setAssignments] = useState<ActiveTeacherAssignments | null>(null);
    const [clearAssignmentsChecked, setClearAssignmentsChecked] = useState(false);

    useEffect(() => {
        if (!isOpen || !teacherProfileId || !schoolId) {
            setAssignments(null);
            setClearAssignmentsChecked(false);
            return;
        }

        let isMounted = true;
        setLoadingAssignments(true);

        const fetchAssignments = async () => {
            try {
                const { data, error } = await supabase.rpc('fn_get_teacher_active_assignments', {
                    _school_id: schoolId,
                    _teacher_profile_id: teacherProfileId,
                });
                if (error) throw error;
                if (isMounted) {
                    setAssignments(data as unknown as ActiveTeacherAssignments);
                }
            } catch (err) {
                console.error('Failed to fetch active teacher assignments:', err);
            } finally {
                if (isMounted) setLoadingAssignments(false);
            }
        };

        fetchAssignments();
        return () => {
            isMounted = false;
        };
    }, [isOpen, teacherProfileId, schoolId]);

    if (!isOpen) return null;

    const hasActiveAssignments = assignments?.has_active_assignments ?? false;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs overflow-y-auto">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-rose-100 space-y-4 my-8">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center flex-shrink-0">
                        <Lock className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-foreground">Disable Teacher Access</h3>
                        <p className="text-xs text-muted">Inactivate educator privileges for {staffName}</p>
                    </div>
                </div>

                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200/80 text-xs text-amber-900 space-y-1.5 leading-relaxed">
                    <div className="flex items-center gap-1.5 font-bold">
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                        <span>Family Access & Academic History Remain Preserved</span>
                    </div>
                    <p>
                        Disabling Teacher access will inactivate educator privileges and immediately revoke active staff unlock sessions.
                        Family login credentials, Parent view, linked children, student records, and historical teacher attribution (marks entered, attendance taken) will remain 100% intact.
                    </p>
                </div>

                {loadingAssignments ? (
                    <div className="p-6 text-center text-xs text-muted bg-stone-50 rounded-xl border border-stone-200 space-y-2">
                        <RefreshCw className="w-4 h-4 animate-spin mx-auto text-stone-400" />
                        <p>Checking active teaching assignments…</p>
                    </div>
                ) : hasActiveAssignments ? (
                    <div className="space-y-3">
                        <div className="p-3.5 rounded-xl bg-rose-50/70 border border-rose-200 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-rose-800 flex items-center gap-1.5">
                                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                                    Active Assignments Found ({assignments?.total_count})
                                </span>
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-rose-200/80 text-rose-800">
                                    Action Required
                                </span>
                            </div>
                            <p className="text-[11px] text-rose-900 leading-relaxed">
                                This staff member currently holds operational assignments. To avoid contradictory states, you must either reassign them first in Class Management or authorize clearing and archiving them now.
                            </p>

                            <div className="max-h-40 overflow-y-auto space-y-1.5 pt-1 pr-1">
                                {assignments?.classes && assignments.classes.length > 0 && (
                                    <div className="bg-white/80 p-2 rounded-lg border border-rose-100 text-[11px] space-y-1">
                                        <p className="font-semibold text-stone-700">Class Teacher:</p>
                                        {assignments.classes.map(c => (
                                            <p key={c.class_id} className="text-stone-600 pl-2">
                                                • Class {c.name}{c.section ? `-${c.section}` : ''} {c.room_number ? `(Room: ${c.room_number})` : ''}
                                            </p>
                                        ))}
                                    </div>
                                )}
                                {assignments?.subjects && assignments.subjects.length > 0 && (
                                    <div className="bg-white/80 p-2 rounded-lg border border-rose-100 text-[11px] space-y-1">
                                        <p className="font-semibold text-stone-700">Subjects Taught:</p>
                                        {assignments.subjects.map(s => (
                                            <p key={s.subject_id} className="text-stone-600 pl-2">
                                                • {s.name} {s.class_name ? `(${s.class_name})` : ''} {s.code ? `[${s.code}]` : ''}
                                            </p>
                                        ))}
                                    </div>
                                )}
                                {assignments?.subject_teachers && assignments.subject_teachers.length > 0 && (
                                    <div className="bg-white/80 p-2 rounded-lg border border-rose-100 text-[11px] space-y-1">
                                        <p className="font-semibold text-stone-700">Subject-Class Allocations:</p>
                                        {assignments.subject_teachers.map(st => (
                                            <p key={st.id} className="text-stone-600 pl-2">
                                                • {st.subject_name} ({st.class_name}{st.class_section ? `-${st.class_section}` : ''})
                                            </p>
                                        ))}
                                    </div>
                                )}
                                {assignments?.timetable && assignments.timetable.length > 0 && (
                                    <div className="bg-white/80 p-2 rounded-lg border border-rose-100 text-[11px] space-y-1">
                                        <p className="font-semibold text-stone-700">Timetable Slots ({assignments.timetable.length}):</p>
                                        {assignments.timetable.slice(0, 3).map(tt => (
                                            <p key={tt.id} className="text-stone-600 pl-2">
                                                • Day {tt.day_of_week} ({tt.start_time}-{tt.end_time}): {tt.subject_name}
                                            </p>
                                        ))}
                                        {assignments.timetable.length > 3 && (
                                            <p className="text-stone-400 pl-2 text-[10px]">
                                                + {assignments.timetable.length - 3} more timetable entries
                                            </p>
                                        )}
                                    </div>
                                )}
                                {assignments?.online_classes && assignments.online_classes.length > 0 && (
                                    <div className="bg-white/80 p-2 rounded-lg border border-rose-100 text-[11px] space-y-1">
                                        <p className="font-semibold text-stone-700">Scheduled Online Sessions:</p>
                                        {assignments.online_classes.map(oc => (
                                            <p key={oc.id} className="text-stone-600 pl-2">
                                                • {oc.title} ({new Date(oc.scheduled_at).toLocaleDateString()})
                                            </p>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <label className="flex items-start gap-2.5 p-3 rounded-xl border border-stone-200 bg-stone-50 text-xs font-semibold text-stone-800 cursor-pointer hover:bg-stone-100 transition-colors">
                            <input
                                type="checkbox"
                                checked={clearAssignmentsChecked}
                                onChange={e => setClearAssignmentsChecked(e.target.checked)}
                                className="mt-0.5 w-4 h-4 accent-rose-600 rounded"
                            />
                            <div className="space-y-0.5">
                                <span>Clear current assignments and archive to assignment history as part of Teacher removal</span>
                                <p className="text-[10px] font-normal text-muted">
                                    Current operational classes and timetable slots will await new teacher assignment in Class Management. Assignment history is permanently archived.
                                </p>
                            </div>
                        </label>
                    </div>
                ) : (
                    <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 flex items-center gap-2 text-xs text-stone-600">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                        <span>No active class or subject teaching assignments found for this staff member.</span>
                    </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="px-4 py-2 text-xs font-semibold rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-100"
                    >
                        {hasActiveAssignments ? 'Cancel & Reassign Manually' : 'Cancel'}
                    </button>
                    <button
                        type="button"
                        onClick={() => onConfirm(clearAssignmentsChecked)}
                        disabled={busy || (hasActiveAssignments && !clearAssignmentsChecked)}
                        className="px-4 py-2 text-xs font-bold rounded-xl bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-sm"
                    >
                        {busy ? 'Disabling…' : 'Disable Teacher Access'}
                    </button>
                </div>
            </div>
        </div>
    );
};

/* 6. Edit Staff Details Modal */
const EditStaffDetailsModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    staffName: string;
    setStaffName: (val: string) => void;
    designation: string;
    setDesignation: (val: string) => void;
    department: string;
    setDepartment: (val: string) => void;
    onSave: () => Promise<void>;
    busy: boolean;
}> = ({ isOpen, onClose, staffName, setStaffName, designation, setDesignation, department, setDepartment, onSave, busy }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-base font-bold text-foreground">Edit Staff Details</h3>
                        <p className="text-xs text-muted">Update educator identity & department</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-600">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="space-y-3">
                    <div>
                        <label className="text-xs font-semibold text-stone-700 block mb-1">
                            Staff Member Full Name <span className="text-rose-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={staffName}
                            onChange={e => setStaffName(e.target.value)}
                            className="clay-input w-full text-sm bg-white"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-xs font-semibold text-stone-700 block mb-1">Designation</label>
                            <input
                                type="text"
                                value={designation}
                                onChange={e => setDesignation(e.target.value)}
                                className="clay-input w-full text-sm bg-white"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-stone-700 block mb-1">Department</label>
                            <input
                                type="text"
                                value={department}
                                onChange={e => setDepartment(e.target.value)}
                                className="clay-input w-full text-sm bg-white"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="px-4 py-2 text-xs font-semibold rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-100"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={busy || !staffName.trim()}
                        className="px-4 py-2 text-xs font-bold rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
                    >
                        {busy ? 'Saving…' : 'Save Details'}
                    </button>
                </div>
            </div>
        </div>
    );
};


/* ─── USER DRAWER (PHASE 8 RESTRUCTURED) ───────────────── */
const UserDrawer: React.FC<{
    user: User | null;
    isOpen: boolean;
    onClose: () => void;
    schools: { id: string; name: string; email_domain?: string | null; combined_parent_student_account?: boolean }[];
    permissions?: unknown[];
    onSaved: () => void;
    onSelectUser?: (user: User) => void;
}> = ({ user, isOpen, onClose, schools, onSaved, onSelectUser }) => {
    const { role: currentRole, user: currentUser } = useAuth();
    const queryClient = useQueryClient();
    const isSuperadmin = currentRole === 'superadmin';
    const canManageUsers = currentRole === 'superadmin' || currentRole === 'admin';
    const canEditName = !!user && (canManageUsers || currentUser?.id === user.id);

    const [editRole, setEditRole] = useState('');
    const [editFullName, setEditFullName] = useState('');
    const [editSchool, setEditSchool] = useState('');
    const [editEmail, setEditEmail] = useState('');
    const [editEmailLocal, setEditEmailLocal] = useState('');
    const [isActive, setIsActive] = useState(true);
    const [accountStatusBusy, setAccountStatusBusy] = useState(false);
    const [showStatusConfirm, setShowStatusConfirm] = useState(false);
    const [additionalRoles, setAdditionalRoles] = useState<string[]>([]);
    const [editStaffPersonName, setEditStaffPersonName] = useState('');
    const [editDesignation, setEditDesignation] = useState('');
    const [editDepartment, setEditDepartment] = useState('');
    const [employeeStatus, setEmployeeStatus] = useState<string | null>(null);

    // Family links state
    interface LinkedGuardian {
        link_id: string;
        guardian_id: string;
        full_name: string;
        email: string;
        primary_role: string;
        relationship: string;
        is_primary: boolean;
        is_staff: boolean;
        is_active?: boolean;
        staff_person_name: string | null;
        designation: string | null;
    }
    const [linkedGuardians, setLinkedGuardians] = useState<LinkedGuardian[]>([]);
    const [linkedStudents, setLinkedStudents] = useState<LinkedStudentTarget[]>([]);
    const [familyLoading, setFamilyLoading] = useState(false);

    // Unlink child modal state
    const [unlinkingStudent, setUnlinkingStudent] = useState<LinkedStudentTarget | null>(null);
    const [unlinkingBusy, setUnlinkingBusy] = useState(false);

    // Phase 11: Last child unlinked modal state
    const [lastChildUnlinkedInfo, setLastChildUnlinkedInfo] = useState<LastChildUnlinkedInfo | null>(null);
    const [deactivatingParentBusy, setDeactivatingParentBusy] = useState(false);

    // Edit relationship modal state (Phase 13: supports both child & guardian targets)
    interface EditableRelationshipTarget {
        link_id: string;
        target_name: string;
        target_role_label: string;
        relationship: string;
        is_primary: boolean;
    }
    const [editingRelationshipLink, setEditingRelationshipLink] = useState<EditableRelationshipTarget | null>(null);
    const [editRelVal, setEditRelVal] = useState('parent');
    const [editPrimaryVal, setEditPrimaryVal] = useState(false);
    const [updatingRelBusy, setUpdatingRelBusy] = useState(false);

    const handleOpenCanonicalProfile = async (targetProfileId: string) => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', targetProfileId)
                .single();
            if (error || !data) {
                toast.error('Unable to load canonical profile.');
                return;
            }
            if (onSelectUser) {
                onSelectUser(data as User);
            }
        } catch {
            toast.error('Failed to load canonical profile.');
        }
    };

    // Link existing student modal state
    const [linkStudentModalOpen, setLinkStudentModalOpen] = useState(false);
    const [studentSearchQuery, setStudentSearchQuery] = useState('');
    const [studentCandidates, setStudentCandidates] = useState<StudentCandidate[]>([]);
    const [searchingStudents, setSearchingStudents] = useState(false);
    const [selectedStudentCandidate, setSelectedStudentCandidate] = useState<StudentCandidate | null>(null);
    const [newLinkRelationship, setNewLinkRelationship] = useState('Son');
    const [newLinkIsPrimary, setNewLinkIsPrimary] = useState(false);
    const [linkingStudentBusy, setLinkingStudentBusy] = useState(false);

    // Phase 12: Create new student & link state
    const [newStudentName, setNewStudentName] = useState('');
    const [newStudentEmailLocal, setNewStudentEmailLocal] = useState('');
    const [newStudentPassword, setNewStudentPassword] = useState('');
    const [creatingStudentBusy, setCreatingStudentBusy] = useState(false);

    // Phase 14: Child duplicate detection state
    const [detectedChildDuplicates, setDetectedChildDuplicates] = useState<DuplicateCandidate[]>([]);
    const [childDuplicateModalOpen, setChildDuplicateModalOpen] = useState(false);
    const [childDuplicateActionBusy, setChildDuplicateActionBusy] = useState(false);

    // Teacher access workflow state
    const [addTeacherModalOpen, setAddTeacherModalOpen] = useState(false);
    const [newStaffPersonName, setNewStaffPersonName] = useState('');
    const [newStaffDesignation, setNewStaffDesignation] = useState('Teacher');
    const [newStaffDepartment, setNewStaffDepartment] = useState('Academics');
    const [addingTeacherBusy, setAddingTeacherBusy] = useState(false);

    // Phase 14: Teacher duplicate detection state
    const [teacherDupCandidates, setTeacherDupCandidates] = useState<DuplicateCandidate[]>([]);
    const [teacherDupModalOpen, setTeacherDupModalOpen] = useState(false);
    const [teacherDupActionBusy, setTeacherDupActionBusy] = useState(false);

    const [disableTeacherModalOpen, setDisableTeacherModalOpen] = useState(false);
    const [disablingTeacherBusy, setDisablingTeacherBusy] = useState(false);

    const [editStaffDetailsOpen, setEditStaffDetailsOpen] = useState(false);
    const [editingStaffBusy, setEditingStaffBusy] = useState(false);

    // Staff PIN state (Phase 5)
    interface StaffPinInfo {
        has_pin: boolean;
        must_change: boolean;
        is_locked: boolean;
        locked_until: string | null;
        attempts_remaining: number;
        is_temporary: boolean;
    }
    const [staffPinInfo, setStaffPinInfo] = useState<StaffPinInfo | null>(null);
    const [showResetPinInput, setShowResetPinInput] = useState(false);
    const [tempPinValue, setTempPinValue] = useState('');
    const [resettingPin, setResettingPin] = useState(false);

    // Student Status & Departure (Phase 10)
    const [studentStatus, setStudentStatus] = useState('active');
    const [studentDepartureReason, setStudentDepartureReason] = useState('');
    const [studentDepartureNotes, setStudentDepartureNotes] = useState('');
    const [updatingStudentStatus, setUpdatingStudentStatus] = useState(false);

    const hasTeacherAccess = editRole === 'teacher' || additionalRoles.includes('teacher') || employeeStatus === 'active';

    const fetchStaffPinStatus = async (schoolId: string, userId: string) => {
        try {
            const { data, error } = await supabase.rpc('fn_check_staff_pin_status', {
                _school_id: schoolId,
                _target_user_id: userId
            });
            if (!error && data) {
                setStaffPinInfo(data as StaffPinInfo);
            }
        } catch { /* ignore */ }
    };

    const handleIssueStaffPin = async () => {
        if (!user || !user.school_id) return;
        if (tempPinValue.length < 6 || tempPinValue.length > 8) {
            toast.error('PIN must be 6 to 8 numeric digits');
            return;
        }
        setResettingPin(true);
        try {
            const { data, error } = await supabase.rpc('fn_setup_or_change_staff_pin', {
                _school_id: user.school_id,
                _target_user_id: user.id,
                _new_pin: tempPinValue,
                _is_temporary: true
            });
            if (error) throw error;
            if (data && !data.success) throw new Error(data.error || 'Failed to set PIN');
            toast.success('Temporary Staff PIN issued successfully.');
            setShowResetPinInput(false);
            setTempPinValue('');
            fetchStaffPinStatus(user.school_id, user.id);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to issue PIN');
        } finally {
            setResettingPin(false);
        }
    };

    const [newPass, setNewPass] = useState('');
    const [saving, setSaving] = useState(false);
    const [passSaving, setPassSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [editingName, setEditingName] = useState(false);

    const PROTECTED_EMAILS = new Set(['admin@admin.com', 'superadmin@edunex.com']);
    const isProtected = !!user && PROTECTED_EMAILS.has((user.email || '').toLowerCase());

    const editSelectedSchool = schools.find(s => s.id === editSchool);
    const editLockedDomain = editSelectedSchool?.email_domain || '';

    const fetchFamilyLinks = async (targetId: string) => {
        setFamilyLoading(true);
        try {
            const { data, error } = await supabase.rpc('fn_get_profile_family_links', { _target_profile_id: targetId });
            if (!error && data && typeof data === 'object') {
                const parsed = data as { guardians: LinkedGuardian[]; students: LinkedStudentTarget[] };
                setLinkedGuardians(parsed.guardians || []);
                setLinkedStudents(parsed.students || []);
            }
        } catch {
            // silent
        } finally {
            setFamilyLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            setEditRole(user.role || '');
            setEditFullName(user.full_name || '');
            setEditSchool(user.school_id || '');
            setEditEmail(user.email || '');
            const atIdx = (user.email || '').indexOf('@');
            setEditEmailLocal(atIdx > 0 ? user.email.slice(0, atIdx) : '');
            setIsActive(user.is_active ?? true);
            setShowStatusConfirm(false);
            setAccountStatusBusy(false);
            setNewPass('');
            setMessage('');
            setErrorMsg('');
            setAdditionalRoles(user.roles ? user.roles.filter(r => r && r !== user.role) : []);
            setEditingName(false);
            setEditStaffPersonName('');
            setEditDesignation('');
            setEditDepartment('');

            setStudentStatus(user.student_status || (user.is_active ? 'active' : 'inactive'));
            setStudentDepartureReason('');
            setStudentDepartureNotes('');

            fetchFamilyLinks(user.id);

            // Fetch assigned roles
            (async () => {
                const { data, error } = await supabase.rpc('fn_get_user_roles', { _target_user_id: user.id });
                if (!error && Array.isArray(data)) {
                    const primary = user.role;
                    setAdditionalRoles((data as string[]).filter(r => r && r !== primary));
                }
            })();

            // Fetch existing employee record
            (async () => {
                const { data } = await supabase
                    .from('employees')
                    .select('staff_person_name, designation, department, status')
                    .eq('profile_id', user.id)
                    .is('deleted_at', null)
                    .maybeSingle();
                if (data) {
                    setEditStaffPersonName(data.staff_person_name || '');
                    setEditDesignation(data.designation || '');
                    setEditDepartment(data.department || '');
                    setEmployeeStatus(data.status || 'active');
                } else {
                    setEmployeeStatus(null);
                }
            })();

            if (user.school_id) {
                fetchStaffPinStatus(user.school_id, user.id);
            }
            setShowResetPinInput(false);
            setTempPinValue('');
        }
    }, [user]);

    // Live search for students in current school
    useEffect(() => {
        if (!linkStudentModalOpen || !user) return;
        const targetSchool = editSchool || user.school_id;
        if (!targetSchool) return;

        const timer = setTimeout(async () => {
            setSearchingStudents(true);
            try {
                const { data, error } = await supabase.rpc('fn_search_students_for_family', {
                    _school_id: targetSchool,
                    _query: studentSearchQuery.trim(),
                    _parent_id: user.id
                });
                if (!error && Array.isArray(data)) {
                    setStudentCandidates(data);
                } else {
                    setStudentCandidates([]);
                }
            } catch {
                setStudentCandidates([]);
            } finally {
                setSearchingStudents(false);
            }
        }, 250);
        return () => clearTimeout(timer);
    }, [linkStudentModalOpen, user, editSchool, studentSearchQuery]);

    // Handle Unlink Student (Phase 11: Capability evaluation)
    const handleUnlinkStudent = async () => {
        if (!user || !unlinkingStudent) return;
        const targetSchool = editSchool || user.school_id;
        if (!targetSchool) return;

        setUnlinkingBusy(true);
        setErrorMsg('');
        try {
            const { data, error } = await supabase.rpc('fn_unlink_student_guardian', {
                _school_id: targetSchool,
                _link_id: unlinkingStudent.link_id,
            });
            if (error) throw error;

            const res = (data as any) || {};
            const removedStudentName = unlinkingStudent.full_name;
            setUnlinkingStudent(null);
            fetchFamilyLinks(user.id);
            onSaved();

            if (res.remaining_children_count === 0) {
                if (res.new_primary_role) {
                    toast.success(`${removedStudentName} unlinked. Account transitioned to ${res.new_primary_role} account.`);
                    setEditRole(res.new_primary_role);
                    if (targetSchool) {
                        queryClient.invalidateQueries({ queryKey: qk.teachers.bySchool(targetSchool) });
                    }
                    queryClient.invalidateQueries({ queryKey: qk.userManagement });
                    queryClient.invalidateQueries({ queryKey: ['persona-summary'] });
                } else if (res.has_active_persona === false) {
                    setLastChildUnlinkedInfo({
                        parentId: user.id,
                        parentName: user.full_name || user.email,
                        studentName: removedStudentName,
                        schoolId: targetSchool,
                    });
                } else {
                    toast.success(`${removedStudentName} unlinked from family account.`);
                }
            } else {
                toast.success(`${removedStudentName} unlinked from family account.`);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to unlink student';
            setErrorMsg(msg);
            toast.error(msg);
        } finally {
            setUnlinkingBusy(false);
        }
    };

    // Phase 11: Handle deactivate unlinked parent
    const handleDeactivateUnlinkedParent = async () => {
        if (!lastChildUnlinkedInfo) return;
        setDeactivatingParentBusy(true);
        try {
            const targetSchoolId = lastChildUnlinkedInfo.schoolId || user?.school_id || null;
            const { error } = await supabase.rpc('fn_admin_set_account_active', {
                _school_id: targetSchoolId,
                _target_user_id: lastChildUnlinkedInfo.parentId,
                _is_active: false,
                _reason: 'Account deactivated after last child unlinked',
            });
            if (error) throw error;

            toast.success(`Account for ${lastChildUnlinkedInfo.parentName} deactivated.`);
            setIsActive(false);
            setLastChildUnlinkedInfo(null);
            queryClient.invalidateQueries({ queryKey: qk.userManagement });
            onSaved();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to deactivate account';
            toast.error(msg);
        } finally {
            setDeactivatingParentBusy(false);
        }
    };

    // Phase 11: Handle relink another student from last child modal
    const handleRelinkFromLastChildModal = () => {
        setLastChildUnlinkedInfo(null);
        setSelectedStudentCandidate(null);
        setStudentSearchQuery('');
        setLinkStudentModalOpen(true);
    };

    // Handle Update Relationship
    const handleUpdateRelationship = async () => {
        if (!user || !editingRelationshipLink) return;
        const targetSchool = editSchool || user.school_id;
        if (!targetSchool) return;

        setUpdatingRelBusy(true);
        setErrorMsg('');
        try {
            const { error } = await supabase.rpc('fn_update_guardian_relationship', {
                _school_id: targetSchool,
                _link_id: editingRelationshipLink.link_id,
                _relationship: editRelVal,
                _is_primary: editPrimaryVal,
            });
            if (error) throw error;

            toast.success('Relationship updated successfully.');
            setEditingRelationshipLink(null);
            fetchFamilyLinks(user.id);
            onSaved();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to update relationship';
            setErrorMsg(msg);
            toast.error(msg);
        } finally {
            setUpdatingRelBusy(false);
        }
    };

    // Handle Update Student Status (Phase 10)
    const handleUpdateStudentStatus = async () => {
        if (!user) return;
        const targetSchool = editSchool || user.school_id;
        if (!targetSchool) return;

        setUpdatingStudentStatus(true);
        try {
            const { error } = await supabase.rpc('fn_set_student_status', {
                _school_id: targetSchool,
                _student_id: user.id,
                _new_status: studentStatus,
                _reason: studentDepartureReason || null,
                _notes: studentDepartureNotes || null,
            });
            if (error) throw error;

            toast.success(`Student status updated to ${studentStatus}. Academic history preserved.`);
            onSaved();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to update student status');
        } finally {
            setUpdatingStudentStatus(false);
        }
    };

    // Fast Set Primary
    const handleSetPrimary = async (student: LinkedStudentTarget) => {
        if (!user || student.is_primary) return;
        const targetSchool = editSchool || user.school_id;
        if (!targetSchool) return;

        try {
            const { error } = await supabase.rpc('fn_update_guardian_relationship', {
                _school_id: targetSchool,
                _link_id: student.link_id,
                _relationship: student.relationship,
                _is_primary: true,
            });
            if (error) throw error;

            toast.success(`${student.full_name} set as primary child.`);
            fetchFamilyLinks(user.id);
            onSaved();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to set primary child');
        }
    };

    // Handle Link Student (Phase 12 Path 1: Link Existing Student)
    const handleExecuteLinkStudent = async () => {
        if (!user || !selectedStudentCandidate) return;
        const targetSchool = editSchool || user.school_id;
        if (!targetSchool) return;

        setLinkingStudentBusy(true);
        setErrorMsg('');
        try {
            const { error } = await supabase.rpc('fn_link_student_guardian', {
                _school_id: targetSchool,
                _parent_id: user.id,
                _student_id: selectedStudentCandidate.student_id,
                _relationship: newLinkRelationship,
                _is_primary: newLinkIsPrimary
            });
            if (error) throw error;

            toast.success(`${selectedStudentCandidate.full_name} linked to family account!`);
            setLinkStudentModalOpen(false);
            setSelectedStudentCandidate(null);
            setStudentSearchQuery('');
            fetchFamilyLinks(user.id);
            if (!additionalRoles.includes('parent') && editRole !== 'parent') {
                setAdditionalRoles(prev => [...prev, 'parent']);
            }
            queryClient.invalidateQueries({ queryKey: qk.userManagement });
            onSaved();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to link student';
            setErrorMsg(msg);
            toast.error(msg);
        } finally {
            setLinkingStudentBusy(false);
        }
    };

    // Phase 12 Path 2: Create New Student & Link to Family (with Phase 14 Duplicate Detection)
    const handleCreateAndLinkStudent = async (skipDupCheck: boolean = false) => {
        if (!user) return;
        const targetSchool = editSchool || user.school_id;
        if (!targetSchool) return;

        const finalEmail = editLockedDomain
            ? `${newStudentEmailLocal.trim().toLowerCase()}@${editLockedDomain}`
            : newStudentEmailLocal.trim().toLowerCase();

        if (!newStudentName.trim() || !finalEmail || newStudentPassword.length < 6) {
            toast.error('Student name, login email, and a password of at least 6 characters are required.');
            return;
        }

        setCreatingStudentBusy(true);

        // Phase 14: Duplicate Detection check before creating
        if (!skipDupCheck) {
            try {
                const { data: dupData, error: dupErr } = await supabase.rpc('fn_detect_duplicate_identities', {
                    _school_id: targetSchool,
                    _name: newStudentName.trim(),
                    _email: finalEmail,
                    _admission_number: finalEmail,
                    _role: 'student',
                });
                if (!dupErr && dupData && Array.isArray(dupData) && dupData.length > 0) {
                    setDetectedChildDuplicates(dupData as DuplicateCandidate[]);
                    setChildDuplicateModalOpen(true);
                    setCreatingStudentBusy(false);
                    return;
                }
            } catch (err) {
                console.warn('Duplicate detection check non-blocking warning:', err);
            }
        }

        try {
            await supabase.auth.refreshSession();

            const body: Record<string, unknown> = {
                email: finalEmail,
                password: newStudentPassword,
                fullName: newStudentName.trim(),
                role: 'student',
                schoolId: targetSchool,
                guardianId: user.id,
                guardianRelationship: newLinkRelationship,
                isPrimaryGuardian: newLinkIsPrimary,
            };

            const { data: fnData, error: fnError } = await supabase.functions.invoke('create_tenant_admin', { body });
            if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Failed to create student'));
            if (fnData?.error) throw new Error(fnData.error);

            toast.success(`Student "${newStudentName.trim()}" created and linked to ${user.full_name || 'family account'}!`);
            setLinkStudentModalOpen(false);
            setNewStudentName('');
            setNewStudentEmailLocal('');
            setNewStudentPassword('');
            fetchFamilyLinks(user.id);
            if (!additionalRoles.includes('parent') && editRole !== 'parent') {
                setAdditionalRoles(prev => [...prev, 'parent']);
            }
            queryClient.invalidateQueries({ queryKey: qk.userManagement });
            onSaved();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to create and link student';
            toast.error(msg);
        } finally {
            setCreatingStudentBusy(false);
        }
    };

    const handleLinkExistingDuplicateChild = async (candidate: DuplicateCandidate) => {
        if (!user) return;
        const targetSchool = editSchool || user.school_id;
        if (!targetSchool) return;

        setChildDuplicateActionBusy(true);
        try {
            const { error: linkErr } = await supabase.rpc('fn_link_student_guardian', {
                _school_id: targetSchool,
                _parent_id: user.id,
                _student_id: candidate.id,
                _relationship: newLinkRelationship,
                _is_primary: newLinkIsPrimary,
            });
            if (linkErr) throw linkErr;

            await supabase.rpc('fn_audit_duplicate_decision', {
                _school_id: targetSchool,
                _resolution: 'link_existing',
                _candidate_id: candidate.id,
                _candidate_name: candidate.full_name,
                _input_name: newStudentName.trim(),
                _input_email: editLockedDomain ? `${newStudentEmailLocal.trim().toLowerCase()}@${editLockedDomain}` : newStudentEmailLocal.trim().toLowerCase(),
                _match_reasons: candidate.match_reasons,
                _detail_notes: 'Admin chose to link existing student to family account instead of creating duplicate',
            });

            toast.success(`Existing student "${candidate.full_name}" linked to ${user.full_name || 'family account'}!`);
            setChildDuplicateModalOpen(false);
            setDetectedChildDuplicates([]);
            setLinkStudentModalOpen(false);
            setNewStudentName('');
            setNewStudentEmailLocal('');
            setNewStudentPassword('');
            fetchFamilyLinks(user.id);
            if (!additionalRoles.includes('parent') && editRole !== 'parent') {
                setAdditionalRoles(prev => [...prev, 'parent']);
            }
            queryClient.invalidateQueries({ queryKey: qk.userManagement });
            onSaved();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to link existing student');
        } finally {
            setChildDuplicateActionBusy(false);
        }
    };

    const handleConfirmCreateNewChild = async () => {
        if (!user) return;
        const targetSchool = editSchool || user.school_id;
        if (!targetSchool) return;

        setChildDuplicateActionBusy(true);
        try {
            const top = detectedChildDuplicates[0];
            await supabase.rpc('fn_audit_duplicate_decision', {
                _school_id: targetSchool,
                _resolution: 'create_new_person',
                _candidate_id: top?.id || null,
                _candidate_name: top?.full_name || null,
                _input_name: newStudentName.trim(),
                _input_email: editLockedDomain ? `${newStudentEmailLocal.trim().toLowerCase()}@${editLockedDomain}` : newStudentEmailLocal.trim().toLowerCase(),
                _match_reasons: top?.match_reasons || [],
                _detail_notes: 'Admin confirmed distinct student identity and proceeded with creation',
            });

            setChildDuplicateModalOpen(false);
            setDetectedChildDuplicates([]);
            await handleCreateAndLinkStudent(true /* skipDupCheck */);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to proceed with creation');
        } finally {
            setChildDuplicateActionBusy(false);
        }
    };

    // Handle Add Teacher Access (single authoritative update_admin pathway)
    const handleAddTeacherAccess = async (skipDupCheck = false) => {
        if (!user) return;
        const staffName = newStaffPersonName.trim();
        if (!staffName) {
            toast.error('Adult staff member full name is required (cannot use student name)');
            return;
        }
        const targetSchool = editSchool || user.school_id;
        if (!targetSchool) {
            toast.error('User must be assigned to a school before enabling staff access');
            return;
        }

        // Phase 14: Check for probable existing staff/teacher identities
        if (!skipDupCheck) {
            try {
                const { data: dupData, error: dupErr } = await supabase.rpc('fn_detect_duplicate_identities', {
                    _school_id: targetSchool,
                    _target_role: 'teacher',
                    _email: null,
                    _full_name: staffName,
                    _phone: null,
                    _admission_number: null,
                    _employee_code: null,
                });
                if (!dupErr && Array.isArray(dupData) && dupData.length > 0) {
                    const filtered = (dupData as DuplicateCandidate[]).filter(c => c.id !== user.id);
                    if (filtered.length > 0) {
                        setTeacherDupCandidates(filtered);
                        setTeacherDupModalOpen(true);
                        return;
                    }
                }
            } catch (dupCatch) {
                console.warn('Teacher duplicate check non-blocking error:', dupCatch);
            }
        }

        setAddingTeacherBusy(true);
        try {
            const body = {
                adminId: user.id,
                schoolId: targetSchool,
                teacherAction: 'enable',
                staffPersonName: staffName,
                designation: newStaffDesignation.trim() || 'Teacher',
                department: newStaffDepartment.trim() || 'Academics',
            };
            const { data: fnData, error: fnError } = await supabase.functions.invoke('update_admin', { body });
            if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Failed to add Teacher access'));
            if (fnData?.error) throw new Error(fnData.error);

            toast.success(`Teacher access granted to ${staffName}!`);
            setAddTeacherModalOpen(false);
            setEditStaffPersonName(staffName);
            setEditDesignation(newStaffDesignation.trim() || 'Teacher');
            setEditDepartment(newStaffDepartment.trim() || 'Academics');
            if (!additionalRoles.includes('teacher') && editRole !== 'teacher') {
                setAdditionalRoles(prev => [...prev, 'teacher']);
            }
            fetchStaffPinStatus(targetSchool, user.id);
            onSaved();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to add Teacher access');
        } finally {
            setAddingTeacherBusy(false);
        }
    };

    const handleSelectExistingTeacherCandidate = (candidate: DuplicateCandidate) => {
        toast.info(`Found existing staff account: ${candidate.full_name} (${candidate.email})`);
        setTeacherDupModalOpen(false);
        setTeacherDupCandidates([]);
        setAddTeacherModalOpen(false);
        handleOpenCanonicalProfile(candidate.id);
    };

    const handleConfirmProceedWithTeacherAccess = async () => {
        if (!user) return;
        const targetSchool = editSchool || user.school_id;
        if (!targetSchool) return;

        setTeacherDupActionBusy(true);
        try {
            const top = teacherDupCandidates[0];
            await supabase.rpc('fn_audit_duplicate_decision', {
                _school_id: targetSchool,
                _resolution: 'create_new_person',
                _candidate_id: top?.id || null,
                _candidate_name: top?.full_name || null,
                _input_name: newStaffPersonName.trim(),
                _input_email: user.email || null,
                _match_reasons: top?.match_reasons || [],
                _detail_notes: 'Admin confirmed distinct staff member and granted Teacher access to user account',
            });

            setTeacherDupModalOpen(false);
            setTeacherDupCandidates([]);
            await handleAddTeacherAccess(true /* skipDupCheck */);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to proceed with granting Teacher access');
        } finally {
            setTeacherDupActionBusy(false);
        }
    };

    // Handle Disable Teacher Access (single authoritative update_admin pathway)
    const handleDisableTeacherAccess = async (clearAssignments: boolean = false) => {
        if (!user) return;
        const targetSchool = editSchool || user.school_id;
        if (!targetSchool) return;

        setDisablingTeacherBusy(true);
        try {
            const body = {
                adminId: user.id,
                schoolId: targetSchool,
                teacherAction: 'disable',
                clearAssignments,
            };
            const { data: fnData, error: fnError } = await supabase.functions.invoke('update_admin', { body });
            if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Failed to disable Teacher access'));
            if (fnData?.error) throw new Error(fnData.error);

            toast.success('Teacher access disabled. Operational assignments handled, unlock sessions revoked, and family access preserved.');
            setDisableTeacherModalOpen(false);
            setAdditionalRoles(prev => prev.filter(r => r !== 'teacher'));
            const resultingRole = (fnData as { new_primary_role?: string })?.new_primary_role;
            if (resultingRole) {
                setEditRole(resultingRole);
            } else if (editRole === 'teacher') {
                const remaining = additionalRoles.find(r => r !== 'teacher') || 'parent';
                setEditRole(remaining);
            }
            if (targetSchool) {
                queryClient.invalidateQueries({ queryKey: qk.teachers.bySchool(targetSchool) });
            }
            queryClient.invalidateQueries({ queryKey: qk.userManagement });
            queryClient.invalidateQueries({ queryKey: ['persona-summary'] });
            onSaved();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to disable Teacher access');
        } finally {
            setDisablingTeacherBusy(false);
        }
    };

    // Handle Save Staff Details
    const handleSaveStaffDetails = async () => {
        if (!user) return;
        const targetSchool = editSchool || user.school_id;
        if (!targetSchool) return;
        const staffName = editStaffPersonName.trim();
        if (!staffName) {
            toast.error('Adult staff member name cannot be empty');
            return;
        }

        setEditingStaffBusy(true);
        try {
            const body = {
                adminId: user.id,
                schoolId: targetSchool,
                teacherAction: 'update_staff',
                staffPersonName: staffName,
                designation: editDesignation.trim(),
                department: editDepartment.trim(),
            };
            const { data: fnData, error: fnError } = await supabase.functions.invoke('update_admin', { body });
            if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Failed to update staff details'));
            if (fnData?.error) throw new Error(fnData.error);

            toast.success('Staff identity details updated successfully.');
            setEditStaffDetailsOpen(false);
            onSaved();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to update staff details');
        } finally {
            setEditingStaffBusy(false);
        }
    };

    // Handle Explicit Account Activation / Deactivation Lifecycle
    const handleToggleAccountActive = async () => {
        if (!user || isProtected) return;
        const nextActive = !isActive;
        setAccountStatusBusy(true);
        try {
            await supabase.auth.refreshSession();
            const targetSchoolId = editSchool || user.school_id || null;
            const { error: activeErr } = await supabase.rpc('fn_admin_set_account_active', {
                _school_id: targetSchoolId,
                _target_user_id: user.id,
                _is_active: nextActive,
                _reason: nextActive ? 'Reactivated in User Management' : 'Deactivated in User Management',
            });
            if (activeErr) throw activeErr;

            setIsActive(nextActive);
            user.is_active = nextActive;
            toast.success(nextActive ? 'Account reactivated successfully.' : 'Account deactivated and active sessions revoked.');
            setShowStatusConfirm(false);
            queryClient.invalidateQueries({ queryKey: qk.userManagement });
            onSaved();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to update account status');
        } finally {
            setAccountStatusBusy(false);
        }
    };

    const handleSave = async () => {
        if (!user) return;
        setSaving(true);
        setMessage('');
        setErrorMsg('');
        try {
            await supabase.auth.refreshSession();

            const composedEmail = editLockedDomain
                ? `${(editEmailLocal || '').trim().toLowerCase()}@${editLockedDomain}`
                : editEmail.trim();

            const body: Record<string, unknown> = {
                adminId: user.id,
                fullName: editFullName.trim() || user.full_name || 'User',
            };
            if (canManageUsers) {
                body.role = editRole;
                body.schoolId = editSchool || '';
                body.metadataPermissions = user.metadata?.permissions ?? [];
                body.additionalRoles = additionalRoles;
                if (composedEmail && composedEmail !== user.email) body.email = composedEmail;
                if (hasTeacherAccess) {
                    body.staffPersonName = editStaffPersonName.trim() || undefined;
                    body.designation = editDesignation.trim();
                    body.department = editDepartment.trim();
                }
            }

            const { data: fnData, error: fnError } = await supabase.functions.invoke('update_admin', { body });
            if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Failed to update user'));
            if (fnData?.error) throw new Error(fnData.error);

            setMessage('Account details updated successfully!');
            onSaved();
            setTimeout(() => onClose(), 1200);
        } catch (err) {
            setErrorMsg((err instanceof Error ? err.message : '') || 'Failed to update user.');
        } finally {
            setSaving(false);
        }
    };

    const handlePasswordReset = async () => {
        if (!user || !newPass || newPass.length < 6) {
            setErrorMsg('Password must be at least 6 characters.');
            return;
        }
        setPassSaving(true);
        setErrorMsg('');
        setMessage('');
        try {
            const { data: { user: currentUser }, error: sessionErr } = await supabase.auth.getUser();
            if (sessionErr || !currentUser) throw new Error('No active session.');

            const body: Record<string, string> = {
                adminId: user.id,
                email: editEmail || user.email,
                fullName: user.full_name || 'User',
                password: newPass,
                schoolId: editSchool || ''
            };

            const { data: fnData, error: fnError } = await supabase.functions.invoke('update_admin', { body });
            if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Failed to update password'));
            if (fnData?.error) throw new Error(fnData.error);

            setMessage('Password updated successfully!');
            setNewPass('');
        } catch (err) {
            setErrorMsg((err instanceof Error ? err.message : '') || 'Failed to reset password.');
        } finally {
            setPassSaving(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && user && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-[60] bg-stone-900/40 backdrop-blur-sm"
                    />
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="fixed top-0 right-0 h-full w-full max-w-lg z-[70] bg-[#FAF9F6] border-l border-gray-200 flex flex-col shadow-2xl overflow-y-auto"
                    >
                        {/* ── Header ── */}
                        <div className="flex justify-between items-center px-8 pt-8 pb-4">
                            <h2 className="text-2xl font-bold text-foreground">User Management</h2>
                            <button onClick={onClose} className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center hover:text-rose-500 transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* ── Avatar & Summary Card ── */}
                        <div className="flex items-center gap-4 mx-8 mb-4 p-4 clay-card">
                            <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center text-white font-bold text-xl shadow-lg flex-shrink-0">
                                {user.avatar_url
                                    ? <img src={user.avatar_url} className="w-full h-full object-cover rounded-2xl" alt="avatar" />
                                    : (user.full_name ? user.full_name.substring(0, 2).toUpperCase() : '??')}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1 min-w-0">
                                    {editingName ? (
                                        <input
                                            autoFocus
                                            value={editFullName}
                                            onChange={e => setEditFullName(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Escape') { setEditFullName(user.full_name || ''); setEditingName(false); } }}
                                            className="clay-input h-8 flex-1 min-w-0 text-sm font-bold"
                                            aria-label="Full name"
                                        />
                                    ) : (
                                        <h3 className="text-lg font-bold text-foreground truncate">{user.full_name || 'No Name'}</h3>
                                    )}
                                    {canEditName && (
                                        <button type="button" onClick={() => setEditingName(true)} className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-colors" aria-label="Edit name">
                                            <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                                <p className="text-xs text-muted truncate">{user.email}</p>
                                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                    {(editRole === 'superadmin' || user.role === 'superadmin') && (
                                        <span className="inline-block text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest bg-purple-100 text-purple-800 border border-purple-200">
                                            Superadmin
                                        </span>
                                    )}
                                    {(editRole === 'admin' || user.role === 'admin' || additionalRoles.includes('admin')) && (
                                        <span className="inline-block text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest bg-amber-100 text-amber-800 border border-amber-200">
                                            School Admin
                                        </span>
                                    )}
                                    {(user.role === 'parent' || editRole === 'parent' || additionalRoles.includes('parent') || linkedStudents.length > 0) ? (
                                        <span className="inline-block text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest bg-indigo-100 text-indigo-800 border border-indigo-200">
                                            Family: Parent
                                        </span>
                                    ) : (user.role === 'student' || editRole === 'student') ? (
                                        <span className="inline-block text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest bg-emerald-100 text-emerald-800 border border-emerald-200">
                                            Student: {studentStatus ? (studentStatus.charAt(0).toUpperCase() + studentStatus.slice(1)) : 'Active'}
                                        </span>
                                    ) : null}
                                    {hasTeacherAccess && (
                                        <span className="inline-block text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest bg-sky-100 text-sky-800 border border-sky-200">
                                            Staff: Teacher
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* ── Alerts ── */}
                        <div className="px-8">
                            {message && <div className="mb-3 p-3 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-xl border border-emerald-100">{message}</div>}
                            {errorMsg && <div className="mb-3 p-3 bg-red-50 text-red-700 text-xs font-medium rounded-xl border border-red-100">{errorMsg}</div>}
                            {isProtected && <div className="mb-3 p-3 bg-amber-50 text-amber-800 text-xs font-medium rounded-xl border border-amber-200">🔒 This is a protected root superadmin account. Role, status, school and email are locked.</div>}
                        </div>

                        {/* ── Body: 5 Distinct High-Clarity Cards ── */}
                        <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-5">

                            {/* ══════════════════════════════════════════════════ */}
                            {/* 1. ACCOUNT CARD */}
                            {/* ══════════════════════════════════════════════════ */}
                            <div className="p-4.5 rounded-2xl bg-white border border-gray-200/90 shadow-2xs space-y-3.5">
                                <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                                    <div className="flex items-center gap-2">
                                        <UserCheck className="w-4 h-4 text-primary" />
                                        <span className="text-xs font-bold uppercase tracking-wider text-foreground">Account Login & Credentials</span>
                                    </div>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                                        {isActive ? 'Active' : 'Disabled'}
                                    </span>
                                </div>

                                {/* Email Address */}
                                <div>
                                    <label className="text-xs font-semibold text-muted block mb-1">
                                        <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" /> Email / Login ID</span>
                                    </label>
                                    {editLockedDomain ? (
                                        <div className={`flex items-stretch rounded-xl overflow-hidden border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-primary/20 ${isProtected ? 'opacity-60' : ''}`}>
                                            <input
                                                type="text"
                                                value={editEmailLocal}
                                                onChange={e => setEditEmailLocal(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                                                disabled={isProtected}
                                                className="flex-1 px-3 py-2 text-sm outline-none disabled:cursor-not-allowed font-mono"
                                                placeholder="john.doe"
                                                autoComplete="off"
                                            />
                                            <span className="px-3 py-2 bg-stone-50 border-l border-gray-200 text-sm text-stone-600 font-mono truncate max-w-[55%]" title={`@${editLockedDomain}`}>
                                                @{editLockedDomain}
                                            </span>
                                        </div>
                                    ) : isSuperadmin ? (
                                        <input
                                            type="email"
                                            value={editEmail}
                                            onChange={e => setEditEmail(e.target.value)}
                                            disabled={isProtected}
                                            className="clay-input w-full text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                                            placeholder="user@example.com"
                                        />
                                    ) : (
                                        <div className="clay-input w-full text-sm bg-stone-50 text-stone-600 font-mono truncate">
                                            {editEmail || '—'}
                                        </div>
                                    )}
                                </div>

                                {/* Administrative Role + School Assignment */}
                                <div className="grid grid-cols-2 gap-2.5">
                                    <div>
                                        <label className="text-xs font-semibold text-muted block mb-1">Administrative Access</label>
                                        {(user.role === 'student' || editRole === 'student') ? (
                                            <div className="clay-input w-full text-xs bg-stone-50 text-stone-600 flex items-center gap-1 truncate font-medium">
                                                <span>Student (No Admin Access)</span>
                                            </div>
                                        ) : (
                                            <select
                                                value={editRole === 'superadmin' ? 'superadmin' : editRole === 'admin' ? 'admin' : 'member'}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    if (val === 'superadmin') setEditRole('superadmin');
                                                    else if (val === 'admin') setEditRole('admin');
                                                    else setEditRole(hasTeacherAccess ? 'teacher' : 'parent');
                                                }}
                                                disabled={isProtected || (!isSuperadmin && editRole === 'superadmin')}
                                                className="clay-input w-full text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                                            >
                                                {isSuperadmin && <option value="superadmin">Root Superadmin</option>}
                                                <option value="admin">School Administrator</option>
                                                <option value="member">Standard Account (No Admin Dashboard)</option>
                                            </select>
                                        )}
                                    </div>
                                    <div>
                                        <label className="text-xs font-semibold text-muted block mb-1">
                                            <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3" /> School</span>
                                        </label>
                                        {isSuperadmin ? (
                                            <select
                                                value={editSchool}
                                                onChange={e => setEditSchool(e.target.value)}
                                                disabled={isProtected}
                                                className="clay-input w-full text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                                            >
                                                <option value="">Platform Core</option>
                                                {schools.map(s => (
                                                    <option key={s.id} value={s.id}>{s.name}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <div className="clay-input w-full text-xs bg-stone-50 text-stone-700 truncate">
                                                {editSelectedSchool?.name ?? 'Platform Core'}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {(user.role === 'student' || editRole === 'student') ? (
                                    <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/90 text-xs text-emerald-950 space-y-1">
                                        <div className="flex items-center gap-1.5 font-bold">
                                            <GraduationCap className="w-4 h-4 text-emerald-700" />
                                            <span>Enrolled Student Identity</span>
                                        </div>
                                        <p className="text-[11px] text-emerald-800/90 leading-relaxed">
                                            This profile is an enrolled student. School administration and staff privileges cannot be assigned to student profiles.
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-[11px] text-muted leading-relaxed">
                                        Family access and educator staff memberships are managed safely and intentionally in the dedicated sections below.
                                    </p>
                                )}
                            </div>

                            {/* ══════════════════════════════════════════════════ */}
                            {/* 1.5 STUDENT ENROLLMENT STATUS CARD (PHASE 10)     */}
                            {/* ══════════════════════════════════════════════════ */}
                            {(editRole === 'student' || user.role === 'student' || additionalRoles.includes('student')) && (
                                <div className="p-4.5 rounded-2xl bg-white border border-gray-200/90 shadow-2xs space-y-3.5">
                                    <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                                        <div className="flex items-center gap-2">
                                            <GraduationCap className="w-4 h-4 text-emerald-600" />
                                            <span className="text-xs font-bold uppercase tracking-wider text-foreground">Student Enrollment Status</span>
                                        </div>
                                        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full capitalize ${
                                            studentStatus === 'active'
                                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                                : studentStatus === 'graduated'
                                                ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                                : studentStatus === 'withdrawn' || studentStatus === 'transferred'
                                                ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                                : 'bg-stone-100 text-stone-700 border border-stone-200'
                                        }`}>
                                            Status: {studentStatus}
                                        </span>
                                    </div>

                                    <div className="space-y-3">
                                        <div>
                                            <label className="text-xs font-semibold text-muted block mb-1.5">Change Enrollment Status</label>
                                            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                                                {(['active', 'withdrawn', 'transferred', 'graduated', 'inactive'] as const).map(st => (
                                                    <button
                                                        key={st}
                                                        type="button"
                                                        onClick={() => setStudentStatus(st)}
                                                        className={`py-1.5 px-2 rounded-xl text-xs font-semibold capitalize border transition-all ${
                                                            studentStatus === st
                                                                ? 'bg-stone-900 text-white border-stone-900 shadow-xs'
                                                                : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
                                                        }`}
                                                    >
                                                        {st}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {studentStatus !== 'active' && (
                                            <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200/80 space-y-2">
                                                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                                                    <span>Departure / Inactive Reason</span>
                                                </div>
                                                <input
                                                    type="text"
                                                    placeholder="Reason (e.g. Relocated to another city, Graduated)"
                                                    value={studentDepartureReason}
                                                    onChange={e => setStudentDepartureReason(e.target.value)}
                                                    className="clay-input w-full text-xs bg-white"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Additional notes (optional)"
                                                    value={studentDepartureNotes}
                                                    onChange={e => setStudentDepartureNotes(e.target.value)}
                                                    className="clay-input w-full text-xs bg-white"
                                                />
                                            </div>
                                        )}

                                        <div className="flex items-center justify-between pt-1">
                                            <p className="text-[10px] text-muted leading-tight">
                                                Preserves marks, attendance, and fee history intact.
                                            </p>
                                            <button
                                                type="button"
                                                onClick={handleUpdateStudentStatus}
                                                disabled={updatingStudentStatus || (studentStatus === (user.student_status || (user.is_active ? 'active' : 'inactive')) && !studentDepartureReason)}
                                                className="clay-btn text-xs py-1.5 px-3.5 disabled:opacity-40 whitespace-nowrap"
                                            >
                                                {updatingStudentStatus ? 'Updating…' : 'Save Status'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ══════════════════════════════════════════════════ */}
                            {/* 2. FAMILY ACCESS CARD */}
                            {/* ══════════════════════════════════════════════════ */}
                            <div className="p-4.5 rounded-2xl bg-white border border-gray-200/90 shadow-2xs space-y-3.5">
                                <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                                    <div className="flex items-center gap-2">
                                        <UsersIcon className="w-4 h-4 text-purple-600" />
                                        <span className="text-xs font-bold uppercase tracking-wider text-foreground">Family Access</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {(() => {
                                            const hasFamilyCapability = user.role === 'parent' || additionalRoles.includes('parent') || linkedStudents.length > 0;
                                            const isAccountActive = isActive && (user.is_active ?? true);
                                            if (!hasFamilyCapability) {
                                                return (
                                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 border border-stone-200">
                                                        No Family Links
                                                    </span>
                                                );
                                            }
                                            if (!isAccountActive) {
                                                return (
                                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
                                                        Family Linked · Account Disabled
                                                    </span>
                                                );
                                            }
                                            return (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200">
                                                    Family Linked · Active
                                                </span>
                                            );
                                        })()}
                                    </div>
                                </div>

                                {/* Student View: Linked Guardians */}
                                {(editRole === 'student' || additionalRoles.includes('student')) && (
                                    <div className="space-y-2">
                                        <p className="text-[11px] font-semibold text-stone-600">Linked Guardians / Parents:</p>
                                        {familyLoading ? (
                                            <p className="text-xs text-muted py-1">Loading family links…</p>
                                        ) : linkedGuardians.length === 0 ? (
                                            <p className="text-xs text-stone-400 italic">No guardians linked to this student yet.</p>
                                        ) : (
                                            <div className="space-y-1.5">
                                                {linkedGuardians.map(g => (
                                                    <div key={g.link_id} className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 flex items-center justify-between gap-2">
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span className="text-xs font-bold text-foreground truncate">
                                                                    {g.staff_person_name || g.full_name}
                                                                </span>
                                                                <span className="text-xs text-stone-400 font-semibold">—</span>
                                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${g.is_active !== false ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-stone-100 text-stone-600 border-stone-200'}`}>
                                                                    {g.is_active !== false ? 'Active' : 'Inactive'}
                                                                </span>
                                                                <span className="text-[10px] font-semibold text-purple-700 bg-purple-100/70 px-1.5 py-0.5 rounded capitalize">
                                                                    {g.relationship}
                                                                </span>
                                                                {g.is_primary && (
                                                                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                                                                        Primary
                                                                    </span>
                                                                )}
                                                                {g.is_staff && (
                                                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">
                                                                        Teacher
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="text-[11px] font-mono text-muted truncate mt-0.5">{g.email}</p>
                                                        </div>
                                                        <div className="flex items-center gap-1 flex-shrink-0">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setEditingRelationshipLink({
                                                                        link_id: g.link_id,
                                                                        target_name: g.staff_person_name || g.full_name,
                                                                        target_role_label: 'guardian',
                                                                        relationship: g.relationship,
                                                                        is_primary: g.is_primary,
                                                                    });
                                                                    setEditRelVal(g.relationship);
                                                                    setEditPrimaryVal(g.is_primary);
                                                                }}
                                                                title="Edit relationship metadata"
                                                                className="p-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 text-stone-700 transition-colors"
                                                            >
                                                                <Settings2 className="w-3.5 h-3.5" />
                                                            </button>
                                                            {onSelectUser && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleOpenCanonicalProfile(g.guardian_id)}
                                                                    title="Open canonical guardian profile"
                                                                    className="p-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 text-stone-700 transition-colors"
                                                                >
                                                                    <ExternalLink className="w-3.5 h-3.5" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Family Account View: Linked Children */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <p className="text-[11px] font-semibold text-stone-600">Linked Children ({linkedStudents.length}):</p>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedStudentCandidate(null);
                                                setStudentSearchQuery('');
                                                setNewStudentName('');
                                                setNewStudentEmailLocal('');
                                                setNewStudentPassword('');
                                                setLinkStudentModalOpen(true);
                                            }}
                                            className="text-xs font-bold text-purple-700 hover:text-purple-800 flex items-center gap-1 transition-colors"
                                        >
                                            <Plus className="w-3.5 h-3.5" />
                                            Add Child
                                        </button>
                                    </div>

                                    {familyLoading ? (
                                        <p className="text-xs text-muted py-2">Loading linked children…</p>
                                    ) : linkedStudents.length === 0 ? (
                                        <div className="p-3.5 rounded-xl bg-stone-50 border border-dashed border-stone-200 text-center space-y-1">
                                            <p className="text-xs text-stone-500">No students are currently linked to this family account.</p>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSelectedStudentCandidate(null);
                                                    setStudentSearchQuery('');
                                                    setLinkStudentModalOpen(true);
                                                }}
                                                className="text-xs font-bold text-primary underline"
                                            >
                                                Add Child
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {linkedStudents.map(s => {
                                                const studentStatusDisplay = s.student_status || (s.is_active === false ? 'inactive' : 'active');
                                                const statusStyle = studentStatusDisplay === 'active'
                                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                                    : studentStatusDisplay === 'withdrawn' || studentStatusDisplay === 'transferred'
                                                    ? 'bg-amber-100 text-amber-800 border-amber-200'
                                                    : studentStatusDisplay === 'graduated'
                                                    ? 'bg-blue-100 text-blue-800 border-blue-200'
                                                    : 'bg-stone-100 text-stone-700 border-stone-200';
                                                return (
                                                    <div
                                                        key={s.link_id}
                                                        className={`p-3 rounded-xl border transition-all space-y-2 ${
                                                            s.is_primary
                                                                ? 'bg-purple-50/40 border-purple-200/90 shadow-2xs'
                                                                : 'bg-stone-50/80 border-stone-200'
                                                        }`}
                                                    >
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    <span className="text-xs font-bold text-foreground truncate">
                                                                        🎓 {s.full_name}
                                                                    </span>
                                                                    <span className="text-xs text-stone-400 font-semibold">—</span>
                                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border capitalize ${statusStyle}`}>
                                                                        {studentStatusDisplay}
                                                                    </span>
                                                                    {s.is_primary && (
                                                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                                            Primary Child
                                                                        </span>
                                                                    )}
                                                                    <span className="text-[10px] font-semibold text-purple-700 bg-purple-100/70 px-1.5 py-0.5 rounded capitalize">
                                                                        {s.relationship}
                                                                    </span>
                                                                </div>
                                                                <p className="text-[11px] text-stone-600 mt-0.5">
                                                                    {s.class_name ? `Class: ${s.class_name}${s.section_name ? ` - ${s.section_name}` : ''}` : 'Class: Not enrolled'}
                                                                    {s.login_id ? ` • Adm ID: ${s.login_id}` : ''}
                                                                </p>
                                                            </div>

                                                            {/* Actions per child */}
                                                            <div className="flex items-center gap-1 flex-shrink-0">
                                                                {!s.is_primary && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleSetPrimary(s)}
                                                                        title="Make primary child"
                                                                        className="px-2 py-1 text-[10px] font-bold rounded-lg border border-stone-200 bg-white hover:bg-stone-100 text-stone-700 transition-colors"
                                                                    >
                                                                        Set Primary
                                                                    </button>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setEditingRelationshipLink({
                                                                            link_id: s.link_id,
                                                                            target_name: s.full_name,
                                                                            target_role_label: 'child',
                                                                            relationship: s.relationship,
                                                                            is_primary: s.is_primary,
                                                                        });
                                                                        setEditRelVal(s.relationship);
                                                                        setEditPrimaryVal(s.is_primary);
                                                                    }}
                                                                    title="Edit relationship metadata"
                                                                    className="p-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 text-stone-700 transition-colors"
                                                                >
                                                                    <Settings2 className="w-3.5 h-3.5" />
                                                                </button>
                                                                {onSelectUser && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleOpenCanonicalProfile(s.student_id)}
                                                                        title="Open canonical student profile (edit student identity, enrollment, etc.)"
                                                                        className="p-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 text-stone-700 transition-colors"
                                                                    >
                                                                        <ExternalLink className="w-3.5 h-3.5" />
                                                                    </button>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setUnlinkingStudent(s)}
                                                                    title="Unlink child from family"
                                                                    className="p-1 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 transition-colors"
                                                                >
                                                                    <UserMinus className="w-3.5 h-3.5" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* ══════════════════════════════════════════════════ */}
                            {/* 3. STAFF ACCESS CARD */}
                            {/* ══════════════════════════════════════════════════ */}
                            <div className="p-4.5 rounded-2xl bg-white border border-gray-200/90 shadow-2xs space-y-3.5">
                                <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                                    <div className="flex items-center gap-2">
                                        <GraduationCap className="w-4 h-4 text-sky-700" />
                                        <span className="text-xs font-bold uppercase tracking-wider text-foreground">Staff Access</span>
                                    </div>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                        hasTeacherAccess
                                            ? 'bg-sky-100 text-sky-800 border border-sky-200'
                                            : employeeStatus === 'inactive'
                                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                            : 'bg-stone-100 text-stone-600'
                                    }`}>
                                        {hasTeacherAccess
                                            ? 'Teacher: Active'
                                            : employeeStatus === 'inactive'
                                            ? 'Teacher: Inactive'
                                            : 'Teacher: Unconfigured'}
                                    </span>
                                </div>

                                {hasTeacherAccess ? (
                                    <div className="p-3.5 rounded-xl bg-sky-50/60 border border-sky-200/80 space-y-3">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <p className="text-xs font-bold text-sky-950">
                                                    {editStaffPersonName || user.full_name} <span className="font-normal text-sky-800">— Teacher</span>
                                                </p>
                                                <p className="text-[11px] text-sky-800 mt-0.5">
                                                    {editDesignation || 'Teacher'} • {editDepartment || 'Academics'}
                                                </p>
                                            </div>
                                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                Active Staff
                                            </span>
                                        </div>

                                        <p className="text-[10px] text-sky-800/80 leading-relaxed">
                                            Canonical adult educator identity used on timetables, subject assignments, and gradebooks.
                                        </p>

                                        <div className="flex items-center gap-2 pt-1">
                                            <button
                                                type="button"
                                                onClick={() => setEditStaffDetailsOpen(true)}
                                                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-white border border-sky-200 text-sky-900 hover:bg-sky-100/50 transition-colors shadow-2xs"
                                            >
                                                Edit Staff Details
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setDisableTeacherModalOpen(true)}
                                                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition-colors shadow-2xs"
                                            >
                                                Disable Teacher Access
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="p-3.5 rounded-xl bg-stone-50 border border-dashed border-stone-200 flex items-center justify-between">
                                        <div>
                                            <p className="text-xs font-medium text-stone-700">No educator access configured.</p>
                                            <p className="text-[10px] text-muted">Grant Teacher access without changing family student accounts.</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setNewStaffPersonName('');
                                                setNewStaffDesignation('Teacher');
                                                setNewStaffDepartment('Academics');
                                                setAddTeacherModalOpen(true);
                                            }}
                                            className="px-3 py-1.5 text-xs font-bold rounded-xl bg-sky-600 text-white hover:bg-sky-700 transition-colors shadow-2xs flex items-center gap-1"
                                        >
                                            <Plus className="w-3.5 h-3.5" />
                                            Add Teacher Access
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* ══════════════════════════════════════════════════ */}
                            {/* 4. STAFF SECURITY CARD (Only if Staff identity exists) */}
                            {/* ══════════════════════════════════════════════════ */}
                            {(hasTeacherAccess || editStaffPersonName) && (
                                <div className="p-4.5 rounded-2xl bg-amber-50/60 border border-amber-200/80 shadow-2xs space-y-3">
                                    <div className="flex items-center justify-between pb-2 border-b border-amber-200/60">
                                        <div className="flex items-center gap-2">
                                            <Lock className="w-4 h-4 text-amber-800" />
                                            <span className="text-xs font-bold uppercase tracking-wider text-amber-900">Staff Mode Security</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                                staffPinInfo?.has_pin
                                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                                    : 'bg-stone-200 text-stone-700'
                                            }`}>
                                                {staffPinInfo?.has_pin ? 'PIN Configured' : 'No PIN Set'}
                                            </span>
                                            {staffPinInfo?.is_locked && (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
                                                    PIN Locked
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <p className="text-[11px] text-amber-900/80 leading-relaxed">
                                        Secures educator mode on shared devices. PIN is securely verified and rate-limited against brute-force attempts.
                                    </p>

                                    {showResetPinInput ? (
                                        <div className="p-3 bg-white rounded-xl border border-amber-200 space-y-2.5">
                                            <label className="text-xs font-semibold text-stone-700 block">
                                                Issue Temporary 6-Digit Staff PIN
                                            </label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    maxLength={8}
                                                    value={tempPinValue}
                                                    onChange={e => setTempPinValue(e.target.value.replace(/\D/g, ''))}
                                                    placeholder="e.g. 123456"
                                                    className="clay-input flex-1 text-sm bg-stone-50"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setTempPinValue(Math.floor(100000 + Math.random() * 900000).toString())}
                                                    className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-stone-200 hover:bg-stone-100 text-stone-700"
                                                >
                                                    Generate
                                                </button>
                                            </div>
                                            <div className="flex justify-end gap-2 pt-1">
                                                <button
                                                    type="button"
                                                    onClick={() => { setShowResetPinInput(false); setTempPinValue(''); }}
                                                    className="text-xs text-stone-600 px-2.5 py-1 rounded hover:bg-stone-100"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={resettingPin || tempPinValue.length < 6}
                                                    onClick={handleIssueStaffPin}
                                                    className="text-xs font-bold px-3 py-1 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                                                >
                                                    {resettingPin ? 'Saving…' : 'Save PIN'}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setShowResetPinInput(true)}
                                            className="w-full text-xs font-bold px-3 py-2 rounded-xl bg-white border border-amber-200 text-amber-900 hover:bg-amber-100/50 transition-colors shadow-2xs flex items-center justify-center gap-1.5"
                                        >
                                            <KeyRound className="w-3.5 h-3.5 text-amber-700" />
                                            {staffPinInfo?.has_pin ? 'Reset Staff PIN / Issue Temporary' : 'Issue Initial Staff PIN'}
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* ══════════════════════════════════════════════════ */}
                            {/* 5. ACCOUNT ACTIONS CARD */}
                            {/* ══════════════════════════════════════════════════ */}
                            <div className="p-4.5 rounded-2xl bg-white border border-gray-200/90 shadow-2xs space-y-3.5">
                                <div className="pb-2 border-b border-gray-100">
                                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">Account Actions & Security</span>
                                </div>

                                {/* Dedicated Account Lifecycle Action */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-xs font-semibold text-muted block">Account Lifecycle Status</label>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                            isActive ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-rose-100 text-rose-800 border border-rose-200'
                                        }`}>
                                            {isActive ? 'Account Active' : 'Account Disabled'}
                                        </span>
                                    </div>

                                    {isProtected ? (
                                        <p className="text-[11px] text-muted italic">Protected system accounts cannot be deactivated.</p>
                                    ) : !showStatusConfirm ? (
                                        <button
                                            type="button"
                                            onClick={() => setShowStatusConfirm(true)}
                                            className={`w-full py-2.5 px-3 rounded-xl shadow-2xs border font-semibold text-xs transition-all flex items-center justify-center gap-2 ${
                                                isActive
                                                    ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                                                    : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                                            }`}
                                        >
                                            <Power className="w-3.5 h-3.5" />
                                            {isActive ? 'Deactivate Account…' : 'Reactivate Account…'}
                                        </button>
                                    ) : (
                                        <div className={`p-3.5 rounded-xl border space-y-2.5 ${
                                            isActive ? 'bg-rose-50/70 border-rose-200 text-rose-950' : 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                                        }`}>
                                            <div className="flex items-center gap-2 font-bold text-xs">
                                                <AlertTriangle className={`w-4 h-4 ${isActive ? 'text-rose-600' : 'text-emerald-600'}`} />
                                                <span>{isActive ? 'Confirm Account Deactivation' : 'Confirm Account Reactivation'}</span>
                                            </div>
                                            <p className="text-[11px] leading-relaxed opacity-90">
                                                {isActive
                                                    ? 'Deactivating this user will immediately revoke all active Staff sessions and block sign-in. Profile and operational links are safely retained.'
                                                    : 'Reactivating this user will restore their sign-in capability and permission to use Kryin Ephor.'}
                                            </p>
                                            <div className="flex items-center justify-end gap-2 pt-1">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowStatusConfirm(false)}
                                                    disabled={accountStatusBusy}
                                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleToggleAccountActive}
                                                    disabled={accountStatusBusy}
                                                    className={`px-3 py-1.5 text-xs font-bold rounded-lg text-white shadow-2xs flex items-center gap-1.5 ${
                                                        isActive ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
                                                    }`}
                                                >
                                                    {accountStatusBusy ? 'Updating…' : (isActive ? 'Yes, Deactivate Account' : 'Yes, Reactivate Account')}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Password Reset */}
                                <div className="space-y-2 pt-2 border-t border-gray-100">
                                    <label className="text-xs font-semibold text-muted block">Set New Password</label>
                                    <input
                                        type="password"
                                        placeholder="Minimum 6 characters"
                                        className="clay-input w-full text-xs"
                                        value={newPass}
                                        onChange={e => setNewPass(e.target.value)}
                                    />
                                    <button
                                        onClick={handlePasswordReset}
                                        disabled={passSaving || !newPass}
                                        className="w-full clay-btn-outline justify-center gap-2 py-2 text-xs flex items-center disabled:opacity-50"
                                    >
                                        <Key className="w-3.5 h-3.5" />
                                        {passSaving ? 'Resetting…' : 'Reset User Password'}
                                    </button>
                                </div>

                                {/* Recovery Email */}
                                {!isProtected && (
                                    <div className="pt-2 border-t border-gray-100">
                                        <RecoveryEmailSection userId={user.id} userEmail={user.email} />
                                    </div>
                                )}

                                {/* Danger zone: Permanent Delete */}
                                {!isProtected && (
                                    <div className="pt-2 border-t border-rose-100">
                                        <button
                                            onClick={() => setDeleteOpen(true)}
                                            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-semibold hover:bg-rose-100 transition-colors"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            Permanently Delete User
                                        </button>
                                        <p className="text-[10px] text-muted mt-1">Irreversible. Removes account credentials immediately.</p>
                                    </div>
                                )}
                            </div>

                        </div>

                        {/* ── Footer: Save Changes ── */}
                        <div className="px-8 pb-8 pt-4 border-t border-gray-200 bg-[#FAF9F6]">
                            <button onClick={handleSave} disabled={saving} className="w-full clay-btn py-3 disabled:opacity-50">
                                {saving ? 'Saving Changes…' : 'Save Changes'}
                            </button>
                        </div>
                    </motion.div>

                    {/* Modals */}
                    <UnlinkChildConfirmModal
                        isOpen={!!unlinkingStudent}
                        onClose={() => setUnlinkingStudent(null)}
                        student={unlinkingStudent}
                        onConfirm={handleUnlinkStudent}
                        busy={unlinkingBusy}
                    />

                    <LastChildUnlinkedModal
                        isOpen={!!lastChildUnlinkedInfo}
                        onClose={() => setLastChildUnlinkedInfo(null)}
                        info={lastChildUnlinkedInfo}
                        onDeactivate={handleDeactivateUnlinkedParent}
                        onRelink={handleRelinkFromLastChildModal}
                        busy={deactivatingParentBusy}
                    />

                    <EditRelationshipModal
                        isOpen={!!editingRelationshipLink}
                        onClose={() => setEditingRelationshipLink(null)}
                        targetName={editingRelationshipLink?.target_name || ''}
                        targetRoleLabel={editingRelationshipLink?.target_role_label || 'family'}
                        relationship={editRelVal}
                        setRelationship={setEditRelVal}
                        isPrimary={editPrimaryVal}
                        setIsPrimary={setEditPrimaryVal}
                        onSave={handleUpdateRelationship}
                        busy={updatingRelBusy}
                    />

                    <AddChildModal
                        isOpen={linkStudentModalOpen}
                        onClose={() => setLinkStudentModalOpen(false)}
                        relationship={newLinkRelationship}
                        setRelationship={setNewLinkRelationship}
                        isPrimary={newLinkIsPrimary}
                        setIsPrimary={setNewLinkIsPrimary}
                        searchQuery={studentSearchQuery}
                        setSearchQuery={setStudentSearchQuery}
                        searching={searchingStudents}
                        candidates={studentCandidates}
                        selected={selectedStudentCandidate}
                        setSelected={setSelectedStudentCandidate}
                        onLinkExisting={handleExecuteLinkStudent}
                        linkingBusy={linkingStudentBusy}
                        schoolDomain={editLockedDomain}
                        newStudentName={newStudentName}
                        setNewStudentName={setNewStudentName}
                        newStudentEmailLocal={newStudentEmailLocal}
                        setNewStudentEmailLocal={setNewStudentEmailLocal}
                        newStudentPassword={newStudentPassword}
                        setNewStudentPassword={setNewStudentPassword}
                        onCreateAndLink={handleCreateAndLinkStudent}
                        creatingBusy={creatingStudentBusy}
                    />

                    {/* Phase 14: Child Duplicate Detection Modal */}
                    <DuplicateDetectionModal
                        isOpen={childDuplicateModalOpen}
                        onClose={() => {
                            setChildDuplicateModalOpen(false);
                            setDetectedChildDuplicates([]);
                        }}
                        candidates={detectedChildDuplicates}
                        inputName={newStudentName}
                        inputEmail={editLockedDomain ? `${newStudentEmailLocal.trim().toLowerCase()}@${editLockedDomain}` : newStudentEmailLocal.trim().toLowerCase()}
                        targetRoleLabel="Student / Child"
                        onLinkExisting={handleLinkExistingDuplicateChild}
                        onCreateNewPerson={handleConfirmCreateNewChild}
                        busy={childDuplicateActionBusy}
                    />

                    {/* Phase 14: Teacher Duplicate Detection Modal */}
                    <DuplicateDetectionModal
                        isOpen={teacherDupModalOpen}
                        onClose={() => {
                            setTeacherDupModalOpen(false);
                            setTeacherDupCandidates([]);
                        }}
                        candidates={teacherDupCandidates}
                        inputName={newStaffPersonName}
                        inputEmail={user?.email || ''}
                        targetRoleLabel="Teacher / Staff"
                        onLinkExisting={handleSelectExistingTeacherCandidate}
                        onCreateNewPerson={handleConfirmProceedWithTeacherAccess}
                        busy={teacherDupActionBusy}
                    />

                    <AddTeacherModal
                        isOpen={addTeacherModalOpen}
                        onClose={() => setAddTeacherModalOpen(false)}
                        staffName={newStaffPersonName}
                        setStaffName={setNewStaffPersonName}
                        designation={newStaffDesignation}
                        setDesignation={setNewStaffDesignation}
                        department={newStaffDepartment}
                        setDepartment={setNewStaffDepartment}
                        onConfirm={handleAddTeacherAccess}
                        busy={addingTeacherBusy}
                    />

                    <DisableTeacherModal
                        isOpen={disableTeacherModalOpen}
                        onClose={() => setDisableTeacherModalOpen(false)}
                        staffName={editStaffPersonName || user.full_name || 'Staff Member'}
                        teacherProfileId={user.id}
                        schoolId={editSchool || user.school_id || ''}
                        onConfirm={handleDisableTeacherAccess}
                        busy={disablingTeacherBusy}
                    />

                    <EditStaffDetailsModal
                        isOpen={editStaffDetailsOpen}
                        onClose={() => setEditStaffDetailsOpen(false)}
                        staffName={editStaffPersonName}
                        setStaffName={setEditStaffPersonName}
                        designation={editDesignation}
                        setDesignation={setEditDesignation}
                        department={editDepartment}
                        setDepartment={setEditDepartment}
                        onSave={handleSaveStaffDetails}
                        busy={editingStaffBusy}
                    />

                    <DeleteUserConfirmModal
                        isOpen={deleteOpen}
                        onClose={() => setDeleteOpen(false)}
                        user={user}
                        schoolName={schools.find(s => s.id === user.school_id)?.name || ''}
                        onDeleted={() => {
                            setDeleteOpen(false);
                            onSaved();
                            onClose();
                        }}
                    />
                </>
            )}
        </AnimatePresence>
    );
};

/* ─── RECOVERY EMAIL SECTION ───────────────────────────── */
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const REC_OTP_TTL_SEC = 10 * 60;

const RecoveryEmailSection: React.FC<{ userId: string; userEmail: string }> = ({ userId, userEmail }) => {
    const [loading, setLoading] = useState(true);
    const [stored, setStored] = useState<string | null>(null);
    const [verified, setVerified] = useState(false);
    const [editing, setEditing] = useState(false);

    const [emailInput, setEmailInput] = useState('');
    const [otp, setOtp] = useState('');
    const [otpSent, setOtpSent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [info, setInfo] = useState('');
    const [error, setError] = useState('');
    const [expiresAt, setExpiresAt] = useState(0);
    const [tick, setTick] = useState(Date.now());

    const load = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('recovery_email, recovery_email_verified')
                .eq('id', userId)
                .maybeSingle();
            if (error) throw error;
            setStored(data?.recovery_email ?? null);
            setVerified(Boolean(data?.recovery_email_verified));
            setEmailInput(data?.recovery_email || '');
            setEditing(!data?.recovery_email_verified);
        } catch {
            setStored(null); setVerified(false); setEditing(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (userId) load();   }, [userId]);

    // OTP countdown
    useEffect(() => {
        if (!otpSent || verified || !expiresAt) return;
        const id = setInterval(() => setTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, [otpSent, verified, expiresAt]);

    const secondsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - tick) / 1000)) : 0;
    const expired = otpSent && !verified && expiresAt > 0 && secondsLeft === 0;
    const validEmail = EMAIL_REGEX.test(emailInput.trim());
    const sameAsLogin = emailInput.trim().toLowerCase() === (userEmail || '').toLowerCase();

    const sendOtp = async () => {
        setError(''); setInfo('');
        if (!validEmail) { setError('Enter a valid email address.'); return; }
        if (sameAsLogin) { setError('Recovery email must differ from the login email.'); return; }
        setBusy(true);
        try {
            await supabase.auth.refreshSession();
            const { data, error } = await supabase.functions.invoke('admin_set_recovery_email', {
                body: { targetUserId: userId, recoveryEmail: emailInput.trim().toLowerCase() },
            });
            if (error) throw new Error(await getFunctionErrorMessage(error, 'Failed to send code'));
            if (data?.error) throw new Error(data.error);
            setOtpSent(true);
            setOtp('');
            setExpiresAt(Date.now() + REC_OTP_TTL_SEC * 1000);
            setTick(Date.now());
            setInfo(data?.message || 'Verification code sent.');
            toast.success('Verification code sent.');
        } catch (e) {
            const friendly = (e instanceof Error ? e.message : '') || 'Failed to send code.';
            setError(friendly);
            toast.error(friendly);
        } finally { setBusy(false); }
    };

    const confirmOtp = async () => {
        setError(''); setInfo('');
        if (expired) { setError('Code expired. Send a new one.'); return; }
        if (!/^\d{6}$/.test(otp.trim())) { setError('Enter the 6-digit code.'); return; }
        setBusy(true);
        try {
            await supabase.auth.refreshSession();
            const { data, error } = await supabase.functions.invoke('admin_set_recovery_email', {
                body: { targetUserId: userId, code: otp.trim() },
            });
            if (error) throw new Error(await getFunctionErrorMessage(error, 'Verification failed'));
            if (data?.error) throw new Error(data.error);
            toast.success('Recovery email verified.');
            setOtpSent(false); setOtp(''); setExpiresAt(0);
            await load();
        } catch (e) {
            const friendly = (e instanceof Error ? e.message : '') || 'Verification failed.';
            setError(friendly);
            toast.error(friendly);
        } finally { setBusy(false); }
    };

    const mmss = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;

    return (
        <div className="pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-bold text-muted uppercase tracking-widest">Recovery Email</p>
                {verified && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" /> Verified
                    </span>
                )}
            </div>

            {loading ? (
                <p className="text-xs text-muted italic">Loading…</p>
            ) : verified && !editing ? (
                <div className="flex items-center justify-between bg-emerald-50/60 border border-emerald-100 rounded-xl p-3">
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-emerald-900 truncate">{stored}</p>
                        <p className="text-[10px] text-emerald-700/80">Used for password recovery.</p>
                    </div>
                    <button
                        onClick={() => { setEditing(true); setOtpSent(false); setError(''); setInfo(''); }}
                        className="text-[11px] font-semibold text-emerald-700 hover:underline px-2 py-1 rounded-md"
                    >
                        Change
                    </button>
                </div>
            ) : (
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted block">
                        <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" /> Recovery email</span>
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="email"
                            value={emailInput}
                            disabled={otpSent || busy}
                            onChange={e => setEmailInput(e.target.value)}
                            placeholder="recovery@example.com"
                            className="clay-input w-full text-sm disabled:opacity-60"
                        />
                        {!otpSent && (
                            <button
                                onClick={sendOtp}
                                disabled={busy || !validEmail || sameAsLogin}
                                className="px-3 rounded-xl bg-primary text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Send className="w-3.5 h-3.5" />
                                {busy ? 'Sending…' : 'Send code'}
                            </button>
                        )}
                    </div>
                    {stored && !verified && !otpSent && (
                        <p className="text-[10px] text-amber-700">Saved as <strong>{stored}</strong> but not yet verified.</p>
                    )}

                    {otpSent && (
                        <div className="space-y-2 mt-2 p-3 rounded-xl border border-amber-100 bg-amber-50/50">
                            <label className="text-xs font-semibold text-amber-900 block">Enter the 6-digit code we just sent</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    value={otp}
                                    onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                                    placeholder="123456"
                                    disabled={busy}
                                    className="clay-input w-full text-sm font-mono tracking-[0.4em] text-center"
                                />
                                <button
                                    onClick={confirmOtp}
                                    disabled={busy || otp.length !== 6 || expired}
                                    className="px-3 rounded-xl bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
                                >
                                    {busy ? 'Verifying…' : 'Verify'}
                                </button>
                            </div>
                            <div className="flex items-center justify-between text-[10px]">
                                <span className={expired ? 'text-rose-700 font-semibold' : 'text-amber-800'}>
                                    {expired ? 'Code expired.' : `Expires in ${mmss}`}
                                </span>
                                <button
                                    type="button"
                                    onClick={sendOtp}
                                    disabled={busy}
                                    className="inline-flex items-center gap-1 text-amber-800 hover:underline disabled:opacity-50"
                                >
                                    <RefreshCw className="w-3 h-3" /> Resend
                                </button>
                            </div>
                        </div>
                    )}

                    {error && <p className="text-[11px] text-rose-700">{error}</p>}
                    {info && !error && <p className="text-[11px] text-emerald-700">{info}</p>}

                    {verified && editing && (
                        <button
                            onClick={() => { setEditing(false); setError(''); setInfo(''); setOtpSent(false); setEmailInput(stored || ''); }}
                            className="text-[10px] text-muted hover:underline"
                        >
                            Cancel change
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

/* ─── DELETE USER CONFIRMATION ─────────────────────────── */
const slugifyClient = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const DeleteUserConfirmModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    user: User;
    schoolName: string;
    onDeleted: () => void;
    onArchiveStudent?: () => void;
}> = ({ isOpen, onClose, user, schoolName, onDeleted }) => {
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [eligibilityChecking, setEligibilityChecking] = useState(false);
    const [eligibility, setEligibility] = useState<{ can_delete: boolean; reasons: string[]; summary: string } | null>(null);
    const [archiveMode, setArchiveMode] = useState(false);
    const [archiveStatus, setArchiveStatus] = useState('withdrawn');
    const [archiveReason, setArchiveReason] = useState('Archived instead of hard delete due to dependencies');
    const [archiveNotes, setArchiveNotes] = useState('');
    const [archivingBusy, setArchivingBusy] = useState(false);
    const inputRef = React.useRef<HTMLInputElement>(null);

    const isStudent = user.role === 'student' || (user.roles && user.roles.includes('student'));
    const schoolSlug = schoolName ? slugifyClient(schoolName) : 'platform';
    const expected = `${schoolSlug}/${(user.full_name || '').trim().toLowerCase()}`;
    const typed = text.trim().toLowerCase();
    const matches = typed === expected;
    const empty = typed.length === 0;

    // Live validation state
    const validation: { tone: 'idle' | 'progress' | 'error' | 'ok'; msg: string } =
        empty ? { tone: 'idle', msg: 'Type the confirmation string above to enable deletion.' }
        : matches ? { tone: 'ok', msg: '✓ Match — deletion enabled.' }
        : expected.startsWith(typed) ? { tone: 'progress', msg: `Keep typing… (${typed.length}/${expected.length})` }
        : { tone: 'error', msg: "Doesn't match the required string. Check school slug and name." };

    useEffect(() => {
        if (isOpen) {
            setText(''); setErr(''); setArchiveMode(false);
            if (isStudent && user.school_id) {
                setEligibilityChecking(true);
                (async () => {
                    try {
                        const { data, error } = await supabase.rpc('fn_check_student_delete_eligibility', {
                            _school_id: user.school_id,
                            _student_id: user.id,
                        });
                        if (!error && data) {
                            const eligResult = data as { can_delete: boolean; reasons: string[]; summary: string };
                            setEligibility(eligResult);
                            if (!eligResult.can_delete && user.school_id) {
                                await supabase.rpc('fn_audit_student_deletion_attempt', {
                                    _school_id: user.school_id,
                                    _student_id: user.id,
                                    _blocked: true,
                                    _reasons: eligResult.reasons || [],
                                    _notes: 'Admin opened student deletion confirmation; deletion blocked by academic records check.',
                                });
                            }
                        }
                    } catch {
                        // ignore
                    } finally {
                        setEligibilityChecking(false);
                    }
                })();
            } else {
                setEligibility(null);
                setEligibilityChecking(false);
                const t = setTimeout(() => inputRef.current?.focus(), 60);
                return () => clearTimeout(t);
            }
        }
    }, [isOpen, user, isStudent]);

    const handleDelete = async () => {
        if (!matches || (eligibility && !eligibility.can_delete)) return;
        setBusy(true);
        setErr('');
        try {
            await supabase.auth.refreshSession();
            const { data, error } = await supabase.functions.invoke('delete_user', {
                body: { targetUserId: user.id, confirmText: text.trim() },
            });
            if (error) throw new Error(await getFunctionErrorMessage(error, 'Failed to delete user'));
            if (data?.error) throw new Error(data.error);
            toast.success(`Deleted ${user.full_name || user.email}`);
            onDeleted();
        } catch (e) {
            const friendly = (e instanceof Error ? e.message : '') || 'Failed to delete user.';
            setErr(friendly);
            toast.error(friendly);
            // Keep the modal open so the admin can retry or cancel.
        } finally {
            setBusy(false);
        }
    };

    const handleConfirmArchive = async () => {
        if (!user.school_id) return;
        setArchivingBusy(true);
        setErr('');
        try {
            const { error } = await supabase.rpc('fn_set_student_status', {
                _school_id: user.school_id,
                _student_id: user.id,
                _new_status: archiveStatus,
                _reason: archiveReason || null,
                _notes: archiveNotes || null,
            });
            if (error) throw error;
            toast.success(`Student status updated to ${archiveStatus}. Academic history preserved.`);
            onDeleted();
            onClose();
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Failed to archive student';
            setErr(msg);
            toast.error(msg);
        } finally {
            setArchivingBusy(false);
        }
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && matches && !busy && (!eligibility || eligibility.can_delete)) handleDelete();
        if (e.key === 'Escape' && !busy) onClose();
    };

    const validationStyles = {
        idle: 'text-muted',
        progress: 'text-amber-700',
        error: 'text-rose-700',
        ok: 'text-emerald-700',
    }[validation.tone];

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={busy || archivingBusy ? undefined : onClose}
                        className="fixed inset-0 z-[80] bg-stone-900/50 backdrop-blur-sm"
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[90] w-[92vw] max-w-md bg-white rounded-3xl shadow-2xl border border-rose-100 overflow-hidden"
                    >
                        <div className="p-6">
                            <div className="flex items-start gap-3 mb-4">
                                <div className="w-11 h-11 rounded-2xl bg-rose-100 flex items-center justify-center flex-shrink-0">
                                    <AlertTriangle className="w-5 h-5 text-rose-600" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-foreground">
                                        {archiveMode ? 'Archive Student' : 'Permanently delete user?'}
                                    </h3>
                                    <p className="text-xs text-muted mt-0.5">
                                        {archiveMode
                                            ? `Confirm departure status transition for ${user.full_name}. Academic records will be preserved.`
                                            : `This will remove ${user.full_name} (${user.email}) and all related access. This action cannot be undone.`}
                                    </p>
                                </div>
                            </div>

                            {archiveMode ? (
                                <div className="space-y-4">
                                    <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 space-y-3">
                                        <div className="flex items-center gap-2 font-bold text-xs text-amber-950">
                                            <GraduationCap className="w-4 h-4 text-amber-600 flex-shrink-0" />
                                            <span>Confirm Departure & Archival</span>
                                        </div>

                                        <div>
                                            <label className="text-[11px] font-semibold text-amber-950 block mb-1.5">New Student Status</label>
                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                                                {(['withdrawn', 'transferred', 'graduated', 'inactive'] as const).map(st => (
                                                    <button
                                                        key={st}
                                                        type="button"
                                                        onClick={() => setArchiveStatus(st)}
                                                        className={`py-1.5 px-2 rounded-xl text-xs font-semibold capitalize border transition-all ${
                                                            archiveStatus === st
                                                                ? 'bg-amber-700 text-white border-amber-700 shadow-xs'
                                                                : 'bg-white text-stone-700 border-amber-200 hover:bg-amber-100/60'
                                                        }`}
                                                    >
                                                        {st}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div>
                                            <label className="text-[11px] font-semibold text-amber-950 block mb-1">Departure Reason</label>
                                            <input
                                                type="text"
                                                value={archiveReason}
                                                onChange={e => setArchiveReason(e.target.value)}
                                                placeholder="Reason (e.g. Relocated, Graduated, Duplicate Remediation)"
                                                className="clay-input w-full text-xs bg-white"
                                            />
                                        </div>

                                        <div>
                                            <label className="text-[11px] font-semibold text-amber-950 block mb-1">Notes (optional)</label>
                                            <input
                                                type="text"
                                                value={archiveNotes}
                                                onChange={e => setArchiveNotes(e.target.value)}
                                                placeholder="Optional administrative notes"
                                                className="clay-input w-full text-xs bg-white"
                                            />
                                        </div>
                                    </div>

                                    {err && <div className="p-2.5 bg-red-50 text-red-700 text-xs font-medium rounded-lg border border-red-100">{err}</div>}

                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => { setArchiveMode(false); setErr(''); }}
                                            disabled={archivingBusy}
                                            className="flex-1 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-muted hover:bg-gray-50 transition-colors disabled:opacity-50"
                                        >
                                            Back
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleConfirmArchive}
                                            disabled={archivingBusy}
                                            className="flex-1 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                                        >
                                            {archivingBusy ? 'Archiving…' : 'Confirm Archive'}
                                        </button>
                                    </div>
                                </div>
                            ) : eligibilityChecking ? (
                                <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 text-center py-6 text-xs text-muted">
                                    Checking academic record dependencies…
                                </div>
                            ) : eligibility && !eligibility.can_delete ? (
                                <div className="space-y-4">
                                    <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 space-y-2">
                                        <div className="flex items-center gap-2 font-bold text-xs text-amber-950">
                                            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                                            <span>Permanent Deletion Blocked</span>
                                        </div>
                                        <p className="text-xs text-amber-900/90 leading-relaxed">
                                            This student cannot be permanently deleted because active or historical records exist:
                                        </p>
                                        <ul className="list-disc list-inside text-[11px] font-semibold text-amber-950 space-y-0.5">
                                            {eligibility.reasons.map((r, i) => (
                                                <li key={i}>{r}</li>
                                            ))}
                                        </ul>
                                        <p className="text-[11px] text-amber-800 pt-1">
                                            Hard deletion is refused to preserve marks, attendance, and fee history. Please mark the student as <strong>Withdrawn</strong>, <strong>Transferred</strong>, or <strong>Inactive</strong> instead.
                                        </p>
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            onClick={onClose}
                                            className="flex-1 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-muted hover:bg-gray-50 transition-colors"
                                        >
                                            Close
                                        </button>
                                        <button
                                            onClick={() => setArchiveMode(true)}
                                            className="flex-1 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 transition-colors inline-flex items-center justify-center gap-1.5"
                                        >
                                            <GraduationCap className="w-4 h-4" />
                                            Archive Student
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="bg-rose-50/60 border border-rose-100 rounded-xl p-3 mb-3">
                                        <p className="text-[11px] font-semibold text-rose-700 uppercase tracking-wider mb-1">To confirm, type</p>
                                        <p className="font-mono text-sm font-bold text-rose-900 break-all">{expected}</p>
                                    </div>

                                    <input
                                        ref={inputRef}
                                        type="text"
                                        value={text}
                                        onChange={e => setText(e.target.value)}
                                        onKeyDown={onKeyDown}
                                        placeholder={expected}
                                        aria-invalid={validation.tone === 'error'}
                                        aria-describedby="delete-confirm-hint"
                                        className={`clay-input w-full text-sm font-mono transition-colors ${
                                            validation.tone === 'ok' ? 'border-emerald-300 ring-1 ring-emerald-200' :
                                            validation.tone === 'error' ? 'border-rose-300 ring-1 ring-rose-200' : ''
                                        }`}
                                    />
                                    <p id="delete-confirm-hint" className={`text-[11px] mt-1.5 ${validationStyles}`}>
                                        {validation.msg}
                                    </p>

                                    {err && <div className="mt-3 p-2.5 bg-red-50 text-red-700 text-xs font-medium rounded-lg border border-red-100">{err}</div>}

                                    <div className="flex gap-2 mt-5">
                                        <button
                                            onClick={onClose}
                                            disabled={busy}
                                            className="flex-1 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-muted hover:bg-gray-50 transition-colors disabled:opacity-50"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleDelete}
                                            disabled={!matches || busy}
                                            className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                            {busy ? 'Deleting…' : 'Delete forever'}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

/* ─── STAFF CANDIDATE TYPE ───────────────────────────────── */
interface StaffSearchCandidate {
    account_id: string;
    email: string;
    full_name: string;
    primary_role: string;
    roles: string[];
    is_active: boolean;
    linked_students: Array<{
        student_id: string;
        student_name: string;
        class_name: string | null;
        relationship: string;
        is_primary: boolean;
    }>;
    has_teacher_role: boolean;
    staff_person_name: string | null;
    designation: string | null;
    department: string | null;
}

/* ─── ADD USER MODAL ────────────────────────────────────── */
const AddUserModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    schools: { id: string; name: string; email_domain?: string | null; combined_parent_student_account?: boolean }[];
    onCreated: () => void;
    initialRole?: string;
}> = ({ isOpen, onClose, schools, onCreated, initialRole }) => {
    const { user: currentUser, role: currentRole } = useAuth();
    const isSuperadmin = currentRole === 'superadmin';
    const myschoolId = currentUser?.schoolId ?? '';

    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');           // full email (used for Platform Core / no-domain)
    const [emailLocal, setEmailLocal] = useState(''); // username-only when school has email_domain
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('admin');
    // Non-superadmins can only create users inside their own school.
    const [schoolId, setSchoolId] = useState<string>(isSuperadmin ? '' : (myschoolId || ''));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Teacher-specific workflow: 'new' vs 'attach_family'
    const [teacherMode, setTeacherMode] = useState<'new' | 'attach_family'>('new');
    const [teacherStaffName, setTeacherStaffName] = useState('');
    const [teacherDesignation, setTeacherDesignation] = useState('');
    const [teacherDepartment, setTeacherDepartment] = useState('');

    // Attach to existing family account state
    const [familySearchQuery, setFamilySearchQuery] = useState('');
    const [familySearchResults, setFamilySearchResults] = useState<StaffSearchCandidate[]>([]);
    const [isSearchingFamily, setIsSearchingFamily] = useState(false);
    const [selectedFamilyAccount, setSelectedFamilyAccount] = useState<StaffSearchCandidate | null>(null);
    const [attachStaffPersonName, setAttachStaffPersonName] = useState('');
    const [attachDesignation, setAttachDesignation] = useState('Teacher');
    const [attachDepartment, setAttachDepartment] = useState('');

    // Student guardian linking state (Phase 4: Teacher-First, Child-Later)
    interface GuardianCandidate {
        guardian_id: string;
        email: string;
        full_name: string;
        primary_role: string;
        roles: string[];
        is_active: boolean;
        has_staff_role: boolean;
        staff_person_name: string | null;
        designation: string | null;
        department: string | null;
        linked_children_count: number;
    }
    const [linkGuardian, setLinkGuardian] = useState(false);
    const [guardianSearchQuery, setGuardianSearchQuery] = useState('');
    const [guardianSearchResults, setGuardianSearchResults] = useState<GuardianCandidate[]>([]);
    const [isSearchingGuardian, setIsSearchingGuardian] = useState(false);
    const [selectedGuardian, setSelectedGuardian] = useState<GuardianCandidate | null>(null);
    const [guardianRelationship, setGuardianRelationship] = useState('mother');
    const [isPrimaryGuardian, setIsPrimaryGuardian] = useState(true);

    // Phase 14: Duplicate detection state
    const [userDupCandidates, setUserDupCandidates] = useState<DuplicateCandidate[]>([]);
    const [showUserDupModal, setShowUserDupModal] = useState(false);
    const [userDupBusy, setUserDupBusy] = useState(false);

    // Recovery-email flow (after user is created)
    const [createdUserId, setCreatedUserId] = useState<string>('');
    const [recoveryEmail, setRecoveryEmail] = useState('');
    const [recoverySent, setRecoverySent] = useState(false);
    const [recoveryVerified, setRecoveryVerified] = useState(false);
    const [otp, setOtp] = useState('');
    const [recError, setRecError] = useState('');
    const [recInfo, setRecInfo] = useState('');
    const [recBusy, setRecBusy] = useState(false);
    // 'idle' | 'sending' | 'sent' | 'failed'
    const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
    const OTP_TTL_SEC = 10 * 60;
    const [expiresAt, setExpiresAt] = useState<number>(0); // epoch ms
    const [now, setNow] = useState<number>(Date.now());

    // Tick every second while waiting for OTP entry
    useEffect(() => {
        if (!recoverySent || recoveryVerified || !expiresAt) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [recoverySent, recoveryVerified, expiresAt]);

    const secondsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : 0;
    const expired = recoverySent && !recoveryVerified && expiresAt > 0 && secondsLeft === 0;

    // Selected school's email domain (if any). Locks the "@domain" suffix.
    const selectedSchool = schools.find(s => s.id === schoolId);
    const lockedDomain = selectedSchool?.email_domain || '';

    useEffect(() => {
        if (isOpen) {
            setFullName(''); setEmail(''); setEmailLocal(''); setPassword('');
            setRole(initialRole || 'admin');
            setSchoolId(isSuperadmin ? '' : (myschoolId || ''));
            setError(''); setSuccess('');
            setCreatedUserId(''); setRecoveryEmail(''); setRecoverySent(false);
            setRecoveryVerified(false); setOtp('');
            setRecError(''); setRecInfo('');
            setSendStatus('idle'); setExpiresAt(0);
            setTeacherMode('new');
            setTeacherStaffName('');
            setTeacherDesignation('');
            setTeacherDepartment('');
            setFamilySearchQuery('');
            setFamilySearchResults([]);
            setSelectedFamilyAccount(null);
            setAttachStaffPersonName('');
            setAttachDesignation('Teacher');
            setAttachDepartment('');
            setLinkGuardian(false);
            setGuardianSearchQuery('');
            setGuardianSearchResults([]);
            setSelectedGuardian(null);
            setGuardianRelationship('mother');
            setIsPrimaryGuardian(true);
            setUserDupCandidates([]);
            setShowUserDupModal(false);
            setUserDupBusy(false);
        }
    }, [isOpen, isSuperadmin, myschoolId, initialRole]);

    // Clear email fields when switching schools with/without a domain
    useEffect(() => { setEmail(''); setEmailLocal(''); }, [schoolId]);

    // Live search for existing family accounts when in attach mode
    useEffect(() => {
        if (!isOpen || role !== 'teacher' || teacherMode !== 'attach_family') return;
        const targetSchool = schoolId || myschoolId;
        if (!targetSchool) return;

        const timer = setTimeout(async () => {
            setIsSearchingFamily(true);
            try {
                const { data, error: searchErr } = await supabase.rpc('fn_search_school_accounts_for_staff', {
                    _school_id: targetSchool,
                    _query: familySearchQuery.trim()
                });
                if (!searchErr && Array.isArray(data)) {
                    setFamilySearchResults(data as StaffSearchCandidate[]);
                } else {
                    setFamilySearchResults([]);
                }
            } catch {
                setFamilySearchResults([]);
            } finally {
                setIsSearchingFamily(false);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [isOpen, role, teacherMode, schoolId, myschoolId, familySearchQuery]);

    // Live search for guardian candidates when creating student
    useEffect(() => {
        if (!isOpen || role !== 'student' || !linkGuardian) return;
        const targetSchool = schoolId || myschoolId;
        if (!targetSchool) return;

        const timer = setTimeout(async () => {
            setIsSearchingGuardian(true);
            try {
                const { data, error: searchErr } = await supabase.rpc('fn_search_guardians_for_student', {
                    _school_id: targetSchool,
                    _query: guardianSearchQuery.trim()
                });
                if (!searchErr && Array.isArray(data)) {
                    setGuardianSearchResults(data as GuardianCandidate[]);
                } else {
                    setGuardianSearchResults([]);
                }
            } catch {
                setGuardianSearchResults([]);
            } finally {
                setIsSearchingGuardian(false);
            }
        }, 250);
        return () => clearTimeout(timer);
    }, [isOpen, role, linkGuardian, schoolId, myschoolId, guardianSearchQuery]);

    const handleCreate = async (skipDupCheck = false) => {
        // Compose the effective email
        const finalEmail = lockedDomain
            ? `${emailLocal.trim().toLowerCase()}@${lockedDomain}`
            : email.trim().toLowerCase();

        if (!fullName.trim() || !finalEmail || password.length < 6) {
            setError('Name, email, and a password of at least 6 characters are required.');
            return;
        }
        if (lockedDomain && !/^[a-z0-9._-]+$/.test(emailLocal.trim().toLowerCase())) {
            setError('Username can only contain letters, numbers, dot, dash, underscore.');
            return;
        }
        if (!lockedDomain && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(finalEmail)) {
            setError('Enter a valid email address.');
            return;
        }

        const targetSchool = schoolId || myschoolId;
        const effectiveName = role === 'teacher' && teacherStaffName.trim() ? teacherStaffName.trim() : fullName.trim();

        // Phase 14: Duplicate detection check before creation
        if (!skipDupCheck && targetSchool) {
            setSaving(true);
            try {
                const { data: dupData, error: dupErr } = await supabase.rpc('fn_detect_duplicate_identities', {
                    _school_id: targetSchool,
                    _target_role: role,
                    _email: finalEmail,
                    _full_name: effectiveName,
                    _phone: null,
                    _admission_number: null,
                    _employee_code: null,
                });
                if (!dupErr && Array.isArray(dupData) && dupData.length > 0) {
                    setUserDupCandidates(dupData as DuplicateCandidate[]);
                    setShowUserDupModal(true);
                    setSaving(false);
                    return;
                }
            } catch (dupCatch) {
                console.warn('User duplicate check non-blocking error:', dupCatch);
            }
        }

        setSaving(true); setError(''); setSuccess('');
        try {
            const body: Record<string, unknown> = { email: finalEmail, password, fullName: fullName.trim(), role };
            if (schoolId) body.schoolId = schoolId;
            if (role === 'teacher') {
                if (teacherStaffName.trim()) body.staffPersonName = teacherStaffName.trim();
                if (teacherDesignation.trim()) body.designation = teacherDesignation.trim();
                if (teacherDepartment.trim()) body.department = teacherDepartment.trim();
            }
            if (role === 'student' && linkGuardian && selectedGuardian) {
                body.guardianId = selectedGuardian.guardian_id;
                body.guardianRelationship = guardianRelationship;
                body.isPrimaryGuardian = isPrimaryGuardian;
            }

            await supabase.auth.refreshSession();

            const { data, error: fnError } = await supabase.functions.invoke('create_tenant_admin', { body });
            if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Failed to create user'));
            if (data?.error) throw new Error(data.error);
            const newId = data?.user?.id || data?.userId || data?.id || '';
            setCreatedUserId(newId);
            setSuccess(`User "${fullName}" created.${selectedGuardian ? ` Linked to guardian "${selectedGuardian.staff_person_name || selectedGuardian.full_name}".` : ''} Now add a recovery email below (optional).`);
            onCreated();
        } catch (err) {
            setError((err instanceof Error ? err.message : '') || 'Failed to create user.');
        } finally {
            setSaving(false);
        }
    };

    const handleLinkExistingUserCandidate = async (candidate: DuplicateCandidate) => {
        const targetSchool = schoolId || myschoolId;
        if (!targetSchool) return;

        setUserDupBusy(true);
        try {
            const finalEmail = lockedDomain
                ? `${emailLocal.trim().toLowerCase()}@${lockedDomain}`
                : email.trim().toLowerCase();
            const effectiveName = role === 'teacher' && teacherStaffName.trim() ? teacherStaffName.trim() : fullName.trim();

            // 1. Audit resolution
            await supabase.rpc('fn_audit_duplicate_decision', {
                _school_id: targetSchool,
                _resolution: 'link_existing',
                _candidate_id: candidate.id,
                _candidate_name: candidate.full_name,
                _input_name: effectiveName,
                _input_email: finalEmail,
                _match_reasons: candidate.match_reasons || [],
                _detail_notes: `Admin linked existing identity (${candidate.id}) instead of creating new ${role}`,
            });

            // 2. Grant role / link access
            if (role === 'teacher') {
                const body: Record<string, unknown> = {
                    adminId: candidate.id,
                    schoolId: targetSchool,
                    teacherAction: 'enable',
                    staffPersonName: teacherStaffName.trim() || candidate.full_name,
                    designation: teacherDesignation.trim() || 'Teacher',
                    department: teacherDepartment.trim() || 'Academics',
                };
                const { data: fnData, error: fnError } = await supabase.functions.invoke('update_admin', { body });
                if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Failed to grant Teacher access'));
                if (fnData?.error) throw new Error(fnData.error);
            } else {
                const existingRoles = candidate.primary_role ? [candidate.primary_role] : [];
                const updatedRoles = Array.from(new Set([...existingRoles, role]));
                const body: Record<string, unknown> = {
                    adminId: candidate.id,
                    additionalRoles: updatedRoles,
                };
                const { data: fnData, error: fnError } = await supabase.functions.invoke('update_admin', { body });
                if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Failed to update user roles'));
                if (fnData?.error) throw new Error(fnData.error);
            }

            // 3. If student and guardian was selected, also link to guardian
            if (role === 'student' && linkGuardian && selectedGuardian) {
                const { error: linkErr } = await supabase.rpc('fn_link_parent_student', {
                    _parent_id: selectedGuardian.guardian_id,
                    _student_id: candidate.id,
                    _school_id: targetSchool,
                    _relationship: guardianRelationship,
                    _is_primary: isPrimaryGuardian,
                });
                if (linkErr) {
                    toast.error(`Account updated but failed to link guardian: ${linkErr.message}`);
                }
            }

            toast.success(`Identity successfully linked to ${candidate.full_name}!`);
            setShowUserDupModal(false);
            setUserDupCandidates([]);
            onCreated();
            onClose();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to link identity');
        } finally {
            setUserDupBusy(false);
        }
    };

    const handleConfirmCreateNewUser = async () => {
        const targetSchool = schoolId || myschoolId;
        if (!targetSchool) return;

        setUserDupBusy(true);
        try {
            const finalEmail = lockedDomain
                ? `${emailLocal.trim().toLowerCase()}@${lockedDomain}`
                : email.trim().toLowerCase();
            const effectiveName = role === 'teacher' && teacherStaffName.trim() ? teacherStaffName.trim() : fullName.trim();
            const top = userDupCandidates[0];

            await supabase.rpc('fn_audit_duplicate_decision', {
                _school_id: targetSchool,
                _resolution: 'create_new_person',
                _candidate_id: top?.id || null,
                _candidate_name: top?.full_name || null,
                _input_name: effectiveName,
                _input_email: finalEmail,
                _match_reasons: top?.match_reasons || [],
                _detail_notes: `Admin confirmed distinct person identity and proceeded to create new ${role}`,
            });

            setShowUserDupModal(false);
            setUserDupCandidates([]);
            await handleCreate(true /* skipDupCheck */);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to proceed with creation');
        } finally {
            setUserDupBusy(false);
        }
    };

    const handleAttachTeacher = async () => {
        if (!selectedFamilyAccount) {
            setError('Please select an existing family or student account first.');
            return;
        }
        if (!attachStaffPersonName.trim()) {
            setError("Please enter the teacher's full name (adult staff member).");
            return;
        }
        setSaving(true);
        setError('');
        setSuccess('');
        try {
            await supabase.auth.refreshSession();
            const currentRoles = selectedFamilyAccount.roles && selectedFamilyAccount.roles.length > 0
                ? selectedFamilyAccount.roles
                : [selectedFamilyAccount.primary_role];
            const updatedRoles = Array.from(new Set([...currentRoles, 'teacher']));

            const body: Record<string, unknown> = {
                adminId: selectedFamilyAccount.account_id,
                additionalRoles: updatedRoles,
                staffPersonName: attachStaffPersonName.trim(),
                designation: attachDesignation.trim() || 'Teacher',
                department: attachDepartment.trim(),
            };

            const { data, error: fnError } = await supabase.functions.invoke('update_admin', { body });
            if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Failed to attach teacher access'));
            if (data?.error) throw new Error(data.error);

            setSuccess(`Teacher access granted to "${attachStaffPersonName.trim()}". Account ${selectedFamilyAccount.email} can now access Teacher Mode.`);
            onCreated();
            setTimeout(() => onClose(), 1500);
        } catch (err) {
            setError((err instanceof Error ? err.message : '') || 'Failed to attach teacher access.');
        } finally {
            setSaving(false);
        }
    };

    const handleSendOtp = async () => {
        setRecError(''); setRecInfo('');
        if (!createdUserId) { setRecError('No user id yet.'); return; }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recoveryEmail.trim())) {
            setRecError('Enter a valid email address.'); return;
        }
        setRecBusy(true);
        setSendStatus('sending');
        try {
            const { data, error: fnError } = await supabase.functions.invoke('admin_set_recovery_email', {
                body: { targetUserId: createdUserId, recoveryEmail: recoveryEmail.trim().toLowerCase() },
            });
            if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Could not send code'));
            if (data?.error) throw new Error(data.error);
            setRecoverySent(true);
            setSendStatus('sent');
            setExpiresAt(Date.now() + OTP_TTL_SEC * 1000);
            setNow(Date.now());
            setOtp('');
            setRecInfo(data?.message || 'Verification code sent.');
        } catch (err) {
            setSendStatus('failed');
            setRecError((err instanceof Error ? err.message : '') || 'Failed to send code.');
        } finally { setRecBusy(false); }
    };

    const handleConfirmOtp = async () => {
        setRecError(''); setRecInfo('');
        if (expired) { setRecError('Code expired. Request a new one.'); return; }
        if (!/^\d{6}$/.test(otp.trim())) { setRecError('Enter the 6-digit code.'); return; }
        setRecBusy(true);
        try {
            const { data, error: fnError } = await supabase.functions.invoke('admin_set_recovery_email', {
                body: { targetUserId: createdUserId, code: otp.trim() },
            });
            if (fnError) throw new Error(await getFunctionErrorMessage(fnError, 'Verification failed'));
            if (data?.error) throw new Error(data.error);
            setRecoveryVerified(true);
            setRecInfo('Recovery email verified ✓');
        } catch (err) {
            setRecError((err instanceof Error ? err.message : '') || 'Verification failed.');
        } finally { setRecBusy(false); }
    };

    const resetOtpFlow = () => {
        setRecoverySent(false); setOtp('');
        setRecInfo(''); setRecError(''); setExpiresAt(0); setSendStatus('idle');
    };

    const userCreated = Boolean(createdUserId);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={onClose} className="fixed inset-0 z-[60] bg-stone-900/40 backdrop-blur-sm" />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 24 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 24 }}
                        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
                        className="fixed inset-0 z-[70] flex items-center justify-center p-4"
                    >
                        <div className="bg-[#FAF9F6] rounded-3xl shadow-2xl w-full max-w-md border border-gray-200 overflow-hidden max-h-[90vh] flex flex-col">
                            {/* Header */}
                            <div className="flex items-center justify-between px-7 pt-7 pb-5 border-b border-gray-100">
                                <div>
                                    <h2 className="text-xl font-bold text-foreground">
                                        {role === 'teacher' && teacherMode === 'attach_family' ? 'Attach Teacher to Family' : 'Add New User'}
                                    </h2>
                                    <p className="text-xs text-muted mt-0.5">
                                        {role === 'teacher' && teacherMode === 'attach_family'
                                            ? 'Grant staff access to an existing family or student account.'
                                            : 'Create a user account with full credentials.'}
                                    </p>
                                </div>
                                <button onClick={onClose} className="w-9 h-9 rounded-full bg-white shadow-sm flex items-center justify-center hover:text-rose-500 transition-colors">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            {/* Body */}
                            <div className="px-7 py-6 space-y-4 overflow-y-auto">
                                {error && <div className="p-3 bg-red-50 text-red-700 text-sm font-medium rounded-xl border border-red-100">{error}</div>}
                                {success && <div className="p-3 bg-emerald-50 text-emerald-700 text-sm font-medium rounded-xl border border-emerald-100">{success}</div>}

                                {/* Role and School Selectors */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-semibold text-muted block mb-1.5">Role <span className="text-rose-500">*</span></label>
                                        <select value={role} onChange={e => setRole(e.target.value)} disabled={userCreated} className="clay-input w-full text-sm disabled:opacity-60">
                                            {Object.keys(ROLE_CONFIG)
                                                .filter(r => isSuperadmin || r !== 'superadmin')
                                                .map(r => (
                                                    <option key={r} value={r}>{ROLE_CONFIG[r].label}</option>
                                                ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-semibold text-muted block mb-1.5">
                                            <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3" /> School</span>
                                        </label>
                                        {isSuperadmin ? (
                                            <select value={schoolId} onChange={e => setSchoolId(e.target.value)} disabled={userCreated} className="clay-input w-full text-sm disabled:opacity-60">
                                                <option value="">Platform Core</option>
                                                {schools.map(s => (
                                                    <option key={s.id} value={s.id}>{s.name}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <div className="clay-input w-full text-sm bg-stone-50 text-stone-700 flex items-center justify-between">
                                                <span className="truncate">{selectedSchool?.name ?? 'Your school'}</span>
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Locked</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Teacher Mode Switcher */}
                                {role === 'teacher' && !userCreated && (
                                    <div className="flex rounded-2xl bg-stone-100/90 p-1 border border-stone-200/60">
                                        <button
                                            type="button"
                                            onClick={() => { setTeacherMode('new'); setError(''); }}
                                            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                                                teacherMode === 'new'
                                                    ? 'bg-white shadow-sm text-foreground'
                                                    : 'text-stone-500 hover:text-stone-900'
                                            }`}
                                        >
                                            New Account
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setTeacherMode('attach_family'); setError(''); }}
                                            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                                                teacherMode === 'attach_family'
                                                    ? 'bg-white shadow-sm text-amber-900'
                                                    : 'text-stone-500 hover:text-stone-900'
                                            }`}
                                        >
                                            Attach to Family Account
                                        </button>
                                    </div>
                                )}

                                {/* Attach to Family Flow */}
                                {role === 'teacher' && teacherMode === 'attach_family' ? (
                                    <div className="space-y-4">
                                        <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-amber-900 text-xs leading-relaxed">
                                            Enable Teacher access on an existing family or student account without creating duplicate logins or changing family student records.
                                        </div>

                                        <div>
                                            <label className="text-xs font-semibold text-muted block mb-1.5">
                                                <span className="inline-flex items-center gap-1"><Search className="w-3 h-3" /> Search Existing Family Accounts</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={familySearchQuery}
                                                onChange={e => setFamilySearchQuery(e.target.value)}
                                                placeholder="Search by name, email, or student name..."
                                                className="clay-input w-full text-sm"
                                                autoFocus
                                            />
                                        </div>

                                        <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                                            {isSearchingFamily && (
                                                <p className="text-xs text-muted text-center py-2">Searching accounts…</p>
                                            )}
                                            {!isSearchingFamily && familySearchResults.length === 0 && (
                                                <p className="text-xs text-stone-400 text-center py-3">
                                                    {familySearchQuery.trim() ? 'No accounts found matching search' : 'Search for an account by name or email'}
                                                </p>
                                            )}
                                            {familySearchResults.map(acc => {
                                                const isSelected = selectedFamilyAccount?.account_id === acc.account_id;
                                                return (
                                                    <div
                                                        key={acc.account_id}
                                                        onClick={() => {
                                                            setSelectedFamilyAccount(acc);
                                                            setAttachStaffPersonName(acc.staff_person_name || '');
                                                            setAttachDesignation(acc.designation || 'Teacher');
                                                            setAttachDepartment(acc.department || '');
                                                            setError('');
                                                        }}
                                                        className={`p-3 rounded-2xl border text-left cursor-pointer transition-all ${
                                                            isSelected
                                                                ? 'bg-amber-50/90 border-amber-300 ring-2 ring-amber-400/30'
                                                                : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-stone-50/60'
                                                        }`}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <span className="font-bold text-xs text-foreground truncate">{acc.full_name || 'Anonymous'}</span>
                                                            <span className="text-[10px] font-mono text-muted truncate">{acc.email}</span>
                                                        </div>
                                                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                                            {(acc.roles && acc.roles.length > 0 ? acc.roles : [acc.primary_role]).map(r => (
                                                                <span key={r} className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 uppercase">
                                                                    {r}
                                                                </span>
                                                            ))}
                                                            {acc.has_teacher_role && (
                                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                                                                    Already Staff
                                                                </span>
                                                            )}
                                                        </div>
                                                        {acc.linked_students && acc.linked_students.length > 0 && (
                                                            <div className="mt-2 pt-1.5 border-t border-gray-100 flex flex-wrap gap-1">
                                                                {acc.linked_students.map(s => (
                                                                    <span key={s.student_id} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 font-medium">
                                                                        🎓 {s.student_name}{s.class_name ? ` (${s.class_name})` : ''} · {s.relationship}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Selected Account Setup */}
                                        {selectedFamilyAccount && (
                                            <div className="p-3.5 rounded-2xl bg-amber-50/80 border border-amber-200 space-y-3">
                                                <div className="flex items-center gap-2">
                                                    <GraduationCap className="w-4 h-4 text-amber-800" />
                                                    <span className="text-xs font-bold text-amber-900 uppercase tracking-wider">Teacher Identity Setup</span>
                                                </div>
                                                <p className="text-[11px] text-amber-800/80">
                                                    Selected: <strong className="text-amber-950">{selectedFamilyAccount.full_name}</strong> ({selectedFamilyAccount.email})
                                                </p>
                                                <div>
                                                    <label className="text-xs font-semibold text-stone-700 block mb-1">
                                                        Educator's Real Name <span className="text-rose-500">*</span>
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={attachStaffPersonName}
                                                        onChange={e => setAttachStaffPersonName(e.target.value)}
                                                        placeholder="e.g. Sunita Sharma"
                                                        className="clay-input w-full text-sm bg-white"
                                                    />
                                                    <p className="text-[10px] text-stone-500 mt-1">
                                                        Used for teacher assignments, timetables, and staff rosters.
                                                    </p>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div>
                                                        <label className="text-xs font-semibold text-stone-700 block mb-1">Designation</label>
                                                        <input
                                                            type="text"
                                                            value={attachDesignation}
                                                            onChange={e => setAttachDesignation(e.target.value)}
                                                            placeholder="e.g. Senior Teacher"
                                                            className="clay-input w-full text-sm bg-white"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-semibold text-stone-700 block mb-1">Department</label>
                                                        <input
                                                            type="text"
                                                            value={attachDepartment}
                                                            onChange={e => setAttachDepartment(e.target.value)}
                                                            placeholder="e.g. Science"
                                                            className="clay-input w-full text-sm bg-white"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    /* Standard New User Creation Flow */
                                    <>
                                        <div>
                                            <label className="text-xs font-semibold text-muted block mb-1.5">Full Name <span className="text-rose-500">*</span></label>
                                            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} disabled={userCreated} className="clay-input w-full text-sm disabled:opacity-60" placeholder="e.g. Jane Smith" autoFocus />
                                        </div>
                                        <div>
                                            <label className="text-xs font-semibold text-muted block mb-1.5">
                                                <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" /> Login Email <span className="text-rose-500">*</span></span>
                                            </label>
                                            {lockedDomain ? (
                                                <div className="flex items-stretch rounded-xl overflow-hidden border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-primary/20">
                                                    <input
                                                        type="text"
                                                        value={emailLocal}
                                                        onChange={e => setEmailLocal(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                                                        disabled={userCreated}
                                                        className="flex-1 px-3 py-2 text-sm outline-none disabled:opacity-60 font-mono"
                                                        placeholder="john.doe"
                                                        autoComplete="off"
                                                    />
                                                    <span className="px-3 py-2 bg-stone-50 border-l border-gray-200 text-sm text-stone-600 font-mono truncate max-w-[55%]" title={`@${lockedDomain}`}>
                                                        @{lockedDomain}
                                                    </span>
                                                </div>
                                            ) : isSuperadmin ? (
                                                <input type="email" value={email} onChange={e => setEmail(e.target.value)} disabled={userCreated} className="clay-input w-full text-sm disabled:opacity-60" placeholder="user@example.com" />
                                            ) : (
                                                <div className="clay-input w-full text-sm bg-stone-50 text-stone-500 italic cursor-not-allowed">
                                                    Email domain not configured
                                                </div>
                                            )}
                                            {lockedDomain && (
                                                <p className="text-[10px] text-muted mt-1">Full email: <span className="font-mono text-foreground">{(emailLocal || 'username')}@{lockedDomain}</span></p>
                                            )}
                                            {!lockedDomain && schoolId && (
                                                <p className="text-[10px] text-amber-600 mt-1">
                                                    {isSuperadmin
                                                        ? 'This school has no email domain configured. Set one in Database → Edit school so all logins share the same subdomain.'
                                                        : 'Your school has no email domain configured yet. Ask your platform superadmin to set one before creating users.'}
                                                </p>
                                            )}
                                        </div>
                                        <div>
                                            <label className="text-xs font-semibold text-muted block mb-1.5">
                                                <span className="inline-flex items-center gap-1"><Key className="w-3 h-3" /> Password <span className="text-rose-500">*</span></span>
                                            </label>
                                            <input type="password" value={password} onChange={e => setPassword(e.target.value)} disabled={userCreated} className="clay-input w-full text-sm disabled:opacity-60" placeholder="Minimum 6 characters" />
                                        </div>

                                        {role === 'teacher' && (
                                            <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200/80 space-y-2.5">
                                                <div className="flex items-center gap-2">
                                                    <GraduationCap className="w-4 h-4 text-amber-800" />
                                                    <span className="text-xs font-bold text-amber-900 uppercase tracking-wider">Teacher Details (Optional)</span>
                                                </div>
                                                <div>
                                                    <label className="text-xs font-semibold text-stone-700 block mb-1">Educator Real Name</label>
                                                    <input
                                                        type="text"
                                                        value={teacherStaffName}
                                                        onChange={e => setTeacherStaffName(e.target.value)}
                                                        placeholder={fullName || "e.g. Sunita Sharma"}
                                                        disabled={userCreated}
                                                        className="clay-input w-full text-sm bg-white"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div>
                                                        <label className="text-xs font-semibold text-stone-700 block mb-1">Designation</label>
                                                        <input
                                                            type="text"
                                                            value={teacherDesignation}
                                                            onChange={e => setTeacherDesignation(e.target.value)}
                                                            placeholder="e.g. Senior Teacher"
                                                            disabled={userCreated}
                                                            className="clay-input w-full text-sm bg-white"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-semibold text-stone-700 block mb-1">Department</label>
                                                        <input
                                                            type="text"
                                                            value={teacherDepartment}
                                                            onChange={e => setTeacherDepartment(e.target.value)}
                                                            placeholder="e.g. Science"
                                                            disabled={userCreated}
                                                            className="clay-input w-full text-sm bg-white"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {role === 'student' && !userCreated && (
                                            <div className="p-3.5 rounded-2xl bg-teal-50/70 border border-teal-200/80 space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <UsersIcon className="w-4 h-4 text-teal-800" />
                                                        <span className="text-xs font-bold uppercase tracking-wider text-teal-900">Parent / Guardian Account</span>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => { setLinkGuardian(!linkGuardian); setSelectedGuardian(null); }}
                                                        className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                                                            linkGuardian ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
                                                        }`}
                                                    >
                                                        {linkGuardian ? 'Linking Active' : '+ Link Existing Staff / Guardian'}
                                                    </button>
                                                </div>
                                                <p className="text-[11px] text-teal-800/80 leading-relaxed">
                                                    If this student's parent is already a teacher, staff member, or guardian at this school, link them here to prevent duplicate accounts.
                                                </p>

                                                {linkGuardian && (
                                                    <div className="space-y-3 pt-1 border-t border-teal-200/60">
                                                        <div>
                                                            <label className="text-xs font-semibold text-stone-700 block mb-1">
                                                                Search Existing Staff or Parent
                                                            </label>
                                                            <input
                                                                type="text"
                                                                value={guardianSearchQuery}
                                                                onChange={e => setGuardianSearchQuery(e.target.value)}
                                                                placeholder="Search by name, email..."
                                                                className="clay-input w-full text-sm bg-white"
                                                            />
                                                        </div>

                                                        {/* Candidate list */}
                                                        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                                                            {isSearchingGuardian && <p className="text-xs text-muted text-center py-2">Searching accounts…</p>}
                                                            {!isSearchingGuardian && guardianSearchResults.length === 0 && (
                                                                <p className="text-xs text-stone-400 text-center py-2">
                                                                    {guardianSearchQuery ? 'No matching accounts found' : 'Type a name or email to search'}
                                                                </p>
                                                            )}
                                                            {guardianSearchResults.map(g => {
                                                                const isSelected = selectedGuardian?.guardian_id === g.guardian_id;
                                                                return (
                                                                    <div
                                                                        key={g.guardian_id}
                                                                        onClick={() => setSelectedGuardian(g)}
                                                                        className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                                                                            isSelected ? 'bg-teal-100/90 border-teal-400 ring-2 ring-teal-400/30' : 'bg-white border-stone-200 hover:bg-stone-50'
                                                                        }`}
                                                                    >
                                                                        <div className="flex items-center justify-between">
                                                                            <span className="font-bold text-xs text-foreground truncate">
                                                                                {g.staff_person_name || g.full_name}
                                                                            </span>
                                                                            <span className="text-[10px] font-mono text-muted truncate">{g.email}</span>
                                                                        </div>
                                                                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                                                            {g.has_staff_role && (
                                                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                                                                                    Teacher / Staff {g.designation ? `(${g.designation})` : ''}
                                                                                </span>
                                                                            )}
                                                                            {(g.roles || [g.primary_role]).map(r => (
                                                                                <span key={r} className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 uppercase">
                                                                                    {r}
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>

                                                        {/* Selected Guardian Configuration */}
                                                        {selectedGuardian && (
                                                            <div className="p-3 rounded-xl bg-white border border-teal-300 space-y-2">
                                                                <p className="text-xs font-semibold text-teal-950">
                                                                    Existing account found: <strong className="text-teal-900">{selectedGuardian.staff_person_name || selectedGuardian.full_name}</strong>
                                                                </p>
                                                                <p className="text-[11px] text-stone-600">
                                                                    Current access: <span className="font-bold text-stone-700">{selectedGuardian.has_staff_role ? 'Teacher / Staff' : selectedGuardian.primary_role}</span> · {selectedGuardian.email}
                                                                </p>
                                                                <div className="grid grid-cols-2 gap-2 pt-1">
                                                                    <div>
                                                                        <label className="text-[11px] font-semibold text-stone-700 block mb-1">Relationship</label>
                                                                        <select
                                                                            value={guardianRelationship}
                                                                            onChange={e => setGuardianRelationship(e.target.value)}
                                                                            className="clay-input w-full text-xs py-1.5 bg-stone-50"
                                                                        >
                                                                            <option value="Mother">Mother</option>
                                                                            <option value="Father">Father</option>
                                                                            <option value="Guardian">Guardian</option>
                                                                            <option value="Legal Guardian">Legal Guardian</option>
                                                                            <option value="Parent">Parent</option>
                                                                            <option value="Son">Son</option>
                                                                            <option value="Daughter">Daughter</option>
                                                                            <option value="Child">Child</option>
                                                                            <option value="Ward">Ward</option>
                                                                            <option value="Other authorized guardian">Other authorized guardian</option>
                                                                            <option value="Primary guardian">Primary guardian</option>
                                                                            <option value="Emergency contact">Emergency contact</option>
                                                                        </select>
                                                                    </div>
                                                                    <div className="flex items-center pt-5">
                                                                        <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={isPrimaryGuardian}
                                                                                onChange={e => setIsPrimaryGuardian(e.target.checked)}
                                                                                className="w-3.5 h-3.5 accent-teal-600"
                                                                            />
                                                                            Primary Guardian
                                                                        </label>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {role && (
                                            <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-50 border border-gray-100">
                                                <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-widest ${ROLE_CONFIG[role]?.bg ?? 'bg-gray-100'} ${ROLE_CONFIG[role]?.color ?? 'text-gray-700'}`}>
                                                    {ROLE_CONFIG[role]?.label ?? role}
                                                </span>
                                                <span className="text-xs text-muted">
                                                    {schoolId ? schools.find(s => s.id === schoolId)?.name ?? 'Unknown School' : 'Platform Core'}
                                                </span>
                                            </div>
                                        )}
                                        {(role === 'student' || role === 'parent') && selectedSchool && (
                                            <p className={`text-xs font-semibold rounded-xl px-3 py-2 ${selectedSchool.combined_parent_student_account !== false ? 'bg-teal-50 text-teal-800 border border-teal-100' : 'bg-stone-100 text-stone-700 border border-stone-200'}`}>
                                                This school has combined parent/student account — {selectedSchool.combined_parent_student_account !== false ? 'enabled' : 'disabled'}.
                                            </p>
                                        )}
                                    </>
                                )}

                                {/* ── Recovery Email Section (after user is created) ── */}
                                {userCreated && (
                                    <div className="mt-2 p-4 rounded-2xl border border-emerald-200/60 bg-gradient-to-br from-emerald-50/70 to-lime-50/70 space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-7 h-7 rounded-lg bg-emerald-600/10 flex items-center justify-center">
                                                <Mail className="w-3.5 h-3.5 text-emerald-700" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-emerald-900">Recovery Email</p>
                                                <p className="text-[11px] text-emerald-700/70">User's real inbox — used only for password resets.</p>
                                            </div>
                                            {recoveryVerified && (
                                                <span className="ml-auto text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-600 text-white">VERIFIED</span>
                                            )}
                                        </div>

                                        <div className="flex gap-2">
                                            <input
                                                type="email"
                                                value={recoveryEmail}
                                                onChange={e => setRecoveryEmail(e.target.value)}
                                                disabled={(recoverySent && !expired) || recoveryVerified || recBusy}
                                                className="clay-input flex-1 text-sm"
                                                placeholder="real-email@gmail.com"
                                            />
                                            {(!recoverySent || expired) && !recoveryVerified && (
                                                <button
                                                    onClick={handleSendOtp}
                                                    disabled={recBusy || !recoveryEmail}
                                                    className="px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 transition-colors disabled:opacity-50 whitespace-nowrap"
                                                >
                                                    {recBusy ? 'Sending…' : expired ? 'Resend' : 'Verify'}
                                                </button>
                                            )}
                                        </div>

                                        {/* Status pill */}
                                        {sendStatus !== 'idle' && !recoveryVerified && (
                                            <div className="flex items-center gap-2 text-[11px] font-medium">
                                                {sendStatus === 'sending' && (
                                                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-sky-50 border border-sky-200 text-sky-700">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                                                        Sending verification code…
                                                    </span>
                                                )}
                                                {sendStatus === 'sent' && !expired && (
                                                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">
                                                        ✓ Code sent · expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
                                                    </span>
                                                )}
                                                {sendStatus === 'sent' && expired && (
                                                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800">
                                                        ⏱ Code expired — request a new one
                                                    </span>
                                                )}
                                                {sendStatus === 'failed' && (
                                                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-700">
                                                        ✗ Send failed
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {recoverySent && !recoveryVerified && (
                                            <>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        maxLength={6}
                                                        value={otp}
                                                        onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                                                        disabled={expired}
                                                        className="clay-input flex-1 text-sm font-mono tracking-[0.5em] text-center"
                                                        placeholder="• • • • • •"
                                                    />
                                                    <button
                                                        onClick={handleConfirmOtp}
                                                        disabled={recBusy || otp.length !== 6 || expired}
                                                        title={expired ? 'Code expired — request a new one' : undefined}
                                                        className="px-4 py-2 rounded-xl bg-emerald-900 text-white text-xs font-bold hover:bg-emerald-950 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                                                    >
                                                        {recBusy ? '…' : 'Confirm'}
                                                    </button>
                                                </div>
                                                {!expired && (
                                                    <button
                                                        onClick={resetOtpFlow}
                                                        className="text-[11px] text-emerald-700 hover:text-emerald-900 underline"
                                                    >
                                                        Change email / resend code
                                                    </button>
                                                )}
                                            </>
                                        )}

                                        {recInfo && sendStatus !== 'sent' && <p className="text-[11px] text-emerald-700">{recInfo}</p>}
                                        {recError && (
                                            <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-700">
                                                <strong>Error:</strong> {recError}
                                            </div>
                                        )}
                                    </div>
                                )}

                            </div>
                            {/* Footer */}
                            <div className="px-7 pb-7 pt-3 flex gap-3 border-t border-gray-100 bg-[#FAF9F6]">
                                {role === 'teacher' && teacherMode === 'attach_family' ? (
                                    <>
                                        <button onClick={onClose} className="flex-1 py-3 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-muted hover:bg-gray-50 transition-colors">
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleAttachTeacher}
                                            disabled={saving || !selectedFamilyAccount || !attachStaffPersonName.trim()}
                                            className="flex-1 clay-btn py-3 disabled:opacity-50 flex items-center justify-center gap-2"
                                        >
                                            {saving ? (
                                                <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Attaching...</>
                                            ) : (
                                                <>Attach Teacher Access</>
                                            )}
                                        </button>
                                    </>
                                ) : !userCreated ? (
                                    <>
                                        <button onClick={onClose} className="flex-1 py-3 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-muted hover:bg-gray-50 transition-colors">
                                            Cancel
                                        </button>
                                        <button onClick={() => handleCreate(false)} disabled={saving} className="flex-1 clay-btn py-3 disabled:opacity-50 flex items-center justify-center gap-2">
                                            {saving ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating...</> : <>Create User</>}
                                        </button>
                                    </>
                                ) : (
                                    <button onClick={onClose} className="flex-1 clay-btn py-3">
                                        Done
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Phase 14: Duplicate detection confirmation modal */}
                        <DuplicateDetectionModal
                            isOpen={showUserDupModal}
                            onClose={() => {
                                setShowUserDupModal(false);
                                setUserDupCandidates([]);
                            }}
                            candidates={userDupCandidates}
                            inputName={role === 'teacher' && teacherStaffName.trim() ? teacherStaffName.trim() : fullName.trim()}
                            inputEmail={lockedDomain ? `${emailLocal.trim().toLowerCase()}@${lockedDomain}` : email.trim().toLowerCase()}
                            targetRoleLabel={role.charAt(0).toUpperCase() + role.slice(1)}
                            onLinkExisting={handleLinkExistingUserCandidate}
                            onCreateNewPerson={handleConfirmCreateNewUser}
                            busy={userDupBusy}
                        />
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

/* ─── USER ROW ─────────────────────────────────────────── */
const UserRow: React.FC<{ user: User; onSelect: (u: User) => void; idx: number }> = ({ user, onSelect, idx }) => {
    const { user: currentUser } = useAuth();
    const displayRoles = useMemo(() => {
        let roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
        if (user.role === 'student') {
            roles = roles.filter(r => r !== 'teacher');
        }
        return roles;
    }, [user.roles, user.role]);
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.03, duration: 0.25 }}
            className="flex items-center gap-3 p-3 rounded-xl bg-white/60 hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-100 transition-all group cursor-pointer"
            onClick={() => onSelect(user)}
        >
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                {user.avatar_url || (user.full_name ? user.full_name.substring(0, 2).toUpperCase() : '??')}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground truncate">{user.full_name || 'Anonymous'}{currentUser?.id === user.id ? ' (YOU)' : ''}</span>
                    {user.recovery_email_verified ? (
                        <span
                            title={`Email verified${user.recovery_email ? `: ${user.recovery_email}` : ''}`}
                            className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white flex-shrink-0 shadow-sm"
                            aria-label="Verified email"
                        >
                            <BadgeCheck className="w-3 h-3" strokeWidth={3} />
                        </span>
                    ) : (
                        <span
                            title="No verified recovery email"
                            className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-gray-500 flex-shrink-0"
                            aria-label="Email not verified"
                        >
                            <XCircle className="w-3 h-3" strokeWidth={2.5} />
                        </span>
                    )}
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {displayRoles.map(r => {
                            const rStyle = getRoleStyle(r);
                            return (
                                <span
                                    key={r}
                                    className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest flex-shrink-0 ${rStyle.bg} ${rStyle.color}`}
                                >
                                    {rStyle.label}
                                </span>
                            );
                        })}
                    </div>
                </div>
                <p className="text-xs text-muted truncate">{user.email}</p>
            </div>
            <div className="text-right flex-shrink-0 hidden sm:block">
                <p className="text-[10px] text-muted italic">
                    {user.updated_at ? formatDistanceToNow(new Date(user.updated_at), { addSuffix: true }) : 'Never'}
                </p>
            </div>
            <button
                onClick={(e) => { e.stopPropagation(); onSelect(user); }}
                className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center text-muted hover:text-primary hover:bg-primary/10 transition-all opacity-0 group-hover:opacity-100 flex-shrink-0"
            >
                <MoreVertical className="w-3.5 h-3.5" />
            </button>
        </motion.div>
    );
};

/* ─── ROLE SECTION ─────────────────────────────────────── */
const RoleSection: React.FC<{ role: string; users: User[]; onSelect: (u: User) => void }> = ({ role, users, onSelect }) => {
    const style = getRoleStyle(role);
    const RoleIcon = role === 'admin' ? ShieldCheck
        : role === 'superadmin' ? Crown
            : role === 'teacher' ? BookOpen
                : role === 'student' ? GraduationCap
                    : UserCheck;

    if (users.length === 0) return null;

    return (
        <div className="mb-4 last:mb-0">
            <div className="flex items-center gap-2 mb-2 px-1">
                <RoleIcon className={`w-3.5 h-3.5 ${style.color}`} />
                <span className={`text-[10px] font-bold uppercase tracking-widest ${style.color}`}>
                    {style.label}s ({users.length})
                </span>
            </div>
            <div className="space-y-1">
                {users.map((user, idx) => (
                    <UserRow key={user.id} user={user} onSelect={onSelect} idx={idx} />
                ))}
            </div>
        </div>
    );
};

/* ─── SCHOOL CARD ──────────────────────────────────────── */
const SchoolCard: React.FC<{ group: SchoolGroup; onSelectUser: (u: User) => void; defaultExpanded: boolean; onDeleteSchool?: (schoolId: string, schoolName: string) => void }> = ({ group, onSelectUser, defaultExpanded, onDeleteSchool }) => {
    const [expanded, setExpanded] = useState(defaultExpanded);

    const roleGroups = useMemo(() => {
        const sorted = [...group.users].sort((a, b) => {
            return (ROLE_CONFIG[a.role]?.order ?? 99) - (ROLE_CONFIG[b.role]?.order ?? 99);
        });
        const map = new Map<string, User[]>();
        for (const u of sorted) {
            if (!map.has(u.role)) map.set(u.role, []);
            map.get(u.role)!.push(u);
        }
        return map;
    }, [group.users]);

    const adminCount = group.users.filter(u => u.role === 'admin' || u.role === 'superadmin').length;
    const teacherCount = group.users.filter(u => u.role === 'teacher').length;
    const studentCount = group.users.filter(u => u.role === 'student').length;
    const otherCount = group.users.length - adminCount - teacherCount - studentCount;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="clay-card overflow-hidden"
        >
            {/* Card Header */}
            <div className="flex items-center">
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex-1 flex items-center gap-4 p-5 hover:bg-gray-50/50 transition-colors text-left"
            >
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-md ${group.isCore
                    ? 'bg-gradient-to-br from-indigo-500 to-purple-600'
                    : 'bg-gradient-to-br from-teal-600 to-emerald-500'
                    }`}>
                    {group.isCore
                        ? <Crown className="w-6 h-6 text-white" />
                        : <Building2 className="w-6 h-6 text-white" />
                    }
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className="font-bold text-lg text-foreground truncate">{group.schoolName}</h3>
                        <span className="text-xs font-bold text-muted bg-gray-100 px-2.5 py-0.5 rounded-full flex-shrink-0">
                            {group.users.length} {group.users.length === 1 ? 'user' : 'users'}
                        </span>
                    </div>
                    {/* Summary pills */}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {adminCount > 0 && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                {adminCount} Admin{adminCount > 1 ? 's' : ''}
                            </span>
                        )}
                        {teacherCount > 0 && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">
                                {teacherCount} Teacher{teacherCount > 1 ? 's' : ''}
                            </span>
                        )}
                        {studentCount > 0 && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                                {studentCount} Student{studentCount > 1 ? 's' : ''}
                            </span>
                        )}
                        {otherCount > 0 && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                {otherCount} Other{otherCount > 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-muted">
                    {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
            </button>
            {!group.isCore && group.schoolId && onDeleteSchool && (
                <button
                    type="button"
                    onClick={() => onDeleteSchool(group.schoolId!, group.schoolName)}
                    className="mr-5 w-9 h-9 rounded-lg text-muted hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    title="Permanently delete this school and all its data"
                    aria-label="Permanently delete school"
                >
                    <Trash2 className="w-4 h-4 mx-auto" />
                </button>
            )}
            </div>

            {/* Card Body */}
            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: 'easeInOut' }}
                        className="overflow-hidden"
                    >
                        <div className="px-5 pb-5 pt-1 border-t border-gray-100">
                            <div className="mt-3 space-y-2">
                                {Array.from(roleGroups.entries()).map(([role, users]) => (
                                    <RoleSection key={role} role={role} users={users} onSelect={onSelectUser} />
                                ))}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

/* ─── MAIN PAGE ────────────────────────────────────────── */
const UserManagement: React.FC = () => {
    const qc = useQueryClient();
    const { role: currentRole } = useAuth();
    const bundleQuery = useUserManagementData();
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [showAddUser, setShowAddUser] = useState(false);
    const [schoolToDelete, setSchoolToDelete] = useState<{ id: string; name: string } | null>(null);
    const [deleteConfirmation, setDeleteConfirmation] = useState('');
    const [deletingSchool, setDeletingSchool] = useState(false);
    const requestedRole = new URLSearchParams(window.location.search).get('newUser');

    useEffect(() => {
        if (requestedRole === 'teacher') setShowAddUser(true);
    }, [requestedRole]);

    const refetchAll = () => { qc.invalidateQueries({ queryKey: qk.userManagement }); };

    const deleteSchool = async () => {
        if (!schoolToDelete || deleteConfirmation !== 'CONFIRM') return;
        setDeletingSchool(true);
        try {
            const { data, error } = await supabase.functions.invoke('delete_school', { body: { schoolId: schoolToDelete.id, hard: true } });
            if (error) throw new Error(await getFunctionErrorMessage(error, 'Failed to permanently delete school'));
            if (data?.error) throw new Error(data.error);
            toast.success('School and all related data deleted.');
            setSchoolToDelete(null);
            setDeleteConfirmation('');
            refetchAll();
        } catch (error) {
            toast.error((error instanceof Error ? error.message : '') || 'Failed to permanently delete school.');
        } finally {
            setDeletingSchool(false);
        }
    };

    const bundle = bundleQuery.data;
    const schools = bundle?.schools ?? [];
    const permissions = bundle?.permissions ?? [];

    const users: User[] = useMemo(() => {
        if (!bundle) return [];
        const schoolMap = new Map(bundle.schools.map(s => [s.id, s.name]));
        return bundle.profiles.map((u): User => {
            const hasStudentCapability = u.role === 'student' || (u.roles && u.roles.includes('student'));
            const studentStatus = hasStudentCapability ? (u.student_status || (u.is_active ? 'active' : 'inactive')) : null;
            const displayStatus = u.is_active ? 'Active' : 'Disabled';
            return {
                id: u.id,
                full_name: u.full_name,
                role: u.role,
                roles: u.roles && u.roles.length > 0 ? u.roles : [u.role],
                school_id: u.school_id,
                school_name: u.school_id ? (schoolMap.get(u.school_id) || 'Unknown') : 'Platform',
                status: displayStatus,
                is_active: u.is_active,
                student_status: studentStatus,
                metadata: (u.metadata as { permissions?: unknown[] }) || {},
                updated_at: u.updated_at,
                email: u.email,
                avatar_url: u.avatar_url,
                recovery_email: u.recovery_email ?? null,
                recovery_email_verified: Boolean(u.recovery_email_verified),
            };
        });
    }, [bundle]);

    /* Group & filter */
    const schoolGroups = useMemo(() => {
        const lowerSearch = searchTerm.toLowerCase();
        const filtered = users.filter(u =>
            (u.full_name?.toLowerCase() || '').includes(lowerSearch) ||
            u.email.toLowerCase().includes(lowerSearch) ||
            u.role.toLowerCase().includes(lowerSearch) ||
            (u.roles && u.roles.some(r => r.toLowerCase().includes(lowerSearch)))
        );

        const map = new Map<string, SchoolGroup>();

        for (const user of filtered) {
            const key = user.school_id || 'core';
            if (!map.has(key)) {
                map.set(key, {
                    schoolId: user.school_id,
                    schoolName: user.school_id ? (user.school_name || 'Unknown School') : 'Core',
                    users: [],
                    isCore: !user.school_id,
                });
            }
            map.get(key)!.users.push(user);
        }

        // Sort: Core first, then schools alphabetically
        const groups = Array.from(map.values());
        groups.sort((a, b) => {
            if (a.isCore && !b.isCore) return -1;
            if (!a.isCore && b.isCore) return 1;
            return a.schoolName.localeCompare(b.schoolName);
        });

        return groups;
    }, [users, searchTerm]);

    const totalUsers = users.length;

    return (
        <div className="min-h-screen bg-[#FAF9F6] flex">
            <Sidebar activePage="Users" />

            <main className="flex-1 lg:ml-72 flex flex-col p-6 md:p-10">
                <Header title="User Management" />

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10 mt-8">
                    <div>
                        <h2 className="text-xl font-bold text-foreground">All Users</h2>
                        <p className="text-muted mt-1 text-sm">
                            {totalUsers} users across {schoolGroups.filter(g => !g.isCore).length} school{schoolGroups.filter(g => !g.isCore).length !== 1 ? 's' : ''} and platform core
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="relative w-64 md:w-80">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <input
                                type="text"
                                placeholder="Search name, email, or role..."
                                className="clay-input pl-11 w-full"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <button
                            onClick={() => setShowAddUser(true)}
                            className="clay-btn flex items-center gap-2 py-2.5 px-4 text-sm whitespace-nowrap"
                        >
                            <span className="text-lg leading-none">+</span>
                            Add User
                        </button>
                    </div>
                </div>

                {/* Summary stat cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                    {[
                        { label: 'Total Users', value: totalUsers, icon: UsersIcon, color: 'text-primary', bg: 'bg-primary/10' },
                        { label: 'Admins', value: users.filter(u => u.role === 'admin' || u.role === 'superadmin').length, icon: ShieldCheck, color: 'text-amber-600', bg: 'bg-amber-50' },
                        { label: 'Teachers', value: users.filter(u => u.role === 'teacher').length, icon: BookOpen, color: 'text-sky-600', bg: 'bg-sky-50' },
                        { label: 'Students', value: users.filter(u => u.role === 'student').length, icon: GraduationCap, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                    ].map((stat, idx) => (
                        <motion.div
                            key={idx}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.08 }}
                            className="clay-card p-4 flex items-center gap-3"
                        >
                            <div className={`w-10 h-10 rounded-xl ${stat.bg} flex items-center justify-center flex-shrink-0`}>
                                <stat.icon className={`w-5 h-5 ${stat.color}`} />
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                                <p className="text-[10px] font-bold text-muted uppercase tracking-widest">{stat.label}</p>
                            </div>
                        </motion.div>
                    ))}
                </div>

                <QueryBoundary
                    query={{ ...bundleQuery, data: schoolGroups }}
                    isEmpty={(g) => g.length === 0}
                    emptyIcon={UsersIcon}
                    emptyTitle="No users found"
                    emptyDescription="Try adjusting your search term."
                    loadingRows={4}
                    loadingHeight={72}
                >
                    {(groups) => (
                        <div className="space-y-6">
                            {groups.map((group) => (
                                <SchoolCard
                                    key={group.schoolId || 'core'}
                                    group={group}
                                    onSelectUser={setSelectedUser}
                                    defaultExpanded={group.isCore || groups.length <= 3}
                                    onDeleteSchool={currentRole === 'superadmin' ? (id, name) => { setSchoolToDelete({ id, name }); setDeleteConfirmation(''); } : undefined}
                                />
                            ))}
                        </div>
                    )}
                </QueryBoundary>

                <UserDrawer
                    user={selectedUser}
                    isOpen={!!selectedUser}
                    onClose={() => setSelectedUser(null)}
                    schools={schools}
                    permissions={permissions}
                    onSaved={refetchAll}
                    onSelectUser={setSelectedUser}
                />

                <AddUserModal
                    isOpen={showAddUser}
                    onClose={() => setShowAddUser(false)}
                    schools={schools}
                    onCreated={refetchAll}
                    initialRole={requestedRole === 'teacher' ? 'teacher' : undefined}
                />

                <AnimatePresence>
                    {schoolToDelete && (
                        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
                            <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !deletingSchool && setSchoolToDelete(null)} className="absolute inset-0 bg-stone-950/45" aria-label="Close deletion confirmation" />
                            <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }} className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
                                <h2 className="text-lg font-bold text-foreground">Permanently delete {schoolToDelete.name}?</h2>
                                <p className="mt-2 text-sm text-muted">This deletes the school, every user account, and all remaining school data. It cannot be undone.</p>
                                <label className="mt-5 block text-sm font-semibold text-foreground">Type <span className="font-mono">CONFIRM</span> to continue
                                    <input autoFocus value={deleteConfirmation} onChange={e => setDeleteConfirmation(e.target.value)} disabled={deletingSchool} className="clay-input mt-2 w-full" placeholder="CONFIRM" />
                                </label>
                                <div className="mt-5 flex justify-end gap-3">
                                    <button onClick={() => setSchoolToDelete(null)} disabled={deletingSchool} className="px-4 py-2 text-sm font-bold text-muted">Cancel</button>
                                    <button onClick={deleteSchool} disabled={deleteConfirmation !== 'CONFIRM' || deletingSchool} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{deletingSchool ? 'Deleting…' : 'Delete permanently'}</button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>


                <div className="mt-auto pt-10 text-center text-sm text-muted font-medium italic opacity-70">
                    © 2024 Kryin School. Administrative Controls Active.
                </div>
            </main>
        </div>
    );
};

export default UserManagement;
