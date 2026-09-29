import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import LoginModal from '../components/auth/LoginModal';
import { useAuth } from '../context/AuthContext';

const LandingPage: React.FC = () => {
    const [isLoginOpen, setIsLoginOpen] = useState(false);
    const { user, role } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const authorizationId = new URLSearchParams(location.search).get('authorization_id');

    useEffect(() => {
        if (user && role && authorizationId) navigate(`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`, { replace: true });
    }, [authorizationId, navigate, role, user]);

    const handleEnterClick = () => {
        if (user && role) {
            if (authorizationId) { navigate(`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`); return; }
            if (role === 'superadmin') {
                navigate('/super-admin');
            } else {
                navigate('/dashboard');
            }
        } else {
            setIsLoginOpen(true);
        }
    };

    return (
        <div className="visible-view w-full overflow-x-hidden antialiased selection:bg-lime-300 selection:text-emerald-900 bg-cream">
            <LoginModal isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} />

            {/* Navigation */}
            <nav className="sticky top-0 z-40 bg-cream/80 backdrop-blur-xl border-b border-emerald-900/5">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="hidden w-10 h-10 bg-emerald-900 rounded-xl items-center justify-center text-lime-400 shadow-lg">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 14l9-5-9-5-9 5 9 5z"></path>
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"></path>
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222"></path>
                            </svg>
                        </div>
                        <img src="/brand/kryin-mark-dark.png" alt="" className="w-10 h-10 object-contain" />
                        <span className="text-xl font-semibold tracking-tight text-emerald-900">Kryin <span className="font-normal text-emerald-900/55">School</span></span>
                    </div>
                    <div className="hidden md:flex items-center gap-8">
                        <a href="#" className="text-sm font-medium text-emerald-900/60 hover:text-emerald-900 transition-colors">Platform</a>
                        <a href="#" className="text-sm font-medium text-emerald-900/60 hover:text-emerald-900 transition-colors">Solutions</a>
                        <a href="#" className="text-sm font-medium text-emerald-900/60 hover:text-emerald-900 transition-colors">Pricing</a>
                        <a href="#" className="text-sm font-medium text-emerald-900/60 hover:text-emerald-900 transition-colors">Resources</a>
                    </div>
                    <div className="flex items-center gap-4">
                        {!user && (
                            <button
                                onClick={() => setIsLoginOpen(true)}
                                className="hidden md:block text-sm font-bold text-emerald-900 hover:text-emerald-700"
                            >
                                Log in
                            </button>
                        )}
                        <button
                            onClick={handleEnterClick}
                            className="bg-emerald-900 text-white px-6 py-2.5 rounded-full text-sm font-bold hover:bg-emerald-800 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
                        >
                            Enter Workspace
                        </button>
                    </div>
                </div>
            </nav>

            <main>
            {/* Hero Header */}
            <header className="relative pt-24 pb-32 overflow-hidden">
                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-0 right-0 w-3/4 h-full bg-gradient-to-l from-lime-100/50 to-transparent"></div>
                    <div className="absolute -top-24 -right-24 w-96 h-96 bg-lime-400/20 rounded-full blur-3xl"></div>
                    <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-emerald-100/40 rounded-full blur-3xl"></div>
                    <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(#1A3C34 1px, transparent 1px), linear-gradient(to right, #1A3C34 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
                </div>

                <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-emerald-900/10 shadow-sm mb-8 animate-fade-up">
                        <span className="w-2 h-2 rounded-full bg-lime-400 animate-pulse"></span>
                        <span className="text-xs font-bold text-emerald-900 tracking-wide uppercase">Super Admin Network v2.0 is live</span>
                    </div>

                    <h1 className="text-5xl md:text-7xl font-extrabold text-emerald-900 tracking-tight mb-6 leading-[1.1] animate-fade-up delay-100">
                        The elegant OS for <br className="hidden md:block" />
                        <span className="relative inline-block text-emerald-800">
                            modern education.
                            <svg className="absolute w-full h-3 -bottom-1 left-0 text-lime-400 -z-10" viewBox="0 0 100 10" preserveAspectRatio="none">
                                <path d="M0 5 Q 50 10 100 5" stroke="currentColor" strokeWidth="8" fill="none" opacity="0.6"></path>
                            </svg>
                        </span>
                    </h1>

                    <p className="text-lg md:text-xl text-emerald-900/60 max-w-2xl mx-auto mb-10 leading-relaxed animate-fade-up delay-200">
                        Unify your entire campus with a beautifully crafted interface. Experience the perfect harmony of form and function.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20 animate-fade-up delay-300">
                        <button
                            onClick={handleEnterClick}
                            className="w-full sm:w-auto px-8 py-4 bg-emerald-900 text-white rounded-full font-bold text-lg hover:bg-emerald-800 transition-all shadow-xl hover:shadow-2xl hover:-translate-y-1 flex items-center justify-center gap-2"
                        >
                            Enter Workspace
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"></path>
                            </svg>
                        </button>
                        <button className="w-full sm:w-auto px-8 py-4 bg-white text-emerald-900 border border-emerald-900/10 rounded-full font-bold text-lg hover:bg-lime-50 transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-2 group">
                            <span className="w-8 h-8 rounded-full bg-lime-100 flex items-center justify-center group-hover:bg-lime-400 transition-colors">
                                <svg className="w-3 h-3 text-emerald-900 fill-current" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z"></path>
                                </svg>
                            </span>
                            Watch Demo
                        </button>
                    </div>

                    <div className="relative max-w-5xl mx-auto animate-fade-up delay-300">
                        <div className="absolute inset-0 bg-emerald-900/20 blur-3xl rounded-[40px] transform translate-y-10 scale-95"></div>
                        <div className="relative bg-cream-dark rounded-t-3xl border border-white/50 shadow-2xl overflow-hidden p-2 pb-0">
                            <div className="bg-white h-full rounded-t-2xl border border-emerald-900/5 p-6 pb-0">
                                <div className="flex items-center gap-2 mb-6">
                                    <div className="w-3 h-3 rounded-full bg-red-400"></div>
                                    <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                                    <div className="w-3 h-3 rounded-full bg-green-400"></div>
                                    <div className="ml-4 h-6 w-96 bg-gray-100 rounded-md"></div>
                                </div>
                                <div className="grid grid-cols-4 gap-6">
                                    <div className="col-span-1 bg-gray-50 h-64 rounded-xl border border-gray-100 p-4 space-y-3">
                                        <div className="w-12 h-12 bg-lime-100 rounded-lg"></div>
                                        <div className="h-4 w-24 bg-gray-200 rounded"></div>
                                        <div className="h-3 w-16 bg-gray-100 rounded"></div>
                                        <div className="mt-8 space-y-2">
                                            <div className="h-8 w-full bg-white rounded shadow-sm"></div>
                                            <div className="h-8 w-full bg-white rounded shadow-sm"></div>
                                            <div className="h-8 w-full bg-white rounded shadow-sm"></div>
                                        </div>
                                    </div>
                                    <div className="col-span-3 grid grid-cols-3 gap-6">
                                        <div className="h-32 bg-emerald-50 rounded-xl border border-emerald-100/50 p-4">
                                            <div className="h-8 w-8 bg-emerald-200 rounded-full mb-2"></div>
                                            <div className="h-4 w-16 bg-emerald-200/50 rounded"></div>
                                        </div>
                                        <div className="h-32 bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                                            <div className="h-8 w-8 bg-gray-100 rounded-full mb-2"></div>
                                            <div className="h-4 w-16 bg-gray-100 rounded"></div>
                                        </div>
                                        <div className="h-32 bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                                            <div className="h-8 w-8 bg-gray-100 rounded-full mb-2"></div>
                                            <div className="h-4 w-16 bg-gray-100 rounded"></div>
                                        </div>
                                        <div className="col-span-3 h-32 bg-white rounded-xl border border-gray-100 shadow-sm mt-auto flex items-end p-6 gap-4">
                                            <div className="h-12 w-full bg-gray-100 rounded-t"></div>
                                            <div className="h-20 w-full bg-emerald-100 rounded-t"></div>
                                            <div className="h-16 w-full bg-gray-100 rounded-t"></div>
                                            <div className="h-24 w-full bg-lime-200 rounded-t"></div>
                                            <div className="h-14 w-full bg-gray-100 rounded-t"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Features Section */}
            <section className="py-24 bg-white relative">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="text-center mb-16">
                        <span className="text-emerald-600 font-bold tracking-wider text-sm uppercase mb-2 block">Comprehensive Tools</span>
                        <h2 className="text-3xl md:text-4xl font-extrabold text-emerald-900 mb-4">Everything Your School Needs</h2>
                        <p className="text-emerald-900/60 max-w-2xl mx-auto">From admissions to alumni, Kryin School provides a comprehensive suite of tools designed to simplify school administration.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        <FeatureCard
                            icon={<svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>}
                            title="Smart Attendance"
                            description="Automated tracking with detailed analytics and instant parent notifications."
                        />
                        <FeatureCard
                            icon={<svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>}
                            title="Fee Management"
                            description="Elegant invoicing, multiple gateways, and automated overdue reminders."
                        />
                        <FeatureCard
                            icon={<svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>}
                            title="Live Classes"
                            description="Built-in, high-definition video infrastructure for seamless remote learning."
                        />
                        <FeatureCard
                            icon={<svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>}
                            title="Exam Center"
                            description="Comprehensive grading, beautiful report cards, and automated rankings."
                        />
                        <FeatureCard
                            icon={<svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>}
                            title="Library System"
                            description="Digital cataloging, automated due dates, and intuitive search functionality."
                        />
                        <FeatureCard
                            icon={<svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>}
                            title="Parent Portal"
                            description="A dedicated, transparent view for parents to track their child's success."
                        />
                    </div>
                </div>
            </section>

            {/* Analytics Hook Section */}
            <section className="py-24 bg-cream-dark border-y border-emerald-900/5 overflow-hidden">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="flex flex-col md:flex-row items-end justify-between mb-16 gap-8">
                        <div className="max-w-xl">
                            <span className="text-lime-600 font-bold tracking-wider text-sm uppercase mb-2 block">Data Driven</span>
                            <h2 className="text-3xl md:text-4xl font-extrabold text-emerald-900 mb-4">Real-Time Analytics</h2>
                            <p className="text-emerald-900/60">Make data-driven decisions with detailed reports and visualizations. Monitor performance, attendance, and finances at a glance.</p>
                        </div>
                        <Link to="/dashboard" className="text-emerald-900 font-bold flex items-center gap-2 hover:gap-4 transition-all">
                            View Full Dashboard <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"></path></svg>
                        </Link>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                        <div className="lg:col-span-3 space-y-6">
                            <div className="bg-white p-6 rounded-3xl shadow-soft border border-emerald-900/5">
                                <div className="text-sm font-medium text-emerald-900/50 mb-1">Total Revenue</div>
                                <div className="text-3xl font-extrabold text-emerald-900 mb-2">$2.4M</div>
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
                                    +12.5% this month
                                </div>
                            </div>
                            <div className="bg-white p-6 rounded-3xl shadow-soft border border-emerald-900/5">
                                <div className="text-sm font-medium text-emerald-900/50 mb-1">Active Students</div>
                                <div className="text-3xl font-extrabold text-emerald-900 mb-2">50K+</div>
                                <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
                                    <div className="bg-lime-400 h-1.5 rounded-full" style={{ width: '92%' }}></div>
                                </div>
                                <div className="text-xs text-emerald-900/40 mt-2 font-medium">150+ Schools</div>
                            </div>
                        </div>

                        <div className="lg:col-span-6 bg-white p-8 rounded-3xl shadow-soft border border-emerald-900/5 flex flex-col">
                            <div className="flex justify-between items-center mb-8">
                                <h3 className="font-bold text-emerald-900">Attendance Overview</h3>
                                <div className="flex gap-2">
                                    <span className="w-3 h-3 rounded-full bg-emerald-800"></span> <span className="text-xs text-gray-500">Present</span>
                                    <span className="w-3 h-3 rounded-full bg-lime-400 ml-2"></span> <span className="text-xs text-gray-500">Absent</span>
                                </div>
                            </div>
                            <div className="flex-1 flex items-end justify-between gap-4 h-64 px-2">
                                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day, i) => (
                                    <div key={i} className="w-full flex flex-col justify-end gap-1 h-full group cursor-pointer">
                                        <div className="w-full bg-emerald-800 rounded-t-sm h-[60%] opacity-90 group-hover:opacity-100 transition-opacity" style={{ height: `${60 + i * 5}%` }}></div>
                                        <div className="w-full bg-lime-400 rounded-t-sm h-[15%] opacity-90 group-hover:opacity-100 transition-opacity" style={{ height: `${15 - i * 2}%` }}></div>
                                        <div className="text-[10px] text-center text-gray-400 mt-2">{day}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="lg:col-span-3 bg-white p-8 rounded-3xl shadow-soft border border-emerald-900/5 flex flex-col justify-center items-center">
                            <h3 className="font-bold text-emerald-900 mb-6 w-full text-left">Fee Status</h3>
                            <div className="relative w-40 h-40">
                                <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                                    <path className="text-gray-100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4"></path>
                                    <path className="text-emerald-800" strokeDasharray="70, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4"></path>
                                    <path className="text-lime-400" strokeDasharray="20, 100" strokeDashoffset="-70" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4"></path>
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-2xl font-bold text-emerald-900">70%</span>
                                    <span className="text-xs text-gray-400">Paid</span>
                                </div>
                            </div>
                            <div className="w-full mt-6 space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-800"></span> Paid</span>
                                    <span className="font-bold">70%</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-lime-400"></span> Pending</span>
                                    <span className="font-bold">20%</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-gray-100"></span> Late</span>
                                    <span className="font-bold">10%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="mt-8 text-center opacity-25">
                        <p className="text-[10px] md:text-xs text-emerald-900 font-medium italic tracking-wide">
                            * Dashboard preview using illustrative data
                        </p>
                    </div>
                </div>
            </section>

            {/* ─────────────────────────────────────────────── */}
            {/* 📝 Author: Narco / Arth                        */}
            {/* 🔗 GitHub: https://github.com/ArthOfficial      */}
            {/* 🌐 Website: https://arth-hub.vercel.app         */}
            {/* © 2026 Arth — All rights reserved.              */}
            {/* ─────────────────────────────────────────────── */}

            {/* Testimonials */}
            <section className="py-24 bg-white">
                <div className="max-w-7xl mx-auto px-6">
                    <h2 className="text-3xl font-bold text-center text-emerald-900 mb-16">
                        Trusted by 500+ Schools
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        <TestimonialCard
                            stars="★★★★★"
                            quote="Kryin School has completely revolutionized how we track attendance and grades. The interface is intuitive and our teachers love it."
                            name="User 1"
                            title="School 1"
                            img="https://ui-avatars.com/api/?name=User&background=E5E7EB&color=6B7280"
                        />
                        <TestimonialCard
                            stars="★★★★★"
                            quote="Finally, a unified system that handles fees, library, and exams in one place. The support team is also fantastic and responsive."
                            name="User 2"
                            title="School 2"
                            img="https://ui-avatars.com/api/?name=User&background=E5E7EB&color=6B7280"
                        />
                        <TestimonialCard
                            stars="★★★★★"
                            quote="The parent portal has reduced our administrative call volume significantly. Parents love seeing real-time updates."
                            name="User 3"
                            title="School 3"
                            img="https://ui-avatars.com/api/?name=User&background=E5E7EB&color=6B7280"
                        />
                    </div>
                </div>
            </section>
            </main>

            {/* Footer */}
            <footer className="bg-emerald-900 text-white py-16">
                <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
                    <div className="col-span-1">
                        <div className="flex items-center gap-2 mb-6">
                            <div className="w-8 h-8 bg-lime-400 rounded-lg flex items-center justify-center text-emerald-900">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 14l9-5-9-5-9 5 9 5z"></path>
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"></path>
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222"></path>
                                </svg>
                            </div>
                            <span className="text-lg font-semibold tracking-tight">Kryin <span className="font-normal text-white/70">School</span></span>
                        </div>
                        <p className="text-emerald-100/90 text-sm">Empowering educational institutions with next-generation management tools.</p>
                    </div>
                    <div>
                        <h3 className="font-bold mb-4 text-lime-400">Platform</h3>
                        <ul className="space-y-2 text-sm text-emerald-100/90">
                            <li><a href="#" className="hover:text-white">Features</a></li>
                            <li><a href="#" className="hover:text-white">Pricing</a></li>
                            <li><a href="#" className="hover:text-white">Support</a></li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="font-bold mb-4 text-lime-400">Company</h3>
                        <ul className="space-y-2 text-sm text-emerald-100/90">
                            <li><a href="#" className="hover:text-white">About Us</a></li>
                            <li><a href="#" className="hover:text-white">Careers</a></li>
                            <li><a href="#" className="hover:text-white">Contact</a></li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="font-bold mb-4 text-lime-400">Legal</h3>
                        <ul className="space-y-2 text-sm text-emerald-100/90">
                            <li><a href="#" className="hover:text-white">Privacy</a></li>
                            <li><a href="#" className="hover:text-white">Terms</a></li>
                            <li><a href="#" className="hover:text-white">Security</a></li>
                        </ul>
                    </div>
                </div>
            </footer>
        </div>
    );
};

const FeatureCard: React.FC<{ icon: React.ReactNode; title: string; description: string }> = ({ icon, title, description }) => (
    <div className="p-8 bg-cream rounded-3xl border border-emerald-900/5 hover:shadow-card transition-all hover:-translate-y-1 group">
        <div className="w-14 h-14 bg-white rounded-2xl shadow-sm border border-emerald-100 flex items-center justify-center text-emerald-900 mb-6 group-hover:bg-emerald-900 group-hover:text-lime-400 transition-colors">
            {icon}
        </div>
        <h3 className="text-xl font-bold text-emerald-900 mb-3">{title}</h3>
        <p className="text-emerald-900/60 leading-relaxed text-sm">{description}</p>
    </div>
);

const TestimonialCard: React.FC<{ stars: string; quote: string; name: string; title: string; img: string }> = ({ stars, quote, name, title, img }) => (
    <div className="p-8 bg-cream rounded-3xl border border-emerald-900/5">
        <div className="flex text-yellow-400 mb-4">{stars}</div>
        <p className="text-emerald-900/70 italic mb-6 leading-relaxed">"{quote}"</p>
        <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-emerald-200 overflow-hidden">
                <img src={img} alt={name} className="w-full h-full object-cover" />
            </div>
            <div>
                <div className="text-sm font-bold text-emerald-900">{name}</div>
                <div className="text-xs text-emerald-900/50 uppercase tracking-wide font-bold">{title}</div>
            </div>
        </div>
    </div>
);

export default LandingPage;
