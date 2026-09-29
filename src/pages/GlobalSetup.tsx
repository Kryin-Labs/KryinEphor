import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Settings,
    Mail,
    ShieldCheck,
    Database,
    Key,
    Server,
    Activity,
    ChevronRight,
    Save,
    Moon,
    Sun,
    Monitor
} from 'lucide-react';
import Sidebar from '../components/dashboard/Sidebar';
import Header from '../components/dashboard/Header';

const HEALTH_METRICS = [
    { label: "Server Uptime", value: "99.98%", sub: "Last 30 days", icon: Server, color: "text-teal-600" },
    { label: "DB Latency", value: "24ms", sub: "Avg response", icon: Database, color: "text-blue-600" },
    { label: "API Requests", value: "12.4K", sub: "Last hour", icon: Activity, color: "text-purple-600" },
    { label: "Storage", value: "48%", sub: "2.4TB / 5TB", icon: Database, color: "text-orange-600" }
];

const GlobalSetup: React.FC = () => {
    const [activeTab, setActiveTab] = useState('General');
    const [maintenanceMode, setMaintenanceMode] = useState(false);
    const [theme, setTheme] = useState('Light');

    const tabs = [
        { id: 'General', icon: Settings },
        { id: 'Email Service', icon: Mail },
        { id: 'Security', icon: ShieldCheck },
        { id: 'Backups', icon: Database },
        { id: 'API Access', icon: Key }
    ];

    return (
        <div className="min-h-screen bg-[#FAF9F6] flex">
            <Sidebar activePage="Global Setup" />

            <main className="flex-1 lg:ml-72 flex flex-col min-h-screen">
                <Header title="System Configuration" />

                <div className="p-6 md:p-10 max-w-6xl mx-auto w-full">
                    <div className="flex flex-col lg:flex-row gap-8">
                        {/* Tabs Sidebar */}
                        <div className="w-full lg:w-72 flex-shrink-0">
                            <div className="clay-card p-4 sticky top-28">
                                <div className="flex flex-col gap-2">
                                    {tabs.map(tab => {
                                        const Icon = tab.icon;
                                        return (
                                            <button
                                                key={tab.id}
                                                onClick={() => setActiveTab(tab.id)}
                                                className={`px-5 py-4 rounded-2xl text-left text-sm font-bold transition-all duration-300 flex items-center gap-3
                                                    ${activeTab === tab.id
                                                        ? 'bg-primary text-white shadow-xl shadow-teal-900/20 translate-x-1'
                                                        : 'text-muted hover:bg-gray-50'}`}
                                            >
                                                <Icon className={`w-4 h-4 ${activeTab === tab.id ? 'text-white' : 'text-muted'}`} />
                                                {tab.id}
                                                {activeTab === tab.id && <ChevronRight className="ml-auto w-4 h-4" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Content Area */}
                        <div className="flex-1 space-y-8">
                            <AnimatePresence mode="wait">
                                {activeTab === 'General' ? (
                                    <motion.div
                                        key="general"
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                        className="space-y-8"
                                    >
                                        <div className="clay-card p-10">
                                            <div className="mb-10 pb-6 border-b border-gray-100 flex justify-between items-end">
                                                <div>
                                                    <h3 className="text-2xl font-black text-foreground tracking-tight">General Setup</h3>
                                                    <p className="text-sm text-muted font-medium mt-1">Manage core system-wide behaviors and accessibility.</p>
                                                </div>
                                                <button className="clay-btn py-2.5 px-6 text-xs flex items-center gap-2">
                                                    <Save className="w-4 h-4" />
                                                    Save Changes
                                                </button>
                                            </div>

                                            <div className="space-y-10">
                                                {/* Maintenance Mode */}
                                                <div className="flex items-center justify-between group">
                                                    <div>
                                                        <div className="font-bold text-foreground text-lg">Maintenance Mode</div>
                                                        <div className="text-sm text-muted font-medium mt-1">Temporarily disable access for all school instances for core updates.</div>
                                                    </div>
                                                    <div
                                                        onClick={() => setMaintenanceMode(!maintenanceMode)}
                                                        className={`w-14 h-8 rounded-full p-1 cursor-pointer transition-colors duration-300 flex items-center ${maintenanceMode ? 'bg-primary shadow-inner shadow-teal-900/20' : 'bg-stone-200 shadow-inner'}`}
                                                    >
                                                        <motion.div
                                                            animate={{ x: maintenanceMode ? 24 : 0 }}
                                                            className="w-6 h-6 bg-white rounded-full shadow-md"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="w-full h-px bg-gray-100/50"></div>

                                                {/* Appearance Theme */}
                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                                                    <div>
                                                        <div className="font-bold text-foreground text-lg">Platform Theme</div>
                                                        <div className="text-sm text-muted font-medium mt-1">Select the default interface appearance for the central dashboard.</div>
                                                    </div>
                                                    <div className="flex p-1.5 bg-gray-100/50 backdrop-blur-sm rounded-[1.25rem] border border-gray-200 shadow-inner">
                                                        {[
                                                            { name: 'Light', icon: Sun },
                                                            { name: 'Dark', icon: Moon },
                                                            { name: 'System', icon: Monitor }
                                                        ].map((t) => (
                                                            <button
                                                                key={t.name}
                                                                onClick={() => setTheme(t.name)}
                                                                className={`px-5 py-2.5 text-xs font-black rounded-xl transition-all duration-300 flex items-center gap-2
                                                                    ${theme === t.name
                                                                        ? 'bg-white text-primary shadow-lg ring-1 ring-black/5'
                                                                        : 'text-muted hover:text-foreground'}`}
                                                            >
                                                                <t.icon className="w-3.5 h-3.5" />
                                                                {t.name}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* System Health Snapshot */}
                                        <div className="clay-card p-10 relative overflow-hidden group">
                                            <div className="flex justify-between items-start mb-10">
                                                <div>
                                                    <h3 className="text-xl font-black text-foreground tracking-tight">Live System Health</h3>
                                                    <p className="text-sm text-muted font-medium mt-1">Encrypted real-time performance telemetry.</p>
                                                </div>
                                                <div className="bg-emerald-50 text-emerald-700 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border border-emerald-100 shadow-sm">
                                                    <span className="relative flex h-2 w-2">
                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                                    </span>
                                                    Operating Normally
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
                                                {HEALTH_METRICS.map((m, i) => (
                                                    <div key={i} className="bg-[#FAF9F6] p-5 rounded-3xl border border-stone-100 shadow-inner hover:shadow-md transition-shadow group/metric">
                                                        <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-2 opacity-50">{m.label}</div>
                                                        <div className="text-2xl font-black text-foreground mb-1">{m.value}</div>
                                                        <div className="text-[9px] font-bold text-primary group-hover/metric:translate-x-1 transition-transform">{m.sub}</div>
                                                    </div>
                                                ))}
                                            </div>

                                            <button className="text-primary text-xs font-black uppercase tracking-widest hover:underline flex items-center gap-2">
                                                Open Health Console <ChevronRight className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </motion.div>
                                ) : (
                                    <motion.div
                                        key="wip"
                                        initial={{ opacity: 0, scale: 0.98 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.98 }}
                                        className="clay-card p-24 text-center mt-10"
                                    >
                                        <div className="w-24 h-24 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner">
                                            <Settings className="w-10 h-10 text-stone-300 animate-spin-slow" />
                                        </div>
                                        <h3 className="text-2xl font-black text-foreground tracking-tight">Configuration Module</h3>
                                        <p className="text-muted mt-3 font-medium max-w-sm mx-auto">The <span className="text-primary font-black italic">{activeTab}</span> settings console is currently being provisioned for your node.</p>
                                        <button onClick={() => setActiveTab('General')} className="clay-btn mt-10 px-8 py-3 text-sm">
                                            Return to General Setup
                                        </button>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>

                <footer className="mt-auto border-t border-gray-200 py-6 text-center text-[10px] font-black text-muted uppercase tracking-[0.2em] bg-[#FAF9F6]">
                    Kryin School Core Engine v2.4.1 • Global Environment
                </footer>
            </main>
        </div>
    );
};

export default GlobalSetup;
