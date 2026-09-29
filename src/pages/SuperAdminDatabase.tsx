import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Plus, Search, Edit2, Trash2, Building2, Users, DollarSign, Loader2, Key, AlertTriangle, X, CheckCircle2, Save, Mail } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { getFunctionErrorMessage } from '../lib/functionErrors';
import { useSchoolsSummary, qk } from '../hooks/queries';

interface SchoolData {
    id: string;
    name: string;
    subdomain: string;
    email_domain?: string | null;
    subscription_tier: string;
    status: string;
    max_students: number;
    address?: string;
    phone?: string;
    student_count?: number;
    revenue?: number;
    admin_id?: string;
    admin_email?: string;
    admin_name?: string;
}

const SuperAdminDatabase: React.FC = () => {
    const qc = useQueryClient();
    const schoolsQuery = useSchoolsSummary();
    const schools = (schoolsQuery.data ?? []) as unknown as SchoolData[];
    const loading = schoolsQuery.isLoading;

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('All');
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    // Create Modal State
    const [newSchoolName, setNewSchoolName] = useState('');
    const [newEmailDomain, setNewEmailDomain] = useState('');
    const [newTier, setNewTier] = useState('starter');
    const [newCombinedParentStudentAccount, setNewCombinedParentStudentAccount] = useState(true);
    const [adminEmailLocal, setAdminEmailLocal] = useState('');
    const [adminName, setAdminName] = useState('');
    const [adminPassword, setAdminPassword] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [createError, setCreateError] = useState('');

    // Edit Modal State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editSchool, setEditSchool] = useState<SchoolData | null>(null);
    const [editName, setEditName] = useState('');
    const [editSubdomain, setEditSubdomain] = useState('');
    const [editEmailDomain, setEditEmailDomain] = useState('');
    const [editTier, setEditTier] = useState('');
    const [editStatus, setEditStatus] = useState('');
    const [editMaxStudents, setEditMaxStudents] = useState(500);
    const [editAddress, setEditAddress] = useState('');
    const [editPhone, setEditPhone] = useState('');
    const [editAdminEmailField, setEditAdminEmailField] = useState('');
    const [editAdminNameField, setEditAdminNameField] = useState('');
    const [editAdminPasswordField, setEditAdminPasswordField] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [editError, setEditError] = useState('');
    const [editSuccess, setEditSuccess] = useState('');
    const [editDomainUnlocked, setEditDomainUnlocked] = useState(false);
    const [editAdminEmailUnlocked, setEditAdminEmailUnlocked] = useState(false);

    // Delete State
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    /** Force-refresh the shared schools cache. */
    const fetchSchoolsData = async () => {
        await qc.invalidateQueries({ queryKey: qk.schoolsSummary });
    };

    const handleCreateSchool = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreateError('');

        const emailDomain = newEmailDomain.trim().toLowerCase().replace(/^@/, '');
        if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(emailDomain)) {
            setCreateError('Enter a valid email domain (e.g. school.com).');
            return;
        }
        const localPart = adminEmailLocal.trim().toLowerCase();
        if (!/^[a-z0-9._-]+$/.test(localPart)) {
            setCreateError('Admin username can only contain letters, numbers, dot, dash, underscore.');
            return;
        }
        const fullAdminEmail = `${localPart}@${emailDomain}`;
        // Auto-generate a URL-safe subdomain slug from the school name
        const autoSubdomain = newSchoolName.trim().toLowerCase()
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || `school-${Date.now().toString(36)}`;

        setIsCreating(true);
        await logger.info('tenant', 'School creation started', { details: { name: newSchoolName, email_domain: emailDomain, tier: newTier, adminEmail: fullAdminEmail } });

        try {
            const { data: { user: currentUser }, error: sessionErr } = await supabase.auth.getUser();
            if (sessionErr || !currentUser) throw new Error('No active session. Please log in again.');
            await supabase.auth.refreshSession();

            const { data: functionData, error: functionError } = await supabase.functions.invoke('create_school_with_admin', {
                body: {
                    name: newSchoolName,
                    subdomain: autoSubdomain,
                    email_domain: emailDomain,
                    tier: newTier,
                    combinedParentStudentAccount: newCombinedParentStudentAccount,
                    adminEmail: fullAdminEmail,
                    adminPassword,
                    adminFullName: adminName,
                },
            });

            if (functionError) {
                const realError = await getFunctionErrorMessage(functionError, 'Failed to create school.');
                await logger.error('edge_function', 'create_school_with_admin failed', { details: { error: realError, name: newSchoolName, adminEmail: fullAdminEmail } });
                throw new Error(realError);
            }
            if (functionData?.error) {
                await logger.error('edge_function', 'create_school_with_admin returned error', { details: { error: functionData.error, name: newSchoolName } });
                throw new Error(functionData.error);
            }

            await logger.info('tenant', 'School + admin created successfully', { details: { schoolId: functionData?.school?.id, adminEmail: fullAdminEmail } });

            setIsCreateModalOpen(false);
            setNewSchoolName('');
            setNewEmailDomain('');
            setNewCombinedParentStudentAccount(true);
            setAdminEmailLocal('');
            setAdminName('');
            setAdminPassword('');
            fetchSchoolsData();
        } catch (err) {
            console.error(err);
            const errorMessage = err instanceof Error ? err.message : 'Failed to create school and admin.';
            await logger.error('tenant', 'School creation flow failed', { details: { error: errorMessage, name: newSchoolName } });
            setCreateError(errorMessage);
        } finally {
            setIsCreating(false);
        }

    };

    const openEditModal = (school: SchoolData) => {
        setEditSchool(school);
        setEditName(school.name);
        setEditSubdomain(school.subdomain);
        setEditEmailDomain(school.email_domain || '');
        setEditTier(school.subscription_tier);
        setEditStatus(school.status);
        setEditMaxStudents(school.max_students || 500);
        setEditAddress(school.address || '');
        setEditPhone(school.phone || '');
        setEditAdminEmailField(school.admin_email !== 'No admin assigned' ? (school.admin_email || '') : '');
        setEditAdminNameField(school.admin_name || '');
        setEditAdminPasswordField('');
        setEditError('');
        setEditSuccess('');
        setEditDomainUnlocked(false);
        setEditAdminEmailUnlocked(false);
        setIsEditModalOpen(true);
    };

    const handleEditSchool = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editSchool) return;
        setIsSaving(true);
        setEditError('');
        setEditSuccess('');

        try {
            // 1. Update School via privileged edge function (RLS-symmetric path)
            await supabase.auth.refreshSession();
            const { error: schoolUpdateError } = await supabase.functions.invoke('update_school', {
                body: {
                    schoolId: editSchool.id,
                    name: editName,
                    subdomain: editSubdomain,
                    email_domain: editEmailDomain || undefined,
                    subscription_tier: editTier,
                    status: editStatus,
                    max_students: editMaxStudents,
                    address: editAddress,
                    phone: editPhone,
                },
            });

            if (schoolUpdateError) {
                const realError = await getFunctionErrorMessage(schoolUpdateError, 'Failed to update school.');
                throw new Error(realError);
            }

            // 2. Update Admin via Edge Function if admin details or password provided
            if (editSchool.admin_id && (editAdminEmailField !== editSchool.admin_email || editAdminNameField !== editSchool.admin_name || editAdminPasswordField)) {
                const payload: Record<string, unknown> = {
                    adminId: editSchool.admin_id,
                    email: editAdminEmailField,
                    fullName: editAdminNameField || editAdminEmailField.split('@')[0],
                    schoolId: editSchool.id
                };

                if (editAdminPasswordField) {
                    payload.password = editAdminPasswordField;
                }

                const { error: functionError } = await supabase.functions.invoke('update_admin', {
                    body: payload
                });

                if (functionError) {
                    const realError = await getFunctionErrorMessage(functionError, 'Failed to update admin details.');
                    throw new Error(realError);
                }
            }

            await logger.info('tenant', 'School and Admin updated', { details: { schoolId: editSchool.id, name: editName } });
            setEditSuccess('Changes saved successfully!');
            fetchSchoolsData();
            setTimeout(() => setIsEditModalOpen(false), 1000);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to save changes.';
            setEditError(msg);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteSchool = async (schoolId: string) => {
        setIsDeleting(true);
        try {
            await supabase.auth.refreshSession();
            const { data, error } = await supabase.functions.invoke('delete_school', {
                body: { schoolId, hard: false },
            });
            if (error) {
                const real = await getFunctionErrorMessage(error, 'Failed to delete school.');
                throw new Error(real);
            }
            if (data?.error) throw new Error(data.error);
            await logger.info('tenant', 'School soft-deleted', { details: { schoolId } });
            setDeleteConfirm(null);
            fetchSchoolsData();
        } catch (err) {
            console.error('Delete failed:', err);
        } finally {
            setIsDeleting(false);
        }
    };



    const filteredSchools = schools.filter(s => {
        const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.subdomain.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = filterStatus === 'All' || s.status.toLowerCase() === filterStatus.toLowerCase();
        return matchesSearch && matchesStatus;
    });

    return (
        // ─────────────────────────────────────────────────────────────
        // 📝 Author: Narco / Arth
        // 🔗 GitHub: https://github.com/ArthOfficial
        // 🌐 Website: https://arth-hub.vercel.app
        // © 2026 Arth — All rights reserved.
        // ─────────────────────────────────────────────────────────────
        <div className="min-h-screen bg-[#FAF9F6] flex">
            <Sidebar activePage="Database" />

            <main className="flex-1 lg:ml-72 min-h-screen flex flex-col">
                <Header title="Schools & Database" />

                <div className="p-6 md:p-8 lg:p-10 pb-20 max-w-7xl mx-auto w-full">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                        <div>
                            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                                <Database className="w-6 h-6 text-primary" />
                                Schools & Database
                            </h1>
                            <p className="text-muted text-sm mt-1">Manage tenants, revenue, and system-wide school data.</p>
                        </div>
                        <button
                            onClick={() => setIsCreateModalOpen(true)}
                            className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-bold hover:shadow-lg hover:-translate-y-0.5 transition-all shadow-md shadow-primary/20"
                        >
                            <Plus className="w-5 h-5" />
                            Create New School
                        </button>
                    </div>

                    {/* Filters */}
                    <div className="clay-card p-4 mb-6 flex flex-col gap-4">
                        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                            <div className="relative flex-1 w-full">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                                <input
                                    type="text"
                                    placeholder="Search schools by name or domain..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm"
                                />
                            </div>
                            <div className="flex gap-2 flex-shrink-0 overflow-x-auto pb-1 sm:pb-0 hide-scrollbar">
                                {['All', 'Active', 'Suspended', 'Inactive'].map((status) => (
                                    <button
                                        key={status}
                                        onClick={() => setFilterStatus(status)}
                                        className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300
                                            ${filterStatus === status
                                                ? 'bg-primary text-white shadow-lg shadow-primary/20'
                                                : 'bg-white text-muted hover:bg-gray-100 shadow-sm border border-gray-100'}`}
                                    >
                                        {status}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Data Grid */}
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-64">
                            <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                            <p className="text-muted font-medium">Loading database records...</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {filteredSchools.map((school) => (
                                <motion.div
                                    key={school.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:border-primary/30 hover:shadow-md transition-all group relative"
                                >
                                    <div className="absolute top-4 right-4 flex opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                                        <button
                                            onClick={() => openEditModal(school)}
                                            className="w-8 h-8 bg-gray-50 text-muted hover:text-primary hover:bg-primary/10 rounded-lg flex items-center justify-center transition-colors"
                                            title="Edit School"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => setDeleteConfirm(school.id)}
                                            className="w-8 h-8 bg-gray-50 text-muted hover:text-rose-500 hover:bg-rose-50 rounded-lg flex items-center justify-center transition-colors"
                                            title="Delete School"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>

                                    <div className="flex items-center gap-4 mb-4">
                                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-50 to-emerald-50 border border-teal-100 flex items-center justify-center text-teal-600 shadow-inner">
                                            <Building2 className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-foreground text-lg leading-tight">{school.name}</h3>
                                            <p className="text-xs text-muted font-mono">@{school.email_domain || school.subdomain || '—'}</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 mb-4">
                                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide
                                    ${school.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                            {school.status}
                                        </span>
                                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide bg-amber-50 text-amber-600 border border-amber-100">
                                            {school.subscription_tier}
                                        </span>
                                    </div>

                                    {/* Admin Email */}
                                    {school.admin_email && (
                                        <div className="flex items-center gap-1.5 text-xs text-muted mb-3 bg-gray-50 px-3 py-1.5 rounded-lg overflow-hidden">
                                            <Mail className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" />
                                            <span className="truncate">{school.admin_email}</span>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-50">
                                        <div>
                                            <div className="flex items-center gap-1.5 text-xs text-muted font-medium mb-1">
                                                <Users className="w-3.5 h-3.5" />
                                                Students
                                            </div>
                                            <div className="font-bold text-foreground text-lg">{school.student_count?.toLocaleString()}</div>
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-1.5 text-xs text-muted font-medium mb-1">
                                                <DollarSign className="w-3.5 h-3.5" />
                                                Revenue
                                            </div>
                                            <div className="font-bold text-emerald-600 text-lg">${school.revenue?.toLocaleString()}</div>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                            {filteredSchools.length === 0 && (
                                <div className="col-span-full py-12 text-center text-muted bg-white rounded-2xl border border-dashed border-gray-200">
                                    <Database className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                                    <p className="font-medium">No school records found.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Summary Bar */}
                    {!loading && (
                        <div className="mt-6 clay-card px-6 py-4 flex items-center justify-between">
                            <div className="text-sm text-muted font-medium">
                                Showing <span className="text-foreground font-bold">{filteredSchools.length}</span> of <span className="text-foreground font-bold">{schools.length}</span> schools
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted">
                                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> {schools.filter(s => s.status === 'active').length} active</span>
                                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500"></span> {schools.filter(s => s.status !== 'active').length} other</span>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* ═══ CREATE MODAL ═══ */}
            <AnimatePresence>
                {isCreateModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
                            onClick={() => !isCreating && setIsCreateModalOpen(false)}
                        />

                        <motion.div
                            initial={{ scale: 0.95, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 20 }}
                            className="bg-white rounded-[24px] shadow-2xl relative w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scroll"
                        >
                            <div className="p-8">
                                <div className="flex items-center justify-between mb-6">
                                    <div>
                                        <h2 className="text-2xl font-bold text-foreground">Provision New School</h2>
                                        <p className="text-muted text-sm">Create a new tenant and assign an initial administrator.</p>
                                    </div>
                                    <button onClick={() => !isCreating && setIsCreateModalOpen(false)} className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-muted hover:text-foreground transition-colors">
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                {createError && (
                                    <div className="mb-6 p-4 bg-rose-50 text-rose-600 text-sm font-medium rounded-xl border border-rose-100 flex items-start gap-3">
                                        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                                        <div>{createError}</div>
                                    </div>
                                )}

                                <form onSubmit={handleCreateSchool} className="space-y-8">
                                    {/* School Details */}
                                    <div>
                                        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-4 border-b border-gray-100 pb-2">Tenant Details</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                            <div className="space-y-1.5">
                                                <label className="text-sm font-semibold text-muted">School Name</label>
                                                <input required type="text" value={newSchoolName} onChange={e => setNewSchoolName(e.target.value)} className="w-full px-4 py-2.5 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm outline-none" placeholder="e.g. Greenwood High" />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-sm font-semibold text-muted">School Email Domain</label>
                                                <div className="relative flex items-center">
                                                    <span className="absolute left-4 text-xs font-mono text-gray-400 pointer-events-none">@</span>
                                                    <input required type="text" value={newEmailDomain} onChange={e => setNewEmailDomain(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))} className="w-full pl-8 pr-4 py-2.5 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm outline-none font-mono" placeholder="school.com" />
                                                </div>
                                                <p className="text-[11px] text-muted">All users of this school will get emails ending with <span className="font-mono text-foreground">@{newEmailDomain || 'school.com'}</span>.</p>
                                            </div>

                                            <div className="space-y-1.5 md:col-span-2">
                                                <label className="text-sm font-semibold text-muted">Subscription Tier</label>
                                                <select value={newTier} onChange={e => setNewTier(e.target.value)} className="w-full px-4 py-2.5 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm outline-none appearance-none font-semibold">
                                                    <option value="starter">Starter - Up to 500 Students</option>
                                                    <option value="pro">Pro - Up to 2000 Students</option>
                                                    <option value="enterprise">Enterprise - Unlimited</option>
                                                </select>
                                            </div>
                                            <label className="md:col-span-2 flex items-start gap-3 rounded-xl border border-teal-100 bg-teal-50 p-4 cursor-pointer">
                                                <input type="checkbox" checked={newCombinedParentStudentAccount} onChange={e => setNewCombinedParentStudentAccount(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
                                                <span><span className="block text-sm font-bold text-teal-900">Combined account — Student / Parent</span><span className="block text-xs text-teal-800 mt-0.5">Enabled by default.</span></span>
                                            </label>
                                        </div>
                                    </div>

                                    {/* Admin Profile */}
                                    <div>
                                        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-4 border-b border-gray-100 pb-2">Administrator Profile</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                            <div className="space-y-1.5">
                                                <label className="text-sm font-semibold text-muted">Admin Full Name</label>
                                                <input required type="text" value={adminName} onChange={e => setAdminName(e.target.value)} className="w-full px-4 py-2.5 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm outline-none" placeholder="John Doe" />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-sm font-semibold text-muted">Admin Username</label>
                                                <div className="relative flex items-center">
                                                    <input required type="text" value={adminEmailLocal} onChange={e => setAdminEmailLocal(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} className="w-full pl-4 pr-40 py-2.5 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm outline-none font-mono" placeholder="admin" />
                                                    <span className="absolute right-3 text-xs font-mono text-gray-500 pointer-events-none truncate max-w-[45%]">@{newEmailDomain || 'school.com'}</span>
                                                </div>
                                            </div>
                                            <div className="space-y-1.5 md:col-span-2">
                                                <label className="text-sm font-semibold text-muted">Initial Password</label>
                                                <div className="relative">
                                                    <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                                    <input required minLength={6} type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm outline-none" placeholder="Min. 6 characters" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-4 flex items-center justify-end gap-3 border-t border-gray-100">
                                        <button type="button" onClick={() => setIsCreateModalOpen(false)} disabled={isCreating} className="px-5 py-2.5 text-sm font-bold text-muted hover:text-foreground transition-colors disabled:opacity-50">
                                            Cancel
                                        </button>
                                        <button type="submit" disabled={isCreating} className="bg-primary text-white px-8 py-2.5 rounded-xl font-bold hover:shadow-lg hover:-translate-y-0.5 transition-all shadow-md shadow-primary/20 flex items-center gap-2 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none">
                                            {isCreating ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Provisioning...
                                                </>
                                            ) : (
                                                'Create Tenant'
                                            )}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ═══ EDIT MODAL ═══ */}
            <AnimatePresence>
                {isEditModalOpen && editSchool && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
                            onClick={() => !isSaving && setIsEditModalOpen(false)}
                        />

                        <motion.div
                            initial={{ scale: 0.95, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 20 }}
                            className="bg-white rounded-[24px] shadow-2xl relative w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scroll"
                        >
                            <div className="p-8">
                                <div className="flex items-center justify-between mb-6">
                                    <div>
                                        <h2 className="text-2xl font-bold text-foreground">Edit School</h2>
                                        <p className="text-muted text-sm">Update tenant settings & configuration.</p>
                                    </div>
                                    <button onClick={() => setIsEditModalOpen(false)} className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-muted hover:text-foreground transition-colors">
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                {editError && (
                                    <div className="mb-6 p-4 bg-rose-50 text-rose-600 text-sm font-medium rounded-xl border border-rose-100 flex items-start gap-3">
                                        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                                        <div>{editError}</div>
                                    </div>
                                )}
                                {editSuccess && (
                                    <div className="mb-6 p-4 bg-emerald-50 text-emerald-600 text-sm font-medium rounded-xl border border-emerald-100 flex items-start gap-3">
                                        <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                                        <div>{editSuccess}</div>
                                    </div>
                                )}

                                <form onSubmit={handleEditSchool} className="space-y-6">
                                    {/* Admin Account Section */}
                                    <div className="space-y-4 pt-2">
                                        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider border-b border-gray-100 pb-2">Admin Account</h3>
                                        {editSchool?.admin_id ? (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                                <div className="space-y-1.5">
                                                    <label className="text-sm font-semibold text-muted">Admin Full Name</label>
                                                    <input type="text" value={editAdminNameField} onChange={e => setEditAdminNameField(e.target.value)} className="w-full px-4 py-2.5 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm outline-none" />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-sm font-semibold text-muted flex items-center justify-between">
                                                        <span>Admin Email</span>
                                                        {!editAdminEmailUnlocked && (
                                                            <button type="button" onClick={() => setEditAdminEmailUnlocked(true)} className="text-primary hover:text-primary/80 transition-colors" title="Edit admin email">
                                                                <Edit2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        )}
                                                    </label>
                                                    <input
                                                        type="email"
                                                        value={editAdminEmailField}
                                                        onChange={e => setEditAdminEmailField(e.target.value)}
                                                        readOnly={!editAdminEmailUnlocked}
                                                        className={`w-full px-4 py-2.5 border rounded-xl transition-all text-sm outline-none ${editAdminEmailUnlocked ? 'bg-white border-primary focus:ring-2 focus:ring-primary/20' : 'bg-gray-100 border-transparent text-muted cursor-not-allowed font-mono'}`}
                                                    />
                                                </div>
                                                <div className="space-y-1.5 md:col-span-2">
                                                    <label className="text-sm font-semibold text-muted">New Password (leave blank to keep current)</label>
                                                    <div className="relative">
                                                        <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                                        <input minLength={6} type="password" value={editAdminPasswordField} onChange={e => setEditAdminPasswordField(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm outline-none" placeholder="Min. 6 characters" />
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="p-4 bg-amber-50 text-amber-700 text-xs rounded-xl border border-amber-100">
                                                No admin profile found for this school. Admin details cannot be updated here.
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-4 pt-2">
                                        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider border-b border-gray-100 pb-2">Tenant Configuration</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                            <div className="space-y-1.5">
                                                <label className="text-sm font-semibold text-muted">School Name</label>
                                                <input required type="text" value={editName} onChange={e => setEditName(e.target.value)} className="w-full px-4 py-2.5 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm outline-none" />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-sm font-semibold text-muted flex items-center justify-between">
                                                    <span>School Email Domain</span>
                                                    {!editDomainUnlocked && (
                                                        <button type="button" onClick={() => setEditDomainUnlocked(true)} className="text-primary hover:text-primary/80 transition-colors" title="Edit email domain">
                                                            <Edit2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </label>
                                                <div className="relative flex items-center">
                                                    <span className="absolute left-4 text-xs font-mono text-gray-400 pointer-events-none">@</span>
                                                    <input
                                                        type="text"
                                                        value={editEmailDomain}
                                                        onChange={e => setEditEmailDomain(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
                                                        readOnly={!editDomainUnlocked}
                                                        className={`w-full pl-8 pr-4 py-2.5 border rounded-xl transition-all text-sm outline-none font-mono ${editDomainUnlocked ? 'bg-white border-primary focus:ring-2 focus:ring-primary/20' : 'bg-gray-100 border-transparent text-muted cursor-not-allowed'}`}
                                                        placeholder="school.com"
                                                    />
                                                </div>
                                                {editDomainUnlocked && (
                                                    <p className="text-[11px] text-amber-600">Changing the domain won't update existing user emails. All new users must use this domain.</p>
                                                )}
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-sm font-semibold text-muted">Subscription Tier</label>
                                                <select value={editTier} onChange={e => setEditTier(e.target.value)} className="w-full px-4 py-2.5 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm outline-none appearance-none font-semibold">
                                                    <option value="starter">Starter</option>
                                                    <option value="pro">Pro</option>
                                                    <option value="enterprise">Enterprise</option>
                                                </select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-sm font-semibold text-muted">Status</label>
                                                <select value={editStatus} onChange={e => setEditStatus(e.target.value)} className="w-full px-4 py-2.5 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm outline-none appearance-none font-semibold">
                                                    <option value="active">Active</option>
                                                    <option value="suspended">Suspended</option>
                                                    <option value="inactive">Inactive</option>
                                                </select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-sm font-semibold text-muted">Max Students</label>
                                                <input type="number" min={0} value={editMaxStudents} onChange={e => setEditMaxStudents(Number(e.target.value))} className="w-full px-4 py-2.5 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm outline-none" />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-sm font-semibold text-muted">Phone</label>
                                                <input type="text" value={editPhone} onChange={e => setEditPhone(e.target.value)} className="w-full px-4 py-2.5 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm outline-none" placeholder="+1 (555) 000-0000" />
                                            </div>
                                            <div className="space-y-1.5 md:col-span-2">
                                                <label className="text-sm font-semibold text-muted">Address</label>
                                                <input type="text" value={editAddress} onChange={e => setEditAddress(e.target.value)} className="w-full px-4 py-2.5 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm outline-none" placeholder="123 Scholar Drive, City, State" />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-4 flex items-center justify-end gap-3 border-t border-gray-100">
                                        <button type="button" onClick={() => setIsEditModalOpen(false)} disabled={isSaving} className="px-5 py-2.5 text-sm font-bold text-muted hover:text-foreground transition-colors disabled:opacity-50">
                                            Cancel
                                        </button>
                                        <button type="submit" disabled={isSaving} className="bg-primary text-white px-8 py-2.5 rounded-xl font-bold hover:shadow-lg hover:-translate-y-0.5 transition-all shadow-md shadow-primary/20 flex items-center gap-2 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none">
                                            {isSaving ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Saving...
                                                </>
                                            ) : (
                                                <>
                                                    <Save className="w-4 h-4" />
                                                    Save Changes
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ═══ DELETE CONFIRMATION ═══ */}
            <AnimatePresence>
                {deleteConfirm && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
                            onClick={() => !isDeleting && setDeleteConfirm(null)}
                        />
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white rounded-2xl shadow-2xl relative w-full max-w-md p-8 text-center"
                        >
                            <div className="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Trash2 className="w-7 h-7 text-rose-500" />
                            </div>
                            <h3 className="text-xl font-bold text-foreground mb-2">Delete School?</h3>
                            <p className="text-muted text-sm mb-6">This will permanently delete the school and all associated data. This action cannot be undone.</p>
                            <div className="flex items-center justify-center gap-3">
                                <button onClick={() => setDeleteConfirm(null)} disabled={isDeleting} className="px-6 py-2.5 text-sm font-bold text-muted hover:text-foreground transition-colors border border-gray-200 rounded-xl">
                                    Cancel
                                </button>
                                <button onClick={() => handleDeleteSchool(deleteConfirm)} disabled={isDeleting} className="bg-rose-500 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-rose-600 transition-all flex items-center gap-2 disabled:opacity-50">
                                    {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                    Delete
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

        </div>
    );
};

export default SuperAdminDatabase;
