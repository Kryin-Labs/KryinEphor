import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    AlertCircle,
    ChevronDown,
    Database,
    CreditCard,
    ShieldAlert,
    School,
    Server,
    Filter,
    CheckCircle2,
    Trash2,
    X,
    Building2,
    UserCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';
import { supabase } from '../lib/supabase';
import { formatDistanceToNow } from 'date-fns';

interface Alert {
    id: string;
    title: string;
    severity: string;
    category: string;
    message: string;
    is_resolved: boolean;
    created_at: string;
    school_id: string | null;
}

export interface SystemLog {
    id: string;
    action: string | null;
    message: string;
    level: 'info' | 'warn' | 'error';
    category: string;
    details: Record<string, unknown> | null;
    created_at: string;
    ip_address: string | null;
    user_id?: string | null;
    user_agent?: string | null;
    user_name?: string;
    status?: string | null;
    schools?: { name: string } | null;
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
    infrastructure: Database,
    finance: CreditCard,
    security: ShieldAlert,
    schools: School,
    system: Server,
};

const renderCategoryIcon = (category: string, className: string) => {
    const IconComponent = CATEGORY_ICONS[category.toLowerCase()] ?? AlertCircle;
    return <IconComponent className={className} />;
};

const getSeverityStyles = (sev: string) => {
    switch (sev) {
        case 'critical': return 'text-rose-600 bg-rose-50 border-rose-100';
        case 'warning': return 'text-amber-600 bg-amber-50 border-amber-100';
        default: return 'text-blue-600 bg-blue-50 border-blue-100';
    }
};

const AlertCardContent = ({ alert, isExpanded, onToggle, onResolve }: { alert: Alert, isExpanded: boolean, onToggle: (id: string) => void, onResolve: (id: string) => void }) => {
    return (
        <motion.div
            layout
            className={`relative mb-4 rounded-[2rem] border border-stone-200 transition-all cursor-pointer overflow-hidden ${isExpanded ? 'bg-white shadow-xl ring-2 ring-primary/5' : 'bg-white/50 hover:bg-white shadow-sm'}`}
            onClick={() => onToggle(alert.id)}
        >
            <div className="p-6 flex items-start gap-4">
                <div className={`mt-1 h-14 w-14 rounded-2xl flex-shrink-0 flex items-center justify-center border-b shadow-inner ${getSeverityStyles(alert.severity)}`}>
                    {renderCategoryIcon(alert.category, 'w-7 h-7')}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-primary/60">{alert.category}</span>
                            <span className="text-gray-300">•</span>
                            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">{formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}</span>
                        </div>
                        <div className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider shadow-sm border ${getSeverityStyles(alert.severity)}`}>
                            {alert.severity}
                        </div>
                    </div>
                    <h3 className="text-lg font-extrabold text-foreground mb-1 leading-tight">{alert.title}</h3>
                    <p className={`text-sm text-muted line-clamp-2 ${isExpanded ? 'line-clamp-none' : ''}`}>
                        {alert.message}
                    </p>
                </div>

                <div className="flex-shrink-0 self-center">
                    <motion.div
                        animate={{ rotate: isExpanded ? 180 : 0 }}
                        className="w-10 h-10 rounded-full bg-white shadow-sm border border-gray-100 flex items-center justify-center text-muted"
                    >
                        <ChevronDown className="w-5 h-5" />
                    </motion.div>
                </div>
            </div>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                    >
                        <div className="px-6 pb-6 pt-2 border-t border-gray-100 mt-2 bg-stone-50/50">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mt-6">
                                <div className="flex items-center gap-3">
                                    <div className="flex -space-x-2">
                                        {[1, 2].map(i => (
                                            <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-stone-200 flex items-center justify-center text-[10px] font-bold text-stone-500">
                                                U{i}
                                            </div>
                                        ))}
                                    </div>
                                    <span className="text-xs text-muted font-medium italic">2 staff members notified</span>
                                </div>
                                <div className="flex items-center gap-3 w-full sm:w-auto">
                                    {!alert.is_resolved && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onResolve(alert.id);
                                            }}
                                            className="clay-btn py-2.5 px-6 text-sm font-bold flex-1 sm:flex-none justify-center gap-2 flex items-center"
                                        >
                                            <CheckCircle2 className="w-4 h-4" />
                                            Resolve Alert
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

const AlertCard = React.memo(AlertCardContent);

const SystemAlerts: React.FC = () => {
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [activeFilter, setActiveFilter] = useState('all');

    // Logs states
    const [activeTab, setActiveTab] = useState<'alerts' | 'logs'>('alerts');
    const [logs, setLogs] = useState<SystemLog[]>([]);
    const [logsLoading, setLogsLoading] = useState(true);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedLogs, setSelectedLogs] = useState<Set<string>>(new Set());
    const [isDeleting, setIsDeleting] = useState(false);
    const [selectedLog, setSelectedLog] = useState<SystemLog | null>(null);

    const fetchAlerts = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('system_alerts')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setAlerts(data || []);
        } catch (err) {
            console.error('Error fetching alerts:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchLogs = async () => {
        setLogsLoading(true);
        try {
            const { data, error } = await supabase
                .from('system_logs')
                .select('id, action, message, level, category, details, created_at, ip_address, user_id, user_agent, status, school_id, schools:school_id(name)')
                .order('created_at', { ascending: false })
                .limit(200);

            if (error) throw error;
            const rows = (data as unknown as SystemLog[]) || [];

            // Resolve actor names
            const userIds = Array.from(new Set(rows.map(r => r.user_id).filter(Boolean))) as string[];
            let nameMap: Record<string, string> = {};
            if (userIds.length) {
                const { data: profs } = await supabase
                    .from('profiles')
                    .select('id, full_name')
                    .in('id', userIds);
                nameMap = (profs || []).reduce((acc: Record<string, string>, p: { id: string; full_name: string | null }) => {
                    if (p.full_name) acc[p.id] = p.full_name;
                    return acc;
                }, {});
            }
            setLogs(rows.map(r => ({ ...r, user_name: (r.user_id && nameMap[r.user_id]) || 'System' })));
        } catch (err) {
            console.error('Error fetching logs:', err);
        } finally {
            setLogsLoading(false);
        }
    };

    const resolveAlert = async (id: string) => {
        try {
            const { error } = await supabase
                .from('system_alerts')
                .update({ is_resolved: true })
                .eq('id', id);

            if (error) throw error;
            setAlerts(prev => prev.map(a => a.id === id ? { ...a, is_resolved: true } : a));
        } catch (err) {
            console.error('Error resolving alert:', err);
        }
    };

    useEffect(() => {
        fetchAlerts();
        fetchLogs();
    }, []);

    const handleDeleteAll = async () => {
        setIsDeleting(true);
        try {
            const { error } = await supabase
                .from('system_logs')
                .delete()
                .neq('id', '00000000-0000-0000-0000-000000000000');
            if (error) throw error;
            setLogs([]);
            setShowDeleteModal(false);
            setSelectionMode(false);
        } catch (err) {
            console.error(err);
        } finally {
            setIsDeleting(false);
        }
    };

    const handleDeleteSelected = async () => {
        setIsDeleting(true);
        try {
            const { error } = await supabase
                .from('system_logs')
                .delete()
                .in('id', Array.from(selectedLogs));
            if (error) throw error;
            setLogs(logs.filter(l => !selectedLogs.has(l.id)));
            setSelectedLogs(new Set());
            setSelectionMode(false);
        } catch (err) {
            console.error(err);
        } finally {
            setIsDeleting(false);
        }
    };
    
    const toggleLogSelection = (id: string) => {
        const newSet = new Set(selectedLogs);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedLogs(newSet);
    };

    const filteredAlerts = alerts.filter(alert =>
        activeFilter === 'all' ? true : alert.severity === activeFilter
    );

    return (
        <div className="min-h-screen bg-[#FAF9F6] flex">
            <Sidebar activePage="System Alerts" />

            <main className="flex-1 lg:ml-72 flex flex-col min-h-screen">
                <Header title="System Status" />

                <div className="p-6 md:p-10 max-w-6xl mx-auto w-full">
                    <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-12">
                        <div>
                            <h1 className="text-3xl font-black text-foreground tracking-tight">System Management</h1>
                            <p className="text-muted mt-2 font-medium">Monitor alerts and system action logs across the network.</p>
                            <div className="flex gap-4 mt-6">
                                <button onClick={() => { setActiveTab('alerts'); setSelectionMode(false); }} className={`px-6 py-2.5 font-bold rounded-xl text-sm transition-all shadow-sm ${activeTab === 'alerts' ? 'bg-primary text-white shadow-primary/20' : 'bg-white text-stone-500 border border-stone-200 hover:bg-stone-50'}`}>Active Alerts</button>
                                <button onClick={() => setActiveTab('logs')} className={`px-6 py-2.5 font-bold rounded-xl text-sm transition-all shadow-sm ${activeTab === 'logs' ? 'bg-primary text-white shadow-primary/20' : 'bg-white text-stone-500 border border-stone-200 hover:bg-stone-50'}`}>System Logs</button>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            {activeTab === 'alerts' && (
                                <>
                                    <div className="hidden md:flex bg-white/50 backdrop-blur rounded-2xl p-1.5 shadow-sm border border-stone-100">
                                        {['all', 'critical', 'warning', 'info'].map(filter => (
                                            <button
                                                key={filter}
                                                onClick={() => setActiveFilter(filter)}
                                                className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeFilter === filter ? 'bg-stone-900 text-white shadow-lg' : 'text-muted hover:text-stone-900'}`}
                                            >
                                                {filter}
                                            </button>
                                        ))}
                                    </div>
                                    <button className="clay-btn-outline w-12 h-12 !p-0 rounded-2xl flex items-center justify-center bg-white shadow-sm hover:shadow-md transition-shadow">
                                        <Filter className="w-5 h-5" />
                                    </button>
                                </>
                            )}
                            {activeTab === 'logs' && (
                                <div className="flex items-center gap-3">
                                    {selectionMode ? (
                                        <>
                                            <button onClick={() => { setSelectionMode(false); setSelectedLogs(new Set()); }} className="px-4 py-2 bg-stone-100 text-stone-600 font-bold rounded-xl text-sm hover:bg-stone-200">
                                                Cancel
                                            </button>
                                            <button 
                                                onClick={handleDeleteSelected} 
                                                disabled={selectedLogs.size === 0 || isDeleting}
                                                className="px-4 py-2 bg-rose-600 text-white font-bold rounded-xl text-sm hover:bg-rose-700 disabled:opacity-50 flex items-center gap-2"
                                            >
                                                {isDeleting ? 'Deleting...' : `Delete Selected (${selectedLogs.size})`}
                                            </button>
                                        </>
                                    ) : (
                                        <button onClick={() => setShowDeleteModal(true)} className="px-4 py-2 bg-rose-50 text-rose-600 font-bold border border-rose-100 rounded-xl text-sm hover:bg-rose-100 flex items-center gap-2 shadow-sm transition-shadow">
                                            <Trash2 className="w-4 h-4" /> Delete Logs
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </header>

                    <div className="flex items-baseline justify-between mb-8 px-2">
                        <div className="text-xs font-black text-stone-400 uppercase tracking-widest">
                            Showing <span className="text-stone-900 font-black">{activeTab === 'alerts' ? filteredAlerts.length : logs.length}</span> {activeTab === 'alerts' ? 'active notifications' : 'system logs'}
                        </div>
                        {activeTab === 'alerts' ? (
                            <button className="text-xs font-black text-primary hover:underline uppercase tracking-widest">
                                Mark all as read
                            </button>
                        ) : selectionMode && (
                            <button onClick={() => setSelectedLogs(new Set(logs.map(l => l.id)))} className="text-xs font-black text-primary hover:underline uppercase tracking-widest border border-primary/20 px-3 py-1 rounded-full">
                                Select All
                            </button>
                        )}
                    </div>

                    <div className="space-y-4">
                        {activeTab === 'alerts' && (
                            loading ? (
                                <div className="clay-card p-24 flex items-center justify-center">
                                    <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                                </div>
                            ) : (
                                <AnimatePresence mode="popLayout">
                                    {filteredAlerts.map(alert => (
                                        <AlertCard
                                            key={alert.id}
                                            alert={alert}
                                            isExpanded={expandedId === alert.id}
                                            onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
                                            onResolve={resolveAlert}
                                        />
                                    ))}
                                </AnimatePresence>
                            )
                        )}

                        {activeTab === 'alerts' && filteredAlerts.length === 0 && !loading && (
                            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="clay-card p-24 flex flex-col items-center justify-center text-center">
                                <div className="w-24 h-24 rounded-full bg-stone-50 flex items-center justify-center mb-10 shadow-inner">
                                    <CheckCircle2 className="w-12 h-12 text-stone-200" />
                                </div>
                                <h3 className="text-2xl font-black mb-3">System Healthy!</h3>
                                <p className="text-muted max-w-xs font-medium">No alerts matching this filter currently require your attention.</p>
                                <button onClick={() => setActiveFilter('all')} className="mt-8 text-primary font-bold hover:underline">Clear all filters</button>
                            </motion.div>
                        )}

                        {activeTab === 'logs' && (
                            logsLoading ? (
                                <div className="clay-card p-24 flex items-center justify-center">
                                    <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                                </div>
                            ) : (
                                <div className="flex flex-col gap-3">
                                    {logs.map(log => (
                                        <motion.div 
                                            key={log.id} 
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            onClick={() => selectionMode ? toggleLogSelection(log.id) : setSelectedLog(log)}
                                            className={`bg-white rounded-[1.5rem] border ${selectionMode && selectedLogs.has(log.id) ? 'border-primary ring-2 ring-primary/10 bg-primary/5' : 'border-stone-200'} p-4 flex gap-4 items-center shadow-sm cursor-pointer hover:shadow-md transition-all`}
                                        >
                                            {selectionMode && (
                                                <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center border-2 rounded bg-white border-stone-300">
                                                    {selectedLogs.has(log.id) && <div className="w-3 h-3 bg-primary rounded-sm" />}
                                                </div>
                                            )}
                                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-bold flex-shrink-0 ${log.level === 'error' ? 'bg-rose-50 text-rose-600' : log.level === 'warn' ? 'bg-amber-50 text-amber-600' : 'bg-sky-50 text-sky-600'}`}>
                                                {log.level === 'error' ? '!!' : log.level === 'warn' ? '!' : 'i'}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1.5">
                                                    <span className="text-base font-bold text-stone-800 tracking-tight">{log.action || log.category || 'System'}</span>
                                                    <span className={`text-[10px] uppercase font-black tracking-wider px-2.5 py-1 rounded-full border ${log.level === 'error' ? 'text-rose-600 bg-rose-50 border-rose-100' : log.level === 'warn' ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-sky-600 bg-sky-50 border-sky-100'}`}>
                                                        {log.level}
                                                    </span>
                                                    <span className="text-[10px] uppercase font-black tracking-wider text-muted px-2.5 py-1 rounded-full bg-stone-100 border border-stone-200">
                                                        {log.schools?.name || 'System'}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-stone-500 font-medium truncate">{log.message}</p>
                                            </div>
                                            <div className="text-right text-[11px] font-bold text-stone-400 uppercase tracking-wider flex-shrink-0">
                                                {log.created_at ? formatDistanceToNow(new Date(log.created_at), { addSuffix: true }) : 'Unknown'}
                                            </div>
                                        </motion.div>
                                    ))}
                                    {logs.length === 0 && (
                                        <div className="text-center py-20 text-stone-400 font-bold">No system logs available.</div>
                                    )}
                                </div>
                            )
                        )}
                    </div>

                    <div className="mt-16 pt-10 border-t border-stone-200 flex flex-col items-center gap-6">
                        <div className="flex items-center gap-3">
                            <button className="w-10 h-10 rounded-xl bg-white border border-stone-200 flex items-center justify-center text-stone-400 disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition-all" disabled>
                                <ChevronDown className="w-4 h-4 rotate-90" />
                            </button>
                            <button className="w-10 h-10 rounded-xl bg-stone-900 text-white text-xs font-black shadow-lg">1</button>
                            <button className="w-10 h-10 rounded-xl bg-white border border-stone-200 text-xs font-black text-stone-600 hover:border-stone-400 shadow-sm transition-all">2</button>
                            <button className="w-10 h-10 rounded-xl bg-white border border-stone-200 text-xs font-black text-stone-600 hover:border-stone-400 shadow-sm transition-all">3</button>
                            <button className="w-10 h-10 rounded-xl bg-white border border-stone-200 flex items-center justify-center text-stone-400 hover:border-stone-400 shadow-sm transition-all">
                                <ChevronDown className="w-4 h-4 -rotate-90" />
                            </button>
                        </div>
                        <p className="text-[10px] font-bold text-muted uppercase tracking-widest opacity-50 italic">KRYIN SCHOOL CORE SYSTEM LOGS V2.4.1</p>
                    </div>
                </div>

                <footer className="mt-auto border-t border-gray-200 py-6 text-center text-sm text-muted font-medium bg-[#FAF9F6]">
                    © 2024 Kryin School. System Alerts Monitoring Console.
                </footer>

                {/* Log Detail Modal */}
                <AnimatePresence>
                    {selectedLog && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={() => setSelectedLog(null)} />
                            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative clay-card w-full max-w-lg p-0 overflow-hidden bg-white">
                                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${selectedLog.level === 'error' ? 'bg-rose-50 text-rose-500' : selectedLog.level === 'warn' ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-500'}`}>
                                            {renderCategoryIcon(selectedLog.category, 'w-5 h-5')}
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-foreground">{selectedLog.action || 'System Event'}</h3>
                                            <p className="text-xs text-muted">ID: {selectedLog.id.slice(0, 8)}...</p>
                                        </div>
                                    </div>
                                    <button onClick={() => setSelectedLog(null)} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 transition-colors">
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                <div className="p-6 space-y-6">
                                    <p className="text-sm text-stone-600 font-medium leading-relaxed">{selectedLog.message}</p>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Status</label>
                                            <div className={`text-sm font-bold uppercase ${selectedLog.status === 'failed' || selectedLog.level === 'error' ? 'text-red-500' : 'text-emerald-500'}`}>
                                                {selectedLog.status || selectedLog.level}
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Time</label>
                                            <div className="text-sm font-medium text-foreground">{new Date(selectedLog.created_at).toLocaleString()}</div>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Target Domain</label>
                                            <div className="text-sm font-medium text-foreground flex items-center gap-2">
                                                <Building2 className="w-4 h-4 text-primary" /> {selectedLog.schools?.name || 'Platform Core'}
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Actor</label>
                                            <div className="text-sm font-medium text-foreground flex items-center gap-2">
                                                <UserCheck className="w-4 h-4 text-primary" /> {selectedLog.user_name || 'System'}
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-muted uppercase tracking-wider">IP Address</label>
                                            <div className="text-sm font-mono font-medium text-stone-600 bg-stone-50 px-2 py-1 rounded inline-block">
                                                {selectedLog.ip_address || '—'}
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-muted uppercase tracking-wider">User Agent</label>
                                            <div className="text-xs font-mono text-stone-500 truncate" title={selectedLog.user_agent || ''}>
                                                {selectedLog.user_agent || '—'}
                                            </div>
                                        </div>
                                    </div>
                                    {selectedLog.details && Object.keys(selectedLog.details).length > 0 && (
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Details</label>
                                            <pre className="text-xs font-mono bg-stone-50 border border-stone-200 rounded-lg p-3 overflow-auto max-h-48 text-stone-700">{JSON.stringify(selectedLog.details, null, 2)}</pre>
                                        </div>
                                    )}
                                </div>

                                <div className="p-6 pt-0 flex justify-end">
                                    <button onClick={() => setSelectedLog(null)} className="clay-btn py-2 px-6 text-sm font-bold">Close</button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>

                {/* Delete Logs Modal */}
                <AnimatePresence>
                    {showDeleteModal && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={() => setShowDeleteModal(false)} />
                            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative bg-white rounded-3xl shadow-2xl overflow-hidden max-w-md w-full border border-stone-200/50">
                                <div className="p-8 pb-6">
                                    <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center mb-6">
                                        <Trash2 className="w-6 h-6 text-rose-500" />
                                    </div>
                                    <h2 className="text-2xl font-black text-stone-800 mb-2 tracking-tight">Manage System Logs</h2>
                                    <p className="text-stone-500 font-medium text-sm leading-relaxed mb-8">
                                        Choose how you want to manage your system action logs. You can delete all securely or select specific logs to discard.
                                    </p>
                                    
                                    <div className="flex flex-col gap-3">
                                        <button 
                                            onClick={handleDeleteAll} 
                                            disabled={isDeleting}
                                            className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-4 rounded-xl flex items-center justify-center transition-colors disabled:opacity-50"
                                        >
                                            {isDeleting ? 'Deleting...' : 'Delete Completely (All)'}
                                        </button>
                                        <button 
                                            onClick={() => {
                                                setShowDeleteModal(false);
                                                setSelectionMode(true);
                                            }} 
                                            className="w-full bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold py-4 rounded-xl flex items-center justify-center transition-colors"
                                        >
                                            Select Specific Logs
                                        </button>
                                        <button 
                                            onClick={() => setShowDeleteModal(false)} 
                                            className="w-full text-stone-400 hover:text-stone-600 font-bold py-3 mt-2"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>
            </main>
        </div>
    );
};

export default SystemAlerts;
