import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { AuthProvider, useAuth } from './context/AuthContext';
import AppErrorBoundary from './components/AppErrorBoundary';
import NotFound from './pages/NotFound';
import LandingPage from './pages/LandingPage';
import ProtectedRoute from './components/auth/ProtectedRoute';
import PageTransition from './components/ui/PageTransition';
import RGBToast from './components/ui/RGBToast';
import GlobalLoader from './components/ui/GlobalLoader';
import DevDiagnosticsPanel from './components/dev/DevDiagnosticsPanel';
import SubscriptionBanner from './components/billing/SubscriptionBanner';
import SubscriptionGate from './components/billing/SubscriptionGate';
import { Toaster as SonnerToaster } from 'sonner';

const HomepageV2 = lazy(() => import('./pages/HomepageV2'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const SuperAdminDashboard = lazy(() => import('./pages/SuperAdminDashboard'));
const SuperAdminDatabase = lazy(() => import('./pages/SuperAdminDatabase'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const FinanceBilling = lazy(() => import('./pages/FinanceBilling'));
const SchoolFinance = lazy(() => import('./pages/SchoolFinance'));
const SystemAlerts = lazy(() => import('./pages/SystemAlerts'));
const GlobalSetup = lazy(() => import('./pages/GlobalSetup'));
const AttendancePage = lazy(() => import('./pages/AttendancePage'));
const Classes = lazy(() => import('./pages/Classes'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const BestSchoolManagementSoftware = lazy(() => import('./pages/BestSchoolManagementSoftware'));
const OAuthConsent = lazy(() => import('./pages/OAuthConsent'));
const FocusMode = lazy(() => import('./pages/FocusMode'));
const StudentFees = lazy(() => import('./pages/StudentFees'));
const StudentTests = lazy(() => import('./pages/StudentTests'));
const StudentPerformance = lazy(() => import('./pages/StudentPerformance'));
const MarksEntry = lazy(() => import('./pages/MarksEntry'));
const TestManagement = lazy(() => import('./pages/TestManagement'));
const Announcements = lazy(() => import('./pages/Announcements'));

function RouteLoading() {
  return <div className="min-h-screen bg-background" aria-busy="true" aria-label="Loading page" />;
}

function AppContent() {
  const location = useLocation();
  const { toast, hideToast, isTransitioning, transition } = useAuth();

  if (location.pathname === '/oauth/consent') {
    return <Suspense fallback={<RouteLoading />}><OAuthConsent /></Suspense>;
  }

  return (
    <>
      <SubscriptionBanner />
      <SubscriptionGate>
      <AnimatePresence mode="sync">
      <Suspense fallback={<RouteLoading />}>
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<PageTransition><LandingPage /></PageTransition>} />
          <Route path="/homepage-v2" element={<PageTransition><HomepageV2 /></PageTransition>} />
          <Route path="/reset-password" element={<PageTransition><ResetPassword /></PageTransition>} />
          <Route path="/blog/best-school-management-software" element={<PageTransition><BestSchoolManagementSoftware /></PageTransition>} />
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <PageTransition><Dashboard /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/announcements" element={<ProtectedRoute><PageTransition><Announcements /></PageTransition></ProtectedRoute>} />
          <Route path="/focus" element={
            <ProtectedRoute allowedRoles={['student']}>
              <FocusMode />
            </ProtectedRoute>
          } />
          <Route path="/fees" element={<ProtectedRoute allowedRoles={['student', 'parent']}><PageTransition><StudentFees /></PageTransition></ProtectedRoute>} />
          <Route path="/tests" element={<ProtectedRoute allowedRoles={['student', 'parent']}><PageTransition><StudentTests /></PageTransition></ProtectedRoute>} />
          <Route path="/performance" element={<ProtectedRoute allowedRoles={['student', 'parent']}><PageTransition><StudentPerformance /></PageTransition></ProtectedRoute>} />
          <Route path="/marks" element={<ProtectedRoute allowedRoles={['admin', 'teacher']}><PageTransition><MarksEntry /></PageTransition></ProtectedRoute>} />
          <Route path="/manage-tests" element={<ProtectedRoute allowedRoles={['admin', 'teacher']}><PageTransition><TestManagement /></PageTransition></ProtectedRoute>} />
          <Route path="/super-admin" element={
            <ProtectedRoute allowedRoles={['superadmin']}>
              <PageTransition><SuperAdminDashboard /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/database" element={
            <ProtectedRoute allowedRoles={['superadmin']}>
              <PageTransition><SuperAdminDatabase /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/users" element={
            <ProtectedRoute allowedRoles={['superadmin', 'admin', 'receptionist']}>
              <PageTransition><UserManagement /></PageTransition>
            </ProtectedRoute>
          } />
          {/* ─────────────────────────────────────────────── */}
          {/* 📝 Author: Narco / Arth                        */}
          {/* 🔗 GitHub: https://github.com/ArthOfficial      */}
          {/* 🌐 Website: https://arth-hub.vercel.app         */}
          {/* © 2026 Arth — All rights reserved.              */}
          {/* ─────────────────────────────────────────────── */}

          <Route path="/finance" element={
            <ProtectedRoute allowedRoles={['superadmin']}>
              <PageTransition><FinanceBilling /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/school-finance" element={
            <ProtectedRoute allowedRoles={['admin', 'accountant']}>
              <PageTransition><SchoolFinance /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/alerts" element={
            <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
              <PageTransition><SystemAlerts /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
              <PageTransition><GlobalSetup /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/global-setup" element={
            <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
              <PageTransition><GlobalSetup /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/attendance" element={
            <ProtectedRoute allowedRoles={['admin', 'teacher']}>
              <PageTransition><AttendancePage /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/classes" element={
            <ProtectedRoute allowedRoles={['superadmin', 'admin', 'teacher', 'receptionist', 'accountant']}>
              <PageTransition><Classes /></PageTransition>
            </ProtectedRoute>
          } />
          {/* Catch-all: any unknown route renders the animated 404 page. */}
          <Route path="*" element={<PageTransition><NotFound /></PageTransition>} />
        </Routes>
      </Suspense>
      </AnimatePresence>
      </SubscriptionGate>

      <RGBToast
        show={toast.show}
        message={toast.message}
        onClose={hideToast}
      />
      <GlobalLoader
        show={isTransitioning || transition.show}
        message={transition.message}
        messages={transition.messages}
        submessage={transition.submessage}
      />
      <DevDiagnosticsPanel />
      <SonnerToaster position="top-right" richColors closeButton />
    </>
  );
}

function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <Router>
          <AppContent />
        </Router>
      </AuthProvider>
    </AppErrorBoundary>
  );
}

export default App;
